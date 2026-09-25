---
app: docs
doc_type: api-reference
audience: dev
lang: fr
title: Référence API
order: 70
tags: [api rest, health, état de l'index, synchronisation, reconstruction, recherche]
sources: [Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/schemas.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py]
---

# Référence API

## Conventions

Le Docs Assistant expose une petite API JSON en HTTP, avec une documentation interactive (Swagger) sur `/docs` au port du service. Le port est choisi par le lanceur (8068 comme base, voir [Configuration](configuration.fr.md#port-et-options-du-lanceur)) ; VisionNexus l'atteint sur `127.0.0.1`, par un tunnel SSH quand le service tourne sur une VM. Il n'y a pas d'authentification : le service est prévu pour n'être atteint que par ce port local.

Les requêtes inter-origines sont acceptées depuis `http://localhost` et `http://127.0.0.1` sur n'importe quel port. Les erreurs de validation utilisent HTTP 422 avec le corps `{"detail": "Requete invalide : <champ> : <message> ; ...", "errors": [{"loc", "msg", "type"}]}`. Les opérations longues (synchronisation, reconstruction) renvoient aussitôt HTTP 202 et s'exécutent dans un thread d'arrière-plan ; suivez-les avec `GET /index/status`.

## Résumé des endpoints

Le tableau liste chaque route avec sa ligne de source. Il est généré à partir du code ; les sections suivantes décrivent les requêtes et les réponses.

<!-- generated:start -->
### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/health` | `health()` | `Docs_Assistant_App/backend/main.py:110` |
| POST | `/index/rebuild` | `index_rebuild()` | `Docs_Assistant_App/backend/main.py:154` |
| GET | `/index/status` | `index_status()` | `Docs_Assistant_App/backend/main.py:121` |
| POST | `/index/sync` | `index_sync()` | `Docs_Assistant_App/backend/main.py:149` |
| POST | `/search` | `search()` | `Docs_Assistant_App/backend/main.py:161` |
<!-- generated:end -->

## Endpoints de santé et d'index

`GET /health` répond toujours rapidement, même pendant le chargement du modèle ou la construction de l'index. Il renvoie `{"status": "ok", "model_available", "model_loaded", "index_ready", "syncing"}` : `model_available` est vrai quand les fichiers du modèle sont complets sur disque, `model_loaded` quand le modèle est en mémoire, `index_ready` quand au moins un passage est stocké, et `syncing` pendant une synchronisation. VisionNexus l'interroge pour décider que le service est prêt.

`GET /index/status` décrit l'index et le modèle :

| Champ | Sens |
|---|---|
| `model_id`, `dim`, `device` | Modèle d'embeddings, taille des vecteurs et périphérique utilisé (`null` avant le chargement sauf s'il a été demandé) |
| `model_available`, `model_loaded` | Comme dans `/health` |
| `message` | Vide, ou la raison pour laquelle le modèle est indisponible ou n'a pas pu se charger |
| `files`, `chunks`, `embedded` | Nombre de pages, de passages, et de passages qui ont un vecteur pour le modèle courant |
| `per_app`, `per_lang` | Nombre de passages par identifiant de source et par langue |
| `last_sync` | `{"at", "seconds"}` de la dernière synchronisation terminée |
| `syncing` | Vrai pendant une synchronisation |
| `progress` | `{"phase", "files_total", "files_done", "chunks_to_embed", "chunks_embedded"}` ; `phase` vaut `idle`, `starting`, `scanning`, `chunking` ou `embedding` |
| `last_error` | Dernière erreur de synchronisation, ou `null` |
| `seed_used` | Vrai si l'index a été initialisé à partir de l'index de départ |
| `user`, `workspace` | Utilisateur de la session et dossier de workspace |

`POST /index/sync` démarre une synchronisation incrémentale en arrière-plan et répond 202 avec `{"started": true, "syncing": true}` ; si une synchronisation tourne déjà, il répond `{"started": false, "syncing": true}` et ne démarre rien. `POST /index/rebuild` vide l'index et réindexe tout : il répond 202 `{"started": true, "syncing": true}`, ou HTTP 409 avec `{"detail": "Une synchronisation est deja en cours."}` si une synchronisation tourne.

## Endpoint de recherche

`POST /search` renvoie les passages qui répondent le mieux à une question. Le corps de la requête a ces champs :

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `q` | chaîne | obligatoire | La question ou des mots-clés, 500 caractères au plus ; moins de 2 caractères ne renvoie aucun résultat (`hits` vide) |
| `lang` | `fr`, `en` ou `both` | `both` | Langues cherchées ; `fr` ou `en` restreint la recherche à cette langue |
| `apps` | tableau de chaînes | `[]` | Identifiants de sources à chercher (`annotation`, `explorer`, `suite`, `docs`...) ; vide signifie toutes |
| `audience` | `user`, `dev` ou `all` | `all` | Une page écrite pour `both` correspond à `user` et à `dev` |
| `k` | entier de 1 à 30 | 8 | Nombre maximal de résultats |
| `prefer` | `fr`, `en` ou `auto` | `auto` | Langue gardée quand `lang` vaut `both` et qu'une section existe dans les deux ; `auto` utilise la langue détectée dans la question |
| `ui_lang` | `fr` ou `en` | `en` | Langue utilisée par `auto` quand la question ne tranche pas (un mot-clé seul, par exemple) |

```json
POST /search
{"q": "comment exporter en YOLO ?", "lang": "both", "apps": ["annotation"], "audience": "all", "k": 8, "prefer": "auto", "ui_lang": "fr"}
```

La réponse contient `mode`, `took_ms`, `terms`, un `notice` facultatif, `confidence`, `lang_detected`, `intent` et les `hits` :

```json
{"mode": "hybrid", "took_ms": 21.4, "terms": ["exporter", "yolo"], "notice": null,
 "confidence": "high", "lang_detected": "fr", "intent": "none",
 "hits": [{"app": "annotation", "doc": "workflows", "doc_type": "workflows", "audience": "user",
           "lang": "fr", "title": "Procédures",
           "heading_path": ["Procédures", "Exporter le dataset en YOLO, COCO ou .ver"],
           "heading_idx": 14, "part": null, "snippet": "Cliquez sur Exporter dans la barre du haut...",
           "score": 0.97, "relevance": 0.81, "vector_score": 0.89, "keyword_rank": 1,
           "other_lang": {"lang": "en", "doc": "workflows", "heading_idx": 14}}]}
```

`mode` vaut `hybrid` (mots-clés et vecteurs) ou `keyword` ; en mode `keyword`, `notice` explique pourquoi, par exemple que le modèle est absent ou en cours de chargement. Une requête de moins de 2 caractères ne renvoie aucun résultat, aucun `notice`, et un `mode` à `hybrid` quand le modèle est chargé. `terms` sont les mots extraits de la question, utiles pour les surligner.

Trois champs de premier niveau décrivent la question. `lang_detected` vaut `fr` ou `en` quand les mots et les accents de la question tranchent, sinon `null` ; avec `prefer` à `auto`, une section qui existe dans les deux langues est renvoyée dans cette langue, ou dans `ui_lang` quand il vaut `null`. Un `prefer` explicite à `fr` ou `en` impose la langue, et `lang` à `fr` ou `en` restreint la recherche à celle-ci. `intent` vaut `dev` quand la question ressemble à une question de développeur (un élément qui ressemble à du code comme un chemin, un nom en `snake_case`, une variable en majuscules ou un nom de fichier, ou des mots comme endpoint, API, module, fonction, schéma, IPC, "how does" ou "where is"), `none` sinon, et `null` pour une requête trop courte pour être cherchée ; hors intention `dev`, les pages de référence générées et les pages README sont classées un peu plus bas. `confidence` vaut `low` quand aucun passage n'est assez proche de la question (la meilleure similarité cosinus est sous un seuil mesuré pour le modèle par défaut), `high` sinon, et `null` quand elle ne peut pas être jugée : mode mots-clés seuls, aucun résultat, ou modèle non calibré. Une confiance `low` ne retire aucun résultat ; un client peut s'en servir pour prévenir l'utilisateur.

Dans chaque résultat, `heading_idx` est le numéro `h-<n>` du titre de la section, l'ancre vers laquelle défiler ; `part` est le numéro de la partie quand une longue section a été coupée, sinon `null` ; `snippet` est un extrait d'au plus 320 caractères choisi dans le passage. `score` est le score de fusion, compris entre 0 et 1 et relatif au meilleur score de fusion possible de la requête : il dit où se situe un résultat parmi les autres, donc le premier est proche de 1 même quand la réponse est mauvaise. `relevance` est la qualité mesurable, entre 0 et 1, déduite de la similarité cosinus ; elle vaut `null` quand le modèle n'est pas calibré ou que le passage n'a été trouvé que par mots-clés. `vector_score` (cosinus) et `keyword_rank` sont des valeurs de débogage et peuvent valoir `null`. `other_lang` donne la section jumelle dans l'autre langue quand elle existe, avec les mêmes `doc` et `heading_idx`.

## Erreurs et limites

- Un corps qui ne respecte pas le schéma (un `q` manquant, un `k` hors de 1 à 30, un `lang`, un `prefer` ou un `ui_lang` inconnu) répond 422 avec le nom du champ dans `detail`.
- Un problème de modèle ne donne jamais de réponse d'erreur : la recherche se replie sur les mots-clés et renseigne `notice`.
- Au plus deux résultats par page de documentation sont renvoyés, et quand `lang` vaut `both` chaque section n'apparaît qu'une fois, dans la langue choisie par `prefer`.
- `POST /index/rebuild` répond 409 pendant une synchronisation ; `POST /index/sync` non.
- Les réponses sont calculées sur un instantané immuable de l'index : une recherche faite pendant une synchronisation voit soit l'ancien état, soit le nouveau, jamais un mélange.
