"""Carga los planes iniciales de la plataforma.

Revision ID: 0002_seed_plans
Revises: 0001_core
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_seed_plans"
down_revision: str | None = "0001_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO plans (id, code, name, limits_json, is_active) VALUES
        ('10000000-0000-4000-8000-000000000001', 'starter', 'Inicial',
         JSON_OBJECT('active_projects', 3, 'users', 10, 'storage_gb', 5,
                     'monthly_plan_uploads', 200), 1),
        ('10000000-0000-4000-8000-000000000002', 'professional', 'Profesional',
         JSON_OBJECT('active_projects', 15, 'users', 50, 'storage_gb', 50,
                     'monthly_plan_uploads', 2000), 1),
        ('10000000-0000-4000-8000-000000000003', 'enterprise', 'Empresa',
         JSON_OBJECT('active_projects', -1, 'users', 200, 'storage_gb', 200,
                     'monthly_plan_uploads', -1), 1)
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM plans WHERE code IN ('starter','professional','enterprise')")
