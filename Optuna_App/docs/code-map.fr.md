---
app: optuna
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [navigation code, backend, frontend, tableau de bord, extension]
sources: [Optuna_App/backend/main.py, Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/core/diagnostics.py, Optuna_App/backend/hpo_trial.py, Optuna_App/frontend/src/App.tsx, Optuna_App/frontend/src/components/StudyDashboard.tsx, Optuna_App/frontend/src/i18n/translate.ts]
---

# Carte du code

## Par ou commencer a lire le code backend

Le backend d'Optuna App est dans `Optuna_App/backend/`. Lisez ces fichiers dans cet ordre pour le comprendre :

1. `main.py` : le point d'entree. Le lifespan sonde le stockage Optuna ; les routeurs sont montes ici ; `/health` et les auxiliaires de workspace sont definis ici.
2. `config.py` : le workspace (`OPTUNA_APP_WORKSPACE`), l'URL de stockage SQLite, les ports et les origines CORS.
3. `api/studies.py` : chaque endpoint utilise par l'interface pour les etudes autonomes, plus les auxiliaires de qualification d'etat et de recuperation legacy utilises par la page d'etude.
4. `core/optuna_runner.py` : le runner a thread arriere-plan derriere `start`/`stop`/`status`/`logs`.
5. `api/orchestrator.py` : l'endpoint bloquant `/api/orchestrator/hpo` utilise par les pipelines Orchestrator.
6. `hpo_trial.py` : le script de trial de reference execute a la fois par l'endpoint Orchestrator et par le prereglage de detection ; le fichier a lire pour comprendre exactement ce que fait un trial.
7. `core/diagnostics.py` : les regles de classification d'echec partagees par les deux runners.

Autres dossiers : `tests/` et le `tests/` racine (voir [Verifier l'installation](configuration.fr.md#verifier-linstallation) pour les executer). `runs/` et `data/` sont des dossiers de type workspace crees a l'execution, pas du code source.

## Par ou commencer a lire le code frontend

Le frontend est une app Vite/React dans `Optuna_App/frontend/src/`. Commencez par `App.tsx` pour la liste des routes et la barre laterale, puis `pages/StudiesPage.tsx` (la page d'accueil), `pages/StudyDetailPage.tsx` et `components/StudyDashboard.tsx` (les panneaux d'analyse), et `pages/LaunchPage.tsx` avec `components/EnginePreset.tsx` (demarrer une optimisation). `api/client.ts` est l'unique endroit qui appelle le backend ; `types/api.ts` reflete les formes Pydantic et dataclass du backend. `i18n/translate.ts` et `i18n/useLang.ts` contiennent le dictionnaire francais-vers-anglais et le hook de langue utilise par chaque page via `useT()`. `hooks/useStudies.ts` centralise les hooks TanStack Query et leurs intervalles de rafraichissement pour la liste des etudes, les trials et le sondage du statut.

## Ou changer une regle de diagnostic d'echec

Ajoutez ou modifiez un tuple `(patterns, code, title, action)` dans `backend/core/diagnostics.py::diagnose_failure()`. L'ordre des regles compte : un motif plus specifique doit venir avant un motif plus large qui pourrait aussi correspondre (voir le commentaire sur les erreurs de store MLflow verifiees avant les erreurs generiques de modele manquant). Les deux runners appellent cette fonction a l'identique, donc une nouvelle regle s'applique aux etudes autonomes et Orchestrator a la fois. Faites correspondre sur des fragments de texte en minuscules pris de la vraie stderr ou du message d'exception, pas sur des noms de classe d'exception, puisque les trials en subprocess n'exposent que du texte. Mettez a jour [Depannage](troubleshooting.fr.md) avec le nouveau symptome.

## Ou changer ce que fait un trial

Pour les etudes Orchestrator et le prereglage de detection, modifiez `backend/hpo_trial.py`. Il doit continuer d'ecrire `result.json` de facon atomique avec les champs lus par `orchestrator.py` (`status`, `objective_value`, `metrics`, `artifact_dir`, `results_csv`, `best_weights`) et continuer d'imprimer la valeur brute de la metrique comme derniere ligne de vrai stdout, puisque les lancements autonomes du meme script dependent de ce contrat de repli. Pour une etude sur votre propre script, rien dans l'app n'a besoin de changer : seuls l'analyse d'arguments de votre script et son `print(value)` final comptent (voir [Concepts](concepts.fr.md#contrat-de-resultat-dun-trial)). Ne retirez pas le repli stdout brut de `hpo_trial.py` meme apres avoir ajoute de nouveaux champs a `result.json` : c'est ce qui garde le fichier utilisable comme script preregle manuellement aussi.

## Ou ajouter un parametre

Ajoutez un champ a `AppSettings` dans `backend/api/settings.py` (avec un defaut sense) et au type TypeScript correspondant dans `frontend/src/types/api.ts` ; la page de parametres est actuellement une page provisoire (`SettingsPlaceholder` dans `App.tsx`), donc un nouveau parametre a besoin de sa propre interface pour etre accessible depuis l'app. `_save_settings()` reecrit tout le modele dans `settings.json` sauf `workspace_path` et `user_name`, toujours exclus puisqu'ils doivent venir de l'environnement. `load_settings()` fusionne le fichier sauvegarde sur les defauts champ par champ, donc un ancien `settings.json` sans une cle nouvellement ajoutee se charge quand meme sans erreur.

## Ou changer le tableau de bord d'analyse

Le payload est construit entierement dans `backend/api/studies.py::study_analysis()` ; ajoutez d'abord un nouveau champ la. Puis ajoutez le panneau ou la cellule correspondante dans `frontend/src/components/StudyDashboard.tsx`, qui exporte une fonction par panneau (`OptunaOptimizationOverview`, `SearchSpacePanel`, `OptimizationHistoryChart`, `ParameterInteractionHeatmap`, `TPEEvolutionView`, `ParameterImportanceChart`, `PruningSummary`, `ParallelCoordinatesChart`) composees par le `StudyDashboard` exporte par defaut. Gardez les nouveaux panneaux defensifs face aux donnees manquantes (peu de trials, pas de parametre numerique) : les panneaux existants rendent tous un texte explicatif de repli plutot qu'un graphique vide, suivant le meme motif que le repli de `ParameterImportanceChart`.

## Ou changer l'aide, le tutoriel et les traductions

L'introduction interactive vit entierement dans `frontend/src/pages/HPOLearnPage.tsx` (donnees pedagogiques fixes, aucun appel backend) ; le panneau `OptunaOptimizationOverview` de `frontend/src/components/StudyDashboard.tsx` est l'autre endroit principal avec un role explicatif similaire, cette fois construit depuis le statut en direct de l'etude courante. Les pages de cette documentation vivent dans `Optuna_App/docs/`, servies par `backend/api/docs.py` et rendues par `frontend/src/components/docs/MarkdownDoc.tsx` sur `frontend/src/pages/GuidePage.tsx`. Les chaines francaises sont la source de verite dans le code ; ajoutez leur traduction anglaise au dictionnaire `EXACT_EN` de `frontend/src/i18n/translate.ts` (correspondance exacte) ou a `PHRASE_EN` (sous-chaine, pour les chaines construites dynamiquement).

## Outils de debogage

- `GET /health` et `GET /api/orchestrator/engines` sont les deux verifications les plus rapides de l'accessibilite du backend et de Training App (voir [Verifier l'installation](configuration.fr.md#verifier-linstallation)).
- Le fichier SQLite `optuna.db` peut etre ouvert directement avec `optuna-dashboard sqlite:///optuna.db` ou tout navigateur SQLite pour inspecter l'etat des trials independamment de l'interface de cette app.
- `hpo_runs/<etude>/trial_*/stdout.log` et `stderr.log` (trials Orchestrator) contiennent la sortie brute du processus derriere un diagnostic d'echec.
- Le journal **Sortie** de la page de lancement et la reponse `GET /api/studies/{name}/status` d'une etude sont les deux facons les plus rapides de voir pourquoi un trial autonome a echoue sans ouvrir un fichier sur la machine backend.

## Carte des modules

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `hpo_trial.py` | hpo_trial.py - script de trial Optuna pour l'orchestrateur. | `main` |
| `main.py` |  | `lifespan`, `health`, `workspace_users`, `workspace_open`, `workspace_history` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `orchestrator.py` |  | `engine_catalog`, `describe_engines`, `HpoRequest`, `engines`, `run_hpo` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |
| `studies.py` |  | `StudyCreate`, `ParamSpec`, `StartBody`, `list_studies`, `create_study`, `delete_study`, `list_trials`, `study_analysis`, `best_trial`, `start_study`, `stop_study`, `study_status` (+1) |

### backend/core

| File | Description | Exports |
|---|---|---|
| `diagnostics.py` | Diagnostic lisible des échecs HPO, partagé par les deux moteurs Optuna. | `diagnose_failure` |
| `optuna_runner.py` |  | `StudyRunState`, `get_state`, `start_optimization`, `stop_optimization`, `stream_logs` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | App.tsx - sidebar layout + routes | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` |  | `BACKEND_BASE`, `studiesAPI`, `enginesAPI`, `settingsAPI`, `docsAPI`, `streamLogs` |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `EnginePreset.tsx` | Preremplit une etude manuelle pour entrainer un moteur de Training_App | `EnginePreset` |
| `StudyDashboard.tsx` |  | `OptunaOptimizationOverview`, `SearchSpacePanel`, `OptimizationHistoryChart`, `ParameterInteractionHeatmap`, `TPEEvolutionView`, `ParameterImportanceChart`, `ParallelCoordinatesChart`, `ObjectiveDistributionChart`, `PruningSummary`, `StudyDashboard` |
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page | `DOCS_ROUTE`, `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useStudies.ts` |  | `useStudies`, `useTrials`, `useStudyStatus`, `useInvalidateStudies` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `GuidePage.tsx` | Page Documentation : rend les pages markdown de Optuna_App/docs/ servies | `GuidePage` |
| `HPOLearnPage.tsx` |  | `HPOLearnPage` |
| `LaunchPage.tsx` | Configure + launch an optimization run with live SSE logs. | `LaunchPage` |
| `StudiesPage.tsx` | StudiesPage.tsx - liste des études + modal création | `StudiesPage` |
| `StudyDetailPage.tsx` | Progression, meilleur trial, table trials, graphiques. | `StudyDetailPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | types/api.ts - miroir exact des schémas Pydantic backend |  |
<!-- generated:end -->
