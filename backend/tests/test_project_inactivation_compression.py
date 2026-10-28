import hashlib
import io
import os
import runpy
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import HTTPException, UploadFile

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from app.api.routes import operations, project_files
from app.api.schemas.operations import ProjectCreate, ProjectPatch
from app.services import project_file_codec


def actor(role: str) -> SimpleNamespace:
    return SimpleNamespace(role=role, company_id="company", user=SimpleNamespace(id="user"))


@pytest.mark.asyncio
async def test_only_admin_or_owner_can_deactivate_and_reactivate(monkeypatch):
    project = SimpleNamespace(id="project", status="active")
    activity = []

    async def require_project(*_):
        return project

    async def committed(*_):
        return None

    class Db:
        async def refresh(self, *_):
            return None

    monkeypatch.setattr(operations, "require_project", require_project)
    monkeypatch.setattr(operations, "commit_or_conflict", committed)
    monkeypatch.setattr(
        operations, "add_activity", lambda _, __, action, *args: activity.append(action)
    )

    with pytest.raises(HTTPException) as denied:
        await operations.deactivate_project("project", actor("engineer"), Db())
    assert denied.value.status_code == 403
    assert project.status == "active"

    await operations.deactivate_project("project", actor("admin"), Db())
    assert project.status == "inactive"
    assert activity == ["project.deactivated"]
    with pytest.raises(HTTPException) as duplicate:
        await operations.deactivate_project("project", actor("owner"), Db())
    assert duplicate.value.status_code == 409

    with pytest.raises(HTTPException) as denied:
        await operations.reactivate_project("project", actor("engineer"), Db())
    assert denied.value.status_code == 403
    await operations.reactivate_project("project", actor("owner"), Db())
    assert project.status == "active"
    assert activity[-1] == "project.reactivated"


@pytest.mark.asyncio
async def test_status_cannot_bypass_inactivation_buttons(monkeypatch):
    project = SimpleNamespace(id="project", status="active", start_date=None, planned_end_date=None)

    async def require_project(*_):
        return project

    monkeypatch.setattr(operations, "require_project", require_project)
    for role, expected in (("engineer", 403), ("admin", 422)):
        with pytest.raises(HTTPException) as denied:
            await operations.update_project(
                "project", ProjectPatch(status="inactive"), actor(role), None
            )
        assert denied.value.status_code == expected
    assert project.status == "active"

    project.status = "inactive"
    with pytest.raises(HTTPException) as denied:
        await operations.update_project(
            "project", ProjectPatch(status="active"), actor("owner"), None
        )
    assert denied.value.status_code == 422
    with pytest.raises(HTTPException) as denied:
        await operations.create_project(
            ProjectCreate(name="Nueva", status="inactive"), actor("admin"), None
        )
    assert denied.value.status_code == 422


def test_project_files_compress_only_when_it_saves_space_and_restore_exact_bytes():
    for original, expected_encoding in (
        (b"Contenido de obra\n" * 10000, "gzip"),
        (os.urandom(100_000), "identity"),
        (b"ABC", "identity"),
    ):
        saved, encoding = project_file_codec.encode(original)
        assert encoding == expected_encoding
        if encoding == "identity":
            assert saved == original
        else:
            assert len(saved) < len(original)
        restored = project_file_codec.decode(saved, encoding, len(original))
        assert restored == original
        assert hashlib.sha256(restored).hexdigest() == hashlib.sha256(original).hexdigest()


def test_project_files_reject_corruption_and_oversized_expansion():
    original = b"large plan" * 100_000
    stored, encoding = project_file_codec.encode(original)
    assert encoding == "gzip"
    for damaged, size in ((stored[:-8], len(original)), (stored, 10)):
        with pytest.raises(ValueError):
            project_file_codec.decode(damaged, encoding, size)
    with pytest.raises(ValueError):
        project_file_codec.decode(stored, "identity", len(original))
    with pytest.raises(ValueError):
        project_file_codec.decode(stored, "zip", len(original))


def test_compression_migration_preserves_legacy_drive_file_size():
    migration = runpy.run_path(
        str(Path(__file__).parents[1] / "alembic/versions/0015_project_file_compression.py")
    )
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE project_files "
                "(id VARCHAR(36) PRIMARY KEY, size_bytes BIGINT NOT NULL)"
            )
        )
        connection.execute(sa.text("INSERT INTO project_files VALUES ('legacy', 13000)"))
        migration["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        migration["upgrade"]()
        migration["upgrade"]()  # A partial MySQL DDL retry is idempotent.
        assert connection.execute(
            sa.text("SELECT size_bytes, stored_size_bytes, storage_encoding FROM project_files")
        ).one() == (13000, 13000, "identity")


@pytest.mark.asyncio
async def test_project_file_api_restores_original_after_conditional_drive_upload(monkeypatch):
    original = b"Plan de obra, capa A\n" * 10000
    objects: dict[str, bytes] = {}
    records = []
    access = SimpleNamespace(
        role="admin",
        company_id="12345678-aaaa-4aaa-8aaa-123456789abc",
        user=SimpleNamespace(id="user"),
    )

    class Db:
        def add(self, record):
            records.append(record)

        async def scalar(self, *_):
            return records[0]

    async def require_project(*_):
        return SimpleNamespace(id="f43f11c9-898a-489a-8acd-923858b23418")

    async def no_op(*_):
        return None

    async def upload(key, content):
        objects[key] = content

    async def download(key):
        return objects[key]

    monkeypatch.setattr(project_files, "require_project", require_project)
    monkeypatch.setattr(project_files, "flush_or_conflict", no_op)
    monkeypatch.setattr(project_files, "commit_or_conflict", no_op)
    monkeypatch.setattr(project_files, "add_activity", lambda *_: None)
    monkeypatch.setattr(project_files.project_drive, "drive_location", lambda key: ("config", key))
    monkeypatch.setattr(project_files.project_drive, "upload", upload)
    monkeypatch.setattr(project_files.project_drive, "download", download)

    response = await project_files.upload_file(
        "f43f11c9-898a-489a-8acd-923858b23418",
        access,
        Db(),
        UploadFile(file=io.BytesIO(original), filename="plano.dwg"),
        None,
    )
    assert response.storage_encoding == "gzip"
    assert response.size_bytes == len(original)
    assert response.stored_size_bytes < len(original)
    restored = await project_files.download_file(response.project_id, response.id, access, Db())
    assert restored.body == original

    objects[response.drive_key] = objects[response.drive_key][:-3]
    with pytest.raises(HTTPException) as damaged:
        await project_files.download_file(response.project_id, response.id, access, Db())
    assert damaged.value.status_code == 502
