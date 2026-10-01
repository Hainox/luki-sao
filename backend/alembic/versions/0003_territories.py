"""Справочник ДТ и ОДХ из реестра АСУ ОДС; место люка в карточке

Revision ID: 0003_territories
Revises: 0002_token_blocklist
Create Date: 2026-10-01
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0003_territories"
down_revision: Union[str, None] = "0002_token_blocklist"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Строки справочника не удаляются, а выключаются (is_active): на объект
    # могут ссылаться карточки, а в новой выгрузке реестра его может не быть.
    # district_keys — названия районов без регистра и «ё»: в журнале обходов
    # «Савёловский», в реестре «Савеловский».
    op.execute("""
        CREATE TABLE IF NOT EXISTS territories (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            kind            VARCHAR(3) NOT NULL CHECK (kind IN ('dt', 'odh')),
            registry_id     TEXT NOT NULL,
            short_id        TEXT,
            name            TEXT NOT NULL,
            district_names  TEXT[] NOT NULL DEFAULT '{}',
            district_keys   TEXT[] NOT NULL DEFAULT '{}',
            owner           TEXT,
            category        TEXT,
            area_m2         NUMERIC(12, 2),
            passport_url    TEXT,
            polygons        JSONB NOT NULL,
            min_lat         DOUBLE PRECISION NOT NULL,
            min_lon         DOUBLE PRECISION NOT NULL,
            max_lat         DOUBLE PRECISION NOT NULL,
            max_lon         DOUBLE PRECISION NOT NULL,
            is_active       BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (kind, registry_id)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_territories_district_keys "
        "ON territories USING GIN (district_keys)"
    )

    op.execute("""
        CREATE TABLE IF NOT EXISTS dataset_versions (
            name         TEXT PRIMARY KEY,
            sha256       TEXT NOT NULL,
            source_date  TEXT,
            items        INTEGER NOT NULL,
            loaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    # У карточек, заведённых до справочника, места нет — колонки допускают
    # NULL, а обязательность для новых карточек проверяет API.
    op.execute("""
        ALTER TABLE cards
            ADD COLUMN IF NOT EXISTS place_kind VARCHAR(3) CHECK (place_kind IN ('dt', 'odh')),
            ADD COLUMN IF NOT EXISTS territory_id UUID REFERENCES territories(id),
            ADD COLUMN IF NOT EXISTS address_note TEXT
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_cards_place_kind ON cards (place_kind)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_cards_place_kind")
    op.execute("""
        ALTER TABLE cards
            DROP COLUMN IF EXISTS address_note,
            DROP COLUMN IF EXISTS territory_id,
            DROP COLUMN IF EXISTS place_kind
    """)
    op.execute("DROP TABLE IF EXISTS dataset_versions")
    op.execute("DROP TABLE IF EXISTS territories")
