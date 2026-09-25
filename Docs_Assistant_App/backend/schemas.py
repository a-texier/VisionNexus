"""Modeles Pydantic de l'API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MAX_QUERY_CHARS = 500


class SearchRequest(BaseModel):
    q: str = Field(
        max_length=MAX_QUERY_CHARS,
        description="Question ou mots-cles (moins de 2 caracteres : aucun resultat)",
    )
    lang: Literal["fr", "en", "both"] = "both"
    apps: list[str] = Field(
        default_factory=list, description="ids d'apps (annotation, explorer...) ; vide = toutes"
    )
    audience: Literal["user", "dev", "all"] = "all"
    k: int = Field(default=8, ge=1, le=30)
    prefer: Literal["fr", "en", "auto"] = Field(
        default="auto", description="langue gardee quand lang=both ; auto = langue de la question"
    )
    ui_lang: Literal["fr", "en"] = Field(
        default="en", description="langue de repli quand la question ne permet pas de trancher"
    )


class OtherLang(BaseModel):
    lang: str
    doc: str
    heading_idx: int


class Hit(BaseModel):
    app: str
    doc: str
    doc_type: str
    audience: str
    lang: str
    title: str
    heading_path: list[str]
    heading_idx: int
    part: int | None
    snippet: str
    score: float
    relevance: float | None = Field(
        default=None, description="pertinence 0..1 d'apres le cosinus ; None si le modele n'est pas calibre"
    )
    vector_score: float | None
    keyword_rank: int | None
    other_lang: OtherLang | None


class SearchResponse(BaseModel):
    mode: Literal["hybrid", "keyword"]
    took_ms: float
    terms: list[str]
    notice: str | None = None
    confidence: Literal["high", "low"] | None = Field(
        default=None, description="low : aucun passage ne ressemble vraiment a la question"
    )
    lang_detected: Literal["fr", "en"] | None = None
    intent: str | None = Field(default=None, description="dev : la question cherche du code ; none sinon")
    hits: list[Hit]
