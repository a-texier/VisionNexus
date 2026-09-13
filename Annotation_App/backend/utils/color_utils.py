# ============================================================
# utils/color_utils.py
# Génération de couleurs distinctes pour les classes et les pistes.
# Utilise une palette HSV pour maximiser la distinction visuelle.
# ============================================================

from typing import List


# Palette de couleurs prédéfinies pour les premières classes/pistes
# Optimisée pour être lisible sur fond sombre (canvas)
DEFAULT_COLORS = [
    "#3B82F6",  # Bleu
    "#EF4444",  # Rouge
    "#10B981",  # Vert émeraude
    "#F59E0B",  # Ambre
    "#8B5CF6",  # Violet
    "#EC4899",  # Rose
    "#06B6D4",  # Cyan
    "#F97316",  # Orange
    "#84CC16",  # Vert citron
    "#6366F1",  # Indigo
    "#14B8A6",  # Teal
    "#F43F5E",  # Rose foncé
    "#A855F7",  # Pourpre
    "#22C55E",  # Vert
    "#EAB308",  # Jaune
    "#64748B",  # Gris ardoise
]


def get_class_color(class_index: int) -> str:
    """
    Retourne la couleur hexadécimale pour une classe donnée.
    Cycle sur la palette si l'indice dépasse le nombre de couleurs.

    Args:
        class_index: Indice de la classe (0-based)

    Returns:
        Couleur hexadécimale (ex: "#3B82F6")
    """
    return DEFAULT_COLORS[class_index % len(DEFAULT_COLORS)]


def get_track_color(track_uid: int) -> str:
    """
    Retourne une couleur distincte pour un identifiant de piste.
    Utilise une rotation décalée par rapport aux classes pour éviter
    les confusions visuelles.

    Args:
        track_uid: Identifiant unique de la piste (0-based)

    Returns:
        Couleur hexadécimale
    """
    # Décalage de 3 pour différencier des couleurs de classe
    offset_index = (track_uid + 3) % len(DEFAULT_COLORS)
    return DEFAULT_COLORS[offset_index]


def hex_to_rgb(hex_color: str) -> tuple:
    """
    Convertit une couleur hexadécimale en tuple RGB (0-255).

    Args:
        hex_color: Ex: "#3B82F6"

    Returns:
        Tuple (r, g, b)
    """
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def rgb_to_hex(r: int, g: int, b: int) -> str:
    """
    Convertit un tuple RGB en couleur hexadécimale.

    Returns:
        Chaîne hexadécimale (ex: "#3B82F6")
    """
    return f"#{r:02X}{g:02X}{b:02X}"


def generate_distinct_colors(n: int) -> List[str]:
    """
    Génère N couleurs distinctes en utilisant l'espace de couleur HSV.
    Utile pour générer dynamiquement des couleurs au-delà de la palette prédéfinie.

    Args:
        n: Nombre de couleurs à générer

    Returns:
        Liste de N couleurs hexadécimales
    """
    import colorsys

    colors = []
    for i in range(n):
        # Distribution uniforme en teinte (hue), saturation et luminosité fixes
        hue = i / n
        saturation = 0.7
        value = 0.9
        r, g, b = colorsys.hsv_to_rgb(hue, saturation, value)
        colors.append(rgb_to_hex(int(r * 255), int(g * 255), int(b * 255)))

    return colors
