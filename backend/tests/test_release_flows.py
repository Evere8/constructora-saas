"""Real HTTP routes + isolated SQL database. No production credentials or files."""

import hashlib
import os
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.dependencies import get_company_access
from app.api.routes import daily_operations
from app.db.base import Base
from app.db.models import (
    AppUser,
    Company,
    CompanyMembership,
    InventoryItem,
    InventoryMovement,
    PerforationColor,
    PerforationDocument,
    PlanDocument,
    PlanVersion,
    Project,
    ProjectFile,
    ProjectRubro,
    ProjectRubroFeature,
    PushSubscription,
    Task,
    TaskMaterialRequirement,
)
from app.db.session import get_db
from app.main import app
from app.services import file_storage, project_drive


class AsyncAdapter:
    def __init__(self, session):
        self.session = session

    def add(self, value):
        self.session.add(value)

    def add_all(self, values):
        self.session.add_all(values)

    async def execute(self, statement):
        return self.session.execute(statement)

    async def scalar(self, statement):
        return self.session.scalar(statement)

    async def scalars(self, statement):
        return self.session.scalars(statement)

    async def get(self, model, key):
        return self.session.get(model, key)

    async def flush(self):
        self.session.flush()

    async def commit(self):
        self.session.commit()

    async def rollback(self):
        self.session.rollback()

    async def refresh(self, row):
        self.session.refresh(row)

    async def delete(self, row):
        self.session.delete(row)


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = Session(engine, expire_on_commit=False)
    user = AppUser(supabase_user_id=str(uuid4()), email="release@example.invalid")
    company = Company(name="QA", slug="qa")
    session.add_all([user, company])
    session.flush()
    project = Project(company_id=company.id, name="Obra QA")
    session.add(project)
    session.flush()
    session.add(CompanyMembership(company_id=company.id, user_id=user.id, role="owner"))
    session.commit()
    actor = SimpleNamespace(
        company_id=company.id,
        role="owner",
        can_register_inventory_day=False,
        user=SimpleNamespace(id=user.id, is_platform_admin=False),
    )
    adapter = AsyncAdapter(session)

    async def access():
        return actor

    async def db():
        try:
            yield adapter
        finally:
            session.rollback()

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_company_access] = access
    app.dependency_overrides[get_db] = db
    monkeypatch.setattr(file_storage, "get_settings", lambda: SimpleNamespace(upload_root=tmp_path))
    remote = {}

    async def upload(key, value):
        remote[key] = value

    async def download(key):
        return remote[key]

    async def upload_path(key, path):
        remote[key] = Path(path).read_bytes()

    async def download_to_path(key, path):
        Path(path).write_bytes(remote[key])

    async def delete(key):
        remote.pop(key, None)

    monkeypatch.setattr(project_drive, "drive_location", lambda key: ("test", key))
    monkeypatch.setattr(project_drive, "upload", upload)
    monkeypatch.setattr(project_drive, "download", download)
    monkeypatch.setattr(project_drive, "upload_path", upload_path)
    monkeypatch.setattr(project_drive, "download_to_path", download_to_path)
    monkeypatch.setattr(project_drive, "delete", delete)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SimpleNamespace(
            client=client,
            session=session,
            company=company,
            project=project,
            user=user,
            actor=actor,
            root=tmp_path,
            remote=remote,
            base=f"/api/v1/companies/{company.id}",
        )
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    session.close()
    engine.dispose()


@pytest.mark.asyncio
async def test_daily_materials_conflicts_same_day_registration_and_permissions(flow):
    f = flow
    c = f.client
    today = daily_operations.today().isoformat()
    item = InventoryItem(
        company_id=f.company.id,
        code="MAT-1",
        name="Estopa",
        item_type="material",
        quantity=2,
        unit="kg",
    )
    f.session.add(item)
    f.session.commit()
    definition = await c.post(
        f.base + "/activity-definitions",
        json={"title": "Reparaciones", "requirements": [{"name": "Estopa", "quantity": 1}]},
    )
    assert definition.status_code == 201, definition.text
    plan_url = f.base + "/daily-activity-plans/" + today
    payload = {
        "plan_date": today,
        "entries": [
            {
                "project_id": f.project.id,
                "activity_definition_id": definition.json()["id"],
                "people_count": 3,
            }
        ],
        "expected_revision": None,
    }
    saved = await c.put(plan_url, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["entries"][0]["verification"] == "incomplete"
    stale = await c.put(plan_url, json={**payload, "entries": []})
    assert stale.status_code == 409
    assert (await c.get(plan_url)).json()["total_people"] == 3
    day = {
        "snapshot_date": today,
        "assignments": [
            {"item_id": item.id, "expected_project_id": None, "to_project_id": f.project.id}
        ],
    }
    f.actor.role = "engineer"
    assert (await c.post(f.base + "/inventory/days", json=day)).status_code == 403
    f.actor.role = "worker"
    f.actor.can_register_inventory_day = True
    response = await c.post(f.base + "/inventory/days", json=day)
    assert response.status_code == 201, response.text
    f.actor.role = "owner"
    assert (await c.get(plan_url)).json()["entries"][0]["verification"] == "ready"
    f.actor.role = "worker"
    assert (await c.post(f.base + "/inventory/days", json=day)).status_code == 409
    f.actor.role = "owner"
    registered = await c.post(
        plan_url + "/register", json={"expected_revision": saved.json()["revision"]}
    )
    assert registered.status_code == 200, registered.text
    assert (
        await c.put(plan_url, json={**payload, "expected_revision": registered.json()["revision"]})
    ).status_code == 409
    tomorrow = (daily_operations.today() + timedelta(days=1)).isoformat()
    future = await c.put(
        f.base + "/daily-activity-plans/" + tomorrow, json={**payload, "plan_date": tomorrow}
    )
    assert future.json()["entries"][0]["verification"] == "incomplete"
    assert len((await c.get(f.base + "/daily-activity-plans?limit=1&offset=1")).json()) == 1
    request = await c.post(
        f.base + "/inventory/restock-requests",
        json={"name": "Taladro", "quantity": 1, "project_id": f.project.id},
    )
    assert request.status_code == 201
    assert (
        await c.patch(f.base + "/inventory/restock-requests/" + request.json()["id"] + "/fulfilled")
    ).json()["status"] == "fulfilled"


@pytest.mark.asyncio
async def test_assigned_tasks_match_badge_and_exclude_other_user(flow):
    f = flow
    f.session.add_all(
        [
            Task(
                company_id=f.company.id,
                project_id=f.project.id,
                title="Mi tarea",
                task_type="work",
                created_by_user_id=f.user.id,
                assigned_user_id=f.user.id,
            ),
            Task(
                company_id=f.company.id,
                project_id=f.project.id,
                title="No asignada",
                task_type="work",
                created_by_user_id=f.user.id,
            ),
        ]
    )
    f.session.commit()
    summary = (await f.client.get(f.base + "/my-tasks/summary")).json()
    listed = await f.client.get(f.base + "/my-tasks")
    assert listed.status_code == 200, listed.text
    assert summary["work_pending"] == listed.json()["total"] == 1
    assert listed.json()["items"][0]["project_name"] == "Obra QA"


@pytest.mark.asyncio
async def test_relocation_task_preserves_origin_until_assignee_completes_it(flow):
    f = flow
    destination = Project(company_id=f.company.id, name="Obra destino")
    item = InventoryItem(
        company_id=f.company.id,
        code="HERR-TRASLADO",
        name="Taladro de traslado",
        item_type="tool",
        unit="unidad",
        quantity=1,
        current_project_id=f.project.id,
        status="assigned",
    )
    f.session.add_all([destination, item])
    f.session.commit()
    response = await f.client.post(
        f.base + "/inventory/relocations",
        json={
            "inventory_item_id": item.id,
            "to_project_id": destination.id,
            "assigned_user_id": f.user.id,
            "notes": "Entregar por la mañana",
        },
    )
    assert response.status_code == 201, response.text
    relocation = response.json()
    f.session.refresh(item)
    assert item.current_project_id == f.project.id
    assert item.status == "relocation_pending"
    assert relocation["from_project_id"] == f.project.id
    assert relocation["to_project_id"] == destination.id
    assert relocation["assigned_user_name"] == f.user.email
    assert (await f.client.get(f.base + "/my-tasks/summary")).json()["work_pending"] == 1

    task_url = f.base + f"/projects/{destination.id}/tasks/{relocation['task_id']}"
    received = await f.client.patch(task_url, json={"status": "received"})
    assert received.status_code == 200, received.text
    assert received.json()["status"] == "received"
    f.session.refresh(item)
    assert item.current_project_id == f.project.id

    completed = await f.client.patch(task_url, json={"status": "completed"})
    assert completed.status_code == 200, completed.text
    f.session.refresh(item)
    assert item.current_project_id == destination.id
    assert item.status == "assigned"
    movement = f.session.query(InventoryMovement).filter_by(item_id=item.id).one()
    assert movement.from_project_id == f.project.id
    assert movement.to_project_id == destination.id
    all_relocations = await f.client.get(
        f.base + "/inventory/relocations", params={"active_only": "false"}
    )
    assert all_relocations.json()[0]["status"] == "completed"
    assert (await f.client.get(f.base + "/my-tasks/summary")).json()["work_pending"] == 0


@pytest.mark.asyncio
async def test_relocation_can_return_an_equipment_from_a_project_to_the_warehouse(flow):
    f = flow
    item = InventoryItem(
        company_id=f.company.id,
        code="HERR-DEPOSITO",
        name="Amoladora para depósito",
        item_type="tool",
        unit="unidad",
        quantity=1,
        current_project_id=f.project.id,
        status="assigned",
    )
    f.session.add(item)
    f.session.commit()

    requested = await f.client.post(
        f.base + "/inventory/relocations",
        json={
            "inventory_item_id": item.id,
            "to_project_id": None,
            "assigned_user_id": f.user.id,
        },
    )
    assert requested.status_code == 201, requested.text
    relocation = requested.json()
    assert relocation["from_project_id"] == f.project.id
    assert relocation["to_project_id"] is None
    assert relocation["to_project_name"] is None

    assert (
        await f.client.post(f.base + f"/inventory/relocations/{relocation['id']}/start")
    ).status_code == 200
    completed = await f.client.post(
        f.base + f"/inventory/relocations/{relocation['id']}/complete"
    )
    assert completed.status_code == 200, completed.text
    f.session.refresh(item)
    assert item.current_project_id is None
    assert item.status == "available"
    movement = f.session.query(InventoryMovement).filter_by(item_id=item.id).one()
    assert movement.from_project_id == f.project.id
    assert movement.to_project_id is None


@pytest.mark.asyncio
async def test_task_can_assign_a_different_person_to_relocate_its_equipment(flow):
    f = flow
    transport_user = AppUser(
        supabase_user_id=str(uuid4()),
        email="transporte@example.invalid",
    )
    source = Project(company_id=f.company.id, name="Obra de origen")
    f.session.add_all([transport_user, source])
    f.session.flush()
    f.session.add(
        CompanyMembership(
            company_id=f.company.id,
            user_id=transport_user.id,
            role="transport",
        )
    )
    item = InventoryItem(
        company_id=f.company.id,
        code="HERR-RESPONSABLE",
        name="Taladro con transportista",
        item_type="tool",
        unit="unidad",
        quantity=1,
        current_project_id=source.id,
        status="assigned",
    )
    f.session.add(item)
    f.session.commit()

    response = await f.client.post(
        f.base + f"/projects/{f.project.id}/tasks",
        json={
            "title": "Perforación con taladro",
            "assigned_user_id": f.user.id,
            "relocation_assignee_id": transport_user.id,
            "inventory_item_ids": [item.id],
        },
    )
    assert response.status_code == 201, response.text
    task = response.json()
    assert task["assigned_user_id"] == f.user.id
    relocations = await f.client.get(
        f.base + "/inventory/relocations", params={"task_id": task["id"]}
    )
    assert relocations.status_code == 200, relocations.text
    assert relocations.json()[0]["assigned_user_id"] == transport_user.id


@pytest.mark.asyncio
async def test_inventory_delete_retires_item_and_keeps_it_out_of_operational_catalog(flow):
    f = flow
    item = InventoryItem(
        company_id=f.company.id,
        code="HERR-RETIRAR",
        name="Herramienta de prueba",
        item_type="tool",
        unit="unidad",
        quantity=1,
    )
    f.session.add(item)
    f.session.commit()

    deleted = await f.client.delete(f.base + f"/inventory/{item.id}")
    assert deleted.status_code == 204, deleted.text
    assert item.status == "retired"
    assert (await f.client.get(f.base + "/inventory")).json() == []
    archived = await f.client.get(f.base + "/inventory", params={"include_retired": "true"})
    assert archived.status_code == 200
    assert archived.json()[0]["id"] == item.id


@pytest.mark.asyncio
async def test_task_delete_is_available_to_owner_and_engineer_only(flow):
    f = flow

    owner_task = Task(
        company_id=f.company.id,
        project_id=f.project.id,
        title="Tarea del propietario",
        task_type="work",
        created_by_user_id=f.user.id,
    )
    f.session.add(owner_task)
    f.session.commit()
    assert (
        await f.client.delete(f.base + f"/projects/{f.project.id}/tasks/{owner_task.id}")
    ).status_code == 204

    engineer_task = Task(
        company_id=f.company.id,
        project_id=f.project.id,
        title="Tarea del ingeniero",
        task_type="work",
        created_by_user_id=f.user.id,
    )
    f.session.add(engineer_task)
    f.session.commit()
    f.actor.role = "engineer"
    assert (
        await f.client.delete(f.base + f"/projects/{f.project.id}/tasks/{engineer_task.id}")
    ).status_code == 204

    admin_task = Task(
        company_id=f.company.id,
        project_id=f.project.id,
        title="Tarea protegida",
        task_type="work",
        created_by_user_id=f.user.id,
    )
    f.session.add(admin_task)
    f.session.commit()
    f.actor.role = "admin"
    denied = await f.client.delete(f.base + f"/projects/{f.project.id}/tasks/{admin_task.id}")
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_relocation_rejects_an_inactive_destination(flow):
    f = flow
    destination = Project(company_id=f.company.id, name="Obra inactiva", status="inactive")
    item = InventoryItem(
        company_id=f.company.id,
        code="HERR-INACTIVA",
        name="Amoladora",
        item_type="tool",
        unit="unidad",
        quantity=1,
    )
    f.session.add_all([destination, item])
    f.session.commit()
    response = await f.client.post(
        f.base + "/inventory/relocations",
        json={
            "inventory_item_id": item.id,
            "to_project_id": destination.id,
            "assigned_user_id": f.user.id,
        },
    )
    assert response.status_code == 422
    f.session.refresh(item)
    assert item.status == "available" and item.current_project_id is None


@pytest.mark.asyncio
async def test_relocation_creation_uses_delegated_permission_and_assignee_scope(flow):
    f = flow
    destination = Project(company_id=f.company.id, name="Obra delegada")
    item = InventoryItem(
        company_id=f.company.id,
        code="HERR-DELEGADA",
        name="Gato hidráulico",
        item_type="tool",
        unit="unidad",
        quantity=1,
    )
    f.session.add_all([destination, item])
    f.session.commit()
    payload = {
        "inventory_item_id": item.id,
        "to_project_id": destination.id,
        "assigned_user_id": f.user.id,
    }
    f.actor.role = "engineer"
    denied = await f.client.post(f.base + "/inventory/relocations", json=payload)
    assert denied.status_code == 403

    f.actor.can_register_inventory_day = True
    created = await f.client.post(f.base + "/inventory/relocations", json=payload)
    assert created.status_code == 201, created.text
    f.actor.can_register_inventory_day = False
    f.actor.role = "worker"
    started = await f.client.post(
        f.base + f"/inventory/relocations/{created.json()['id']}/start"
    )
    assert started.status_code == 200, started.text
    completed = await f.client.post(
        f.base + f"/inventory/relocations/{created.json()['id']}/complete"
    )
    assert completed.status_code == 200, completed.text
    f.session.refresh(item)
    assert item.current_project_id == destination.id


@pytest.mark.asyncio
async def test_assigned_activity_creates_task_tools_and_live_custom_status(flow):
    f = flow
    definition = await f.client.post(
        f.base + "/activity-definitions",
        json={
            "title": "Colocación de cabos",
            "requirements": [{"name": "Taladro", "quantity": 2}],
        },
    )
    assert definition.status_code == 201, definition.text
    day = daily_operations.today().isoformat()
    saved = await f.client.put(
        f.base + "/daily-activity-plans/" + day,
        json={
            "plan_date": day,
            "expected_revision": None,
            "entries": [
                {
                    "project_id": f.project.id,
                    "activity_definition_id": definition.json()["id"],
                    "assigned_user_id": f.user.id,
                    "people_count": 4,
                    "note": "Iniciar en nivel 2",
                }
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    entry = saved.json()["entries"][0]
    assert entry["task_id"] and entry["task_status"] == "pending"
    task = f.session.get(Task, entry["task_id"])
    assert task.title == "Colocación de cabos"
    assert task.assigned_user_id == f.user.id
    requirement = f.session.query(TaskMaterialRequirement).filter_by(task_id=task.id).one()
    assert requirement.description == "Taladro"
    assert requirement.required_quantity == 2

    task_url = f.base + f"/projects/{f.project.id}/tasks/{task.id}"
    custom = await f.client.patch(
        task_url,
        json={"status": "custom", "custom_status_label": "Esperando hormigón"},
    )
    assert custom.status_code == 200, custom.text
    assert custom.json()["custom_status_label"] == "Esperando hormigón"
    refreshed = await f.client.get(f.base + "/daily-activity-plans/" + day)
    assert refreshed.json()["entries"][0]["task_status"] == "custom"
    assert refreshed.json()["entries"][0]["custom_status_label"] == "Esperando hormigón"

    assert (await f.client.get(f.base + "/task-overview")).status_code == 200
    f.actor.role = "admin"
    assert (await f.client.get(f.base + "/task-overview")).status_code == 403
    assert (await f.client.get(f.base + "/daily-activity-plans/" + day)).status_code == 403
    f.actor.role = "engineer"
    assert (await f.client.get(f.base + "/task-overview")).status_code == 200
    f.actor.role = "worker"
    assert (await f.client.get(f.base + "/task-overview")).status_code == 403
    f.actor.role = "owner"


@pytest.mark.asyncio
async def test_push_subscription_can_be_refreshed_and_disabled(flow):
    f = flow
    endpoint = "https://push.example.test/subscription/abc"
    first = await f.client.post(
        f.base + "/push/subscriptions",
        json={"endpoint": endpoint, "keys": {"p256dh": "p" * 80, "auth": "a" * 24}},
    )
    assert first.status_code == 204, first.text
    second = await f.client.post(
        f.base + "/push/subscriptions",
        json={"endpoint": endpoint, "keys": {"p256dh": "q" * 80, "auth": "b" * 24}},
    )
    assert second.status_code == 204, second.text
    rows = f.session.query(PushSubscription).all()
    assert len(rows) == 1 and rows[0].is_active and rows[0].p256dh == "q" * 80
    removed = await f.client.request(
        "DELETE", f.base + "/push/subscriptions", json={"endpoint": endpoint}
    )
    assert removed.status_code == 204, removed.text
    f.session.refresh(rows[0])
    assert not rows[0].is_active


@pytest.mark.asyncio
async def test_folders_pagination_and_lossless_drive_download(flow):
    f = flow
    url = f.base + "/projects/" + f.project.id
    parent = (await f.client.post(url + "/folders", json={"name": "Planos"})).json()
    child = (
        await f.client.post(url + "/folders", json={"name": "Nivel 1", "parent_id": parent["id"]})
    ).json()
    content = b"ACAD original\x00" * 2000
    uploaded = await f.client.post(
        url + "/files",
        data={"folder_id": child["id"]},
        files={"file": ("plano.dwg", content, "application/octet-stream")},
    )
    assert uploaded.status_code == 201, uploaded.text
    record = uploaded.json()
    assert record["storage_encoding"] == "gzip"
    assert (await f.client.get(url + "/files")).json() == []
    assert len((await f.client.get(url + "/files", params={"folder_id": child["id"]})).json()) == 1
    assert (await f.client.get(url + "/files/" + record["id"] + "/download")).content == content
    for i in range(102):
        f.session.add(
            ProjectFile(
                company_id=f.company.id,
                project_id=f.project.id,
                folder_id=child["id"],
                original_filename=f"{i}.bin",
                mime_type="application/octet-stream",
                size_bytes=1,
                stored_size_bytes=1,
                sha256="a" * 64,
                drive_key=uuid4().hex,
                uploaded_by_user_id=f.user.id,
            )
        )
    f.session.commit()
    page = await f.client.get(
        url + "/files", params={"folder_id": child["id"], "limit": 100, "offset": 100}
    )
    assert len(page.json()) == 3
    assert (
        await f.client.get(url + "/files", params={"folder_id": str(uuid4())})
    ).status_code == 404


@pytest.mark.asyncio
async def test_operational_drive_upload_has_no_legacy_ten_megabyte_cap(flow):
    f = flow
    content = (b"Documento grande de obra\n" * 480_000) + b"fin"
    assert len(content) > 10 * 1024 * 1024
    url = f.base + "/projects/" + f.project.id
    uploaded = await f.client.post(
        url + "/files",
        files={"file": ("modelo-grande.dwg", content, "application/octet-stream")},
    )
    assert uploaded.status_code == 201, uploaded.text
    record = uploaded.json()
    assert record["size_bytes"] == len(content)
    downloaded = await f.client.get(url + "/files/" + record["id"] + "/download")
    assert downloaded.status_code == 200
    assert hashlib.sha256(downloaded.content).digest() == hashlib.sha256(content).digest()


@pytest.mark.asyncio
async def test_admin_archival_restores_original_and_stale_reference(flow):
    f = flow
    url = f.base + "/projects/" + f.project.id
    content = b"%PDF-1.7\n" + b"original-data " * 3000
    key = "original.pdf"
    (f.root / key).write_bytes(content)
    doc = PlanDocument(
        company_id=f.company.id,
        project_id=f.project.id,
        title="Plano",
        created_by_user_id=f.user.id,
    )
    f.session.add(doc)
    f.session.flush()
    version = PlanVersion(
        document_id=doc.id,
        version_number=1,
        storage_key=key,
        original_filename="plano.pdf",
        mime_type="application/pdf",
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        created_by_user_id=f.user.id,
    )
    f.session.add(version)
    f.session.commit()
    f.actor.role = "engineer"
    assert (await f.client.post(url + "/deactivate")).status_code == 403
    assert (await f.client.post(url + "/archive-step")).status_code == 403
    f.actor.role = "owner"
    assert (await f.client.post(url + "/archive-step")).status_code == 409
    assert (await f.client.post(url + "/deactivate")).status_code == 200
    archived = await f.client.post(url + "/archive-step")
    assert archived.status_code == 200, archived.text
    assert archived.json()["complete"] and archived.json()["saved_bytes"] > 0
    assert not (f.root / key).exists()
    assert await file_storage.read_stored_bytes(key) == content
    assert (await f.client.get(url + f"/plans/versions/{version.id}/download")).content == content
    async with file_storage.stored_path(version.storage_key) as temporary:
        assert temporary.read_bytes() == content
    assert not temporary.exists()
    assert (await f.client.post(url + "/reactivate")).status_code == 200
    assert (await f.client.get(url + f"/plans/versions/{version.id}/download")).content == content


@pytest.mark.asyncio
async def test_pdf_color_defaults_annotation_idempotence_and_deletion(flow):
    f = flow
    rubro = ProjectRubro(
        company_id=f.company.id, project_id=f.project.id, name="Reparaciones", slug="reparaciones"
    )
    f.session.add(rubro)
    f.session.flush()
    f.session.add(ProjectRubroFeature(rubro_id=rubro.id, feature_key="interactive_pdf"))
    document = PerforationDocument(
        company_id=f.company.id,
        project_id=f.project.id,
        rubro_id=rubro.id,
        title="N1",
        storage_key="test.pdf",
        original_filename="N1.pdf",
        mime_type="application/pdf",
        size_bytes=1,
        sha256="a" * 64,
        page_count=1,
        created_by_user_id=f.user.id,
    )
    color = PerforationColor(
        rubro_id=rubro.id, name="Perforado", color_hex="#ff0000", checklist_json=[]
    )
    f.session.add_all([document, color])
    f.session.commit()
    url = f.base + f"/projects/{f.project.id}/rubros/{rubro.id}"
    renamed = await f.client.patch(
        url + f"/perforation-colors/{color.id}",
        json={"name": "Perforado y corte", "color_hex": "#22C55E"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Perforado y corte"
    assert renamed.json()["color_hex"] == "#22C55E"
    point_input = {
        "document_id": document.id,
        "color_id": color.id,
        "page_number": 1,
        "x": 0.2,
        "y": 0.3,
    }
    point = await f.client.post(url + "/perforation-points", json=point_input)
    assert point.status_code == 201, point.text
    checklist = [{"id": str(uuid4()), "title": "Reparar", "checked": True, "sort_order": 0}]
    response = await f.client.put(
        url + "/perforation-points/" + point.json()["id"] + "/checklist",
        json={"checklist": checklist, "save_as_color_default": True},
    )
    assert response.status_code == 200, response.text
    new_point = (await f.client.post(url + "/perforation-points", json=point_input)).json()
    assert new_point["checklist_json"][0]["title"] == "Reparar"
    assert not new_point["checklist_json"][0]["checked"]
    mark = {
        "client_id": str(uuid4()),
        "document_id": document.id,
        "page_number": 1,
        "kind": "line",
        "points": [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.5}],
        "color_hex": "#f97316",
        "stroke_width": 4,
        "opacity": 1,
    }
    created = await f.client.post(url + "/perforation-annotations", json=mark)
    assert created.status_code == 201, created.text
    retried = await f.client.post(url + "/perforation-annotations", json=mark)
    assert retried.json()["id"] == created.json()["id"]
    conflict = await f.client.post(
        url + "/perforation-annotations", json={**mark, "stroke_width": 7}
    )
    assert conflict.status_code == 409
    assert (
        await f.client.delete(url + "/perforation-annotations/" + created.json()["id"])
    ).status_code == 204
    assert (
        await f.client.delete(url + "/perforation-points/" + point.json()["id"])
    ).status_code == 204


@pytest.mark.asyncio
async def test_rubros_can_remove_features_and_deleted_defaults_do_not_return(flow):
    f = flow
    url = f.base + f"/projects/{f.project.id}/rubros"
    seeded = await f.client.get(url)
    assert seeded.status_code == 200, seeded.text
    postensado = next(item for item in seeded.json() if item["slug"] == "postensado")
    assert postensado["features"]

    without_features = await f.client.put(
        url + f"/{postensado['id']}/features", json={"features": []}
    )
    assert without_features.status_code == 200, without_features.text
    assert without_features.json()["features"] == []

    assert (await f.client.delete(url + f"/{postensado['id']}")).status_code == 204
    assert "postensado" not in {item["slug"] for item in (await f.client.get(url)).json()}

    custom = await f.client.post(
        url,
        json={"name": "Rubro temporal", "feature_keys": ["interactive_pdf", "tasks"]},
    )
    assert custom.status_code == 201, custom.text
    assert {item["feature_key"] for item in custom.json()["features"]} == {
        "interactive_pdf",
        "tasks",
    }
    assert (await f.client.delete(url + f"/{custom.json()['id']}")).status_code == 204


def legacy_drive_file(f, content):
    key = f"{f.company.id.replace('-', '')}/{f.project.id.replace('-', '')}/{uuid4().hex}"
    record = ProjectFile(
        company_id=f.company.id,
        project_id=f.project.id,
        original_filename="original.dwg",
        mime_type="application/octet-stream",
        size_bytes=len(content),
        stored_size_bytes=len(content),
        storage_encoding="identity",
        compression_checked=False,
        sha256=hashlib.sha256(content).hexdigest(),
        drive_key=key,
        uploaded_by_user_id=f.user.id,
    )
    f.project.status = "inactive"
    f.session.add(record)
    f.session.commit()
    f.remote[key] = content
    return record, key


@pytest.mark.asyncio
async def test_existing_drive_file_archive_keeps_exact_original_and_retires_only_old_object(flow):
    f = flow
    content = b"DWG layer " * 10000
    record, key = legacy_drive_file(f, content)
    url = f.base + f"/projects/{f.project.id}"
    response = await f.client.post(url + "/archive-step")
    assert response.status_code == 200, response.text
    assert response.json()["complete"]
    f.session.refresh(record)
    assert record.storage_encoding == "gzip"
    assert key not in f.remote and record.drive_key in f.remote
    assert (await f.client.get(url + f"/files/{record.id}/download")).content == content


@pytest.mark.asyncio
async def test_already_dense_dwg_is_checked_but_not_replaced(flow):
    f = flow
    content = os.urandom(40_000)
    record, key = legacy_drive_file(f, content)
    response = await f.client.post(f.base + f"/projects/{f.project.id}/archive-step")
    assert response.status_code == 200
    assert response.json()["complete"] and response.json()["saved_bytes"] == 0
    f.session.refresh(record)
    assert record.drive_key == key and record.storage_encoding == "identity"
    assert f.remote[key] == content and record.compression_checked


@pytest.mark.asyncio
async def test_corrupt_replacement_cannot_delete_or_change_original(flow, monkeypatch):
    f = flow
    content = b"original " * 10000
    record, key = legacy_drive_file(f, content)

    async def broken_upload(new_key, value):
        f.remote[new_key] = value[:-3]

    monkeypatch.setattr(project_drive, "upload", broken_upload)
    response = await f.client.post(f.base + f"/projects/{f.project.id}/archive-step")
    assert response.status_code == 502
    f.session.refresh(record)
    assert record.drive_key == key and not record.compression_checked
    assert f.remote[key] == content


@pytest.mark.asyncio
async def test_corrupt_original_drive_object_is_reported_without_replacement(flow):
    f = flow
    content = b"original " * 10000
    record, key = legacy_drive_file(f, content)
    f.remote[key] = content[:-7]

    response = await f.client.post(f.base + f"/projects/{f.project.id}/archive-step")
    assert response.status_code == 502
    f.session.refresh(record)
    assert record.drive_key == key and not record.compression_checked
    assert set(f.remote) == {key}


@pytest.mark.asyncio
async def test_failed_database_commit_during_archive_retains_readable_original(flow, monkeypatch):
    f = flow
    content = b"original " * 10000
    record, key = legacy_drive_file(f, content)

    async def failed_commit(self):
        raise HTTPException(status_code=503, detail="Database unavailable")

    monkeypatch.setattr(AsyncAdapter, "commit", failed_commit)
    response = await f.client.post(f.base + f"/projects/{f.project.id}/archive-step")
    assert response.status_code == 503
    f.session.refresh(record)
    assert record.drive_key == key and not record.compression_checked
    assert f.remote[key] == content


@pytest.mark.asyncio
async def test_archive_preview_temporary_is_cleaned_on_reader_error(flow):
    from app.services import project_file_codec

    content = b"%PDF-1.7\n" + b"preview " * 10000
    stored, encoding = project_file_codec.encode(content)
    (flow.root / "archived.gz").write_bytes(stored)
    ref = file_storage.archive_reference("archived.gz", content, len(stored), encoding, local=True)
    with pytest.raises(RuntimeError, match="reader failed"):
        async with file_storage.stored_path(ref) as path:
            assert path.read_bytes() == content
            raise RuntimeError("reader failed")
    assert not path.exists()


@pytest.mark.asyncio
async def test_blank_folder_name_is_rejected(flow):
    response = await flow.client.post(
        flow.base + f"/projects/{flow.project.id}/folders", json={"name": "   "}
    )
    assert response.status_code == 422
