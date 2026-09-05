"""Complete metadata for document processing jobs.

Revision ID: 0004_operations_modules
Revises: 0003_task_checklist_evidence
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_operations_modules"
down_revision: str | None = "0003_task_checklist_evidence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "elongation_jobs",
        sa.Column("title", sa.String(220), nullable=False, server_default="Documento técnico"),
    )
    op.add_column(
        "elongation_jobs",
        sa.Column("source_kind", sa.String(20), nullable=False, server_default="legacy"),
    )
    op.add_column("elongation_jobs", sa.Column("source_storage_key", sa.String(500)))
    op.add_column("elongation_jobs", sa.Column("original_filename", sa.String(255)))
    op.add_column("elongation_jobs", sa.Column("mime_type", sa.String(120)))
    op.add_column("elongation_jobs", sa.Column("size_bytes", sa.BigInteger()))
    op.add_column("elongation_jobs", sa.Column("sha256", sa.String(64)))
    op.add_column("elongation_jobs", sa.Column("extracted_text", sa.Text()))
    op.add_column("elongation_jobs", sa.Column("error_message", sa.String(500)))
    op.add_column("elongation_jobs", sa.Column("completed_at", sa.DateTime()))
    op.create_index(
        "ix_elongation_company_project_created",
        "elongation_jobs",
        ["company_id", "project_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_elongation_company_project_created", table_name="elongation_jobs")
    for column in (
        "completed_at",
        "error_message",
        "extracted_text",
        "sha256",
        "size_bytes",
        "mime_type",
        "original_filename",
        "source_storage_key",
        "source_kind",
        "title",
    ):
        op.drop_column("elongation_jobs", column)
