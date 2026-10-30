"""Track files already checked for lossless compression.

Revision ID: 0016_archive_verification
Revises: 0015_project_file_compression
"""

import sqlalchemy as sa

from alembic import op
from app.db.migration_support import ResumableDDL

revision = "0016_archive_verification"
down_revision = "0015_project_file_compression"
branch_labels = None
depends_on = None


def upgrade():
    ResumableDDL(op).add_column(
        "project_files",
        sa.Column("compression_checked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        sa.text(
            "UPDATE project_files SET compression_checked = true WHERE storage_encoding = 'gzip'"
        )
    )


def downgrade():
    # Packed legacy references need the reader introduced with this release.
    # Never downgrade the application while archived references still exist.
    op.drop_column("project_files", "compression_checked")
