"""Ajustements du classement apres la fusion RRF, et signaux de confiance.

La fusion vecteur + mots-cles ne sait rien de ce que l'utilisateur cherche : les tables
generees (api-reference, code-map) contiennent tous les mots-cles d'une app et passent
devant les pas-a-pas pour presque toute question de type procedure ; un nom d'app dans la
question doit pousser les pages de cette app. Deux regles seulement, volontairement
prudentes, chacune avec une force reglable (0 = desactivee) pour l'isoler dans les mesures.
Des regles plus ambitieuses (un type de page prefere selon l'intention : procedure,
symptome, notion) ont fait perdre 13 points de top-1 sur le jeu golden, dont les questions
"how does X work" sont souvent des questions d'architecture ; un bonus au depannage pour
les symptomes n'a rien apporte une fois le nom de l'app dans le texte indexe.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_WORD = re.compile(r"\w+", re.UNICODE)


def fold(text: str) -> str:
    """Minuscules sans accents."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


# ---- intention de la question ---------------------------------------------- #

DEV = "dev"
NONE = "none"

# Question de developpeur : la doc technique est alors la bonne reponse, on n'y touche pas.
_DEV_RE = re.compile(
    r"\b(endpoints?|api|routes?|implement\w*|defini\w*|defined|modules?|class(?:es)?|fonctions?|functions?|"
    r"code|schema|ipc|canal|channel|env var|registre|registry|sse|websocket|sqlite|quel fichier|which file|"
    r"quelle table|which table|how does|how is|how are|comment fonctionne\w*|comment est|where is|where are|"
    r"ou est|ou sont|architecture|contract|contrat|argument\w*|command line|ligne de commande)\b"
)
# Identifiant de code dans la question : chemin, snake_case, VARIABLE_ENV, camelCase, fichier.
_CODE_LIKE_RE = re.compile(
    r"[/_`]|\.(?:py|ts|tsx|md|json|yaml)\b|\b[A-Z]{2,}\d*_[A-Z_\d]+\b|\b[a-z]+[A-Z][a-z]+"
)

_GENERATED_TYPES = ("api-reference", "code-map")


def detect_intent(query: str) -> str:
    """dev si la question cherche du code (chemin, endpoint, identifiant...), sinon none."""
    if _CODE_LIKE_RE.search(query) or _DEV_RE.search(fold(query)):
        return DEV
    return NONE


# ---- app visee par la question ---------------------------------------------- #

_GENERIC_WORDS = frozenset({"app", "dataset", "docs", "the", "and"})
# Mots francais qui designent une app sans figurer dans son titre.
EXTRA_ALIASES = {"entrainement": "training", "entrainements": "training", "entrainer": "training"}


def label_aliases(label: str) -> set[str]:
    """Formes sous lesquelles l'utilisateur nomme une app : "Dataset Explorer App" ->
    {"dataset explorer", "explorer"}."""
    base = fold(label).strip()
    if base.endswith(" app"):
        base = base[:-4].strip()
    aliases = {base} if base else set()
    words = base.split()
    if len(words) > 1:
        aliases |= {w for w in words if len(w) >= 6 and w not in _GENERIC_WORDS}
    return aliases


def mentioned_apps(query: str, labels: dict[str, str]) -> set[str]:
    """Apps nommees explicitement dans la question (titre, nom d'un mot, orthographe
    francaise proche : orchestrateur ~ orchestrator)."""
    folded = fold(query)
    terms = _WORD.findall(folded)
    found: set[str] = set()
    for app, label in labels.items():
        for alias in label_aliases(label):
            if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", folded):
                found.add(app)
            elif " " not in alias and len(alias) >= 8:
                stem = alias[:8]
                if any(t.startswith(stem) for t in terms):
                    found.add(app)
    for term in terms:
        app = EXTRA_ALIASES.get(term)
        if app and app in labels:
            found.add(app)
    return found


@dataclass(frozen=True)
class RankConfig:
    """Force de chaque regle : le facteur est eleve a cette puissance (0 = regle desactivee)."""

    tables: float = 1.0  # tables generees et README moins bien classes hors question de dev
    mention: float = 1.0  # pages de l'app nommee dans la question

    TABLES_FACTOR = 0.87
    README_FACTOR = 0.95
    MENTION_FACTOR = 1.14


@dataclass(frozen=True)
class QueryProfile:
    intent: str
    mentioned: frozenset[str]


def profile_query(query: str, labels: dict[str, str]) -> QueryProfile:
    return QueryProfile(detect_intent(query), frozenset(mentioned_apps(query, labels)))


def factor(app: str, doc_type: str, profile: QueryProfile, cfg: RankConfig) -> float:
    total = 1.0
    if cfg.tables and profile.intent != DEV:
        if doc_type in _GENERATED_TYPES:
            total *= RankConfig.TABLES_FACTOR**cfg.tables
        elif doc_type == "readme":
            total *= RankConfig.README_FACTOR**cfg.tables
    if cfg.mention and app in profile.mentioned:
        total *= RankConfig.MENTION_FACTOR**cfg.mention
    return total


# ---- langue de la question --------------------------------------------------- #

_FR_WORDS = frozenset(
    "le la les des du de un une est sont comment pour dans sur avec que qui quoi pas ne mon ma mes je "
    "tu il elle nous vous ce cette ces au aux et ou ca quel quelle quels quelles faire peut fait lancer "
    "utiliser pourquoi donc mais sans plus tout tous ete sa son ses leur y a".split()
)
_EN_WORDS = frozenset(
    "the a an is are how what to of in on for with my do does can i you it this that and or not why "
    "where which when from by be as at use using did was were should would could there their".split()
)
_ACCENTED = re.compile(r"[àâäçéèêëîïôöùûüœ]", re.IGNORECASE)


def detect_lang(query: str) -> str | None:
    """'fr' ou 'en' d'apres les mots vides et les accents ; None si rien ne tranche
    (un mot-cle seul comme "SAM2")."""
    lowered = query.lower()
    words = _WORD.findall(fold(lowered))
    fr = sum(1 for w in words if w in _FR_WORDS) + 2 * len(_ACCENTED.findall(lowered))
    en = sum(1 for w in words if w in _EN_WORDS)
    if fr == en:
        return None
    return "fr" if fr > en else "en"


# ---- pertinence et confiance -------------------------------------------------- #

# Cosinus e5 : les questions sans rapport avec la doc plafonnent vers 0,82 (max 0,84),
# les bonnes reponses tournent autour de 0,89. Bornes mesurees sur le jeu d'essai du
# projet ; propres a chaque modele (les cosinus e5-base sont plus hauts).
_COSINE_RANGE: dict[str, tuple[float, float, float]] = {
    "intfloat/multilingual-e5-small": (0.80, 0.92, 0.845),  # bas, haut, seuil de confiance
}


def relevance(cosine: float | None, model_id: str) -> float | None:
    """Pertinence 0..1 lisible par l'utilisateur ; None si le modele n'est pas calibre."""
    bounds = _COSINE_RANGE.get(model_id)
    if cosine is None or bounds is None:
        return None
    low, high, _ = bounds
    return round(min(1.0, max(0.0, (cosine - low) / (high - low))), 4)


def confidence(
    best_cosine: float | None, best_keyword_rank: int | None, n_terms: int, model_id: str
) -> str | None:
    """'high' ou 'low' ; None si non calibre. Un mot-cle exact seul (une question d'un mot,
    bien classee par BM25) reste fiable meme quand l'embedding d'une requete si courte est
    flou ; des que la question a deux mots, seul le cosinus decide (sinon "recette de
    crepes" passait pour une question sur un mot present dans la doc)."""
    bounds = _COSINE_RANGE.get(model_id)
    if bounds is None or best_cosine is None:
        return None
    if best_cosine >= bounds[2]:
        return "high"
    if n_terms <= 1 and best_keyword_rank is not None and best_keyword_rank <= 3:
        return "high"
    return "low"
