"""Store per-user browser push subscriptions.

Revision ID: 0018_push_subscriptions
Revises: 0017_task_workflow_statuses
"""

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision = "0018_push_subscriptions"
down_revision = "0017_task_workflow_statuses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.create_table(
        "push_subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "company_id",
            sa.String(36),
            sa.ForeignKey("companies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("endpoint_hash", sa.String(64), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_unique_constraint(
        "uq_push_company_user_endpoint",
        "push_subscriptions",
        ["company_id", "user_id", "endpoint_hash"],
    )
    ddl.create_index(
        "ix_push_company_user_active",
        "push_subscriptions",
        ["company_id", "user_id", "is_active"],
    )
    ddl.create_index(
        "ix_push_company_endpoint",
        "push_subscriptions",
        ["company_id", "endpoint_hash"],
    )


def downgrade() -> None:
    op.drop_table("push_subscriptions")
