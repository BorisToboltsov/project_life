import pytest
from httpx import AsyncClient

from app import cli

pytestmark = pytest.mark.anyio


async def test_invite_command_prints_a_working_admin_link(client: AsyncClient) -> None:
    link = await cli.create_invite_link(cli.Role.ADMIN, "первый администратор")

    base, token = link.split("/invite#")
    assert base == "http://localhost:5173"
    response = await client.post("/api/auth/invite/check", json={"token": token})
    assert response.json()["role"] == "admin"


def test_command_line_parses_role_and_note(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    calls: list[tuple[cli.Role, str | None]] = []

    async def fake(role: cli.Role, note: str | None) -> str:
        calls.append((role, note))
        return "https://example.test/invite#token"

    monkeypatch.setattr(cli, "create_invite_link", fake)

    cli.main(["invite", "--admin", "--note", "для Анны"])
    cli.main(["invite"])

    assert calls == [(cli.Role.ADMIN, "для Анны"), (cli.Role.USER, None)]
    assert capsys.readouterr().out.splitlines() == ["https://example.test/invite#token"] * 2
