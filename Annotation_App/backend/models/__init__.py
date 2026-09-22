# ============================================================
# models/__init__.py
# Réexporte tous les modèles SQLModel pour faciliter les imports
# ============================================================

from backend.models.project import Project, ProjectType
from backend.models.frame import Frame
from backend.models.annotation import Annotation, AnnotationType
from backend.models.track import Track
from backend.models.label_class import LabelClass
from backend.models.session_state import SessionState
from backend.models.sequence import Sequence

__all__ = [
    "Project",
    "ProjectType",
    "Frame",
    "Annotation",
    "AnnotationType",
    "Track",
    "LabelClass",
    "SessionState",
    "Sequence",
]
