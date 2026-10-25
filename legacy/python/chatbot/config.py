"""Read configuration without exposing credential values in errors or reprs."""

from dataclasses import dataclass, field
import os
from pathlib import Path

from .departments import DEPARTMENTS


@dataclass(frozen=True)
class Settings:
    token: str = field(repr=False)
    database_path: Path
    team_chats: dict[str, int]
    company_name: str = "Atendimento"

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        if not token:
            raise ValueError("Defina TELEGRAM_BOT_TOKEN para iniciar o bot.")

        def chat_id(variable: str) -> int | None:
            value = os.environ.get(variable, "").strip()
            if not value:
                return None
            try:
                result = int(value)
            except ValueError:
                raise ValueError(f"{variable} deve ser um ID numérico do Telegram.") from None
            if result >= 0:
                raise ValueError(f"{variable} deve ser um ID negativo de grupo do Telegram.")
            return result

        fallback = chat_id("TEAM_CHAT_ID")
        team_chats = {}
        for department in DEPARTMENTS:
            destination = chat_id(f"{department.key.upper()}_CHAT_ID")
            if destination is None:
                destination = fallback
            if destination is not None:
                team_chats[department.key] = destination

        return cls(
            token=token,
            database_path=Path(
                os.environ.get("DATABASE_PATH", "").strip() or "data/atendimento.sqlite3"
            ),
            team_chats=team_chats,
            company_name=os.environ.get("COMPANY_NAME", "").strip() or "Atendimento",
        )
