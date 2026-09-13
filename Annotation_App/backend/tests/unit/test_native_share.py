import pytest

from backend.services.settings_service import settings_service
from backend.utils.native_share import to_native_share_path


pytestmark = pytest.mark.unit


def test_linux_workspace_path_maps_to_windows_unc(monkeypatch):
    monkeypatch.setattr(
        settings_service,
        "load",
        lambda: {
            "paths": {
                "native_share_host": "share-host",
                "shared_roots": ["home", "mnt", "srv"],
            }
        },
    )

    assert (
        to_native_share_path("/srv/datasets/workspaces/alice/projects/2/_tracking_tmp/f.jpg")
        == r"\\share-host\datasets\workspaces\alice\projects\2\_tracking_tmp\f.jpg"
    )


def test_local_windows_path_is_already_native():
    path = r"C:\workspaces\alice\projects\2\_tracking_tmp\f.jpg"
    assert to_native_share_path(path) == path


def test_unshared_linux_root_falls_back_to_http(monkeypatch):
    monkeypatch.setattr(
        settings_service,
        "load",
        lambda: {"paths": {"native_share_host": "share-host", "shared_roots": ["home"]}},
    )

    assert to_native_share_path("/tmp/sam2_track/f.jpg") is None
