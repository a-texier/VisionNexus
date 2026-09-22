# ============================================================
# services/settings_service.py
# Gestion des paramètres utilisateur persistants (JSON).
#
# Les paramètres sont stockés dans le workspace utilisateur :
#   <ANNOTATION_WORKSPACE>/user_settings.json
#
# Le chargement fusionne profondément les valeurs sauvegardées
# avec les valeurs par défaut — garantit que toutes les clés
# existent même après une mise à jour de l'application.
# ============================================================

import json
import os
from typing import Any, Dict

from backend.config import SETTINGS_FILE

SETTINGS_SCHEMA_VERSION = 3

# ---- Paramètres par défaut ----
# Toutes les valeurs ici servent de fallback si la clé est absente.
DEFAULT_SETTINGS: Dict[str, Any] = {
    "_schema_version": SETTINGS_SCHEMA_VERSION,
    "interface": {
        "background_color": "#0f172a",       # Couleur fond canvas (hex)
        "default_tool": "bbox",              # Outil actif au démarrage
        "timeline_height": 80,               # Hauteur en px de la timeline
        "tracks_panel_height": 92,           # Hauteur en px de la zone tracks (redimensionnable)
        "annotation_opacity": 0.35,          # Opacité des annotations (0-1)
        "show_labels": True,                 # Afficher les étiquettes de classe sur les annotations
        "show_confidence": False,            # Afficher le score de confiance sur les annotations
        "annotation_border_width": 2,        # Épaisseur des bordures d'annotations (1-4 px)
        # Reduction 480px (scrub) / 1600px (affichage zoom ajuste) des images servies.
        # True (defaut) = comportement actuel : JPEG reduit genere et mis en cache disque
        # dans frames_preview/. False = chaque requete preview=1/display=1 renvoie la
        # source pleine resolution, AUCUNE ecriture disque a 480/1600px — a activer si la
        # connexion est assez bonne pour se passer de la reduction de qualite.
        "preview_downscale_enabled": True,
        # Reglage "Live temps reel par defaut" dans Parametres > Interface.
        # True par defaut : pendant SAMURAI/SAM2, le canvas suit la frame en
        # cours et recoit image native + annotations via WebSocket.
        "realtime_live_enabled": True,
        # Cadence MINIMALE entre deux sauts du canvas pendant une propagation
        # (ms). Ne concerne QUE l'image affichee : les pastilles de la timeline
        # et les annotations en apercu, elles, suivent chaque frame poussee par
        # le WebSocket, sans throttle. Historiquement 700 ms (~1,4 saut/s) pour
        # ne pas noyer les 6 connexions HTTP par origine sous SSH. Le chemin
        # natif SMB libere HTTP : 150 ms suit la boucle WebSocket (~6,7 Hz)
        # sans empiler les decodages. 0 = suivre la cadence du GPU.
        "propagation_nav_throttle_ms": 150,
    },
    "paths": {
        # Sur un client Windows, /srv/datasets/xxx peut être présenté comme
        # \\{native_share_host}\datasets\xxx. Aucun hôte n'est supposé.
        "native_share_host": os.environ.get("NATIVE_SHARE_HOST", ""),
        "shared_roots": ["home", "mnt", "srv", "media", "data"],
        # Derniers dossiers serveur parcourus (import de séquences). Le plus
        # récent en tête. Propre à l'utilisateur : ce fichier vit dans SON
        # workspace, même si le workspace applicatif est partagé.
        "browse_history": [],
        "browse_history_max": 12,
    },
    "import": {
        "jpeg_quality": 85,                  # Qualité JPEG miniatures/frames vidéo (50-95)
        "chunk_size_mb": 8,                  # Taille chunk upload vidéo (MB)
        "frame_keep": 0,                     # 0=tout, 2=1/2, 3=1/3... (décimation frames)
        "batch_size_images": 20,             # Nb images par batch lors de l'upload
    },
    "algorithms": {
        # NMS
        "nms_iou_threshold": 0.5,
        # Grounding DINO
        "grounding_dino_box_threshold": 0.30,
        "grounding_dino_text_threshold": 0.25,
        # Valeur de depart du selecteur BBox/Seg de la barre d'outils (True = Seg).
        # Pour GD, "Seg" implique le raffinement SAM2, seul chemin qui produit un contour.
        "grounding_dino_use_sam_refine": False,
        # SAM2 auto
        "sam_points_per_side": 32,
        "sam_pred_iou_thresh": 0.88,
        "sam_stability_score_thresh": 0.95,
        # Homographie XFeat/SIFT
        "xfeat_top_k": 2048,
        "xfeat_min_cossim": 0.82,
        "ransac_threshold": 4.0,
        "min_inlier_count": 20,
        "min_inlier_ratio": 0.3,
        # Flux optique Lucas-Kanade
        "optflow_win_size": 21,
        "optflow_max_level": 3,
        "optflow_min_pts": 4,
        # SAM3 / Tracking guidé (partagés)
        "sam3_box_threshold": 0.25,
        "sam3_text_threshold": 0.20,
        "guided_max_centroid_dist": 0.15,
        "guided_size_variation": 0.5,
        # Tracking — critère de correspondance par défaut
        # 'geometric' = distance centroide / surface (rapide, defaut)
        "tracking_match_criterion": "geometric",
        # SAMURAI/SAM2 vidéo : offload des frames sur le CPU.
        # False (défaut) = MODE GPU RAPIDE, frames sur le GPU → 1.5–3x plus vite,
        # mais limité par la VRAM (~350–450 frames @1024² sur 10 Go). True = frames
        # en RAM CPU, VRAM mini (robuste GPU modeste / séquences longues).
        "sam2_offload_video_to_cpu": False,
        # Auto-stop par défaut
        "auto_stop_enabled": False,
        "auto_stop_lost_ratio": 0.5,
        "auto_stop_consecutive_frames": 5,
    },
    # Etat du tutoriel interactif -- REPLI uniquement. La source de verite est
    # VisionNexus (%APPDATA%\VisionNexusElectron\settings.json, champ
    # tutorials.annotation) : le "deja vu ce tuto" appartient a l'utilisateur
    # et a son poste, pas au workspace. Ces cles ne servent que si l'app est
    # ouverte hors du lanceur (navigateur, dev local).
    "tutorial": {
        # Passe a True au PREMIER clic sur le bouton d'accueil (le halo orange
        # s'eteint alors definitivement, meme si le tour est abandonne).
        "launched_once": False,
        # True une fois le tour arrive a la derniere etape.
        "completed": False,
    },
    "export": {
        "train_ratio": 0.70,
        "val_ratio": 0.20,
        "test_ratio": 0.10,
        "include_unannotated": True,     # coché par défaut (frames non annotées → ligne 0 en .ver) (S11)
        "symlink_images": True,          # True = liens symboliques (dataset local, pas de ZIP)
    },
}


class SettingsService:
    """
    Singleton de gestion des paramètres utilisateur.
    Lit/écrit <workspace>/user_settings.json.
    """

    def load(self) -> Dict[str, Any]:
        """
        Charge les paramètres depuis le fichier JSON.
        Fusionne avec DEFAULT_SETTINGS pour garantir toutes les clés.
        Crée le fichier avec les valeurs par défaut s'il n'existe pas.
        """
        if not SETTINGS_FILE.exists():
            self.save(DEFAULT_SETTINGS)
            return self._apply_runtime_overrides(dict(DEFAULT_SETTINGS))
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            saved, changed = self._migrate(saved)
            if changed:
                self.save(saved)
            # Fusion profonde : les clés manquantes viennent des defaults
            return self._apply_runtime_overrides(self._deep_merge(DEFAULT_SETTINGS, saved))
        except Exception as e:
            print(f"[settings] Erreur chargement {SETTINGS_FILE}: {e}")
            return self._apply_runtime_overrides(dict(DEFAULT_SETTINGS))

    def save(self, settings: Dict[str, Any]) -> None:
        """Sauvegarde les paramètres dans le fichier JSON."""
        try:
            SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[settings] Erreur sauvegarde : {e}")

    def update(self, partial: Dict[str, Any]) -> Dict[str, Any]:
        """
        Fusion partielle : met à jour uniquement les sections fournies.
        Les sections non fournies sont conservées telles quelles.
        """
        current = self.load()
        merged = self._deep_merge(current, partial)
        self.save(merged)
        return merged

    def reset(self) -> Dict[str, Any]:
        """Remet les paramètres aux valeurs par défaut."""
        self.save(DEFAULT_SETTINGS)
        return dict(DEFAULT_SETTINGS)

    @staticmethod
    def _apply_runtime_overrides(settings: Dict[str, Any]) -> Dict[str, Any]:
        host = os.environ.get("NATIVE_SHARE_HOST", "").strip()
        if host:
            paths = dict(settings.get("paths") or {})
            paths["native_share_host"] = host
            settings = dict(settings)
            settings["paths"] = paths
        return settings

    @staticmethod
    def _migrate(saved: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
        """Applique une fois les changements de defaults qui affectent l'usage."""
        try:
            version = int(saved.get("_schema_version", 0))
        except (TypeError, ValueError):
            version = 0
        if version >= SETTINGS_SCHEMA_VERSION:
            return saved, False

        migrated = dict(saved)
        interface = dict(migrated.get("interface") or {})
        # 700 ms etait l'ancien default. Une valeur personnalisee est preservee.
        if version < 2 and interface.get("propagation_nav_throttle_ms") == 700:
            interface["propagation_nav_throttle_ms"] = 150
        if interface:
            migrated["interface"] = interface
        if version < 3:
            allowed_path_keys = {
                "native_share_host", "shared_roots", "browse_history", "browse_history_max"
            }
            paths = {
                key: value
                for key, value in dict(migrated.get("paths") or {}).items()
                if key in allowed_path_keys
            }
            paths.setdefault("native_share_host", "")
            paths.setdefault("shared_roots", ["home", "mnt", "srv", "media", "data"])
            migrated["paths"] = paths
        migrated["_schema_version"] = SETTINGS_SCHEMA_VERSION
        return migrated, True

    @staticmethod
    def _deep_merge(base: Dict, override: Dict) -> Dict:
        """
        Fusion récursive : base fournit les clés manquantes,
        override écrase les valeurs existantes.
        """
        result = dict(base)
        for key, val in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(val, dict):
                result[key] = SettingsService._deep_merge(result[key], val)
            else:
                result[key] = val
        return result


# ---- Singleton ----
settings_service = SettingsService()
