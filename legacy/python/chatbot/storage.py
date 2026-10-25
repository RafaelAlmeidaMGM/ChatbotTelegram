"""Persistent tickets; each operation owns and closes its SQLite connection."""

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
from typing import Iterator


@dataclass(frozen=True)
class Ticket:
    id: int
    chat_id: int
    username: str | None
    department: str
    customer_name: str
    company: str
    description: str
    created_at: str
    delivery_status: str


class TicketStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # O_EXCL avoids changing existing file permissions or truncating any file.
        try:
            descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(descriptor)
        with self._connection() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS tickets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    username TEXT,
                    department TEXT NOT NULL,
                    customer_name TEXT NOT NULL,
                    company TEXT NOT NULL,
                    description TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    delivery_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (delivery_status IN ('pending', 'delivered'))
                )"""
            )

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def create_ticket(
        self,
        *,
        chat_id: int,
        username: str | None,
        department: str,
        customer_name: str,
        company: str,
        description: str,
    ) -> Ticket:
        with self._connection() as connection:
            cursor = connection.execute(
                """INSERT INTO tickets (
                    chat_id, username, department, customer_name, company,
                    description, created_at, delivery_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')""",
                (
                    chat_id, username, department, customer_name, company,
                    description, datetime.now(timezone.utc).isoformat(),
                ),
            )
            row = connection.execute(
                "SELECT * FROM tickets WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
            return Ticket(**dict(row))

    def get_ticket(self, ticket_id: int) -> Ticket | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM tickets WHERE id = ?", (ticket_id,)
            ).fetchone()
            return Ticket(**dict(row)) if row is not None else None

    def mark_delivered(self, ticket_id: int) -> None:
        with self._connection() as connection:
            connection.execute(
                "UPDATE tickets SET delivery_status = 'delivered' WHERE id = ?",
                (ticket_id,),
            )

    def pending_tickets(self) -> list[Ticket]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM tickets WHERE delivery_status = 'pending' ORDER BY id"
            ).fetchall()
            return [Ticket(**dict(row)) for row in rows]
