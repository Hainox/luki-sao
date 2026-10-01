"""Отзыв токенов при выходе (token_blocklist) + индекс.

Revision ID: 0002_token_blocklist
Revises: 0001_initial
Create Date: 2026-10-01
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0002_token_blocklist"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS token_blocklist (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            jti         VARCHAR(64) NOT NULL,
            expires_at  TIMESTAMPTZ NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_token_blocklist_jti ON token_blocklist (jti)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_token_blocklist_expires_at ON token_blocklist (expires_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS token_blocklist")
