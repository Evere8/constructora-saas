"""Vincula checklist con tareas y agrega evidencias.

Revision ID: 0003_task_checklist_evidence
Revises: 0002_seed_plans
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_task_checklist_evidence"
down_revision: str | None = "0002_seed_plans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("address", sa.String(300), nullable=True))
    op.add_column(
        "checklist_items",
        sa.Column("task_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_checklists_company_task_status",
        "checklist_items",
        ["company_id", "task_id", "status"],
    )
    op.create_foreign_key(
        "fk_checklist_items_task_id",
        "checklist_items",
        "tasks",
        ["task_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "checklist_evidence",
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
            nullable=False,
        ),
        sa.Column(
            "task_id",
            sa.String(36),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "checklist_item_id",
            sa.String(36),
            sa.ForeignKey("checklist_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("evidence_type", sa.String(20), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.String(500), nullable=True),
        sa.Column("original_filename", sa.String(255), nullable=True),
        sa.Column("mime_type", sa.String(120), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(64), nullable=True),
        sa.Column(
            "uploaded_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "evidence_type in ('photo','document','note')",
            name="ck_checklist_evidence_type",
        ),
        sa.Index(
            "ix_evidence_company_item_created",
            "company_id",
            "checklist_item_id",
            "created_at",
        ),
    )


def downgrade() -> None:
    op.drop_table("checklist_evidence")
    op.drop_constraint("fk_checklist_items_task_id", "checklist_items", type_="foreignkey")
    op.drop_index("ix_checklists_company_task_status", table_name="checklist_items")
    op.drop_column("checklist_items", "task_id")
    op.drop_column("projects", "address")
