"""Команды администратора сервера: `python -m app.cli invite --admin`."""

import argparse
import asyncio

from app.config import get_settings
from app.db import engine, session_factory
from app.models import Role
from app.services import links


async def create_invite_link(role: Role, note: str | None) -> str:
    async with session_factory() as db:
        _, token = links.create_invite(db, role, note)
        await db.commit()
    await engine.dispose()
    # Токен — во фрагменте адреса: он не уходит на сервер и не попадает в логи.
    return f"{get_settings().public_url.rstrip('/')}/invite#{token}"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    invite = commands.add_parser("invite", help="выпустить ссылку-приглашение")
    invite.add_argument("--admin", action="store_true", help="приглашение с правами администратора")
    invite.add_argument("--note", help="пометка, для кого приглашение")
    args = parser.parse_args(argv)

    role = Role.ADMIN if args.admin else Role.USER
    print(asyncio.run(create_invite_link(role, args.note)))  # noqa: T201


if __name__ == "__main__":
    main()
