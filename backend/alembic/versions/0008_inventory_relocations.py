"""Track requested inventory relocations before equipment changes project.

Revision ID: 0008_inventory_relocations
Revises: 0007_project_plan_board
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_inventory_relocations"
down_revision: str | None = "0007_project_plan_board"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_relocation_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            sa.String(36),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "inventory_item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "from_project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "to_project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assigned_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "requested_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id"),
            nullable=False,
        ),
        sa.Column("status", sa.String(25), nullable=False, server_default="pending"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status in ('pending','in_transit','completed','cancelled')",
            name="ck_inventory_relocation_status",
        ),
    )
    op.create_index(
        "ix_inventory_relocations_company_status",
        "inventory_relocation_requests",
        ["company_id", "status"],
    )
    op.create_index(
        "ix_inventory_relocations_task_status",
        "inventory_relocation_requests",
        ["task_id", "status"],
    )
    op.create_index(
        "ix_inventory_relocations_item_status",
        "inventory_relocation_requests",
        ["inventory_item_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_inventory_relocations_item_status",
        table_name="inventory_relocation_requests",
    )
    op.drop_index(
        "ix_inventory_relocations_task_status",
        table_name="inventory_relocation_requests",
    )
    op.drop_index(
        "ix_inventory_relocations_company_status",
        table_name="inventory_relocation_requests",
    )
    op.drop_table("inventory_relocation_requests")
