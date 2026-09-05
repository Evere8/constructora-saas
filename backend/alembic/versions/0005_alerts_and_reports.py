"""Add persisted operational alerts.

Revision ID: 0005_alerts_and_reports
Revises: 0004_operations_modules
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_alerts_and_reports"
down_revision: str | None = "0004_operations_modules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("planned_start_at", sa.DateTime(), nullable=True))
    op.add_column("tasks", sa.Column("location_text", sa.String(300), nullable=True))
    op.create_table(
        "notifications",
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
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "task_id",
            sa.String(36),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "checklist_item_id",
            sa.String(36),
            sa.ForeignKey("checklist_items.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey("task_material_requirements.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "assigned_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("alert_type", sa.String(40), nullable=False),
        sa.Column("severity", sa.String(15), nullable=False),
        sa.Column("dedupe_key", sa.String(180), nullable=False),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("company_id", "dedupe_key", name="uq_notification_company_dedupe"),
        sa.Index(
            "ix_notifications_company_resolved_due",
            "company_id",
            "resolved_at",
            "due_at",
        ),
        sa.Index("ix_notifications_assignee", "assigned_user_id", "resolved_at"),
        sa.CheckConstraint(
            "severity in ('info','warning','critical')", name="ck_notifications_severity"
        ),
    )
    op.create_table(
        "notification_receipts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "notification_id",
            sa.String(36),
            sa.ForeignKey("notifications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(15), nullable=False, server_default="read"),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("notification_id", "user_id", name="uq_notification_receipt_user"),
        sa.Index("ix_notification_receipts_user_status", "user_id", "status"),
        sa.CheckConstraint(
            "status in ('unread','read','dismissed')", name="ck_notification_receipts_status"
        ),
    )


def downgrade() -> None:
    op.drop_table("notification_receipts")
    op.drop_table("notifications")
    op.drop_column("tasks", "location_text")
    op.drop_column("tasks", "planned_start_at")
