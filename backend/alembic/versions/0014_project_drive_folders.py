"""Metadata-only project file tree; content is stored in a separate Drive remote.

Revision ID: 0014_project_drive_folders
Revises: 0013_daily_operations
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision: str = "0014_project_drive_folders"
down_revision: str | None = "0013_daily_operations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.create_table(
        "project_folders",
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
            "parent_id",
            sa.String(36),
            sa.ForeignKey("project_folders.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column(
            "created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_index(
        "ix_project_folders_parent", "project_folders", ["company_id", "project_id", "parent_id"]
    )
    ddl.create_table(
        "project_files",
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
            "folder_id",
            sa.String(36),
            sa.ForeignKey("project_folders.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("drive_key", sa.String(250), nullable=False),
        sa.Column(
            "uploaded_by_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    ddl.create_index(
        "ix_project_files_folder", "project_files", ["company_id", "project_id", "folder_id"]
    )
    ddl.create_unique_constraint("uq_project_drive_key", "project_files", ["drive_key"])


def downgrade() -> None:
    op.drop_table("project_files")
    op.drop_table("project_folders")
