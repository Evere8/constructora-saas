"""Add explicit assignee workflow states to project tasks.

Revision ID: 0017_task_workflow_statuses
Revises: 0016_archive_verification
"""

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision = "0017_task_workflow_statuses"
down_revision = "0016_archive_verification"
branch_labels = None
depends_on = None

TASK_STATUS_CHECK = (
    "status in ('pending','received','in_progress','missing_tool','review',"
    "'custom','completed','cancelled')"
)


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.add_column(
        "tasks",
        sa.Column("custom_status_label", sa.String(80), nullable=True),
    )
    ddl.replace_check_constraint("ck_tasks_status", "tasks", TASK_STATUS_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_tasks_status", "tasks", type_="check")
    op.create_check_constraint(
        "ck_tasks_status",
        "tasks",
        "status in ('pending','in_progress','review','completed','cancelled')",
    )
    op.drop_column("tasks", "custom_status_label")
