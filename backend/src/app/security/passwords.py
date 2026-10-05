from anyio import to_thread
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.config import get_settings


def _build_hasher() -> PasswordHash:
    if get_settings().environment == "test":
        # Минимальная стоимость: тесты проверяют логику, а не стойкость хэша.
        return PasswordHash((Argon2Hasher(time_cost=1, memory_cost=8, parallelism=1),))
    return PasswordHash.recommended()


_hasher = _build_hasher()
# Сверяется, когда пользователя нет: время ответа не выдаёт, существует ли адрес.
_DUMMY_HASH = _hasher.hash("no-such-user")


async def hash_password(password: str) -> str:
    # Argon2 намеренно медленный — считаем в потоке, чтобы не останавливать цикл событий.
    return await to_thread.run_sync(_hasher.hash, password)


async def verify_password(password: str, password_hash: str | None) -> bool:
    matches = await to_thread.run_sync(_hasher.verify, password, password_hash or _DUMMY_HASH)
    return matches and password_hash is not None
