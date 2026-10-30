from types import SimpleNamespace

import pytest
import pywebpush
from pydantic import ValidationError

from app.api.schemas.push import PushSubscriptionInput
from app.services import push_notifications


def subscription():
    return SimpleNamespace(
        endpoint="https://push.example.test/device",
        p256dh="p" * 80,
        auth="a" * 24,
    )


def test_push_delivery_uses_a_short_timeout(monkeypatch):
    captured = {}

    def deliver(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(status_code=201)

    monkeypatch.setattr(pywebpush, "webpush", deliver)
    monkeypatch.setattr(
        push_notifications,
        "get_settings",
        lambda: SimpleNamespace(
            vapid_private_key_path="/tmp/test-vapid.pem",
            vapid_subject="mailto:test@example.invalid",
        ),
    )
    assert push_notifications._deliver(subscription(), {"title": "Tarea"}) == 201
    assert captured["timeout"] == 10
    assert captured["ttl"] == 24 * 60 * 60


def test_push_provider_failure_never_breaks_the_saved_business_action(monkeypatch):
    monkeypatch.setattr(
        pywebpush,
        "webpush",
        lambda **_: (_ for _ in ()).throw(OSError("provider unavailable")),
    )
    monkeypatch.setattr(
        push_notifications,
        "get_settings",
        lambda: SimpleNamespace(
            vapid_private_key_path="/tmp/test-vapid.pem",
            vapid_subject="mailto:test@example.invalid",
        ),
    )
    assert push_notifications._deliver(subscription(), {"title": "Tarea"}) == 0


def test_push_subscriptions_reject_insecure_endpoints():
    with pytest.raises(ValidationError, match="HTTPS"):
        PushSubscriptionInput(
            endpoint="http://push.example.test/device",
            keys={"p256dh": "p" * 80, "auth": "a" * 24},
        )
