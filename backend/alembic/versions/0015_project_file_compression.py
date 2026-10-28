"""Record conditional, reversible compression of project Drive files.

Revision ID: 0015_project_file_compression
Revises: 0014_project_drive_folders
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision: str = "0015_project_file_compression"
down_revision: str | None = "0014_project_drive_folders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    ddl = ResumableDDL(op)
    ddl.add_column(
        "project_files",
        sa.Column("stored_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
    )
    ddl.add_column(
        "project_files",
        sa.Column("storage_encoding", sa.String(16), nullable=False, server_default="identity"),
    )
    # Files uploaded before this migration were uncompressed. Safe to run again
    # if MySQL committed a DDL step but not the Alembic version marker.
    op.execute(
        sa.text(
            "UPDATE project_files SET stored_size_bytes = size_bytes WHERE stored_size_bytes = 0"
        )
    )


def downgrade() -> None:
    # A compressed file cannot be decoded after dropping its encoding metadata.
    count = op.get_bind().scalar(
        sa.text("SELECT COUNT(*) FROM project_files WHERE storage_encoding <> 'identity'")
    )
    if count:
        raise RuntimeError("No se puede quitar la compresión mientras haya archivos gzip en Drive")
    op.drop_column("project_files", "storage_encoding")
    op.drop_column("project_files", "stored_size_bytes")
