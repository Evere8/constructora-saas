"""Read-only deployment gate: verify migrated tables and level serialization.

Run from /app in the API image: python -m app.db.verify_schema
No credentials, project names, geometry or checklist content are printed.
"""

import asyncio

from sqlalchemy import func, select, text

from alembic.config import Config
from alembic.script import ScriptDirectory
from app.api.schemas.operations import LevelResponse, SectorResponse
from app.db.models import ChecklistItem, ProjectLevel, ProjectSector, Task
from app.db.session import SessionLocal, engine


async def verify() -> None:
    expected = set(ScriptDirectory.from_config(Config("alembic.ini")).get_heads())
    async with SessionLocal() as session:
        actual = set(
            (await session.execute(text("SELECT version_num FROM alembic_version"))).scalars()
        )
        if actual != expected:
            raise RuntimeError(
                "La base de datos no está en la revisión esperada; ejecutar la migración"
            )
        levels = (await session.scalars(select(ProjectLevel))).all()
        sectors = (await session.scalars(select(ProjectSector))).all()
        sector_projects = {sector.id: sector.project_id for sector in sectors}
        for level in levels:
            LevelResponse.model_validate(level)
            if sector_projects.get(level.sector_id) != level.project_id:
                raise RuntimeError("Hay un nivel sin sector válido dentro de su obra")
        for sector in sectors:
            SectorResponse.model_validate(sector)
        # Select mapped columns, not just COUNT(*)/SELECT 1, to catch schema drift.
        await session.execute(select(ChecklistItem).limit(1))
        await session.execute(select(Task).limit(1))
        checks = await session.scalar(select(func.count()).select_from(ChecklistItem))
        print(f"SCHEMA_OK niveles={len(levels)} sectores={len(sectors)} controles={checks}")
        print("Revisión: " + ", ".join(sorted(actual)))


async def main() -> None:
    try:
        await verify()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
