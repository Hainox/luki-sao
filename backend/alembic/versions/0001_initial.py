"""Начальная схема: районы, пользователи, карточки ОЛХ, фото, история, аудит

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-30
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Все CREATE — с IF NOT EXISTS: entrypoint контейнера прогоняет
# `alembic upgrade head` на каждом старте, а при ручном восстановлении из
# pg_dump таблицы уже существуют, хотя alembic_version может отставать.
def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS card_number_seq START WITH 1 MINVALUE 1")

    op.execute("""
        CREATE TABLE IF NOT EXISTS districts (
            id         UUID PRIMARY KEY,
            name       TEXT NOT NULL,
            synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id             UUID PRIMARY KEY,
            login          TEXT NOT NULL,
            full_name      TEXT NOT NULL DEFAULT '',
            role           VARCHAR(20) NOT NULL,
            district_id    UUID,
            last_login_at  TIMESTAMPTZ,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS cards (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            number           INTEGER NOT NULL UNIQUE DEFAULT nextval('card_number_seq'),
            district_id      UUID NOT NULL REFERENCES districts(id),
            address          TEXT NOT NULL,
            lat              NUMERIC(9, 6),
            lon              NUMERIC(9, 6),
            comment          TEXT,
            status           VARCHAR(20) NOT NULL DEFAULT 'detected'
                             CHECK (status IN ('detected', 'on_review', 'accepted', 'returned')),
            current_attempt  INTEGER NOT NULL DEFAULT 0,
            created_by       UUID NOT NULL REFERENCES users(id),
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            accepted_at      TIMESTAMPTZ,
            accepted_by      UUID REFERENCES users(id)
        )
    """)
    op.execute("ALTER SEQUENCE card_number_seq OWNED BY cards.number")
    op.execute("CREATE INDEX IF NOT EXISTS ix_cards_district_created ON cards (district_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_cards_created_at ON cards (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_cards_status ON cards (status)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS card_photos (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            card_id         UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            kind            VARCHAR(10) NOT NULL CHECK (kind IN ('before', 'after')),
            attempt         INTEGER NOT NULL DEFAULT 0,
            storage_path    TEXT NOT NULL,
            thumbnail_path  TEXT,
            preview_path    TEXT,
            uploaded_by     UUID NOT NULL REFERENCES users(id),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK ((kind = 'before' AND attempt = 0) OR (kind = 'after' AND attempt >= 1))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_card_photos_card ON card_photos (card_id, kind, attempt)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS card_events (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            card_id     UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            kind        VARCHAR(20) NOT NULL
                        CHECK (kind IN ('created', 'after_uploaded', 'accepted', 'returned')),
            attempt     INTEGER,
            comment     TEXT,
            user_id     UUID NOT NULL REFERENCES users(id),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_card_events_card ON card_events (card_id, created_at)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id      UUID,
            action       VARCHAR(50) NOT NULL,
            entity_type  VARCHAR(50),
            entity_id    VARCHAR(100),
            details      JSONB,
            ip           VARCHAR(64),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_created ON audit_log (created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("DROP TABLE IF EXISTS card_events")
    op.execute("DROP TABLE IF EXISTS card_photos")
    op.execute("DROP TABLE IF EXISTS cards")
    op.execute("DROP SEQUENCE IF EXISTS card_number_seq")
    op.execute("DROP TABLE IF EXISTS users")
    op.execute("DROP TABLE IF EXISTS districts")
