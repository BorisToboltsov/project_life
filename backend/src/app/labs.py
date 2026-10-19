"""Справочник штатных показателей анализов и пересчёт их единиц (ADR 0022).

У каждого показателя одна каноническая единица — в ней значения ложатся на график, — и
единицы, в которых его печатают лаборатории, с множителем перевода. Название показателя и
единиц подбирает интерфейс по коду.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum


class LabGroup(StrEnum):
    """Группа показателей — так их перечисляют бланки и экран выбора."""

    CBC = "cbc"
    BIOCHEMISTRY = "biochemistry"
    LIPIDS = "lipids"
    IRON_VITAMINS = "iron_vitamins"
    THYROID = "thyroid"
    HORMONES = "hormones"


class LabUnit(StrEnum):
    G_L = "g_l"
    G_DL = "g_dl"
    MMOL_L = "mmol_l"
    MG_DL = "mg_dl"
    UMOL_L = "umol_l"
    U_L = "u_l"
    PERCENT = "percent"
    E12_L = "e12_l"
    E9_L = "e9_l"
    FL = "fl"
    PG = "pg"
    MM_H = "mm_h"
    MG_L = "mg_l"
    UG_L = "ug_l"
    NG_ML = "ng_ml"
    PG_ML = "pg_ml"
    PMOL_L = "pmol_l"
    NMOL_L = "nmol_l"
    UIU_ML = "uiu_ml"
    MIU_L = "miu_l"
    NG_DL = "ng_dl"
    UG_DL = "ug_dl"


class LabPreset(StrEnum):
    """Штатные показатели в порядке экрана выбора: по группам, как на бланках."""

    HEMOGLOBIN = "hemoglobin"
    RBC = "rbc"
    HEMATOCRIT = "hematocrit"
    MCV = "mcv"
    MCH = "mch"
    MCHC = "mchc"
    WBC = "wbc"
    NEUTROPHILS = "neutrophils"
    LYMPHOCYTES = "lymphocytes"
    MONOCYTES = "monocytes"
    EOSINOPHILS = "eosinophils"
    BASOPHILS = "basophils"
    PLATELETS = "platelets"
    ESR = "esr"
    GLUCOSE = "glucose"
    HBA1C = "hba1c"
    ALT = "alt"
    AST = "ast"
    BILIRUBIN_TOTAL = "bilirubin_total"
    CREATININE = "creatinine"
    UREA = "urea"
    URIC_ACID = "uric_acid"
    TOTAL_PROTEIN = "total_protein"
    CRP = "crp"
    CHOLESTEROL_TOTAL = "cholesterol_total"
    LDL = "ldl"
    HDL = "hdl"
    TRIGLYCERIDES = "triglycerides"
    FERRITIN = "ferritin"
    IRON = "iron"
    VITAMIN_D = "vitamin_d"
    VITAMIN_B12 = "vitamin_b12"
    FOLATE = "folate"
    TSH = "tsh"
    FT4 = "ft4"
    FT3 = "ft3"
    TESTOSTERONE = "testosterone"


@dataclass(frozen=True)
class LabPresetType:
    code: LabPreset
    group: LabGroup
    # Каноническая единица: в ней значение хранится для графика (ADR 0004).
    unit: LabUnit
    # Допустимый диапазон в канонической единице: отсекает опечатки, а не редкие случаи.
    min_value: Decimal
    max_value: Decimal
    # Другие единицы бланков и сколько канонических единиц в одной такой.
    alternatives: tuple[tuple[LabUnit, Decimal], ...] = ()

    @property
    def units(self) -> dict[LabUnit, Decimal]:
        """Все единицы показателя с множителем перевода; каноническая — первой."""
        return {self.unit: Decimal(1), **dict(self.alternatives)}


def _cbc(
    code: LabPreset, unit: LabUnit, low: str, high: str, *alt: tuple[LabUnit, Decimal]
) -> LabPresetType:
    return LabPresetType(code, LabGroup.CBC, unit, Decimal(low), Decimal(high), alt)


# Множители — общепринятые для клинических пересчётов: через молярную массу вещества.
_G_DL = (LabUnit.G_DL, Decimal(10))
_CHOLESTEROL_MG_DL = (LabUnit.MG_DL, Decimal("0.02586"))

CATALOG: dict[LabPreset, LabPresetType] = {
    item.code: item
    for item in (
        _cbc(LabPreset.HEMOGLOBIN, LabUnit.G_L, "20", "250", _G_DL),
        _cbc(LabPreset.RBC, LabUnit.E12_L, "0.5", "10"),
        _cbc(LabPreset.HEMATOCRIT, LabUnit.PERCENT, "5", "80"),
        _cbc(LabPreset.MCV, LabUnit.FL, "40", "160"),
        _cbc(LabPreset.MCH, LabUnit.PG, "10", "60"),
        _cbc(LabPreset.MCHC, LabUnit.G_L, "150", "500", _G_DL),
        _cbc(LabPreset.WBC, LabUnit.E9_L, "0.1", "500"),
        _cbc(LabPreset.NEUTROPHILS, LabUnit.PERCENT, "0", "100"),
        _cbc(LabPreset.LYMPHOCYTES, LabUnit.PERCENT, "0", "100"),
        _cbc(LabPreset.MONOCYTES, LabUnit.PERCENT, "0", "100"),
        _cbc(LabPreset.EOSINOPHILS, LabUnit.PERCENT, "0", "100"),
        _cbc(LabPreset.BASOPHILS, LabUnit.PERCENT, "0", "100"),
        _cbc(LabPreset.PLATELETS, LabUnit.E9_L, "1", "3000"),
        _cbc(LabPreset.ESR, LabUnit.MM_H, "0", "200"),
        LabPresetType(
            LabPreset.GLUCOSE,
            LabGroup.BIOCHEMISTRY,
            LabUnit.MMOL_L,
            Decimal("0.5"),
            Decimal(60),
            ((LabUnit.MG_DL, Decimal("0.0555")),),
        ),
        LabPresetType(
            LabPreset.HBA1C, LabGroup.BIOCHEMISTRY, LabUnit.PERCENT, Decimal(2), Decimal(25)
        ),
        LabPresetType(
            LabPreset.ALT, LabGroup.BIOCHEMISTRY, LabUnit.U_L, Decimal(0), Decimal(10000)
        ),
        LabPresetType(
            LabPreset.AST, LabGroup.BIOCHEMISTRY, LabUnit.U_L, Decimal(0), Decimal(10000)
        ),
        LabPresetType(
            LabPreset.BILIRUBIN_TOTAL,
            LabGroup.BIOCHEMISTRY,
            LabUnit.UMOL_L,
            Decimal(0),
            Decimal(1000),
            ((LabUnit.MG_DL, Decimal("17.1")),),
        ),
        LabPresetType(
            LabPreset.CREATININE,
            LabGroup.BIOCHEMISTRY,
            LabUnit.UMOL_L,
            Decimal(5),
            Decimal(3000),
            ((LabUnit.MG_DL, Decimal("88.4")),),
        ),
        LabPresetType(
            LabPreset.UREA, LabGroup.BIOCHEMISTRY, LabUnit.MMOL_L, Decimal("0.3"), Decimal(150)
        ),
        LabPresetType(
            LabPreset.URIC_ACID,
            LabGroup.BIOCHEMISTRY,
            LabUnit.UMOL_L,
            Decimal(10),
            Decimal(2000),
            ((LabUnit.MG_DL, Decimal("59.48")),),
        ),
        LabPresetType(
            LabPreset.TOTAL_PROTEIN,
            LabGroup.BIOCHEMISTRY,
            LabUnit.G_L,
            Decimal(10),
            Decimal(200),
            (_G_DL,),
        ),
        LabPresetType(
            LabPreset.CRP, LabGroup.BIOCHEMISTRY, LabUnit.MG_L, Decimal(0), Decimal(1000)
        ),
        LabPresetType(
            LabPreset.CHOLESTEROL_TOTAL,
            LabGroup.LIPIDS,
            LabUnit.MMOL_L,
            Decimal("0.5"),
            Decimal(40),
            (_CHOLESTEROL_MG_DL,),
        ),
        LabPresetType(
            LabPreset.LDL,
            LabGroup.LIPIDS,
            LabUnit.MMOL_L,
            Decimal("0.05"),
            Decimal(30),
            (_CHOLESTEROL_MG_DL,),
        ),
        LabPresetType(
            LabPreset.HDL,
            LabGroup.LIPIDS,
            LabUnit.MMOL_L,
            Decimal("0.05"),
            Decimal(10),
            (_CHOLESTEROL_MG_DL,),
        ),
        LabPresetType(
            LabPreset.TRIGLYCERIDES,
            LabGroup.LIPIDS,
            LabUnit.MMOL_L,
            Decimal("0.05"),
            Decimal(100),
            ((LabUnit.MG_DL, Decimal("0.01129")),),
        ),
        LabPresetType(
            LabPreset.FERRITIN,
            LabGroup.IRON_VITAMINS,
            LabUnit.UG_L,
            Decimal(0),
            Decimal(20000),
            ((LabUnit.NG_ML, Decimal(1)),),
        ),
        LabPresetType(
            LabPreset.IRON,
            LabGroup.IRON_VITAMINS,
            LabUnit.UMOL_L,
            Decimal("0.5"),
            Decimal(150),
            ((LabUnit.UG_DL, Decimal("0.1791")),),
        ),
        LabPresetType(
            LabPreset.VITAMIN_D,
            LabGroup.IRON_VITAMINS,
            LabUnit.NG_ML,
            Decimal(1),
            Decimal(300),
            ((LabUnit.NMOL_L, Decimal("0.4006")),),
        ),
        LabPresetType(
            LabPreset.VITAMIN_B12,
            LabGroup.IRON_VITAMINS,
            LabUnit.PG_ML,
            Decimal(10),
            Decimal(10000),
            ((LabUnit.PMOL_L, Decimal("1.355")),),
        ),
        LabPresetType(
            LabPreset.FOLATE,
            LabGroup.IRON_VITAMINS,
            LabUnit.NG_ML,
            Decimal("0.1"),
            Decimal(200),
            ((LabUnit.NMOL_L, Decimal("0.4413")),),
        ),
        LabPresetType(
            LabPreset.TSH,
            LabGroup.THYROID,
            LabUnit.UIU_ML,
            Decimal(0),
            Decimal(500),
            ((LabUnit.MIU_L, Decimal(1)),),
        ),
        LabPresetType(
            LabPreset.FT4,
            LabGroup.THYROID,
            LabUnit.PMOL_L,
            Decimal("0.5"),
            Decimal(300),
            ((LabUnit.NG_DL, Decimal("12.87")),),
        ),
        LabPresetType(
            LabPreset.FT3,
            LabGroup.THYROID,
            LabUnit.PMOL_L,
            Decimal("0.5"),
            Decimal(100),
            ((LabUnit.PG_ML, Decimal("1.536")),),
        ),
        LabPresetType(
            LabPreset.TESTOSTERONE,
            LabGroup.HORMONES,
            LabUnit.NMOL_L,
            Decimal(0),
            Decimal(300),
            ((LabUnit.NG_DL, Decimal("0.03467")), (LabUnit.NG_ML, Decimal("3.467"))),
        ),
    )
}

# Свой показатель: что именно измеряют, приложение не знает — диапазон отсекает только
# явные опечатки.
OWN_MAX = Decimal("999999")

# Точность хранения: четыре знака после запятой — как у самых мелких значений бланков
# (ТТГ 0,005) с запасом на пересчёт.
_PRECISION = Decimal("0.0001")


def to_canonical(preset: LabPreset, value: Decimal, unit: LabUnit) -> Decimal | None:
    """Значение в канонической единице показателя; `None` — у показателя нет такой
    единицы."""
    factor = CATALOG[preset].units.get(unit)
    if factor is None:
        return None
    return (value * factor).quantize(_PRECISION, rounding=ROUND_HALF_UP)
