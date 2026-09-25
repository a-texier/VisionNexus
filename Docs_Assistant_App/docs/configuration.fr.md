---
app: docs
doc_type: configuration
audience: both
lang: fr
title: Configuration
order: 40
tags: [variables d'environnement, poids de modèle, hors ligne, périphérique de calcul, workspace, port, index de départ]
sources: [Docs_Assistant_App/backend/config.py, Docs_Assistant_App/backend/model_paths.py, Docs_Assistant_App/backend/main.py, Docs_Assistant_App/scripts/download_model.py, Docs_Assistant_App/scripts/build_seed.py, Docs_Assistant_App/requirements.txt, _lib/launcher_engine.py]
---

# Configuration

## Prérequis et installation

Le Docs Assistant est un service Python ; il n'a besoin ni de Node.js ni de frontend. Il s'exécute dans l'environnement conda indiqué dans les réglages de VisionNexus : les paquets ci-dessous doivent donc être installés dans cet environnement, sur la machine qui exécute le service (votre machine, ou la VM).

| Paquet | Usage |
|---|---|
| `fastapi`, `uvicorn`, `pydantic` | Le service HTTP |
| `numpy` | La recherche vectorielle |
| `torch`, `transformers` | Le modèle d'embeddings |
| `huggingface_hub` | Uniquement pour le script de téléchargement |
| `pytest`, `httpx` | Uniquement pour les tests |

Installez-les avec `pip install -r Docs_Assistant_App/requirements.txt`, avec Python 3.11 ou plus récent. Le service a aussi besoin de la documentation à indexer : le dépôt depuis lequel il tourne, avec son `docs/docs_manifest.json` (voir [Sources de documentation](#sources-de-documentation)).

## Variables d'environnement

Le service lit sa configuration dans l'environnement, que le lanceur remplit. Vous ne les définissez à la main que quand vous démarrez le service sans le lanceur.

| Variable | Rôle | Défaut |
|---|---|---|
| `DOCS_ASSISTANT_WORKSPACE` | Dossier de travail ; l'index est `<workspace>/index.sqlite` | `Docs_Assistant_App/data/workspace` ; le lanceur définit `<workspace>/docs_<utilisateur>` |
| `DOCS_ASSISTANT_USER` | Nom de session, affiché par l'état de l'index | `unknown` ; le lanceur définit votre utilisateur |
| `DOCS_ASSISTANT_DOCS_ROOT` | Racine de la suite qui contient `docs/docs_manifest.json` | Le dossier parent de `Docs_Assistant_App/` |
| `DOCS_ASSISTANT_MODEL` | Modèle d'embeddings : `intfloat/multilingual-e5-small` ou `intfloat/multilingual-e5-base` | `intfloat/multilingual-e5-small` |
| `DOCS_ASSISTANT_MODEL_DIR` | Dossier des fichiers du modèle, au lieu de `backend/models/<nom du modèle>/` | non défini |
| `DOCS_ASSISTANT_DEVICE` | Où le modèle s'exécute : `cuda`, `cpu`... | `cuda` si disponible, sinon `cpu` |
| `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE` | Interdisent tout téléchargement | `1` |
| `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK` | Désactivent la télémétrie | `1`, définies par le lanceur |

Le lanceur exporte aussi `BACKEND_PORT` vers chaque backend, mais le Docs Assistant ne le lit pas : le port est celui donné à `uvicorn` sur sa ligne de commande.

## Poids du modèle et script de téléchargement

Le service a besoin des fichiers d'un modèle d'embeddings dans `Docs_Assistant_App/backend/models/<nom du modèle>/` : `config.json`, les fichiers du tokenizer (`tokenizer.json` ou `sentencepiece.bpe.model`) et les poids (`model.safetensors`). Le modèle par défaut est `multilingual-e5-small`, environ 470 Mo avec des vecteurs de 384 dimensions ; `multilingual-e5-base` fait environ 1,1 Go avec des vecteurs de 768 dimensions. Les poids ne sont pas stockés dans le dépôt, et [MODEL_WEIGHTS.md](../../MODEL_WEIGHTS.fr.md) les liste avec les autres poids de la suite.

Téléchargez-les une fois, sur une machine avec accès à Internet, depuis `Docs_Assistant_App/` :

```bash
python scripts/download_model.py                        # le petit modèle par défaut
python scripts/download_model.py --model intfloat/multilingual-e5-base
python scripts/download_model.py --all                  # les deux modèles
```

Le script ne récupère que les fichiers listés ci-dessus (ni ONNX ni autres formats), vérifie que rien ne manque et affiche la taille. C'est le seul endroit autorisé à utiliser le réseau. Sur une VM sans Internet, téléchargez sur une autre machine et copiez le dossier du modèle au même chemin sur la VM. Sans le modèle, le service démarre quand même et cherche par mots-clés seulement.

## Fonctionnement hors ligne

Le service ne télécharge jamais rien pendant qu'il tourne. `main.py` définit `HF_HUB_OFFLINE=1` et `TRANSFORMERS_OFFLINE=1` avant l'import de toute bibliothèque, et le registre du lanceur les ajoute de nouveau, avec les interrupteurs de télémétrie, pour `docs`. Le modèle est chargé avec `local_files_only` : un fichier manquant ou abîmé donne un message d'erreur au lieu d'une tentative de téléchargement. Le service est ainsi sûr sur des machines sans accès à Internet, une fois les poids en place.

## Choix du périphérique de calcul

Le modèle d'embeddings s'exécute sur le GPU quand CUDA est disponible, et sur le processeur sinon. Définissez `DOCS_ASSISTANT_DEVICE` pour forcer `cpu` (par exemple sur un GPU dont d'autres tâches ont besoin) ou un `cuda:1` précis. Le périphérique réellement utilisé apparaît dans l'état de l'index. Un processeur suffit pour les recherches, qui calculent l'embedding d'une seule courte question ; il est seulement nettement plus lent pour indexer toute une documentation de zéro.

## Workspace et fichiers d'index

Le service écrit une seule base SQLite, `index.sqlite`, dans son dossier de workspace, avec les fichiers compagnons habituels `-wal` et `-shm` pendant son exécution. Avec le lanceur, le dossier est `<workspace>/docs_<utilisateur>/` : chaque utilisateur a donc son propre index. L'index contient le texte des passages de documentation et leurs vecteurs ; il peut être supprimé à tout moment et il est reconstruit au démarrage suivant (à partir de l'index de départ s'il y en a un). Un index écrit par une version du service dont la structure d'index diffère est supprimé puis reconstruit de lui-même au démarrage, ce qui prend quelques secondes sur un GPU.

Dans `Docs_Assistant_App/`, le dossier `data/` peut contenir un index de départ facultatif `seed_index.sqlite` (absent du dépôt publié et des bundles) et, une fois lancé par le lanceur, un petit `.history.json` qui liste les workspaces utilisés. Le service n'écrit jamais dans les dossiers de documentation.

## Port et options du lanceur

Le port de base est 8068 ; le lanceur choisit le premier port libre à partir de là et l'annonce. Le service est lancé par VisionNexus comme une app, avec `--backend-only` implicite puisque son entrée de registre n'a pas de frontend :

```bash
python launcher.py --app docs --workspace <workspace> --user <utilisateur>
```

Démarré à la main depuis `Docs_Assistant_App/`, sans le lanceur :

```bash
DOCS_ASSISTANT_WORKSPACE=/tmp/docs_ws python -m uvicorn backend.main:app --port 8068
```

Le service écoute sur toutes les interfaces réseau de sa machine et accepte les requêtes inter-origines venant de `localhost` et `127.0.0.1` sur n'importe quel port. Sur une VM, seul votre tunnel a besoin de l'atteindre ; restreignez le port avec le pare-feu de la VM sur un réseau partagé.

## Sources de documentation

Le service indexe ce que `docs/docs_manifest.json` liste sous `sources` avec `indexed` à vrai : les huit apps, VisionNexus (`suite`) et le Docs Assistant lui-même (`docs`). Pour chaque source, il lit les fichiers `.md` de premier niveau de son dossier de documentation, qui est `<dir>/docs` ou le dossier désigné par `docs_path` (`docs` à la racine du dépôt pour VisionNexus), et les pages que les plugins ajoutent dans `plugins/<plugin>/docs/<dir>/`. Les sous-dossiers comme `assets/` sont ignorés.

Les fichiers doivent être en UTF-8 ; les autres sont ignorés avec un avertissement. Le frontmatter est lu avec tolérance : une page aux clés manquantes est quand même indexée, avec des valeurs déduites de son nom de fichier et du jeu de pages du manifest. Si le manifest est illisible, la synchronisation s'arrête avec l'erreur `Sources de doc illisibles` et la dernière erreur apparaît dans l'état de l'index.

## Construire l'index de départ

L'index de départ est construit avec le vrai modèle pour qu'une machine neuve démarre avec un index prêt. Depuis `Docs_Assistant_App/` :

```bash
python scripts/build_seed.py [--model intfloat/multilingual-e5-small] [--docs-root ..] [--output data/seed_index.sqlite] [--device cuda]
```

Le script indexe toute la documentation, compacte le fichier en un seul fichier SQLite autonome et remplace `data/seed_index.sqlite`. Construisez-le avec le même modèle que celui que le service utilisera, car un index de départ construit avec un autre modèle ou une autre structure d'index est ignoré. Reconstruisez-le après un changement notable de la documentation, après tout changement de la structure de l'index (la version du schéma de stockage) C'est un artefact de construction pour les déploiements internes : gardez-le hors du contrôle de version. Les scripts de publication et de bundle ne le livrent jamais, donc une installation publique construit toujours son index au premier démarrage (quelques dizaines de secondes sur GPU).
