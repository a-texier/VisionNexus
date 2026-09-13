import zipfile

import pytest
from fastapi import HTTPException

from backend.routers.orchestrator import OrchestratorTrainRequest, orchestrator_train


def test_training_rejects_ver_zip_before_starting_a_run(tmp_path):
    archive_path = tmp_path / "annotations-ver.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("annotations/sequence.ver", "# annotations")

    with pytest.raises(HTTPException) as exc:
        orchestrator_train(
            OrchestratorTrainRequest(dataset_path=str(archive_path)),
            session=None,
        )

    assert exc.value.status_code == 400
    assert "Archive non-YOLO refusée" in str(exc.value.detail)
