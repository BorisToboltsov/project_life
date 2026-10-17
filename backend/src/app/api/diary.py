from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import ColumnElement, Row, Subquery, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.db import SessionDep
from app.errors import ApiError, ErrorCode, error_responses
from app.models import FoodEntry, Meal, NutritionGoal, Product, WaterIntake
from app.nutrition import MAX_AMOUNT, PortionKind, portions_amount, total
from app.schemas import (
    DayMealOut,
    DiaryCopyIn,
    DiaryDate,
    DiaryDayOut,
    DiaryStatisticsOut,
    FoodEntryIn,
    FoodEntryOut,
    MealIn,
    MealOut,
    NutrientsOut,
    NutritionGoalIn,
    NutritionGoalOut,
    PortionOut,
    ProductOut,
    RecordId,
    StatisticsDate,
    StatisticsPeriod,
    SuggestionOut,
    SuggestionsOut,
    WaterDayOut,
    WaterIntakeIn,
    WaterIntakeOut,
)
from app.services.diary_statistics import statistics

router = APIRouter(prefix="/diary", tags=["nutrition"])

# Столько продуктов в каждой подсказке.
SUGGESTIONS = 10
# За это время считается, как часто продукт вносили; «частый» — внесённый хотя бы дважды.
FREQUENT_WINDOW = timedelta(days=90)

_IN_ORDER = (FoodEntry.created_at, FoodEntry.id)


async def _goal_on(db: AsyncSession, user_id: UUID, day: date) -> NutritionGoal | None:
    """Цель, действовавшая в этот день: последняя из начавшихся не позже него."""
    return await db.scalar(
        select(NutritionGoal)
        .where(NutritionGoal.user_id == user_id, NutritionGoal.effective_from <= day)
        .order_by(NutritionGoal.effective_from.desc())
        .limit(1)
    )


def _shown(goal: NutritionGoal | None) -> NutritionGoalOut | None:
    return NutritionGoalOut.model_validate(goal).if_set() if goal else None


@router.get("")
async def read_day(
    user: CurrentUser, db: SessionDep, day: Annotated[DiaryDate, Query(alias="date")]
) -> DiaryDayOut:
    """День дневника: записи по приёмам пищи, съеденное за приём и за день, выпитая вода,
    цель дня."""
    entries = list(
        await db.scalars(
            select(FoodEntry)
            .where(FoodEntry.user_id == user.id, FoodEntry.local_date == day)
            .order_by(*_IN_ORDER)
        )
    )
    by_meal: defaultdict[UUID, list[FoodEntry]] = defaultdict(list)
    for entry in entries:
        by_meal[entry.meal_id].append(entry)
    meals = await db.scalars(
        select(Meal).where(Meal.user_id == user.id).order_by(Meal.position, Meal.id)
    )
    water = await db.scalars(
        select(WaterIntake)
        .where(WaterIntake.user_id == user.id, WaterIntake.local_date == day)
        .order_by(WaterIntake.created_at, WaterIntake.id)
    )
    return DiaryDayOut(
        local_date=day,
        meals=[
            DayMealOut(
                **MealOut.of(meal).model_dump(),
                entries=[FoodEntryOut.of_entry(entry) for entry in by_meal[meal.id]],
                totals=NutrientsOut.of(total(entry.eaten for entry in by_meal[meal.id])),
            )
            for meal in meals
            # Убранный из списка приём остаётся в тех днях, где в нём есть записи.
            if meal.archived_at is None or by_meal[meal.id]
        ],
        totals=NutrientsOut.of(total(entry.eaten for entry in entries)),
        water=WaterDayOut.of(list(water)),
        goal=_shown(await _goal_on(db, user.id, day)),
    )


def _with_product(user_id: UUID, meal_id: UUID | None) -> list[ColumnElement[bool]]:
    """Записи пользователя с продуктами каталога — во всём дневнике или в одном приёме пищи."""
    mine = [FoodEntry.user_id == user_id, FoodEntry.product_id.is_not(None)]
    return mine if meal_id is None else [*mine, FoodEntry.meal_id == meal_id]


def _last_use(user_id: UUID, meal_id: UUID | None = None) -> Subquery:
    """Последняя запись пользователя с каждым продуктом каталога."""
    recency = (
        func.row_number()
        .over(
            partition_by=FoodEntry.product_id,
            order_by=(FoodEntry.created_at.desc(), FoodEntry.id.desc()),
        )
        .label("recency")
    )
    ranked = (
        select(
            FoodEntry.product_id,
            FoodEntry.amount,
            FoodEntry.portion_kind,
            FoodEntry.portion_count,
            FoodEntry.created_at,
            recency,
        )
        .where(*_with_product(user_id, meal_id))
        .subquery()
    )
    return select(ranked).where(ranked.c.recency == 1).subquery()


def _uses(user_id: UUID, meal_id: UUID | None = None) -> Subquery:
    """Сколько раз пользователь вносил каждый продукт за последнее время."""
    return (
        select(FoodEntry.product_id, func.count().label("times"))
        .where(
            *_with_product(user_id, meal_id),
            FoodEntry.created_at >= datetime.now(UTC) - FREQUENT_WINDOW,
        )
        .group_by(FoodEntry.product_id)
        .subquery()
    )


# Продукт и то, как его внесли в прошлый раз: количество, вид порции и их число.
type _Used = Row[Product, Decimal, PortionKind | None, Decimal | None]


@router.get("/suggestions")
async def suggest_products(
    user: CurrentUser, db: SessionDep, meal_id: UUID | None = None, product_id: UUID | None = None
) -> SuggestionsOut:
    """Продукты, которые пользователь вносит: чаще всего в приём пищи `meal_id`, недавно и
    часто вообще. У каждого — количество, внесённое в прошлый раз, и то, как его внесли."""
    if product_id is not None:
        # История выбранного продукта не ограничена десяткой подсказок и окном частоты.
        # Чужие приёмы не дают доступа к чужим записям: отбор всегда по user.id.
        product = await db.get(Product, product_id)
        if product is None:
            return SuggestionsOut(in_meal=[], recent=[], frequent=[])

        async def last_in(meal: UUID | None) -> list[SuggestionOut]:
            query = (
                select(FoodEntry)
                .where(*_with_product(user.id, meal), FoodEntry.product_id == product_id)
                .order_by(FoodEntry.created_at.desc(), FoodEntry.id.desc())
                .limit(1)
            )
            entry = await db.scalar(query)
            if entry is None:
                return []
            kind = entry.portion_kind
            return [
                SuggestionOut(
                    **ProductOut.of(product, user).model_dump(),
                    amount=float(entry.amount),
                    portion=PortionOut.of(
                        kind, product.size_of(kind) if kind else None, entry.portion_count
                    ),
                )
            ]

        return SuggestionsOut(
            in_meal=await last_in(meal_id) if meal_id else [],
            recent=await last_in(None),
            frequent=[],
        )
    last, uses = _last_use(user.id), _uses(user.id)
    recent = await db.execute(
        select(Product, last.c.amount, last.c.portion_kind, last.c.portion_count)
        .join(last, last.c.product_id == Product.id)
        .order_by(last.c.created_at.desc(), Product.id)
        .limit(SUGGESTIONS)
    )
    frequent = await db.execute(
        select(Product, last.c.amount, last.c.portion_kind, last.c.portion_count)
        .join(last, last.c.product_id == Product.id)
        .join(uses, uses.c.product_id == Product.id)
        .where(uses.c.times > 1)
        .order_by(uses.c.times.desc(), func.lower(Product.name), Product.id)
        .limit(SUGGESTIONS)
    )

    def suggestions(rows: Iterable[_Used]) -> list[SuggestionOut]:
        return [
            SuggestionOut(
                **ProductOut.of(product, user).model_dump(),
                amount=float(amount),
                # Порция предлагается нынешнего размера; если её у продукта больше нет,
                # остаётся количество в его единицах.
                portion=PortionOut.of(kind, product.size_of(kind) if kind else None, count),
            )
            for product, amount, kind, count in rows
        ]

    in_meal: list[SuggestionOut] = []
    if meal_id is not None:
        # Чужой приём пищи ничего не выдаёт: записи отбираются по своему пользователю.
        last_here, uses_here = _last_use(user.id, meal_id), _uses(user.id, meal_id)
        in_meal = suggestions(
            await db.execute(
                # Количество — из прошлого раза в этом же приёме: на завтрак и на ужин
                # одного продукта едят по-разному.
                select(
                    Product, last_here.c.amount, last_here.c.portion_kind, last_here.c.portion_count
                )
                .join(last_here, last_here.c.product_id == Product.id)
                .join(uses_here, uses_here.c.product_id == Product.id)
                .order_by(uses_here.c.times.desc(), last_here.c.created_at.desc(), Product.id)
                .limit(SUGGESTIONS)
            )
        )
    return SuggestionsOut(
        in_meal=in_meal, recent=suggestions(recent), frequent=suggestions(frequent)
    )


async def _own_meal(db: AsyncSession, meal_id: UUID, user_id: UUID) -> Meal | None:
    """Приём пищи пользователя; чужой неотличим от несуществующего (инвариант I5)."""
    meal = await db.get(Meal, meal_id, with_for_update=True)
    if meal is not None and meal.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return meal


@router.put(
    "/meals/{meal_id}",
    responses={201: {"model": MealOut}, **error_responses(404)},
)
async def save_meal(
    meal_id: RecordId,
    body: MealIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> MealOut:
    """Добавляет в список пользователя приём пищи или даёт своему новое название: повтор
    запроса не плодит дубли (ADR 0002). Убранный приём этим же запросом возвращается в
    список. Новый приём встаёт в конец дня.
    """
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    meal = await _own_meal(db, meal_id, user_id)
    if meal is None:
        last = await db.scalar(select(func.max(Meal.position)).where(Meal.user_id == user_id))
        meal = Meal(
            id=meal_id, user_id=user_id, name=body.name, position=0 if last is None else last + 1
        )
        db.add(meal)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своего приёма либо отказ, если приём чужой.
            await db.rollback()
            meal = await _own_meal(db, meal_id, user_id)
    if meal is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    meal.name = body.name
    meal.archived_at = None
    await db.commit()
    return MealOut.of(meal)


@router.delete(
    "/meals/{meal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_meal(meal_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    """Убирает приём пищи из списка. Записи в нём остаются: дни, где он был, показывают
    его по-прежнему (инвариант I10)."""
    meal = await _own_meal(db, meal_id, user.id)
    if meal is None or meal.archived_at is not None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    meal.archived_at = datetime.now(UTC)
    await db.commit()


async def _require_meal(db: AsyncSession, meal_id: UUID, user_id: UUID) -> None:
    """Запись кладётся только в приём пищи из своего списка."""
    meal = await db.get(Meal, meal_id)
    if meal is None or meal.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.MEAL_NOT_FOUND)


async def _own_entry(db: AsyncSession, entry_id: UUID, user_id: UUID) -> FoodEntry | None:
    """Запись пользователя; чужая неотличима от несуществующей (инвариант I5)."""
    entry = await db.get(FoodEntry, entry_id, with_for_update=True)
    if entry is not None and entry.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return entry


async def _how_much(
    db: AsyncSession, body: FoodEntryIn, entry: FoodEntry | None, product: Product | None
) -> dict[str, Any]:
    """Количество записи: в единицах продукта и — если его внесли порциями или упаковками —
    какими, сколько и какого размера.

    `product` — продукт, с которого запись снимается заново; `None` — снимок прежний. Размер
    порции живёт по тем же правилам, что состав: пока продукт и вид порции в записи те же,
    он прежний, что бы ни стало с продуктом (инвариант I10).
    """
    if body.portion is None:
        return {
            "amount": body.amount,
            "portion_kind": None,
            "portion_size": None,
            "portion_count": None,
        }
    kind, count = body.portion.kind, body.portion.count
    if product is None and entry is not None and entry.portion_kind == kind:
        size = entry.portion_size
    else:
        # Запись в единицах или в другой мере переходит на эту: размер — из каталога.
        if product is None and entry is not None and entry.product_id is not None:
            product = await db.get(Product, entry.product_id)
        size = product.size_of(kind) if product else None
    if size is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.PORTION_NOT_FOUND)
    amount = portions_amount(count, size)
    if not 0 < amount <= MAX_AMOUNT:
        raise ApiError(status.HTTP_400_BAD_REQUEST, ErrorCode.AMOUNT_OUT_OF_RANGE)
    return {"amount": amount, "portion_kind": kind, "portion_size": size, "portion_count": count}


@router.put(
    "/entries/{entry_id}",
    responses={201: {"model": FoodEntryOut}, **error_responses(400, 404)},
)
async def save_entry(
    entry_id: RecordId,
    body: FoodEntryIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> FoodEntryOut:
    """Создаёт запись или заменяет свою же: повтор запроса не плодит дубли (ADR 0002).

    Состав продукта снимается в запись при создании и при смене продукта. Пока продукт
    тот же, снимок прежний — даже если продукт в каталоге с тех пор исправили. Так же
    снимается размер порции, если количество внесли порциями или упаковками (ADR 0013).
    """
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    entry = await _own_entry(db, entry_id, user_id)
    await _require_meal(db, body.meal_id, user_id)
    product: Product | None = None
    if entry is None or body.product_id not in (None, entry.product_id):
        product = await db.get(Product, body.product_id) if body.product_id else None
        if product is None:
            raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.PRODUCT_NOT_FOUND)
        snapshot = {
            "product_id": product.id,
            "product_name": product.name,
            "unit": product.unit,
            "kcal": product.kcal,
            "protein_g": product.protein_g,
            "fat_g": product.fat_g,
            "carbs_g": product.carbs_g,
            "sugars_g": product.sugars_g,
            "saturated_fat_g": product.saturated_fat_g,
            "fiber_g": product.fiber_g,
            "salt_g": product.salt_g,
        }
    else:
        snapshot = {}
    fields = {
        "local_date": body.local_date,
        "meal_id": body.meal_id,
        **await _how_much(db, body, entry, product),
        **snapshot,
    }
    if entry is None:
        entry = FoodEntry(id=entry_id, user_id=user_id, **fields)
        db.add(entry)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своей записи либо отказ, если запись чужая.
            await db.rollback()
            entry = await _own_entry(db, entry_id, user_id)
    if entry is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    for name, value in fields.items():
        setattr(entry, name, value)
    await db.commit()
    return FoodEntryOut.of_entry(entry)


@router.delete(
    "/entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_entry(entry_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    entry = await _own_entry(db, entry_id, user.id)
    if entry is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(entry)
    await db.commit()


async def _own_intake(db: AsyncSession, intake_id: UUID, user_id: UUID) -> WaterIntake | None:
    """Порция воды пользователя; чужая неотличима от несуществующей (инвариант I5)."""
    intake = await db.get(WaterIntake, intake_id, with_for_update=True)
    if intake is not None and intake.user_id != user_id:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    return intake


@router.put(
    "/water/{intake_id}",
    responses={201: {"model": WaterIntakeOut}, **error_responses(404)},
)
async def save_water(
    intake_id: RecordId,
    body: WaterIntakeIn,
    user: CurrentUser,
    response: Response,
    db: SessionDep,
) -> WaterIntakeOut:
    """Вносит порцию воды или заменяет свою же: повтор запроса не добавляет вторую
    (ADR 0002)."""
    fields = {"local_date": body.local_date, "amount_ml": body.amount_ml}
    # Запоминаем заранее: откат ниже сбросил бы загруженные поля пользователя.
    user_id = user.id
    intake = await _own_intake(db, intake_id, user_id)
    if intake is None:
        intake = WaterIntake(id=intake_id, user_id=user_id, **fields)
        db.add(intake)
        try:
            await db.flush()
            response.status_code = status.HTTP_201_CREATED
        except IntegrityError:
            # Тот же ключ только что создал параллельный запрос — дальше это замена
            # своей порции либо отказ, если порция чужая.
            await db.rollback()
            intake = await _own_intake(db, intake_id, user_id)
    if intake is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    for name, value in fields.items():
        setattr(intake, name, value)
    await db.commit()
    return WaterIntakeOut.model_validate(intake)


@router.delete(
    "/water/{intake_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(404),
)
async def delete_water(intake_id: RecordId, user: CurrentUser, db: SessionDep) -> None:
    intake = await _own_intake(db, intake_id, user.id)
    if intake is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    await db.delete(intake)
    await db.commit()


@router.post("/copy", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404))
async def copy_entries(body: DiaryCopyIn, user: CurrentUser, db: SessionDep) -> None:
    """Копирует свои записи на другой день вместе со снимками.

    Ключи копий выбирает клиент, так что повтор запроса ничего не дублирует.
    """
    if body.to_meal_id is not None:
        await _require_meal(db, body.to_meal_id, user.id)
    wanted = {item.source_id for item in body.items}
    sources = {
        entry.id: entry
        for entry in await db.scalars(
            select(FoodEntry).where(FoodEntry.user_id == user.id, FoodEntry.id.in_(wanted))
        )
    }
    if len(sources) != len(wanted):
        raise ApiError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)
    # Порядок записей в приёме пищи — по времени создания: копии встают в порядке запроса.
    now = datetime.now(UTC)
    copies = [
        {
            "id": item.id,
            "user_id": user.id,
            "local_date": body.to_date,
            "meal_id": body.to_meal_id or source.meal_id,
            "amount": source.amount,
            "portion_kind": source.portion_kind,
            "portion_size": source.portion_size,
            "portion_count": source.portion_count,
            "product_id": source.product_id,
            "product_name": source.product_name,
            "unit": source.unit,
            "kcal": source.kcal,
            "protein_g": source.protein_g,
            "fat_g": source.fat_g,
            "carbs_g": source.carbs_g,
            "sugars_g": source.sugars_g,
            "saturated_fat_g": source.saturated_fat_g,
            "fiber_g": source.fiber_g,
            "salt_g": source.salt_g,
            "created_at": now + timedelta(microseconds=index),
        }
        for index, item in enumerate(body.items)
        for source in [sources[item.source_id]]
    ]
    await db.execute(insert(FoodEntry).values(copies).on_conflict_do_nothing())
    await db.commit()


@router.get("/goal")
async def read_goal(user: CurrentUser, db: SessionDep) -> NutritionGoalOut | None:
    """Действующая цель на день; `null`, пока она не задана или если её сняли."""
    goal = await db.scalar(
        select(NutritionGoal)
        .where(NutritionGoal.user_id == user.id)
        .order_by(NutritionGoal.effective_from.desc())
        .limit(1)
    )
    return _shown(goal)


@router.put("/goal")
async def save_goal(
    body: NutritionGoalIn, user: CurrentUser, db: SessionDep
) -> NutritionGoalOut | None:
    """Задаёт цель с сегодняшнего дня. Прошлые дни остаются со своей прежней целью.

    Показатель без значения — цели по нему нет; без всех цель с этого дня снята.
    """
    targets = body.model_dump(exclude={"local_date"})
    if "water_ml" not in body.model_fields_set:
        # Прежняя версия приложения о воде не знает: цель по воде остаётся какой была.
        current = await _goal_on(db, user.id, body.local_date)
        targets["water_ml"] = current.water_ml if current else None
    statement = insert(NutritionGoal).values(
        user_id=user.id, effective_from=body.local_date, **targets
    )
    statement = statement.on_conflict_do_update(
        index_elements=[NutritionGoal.user_id, NutritionGoal.effective_from],
        set_={**targets, "updated_at": func.now()},
    )
    await db.execute(statement)
    await db.commit()
    return NutritionGoalOut(effective_from=body.local_date, **targets).if_set()


@router.get("/stats")
async def read_statistics(
    user: CurrentUser,
    db: SessionDep,
    day: Annotated[StatisticsDate, Query(alias="date")],
    period: StatisticsPeriod = "week",
) -> DiaryStatisticsOut:
    return await statistics(db, user.id, day, period, datetime.now(ZoneInfo(user.timezone)).date())
