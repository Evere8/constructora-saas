"""Daily inventory close, activity planning and delegated movement permission.

Revision ID: 0013_daily_operations
Revises: 0012_perforation_annotations
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision: str = "0013_daily_operations"
down_revision: str | None = "0012_perforation_annotations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.add_column(
        "company_memberships",
        sa.Column(
            "can_register_inventory_day", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    ddl.create_table(
        "inventory_day_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("items_json", sa.JSON(), nullable=False),
        sa.Column(
            "registered_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("registered_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_index(
        "ix_inventory_day_company_date",
        "inventory_day_snapshots",
        ["company_id", "snapshot_date", "revision"],
    )
    ddl.create_unique_constraint(
        "uq_inventory_day_revision",
        "inventory_day_snapshots",
        ["company_id", "snapshot_date", "revision"],
    )
    ddl.create_table(
        "inventory_restock_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "requested_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_index(
        "ix_inventory_restock_company_status",
        "inventory_restock_requests",
        ["company_id", "status"],
    )
    ddl.create_table(
        "activity_definitions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("requirements_json", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_unique_constraint(
        "uq_activity_company_title", "activity_definitions", ["company_id", "title"]
    )
    ddl.create_table(
        "daily_activity_plans",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("plan_date", sa.Date(), nullable=False),
        sa.Column("entries_json", sa.JSON(), nullable=False),
        sa.Column(
            "registered_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=True
        ),
        sa.Column("registered_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_unique_constraint(
        "uq_activity_plan_company_date", "daily_activity_plans", ["company_id", "plan_date"]
    )


def downgrade() -> None:
    op.drop_table("daily_activity_plans")
    op.drop_table("activity_definitions")
    op.drop_table("inventory_restock_requests")
    op.drop_table("inventory_day_snapshots")
    op.drop_column("company_memberships", "can_register_inventory_day")
