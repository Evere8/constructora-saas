"""Permit an inventory relocation to finish in the company warehouse.

Revision ID: 0019_inventory_relocation_warehouse
Revises: 0018_push_subscriptions
"""

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision = "0019_inventory_relocation_warehouse"
down_revision = "0018_push_subscriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # MySQL DDL is non-transactional.  Checking the reflected definition makes
    # a retry safe if a deployment is interrupted after ALTER TABLE completes.
    ResumableDDL(op).set_nullable(
        "inventory_relocation_requests",
        "to_project_id",
        True,
    )


def downgrade() -> None:
    op.alter_column(
        "inventory_relocation_requests",
        "to_project_id",
        existing_type=sa.String(36),
        existing_nullable=True,
        nullable=False,
    )
