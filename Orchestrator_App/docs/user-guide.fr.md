---
app: orchestrator
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [sandgraph, nœuds, barre d'outils, panneau de configuration, expériences, mlops, insights, lineage]
sources: [Orchestrator_App/frontend/src/App.tsx, Orchestrator_App/frontend/src/pages/SandgraphPage.tsx, Orchestrator_App/frontend/src/components/NodeConfigPanel.tsx, Orchestrator_App/frontend/src/nodes/AppNode.tsx, Orchestrator_App/frontend/src/nodes/ports.ts, Orchestrator_App/frontend/src/nodes/nodeHelp.ts, Orchestrator_App/frontend/src/pages/ExperimentsPage.tsx, Orchestrator_App/frontend/src/pages/InsightsPage.tsx, Orchestrator_App/frontend/src/pages/PlansPage.tsx, Orchestrator_App/frontend/src/pages/ActivityPage.tsx, Orchestrator_App/frontend/src/pages/LineageGraphPage.tsx, Orchestrator_App/frontend/src/pages/GuidePage.tsx, Orchestrator_App/frontend/src/pages/AppsPage.tsx, Orchestrator_App/frontend/src/components/UserBadge.tsx]
---

# Guide utilisateur

## Fenêtre principale et navigation d'Orchestrator App

La fenêtre d'Orchestrator App comporte une barre latérale a gauche et la page courante a droite. La barre laterale liste six entrees, de haut en bas :

- **Sandgraph** : l'editeur visuel de pipeline, la page d'accueil de l'application.
- **Expériences** : la liste des graphes enregistres et les gabarits predefinis.
- **MLOps** : monitoring et tracabilite, avec les sous-onglets **Insights**, **Plans**, **Activité**, **Lineage** et **Guide**.
- **À propos** : une presentation statique de la plateforme.
- **Paramètres** : une page vide qui n'affiche que "Configuration de l'espace de travail.". Les vrais reglages de la suite vivent dans VisionNexus et dans [Configuration](configuration.fr.md).
- **Applications** : la page de lancement et de statut des sept sous-applications.

Le bas de la barre laterale porte le badge utilisateur : le nom de l'utilisateur courant, puis trois boutons (**Ouvrir workspace**, **Historique des workspaces**, **Utilisateurs connectes**) et le selecteur de langue. **Ouvrir workspace** ouvre le dossier du workspace dans l'explorateur de fichiers de la machine qui fait tourner le backend, ce qui n'a donc de sens qu'en lancement local. **Historique des workspaces** liste les workspaces recemment utilises qui existent encore et en ouvre un de la meme facon. **Utilisateurs connectes** liste les instances Orchestrator enregistrees sur la meme machine, avec leur workspace.

Le selecteur de langue bascule entre anglais et francais. Quand VisionNexus lance l'application, il impose la langue via le parametre d'URL `?lang=`. Quelques libelles restent en francais dans le code sans traduction (par exemple **Intervention requise**, **Stop**, **Auto Save**, **Kill All**) ; ils restent en francais dans les deux langues, et ce guide les cite tels qu'affiches.

## Éditeur Sandgraph : barre d'outils et canvas

La page **Sandgraph** est l'endroit ou vous construisez et lancez un pipeline, appele graphe ou experience. Elle comporte trois zones : la barre d'outils a gauche, le canvas au centre et, quand un nœud est selectionne, le panneau de configuration a droite.

La barre d'outils, intitulee **Nœuds** avec l'indication "Glisser sur le canvas", liste les types de nœuds en deux groupes :

- **Applications** : **Dataset Explorer**, **Annotation**, **Training**, **Inference / Eval**, **DVC Commit**, **MLflow (superviseur)** et **Optuna HPO**.
- **Entrées (inputs)** : **Dataset Source** et **Modèle**.

Faites glisser une entree sur le canvas pour creer un nœud avec ses valeurs par defaut. Le pied de la barre d'outils rappelle les raccourcis : `Suppr` efface, `F` ajuste la vue, `Ctrl+Z` / `Ctrl+Y` annulent et retablissent.

Sur le canvas :

| Action | Effet |
|---|---|
| Molette, glisser sur le fond | Zoomer et deplacer la vue |
| Glisser un nœud | Le deplacer (autorise meme pendant un run) |
| Glisser d'un port de sortie vers un port d'entree | Creer une arete, si les ports sont compatibles |
| Glisser depuis un port et relacher dans le vide | Ouvrir le popup de nœud compatible |
| Cliquer un nœud | Ouvrir son panneau de configuration |
| Cliquer le fond | Fermer le panneau de configuration |
| `Suppr` ou `Retour arriere` | Supprimer les nœuds ou aretes selectionnes (bloque pendant un run) |
| `F`, ou le bouton **F** en haut a droite | Ajuster la vue |
| `Ctrl+Z`, `Ctrl+Y` ou `Ctrl+Maj+Z` | Annuler, retablir |
| `Ctrl+S` | Sauvegarder le graphe |

Le coin inferieur gauche porte les controles de zoom et le coin inferieur droit une minicarte, ou chaque nœud est colore selon son statut d'execution. Quand aucun graphe n'existe, le canvas affiche **Aucune expérience** avec un bouton **Créer une expérience**.

Pendant un run, la connexion et la suppression sont bloquees car elles casseraient le lien entre les etapes du pipeline et les nœuds ; deplacer les nœuds et zoomer restent possibles.

## Barre du haut du Sandgraph

La barre du haut de la page **Sandgraph** controle le graphe ouvert. De gauche a droite :

- **Sélecteur de graphe** : une liste deroulante avec un point de statut par graphe. Elle propose **Nouvelle expérience** en haut et, au survol d'un graphe, des icones dupliquer et supprimer. Le dernier graphe ouvert est memorise par workspace et par utilisateur.
- **Nom du graphe** : cliquez dessus (**Cliquer pour renommer**) pour renommer le graphe ; `Entrée` valide, `Échap` annule.
- **Badge MLOps** : **MLOps** en vert quand le graphe contient a la fois un nœud MLflow et un nœud DVC ; **Suivi incomplet , compléter** en ambre quand un seul des deux est present (cliquer ajoute celui qui manque) ; **Experimental , Track in MLOps** quand aucun des deux n'est present (cliquer ajoute les deux). Voir [Concepts](concepts.fr.md) pour ce que cela change.
- **Annuler (Ctrl+Z)** et **Rétablir (Ctrl+Y)**.
- **Auto Save** : quand actif, le graphe est sauvegarde une seconde apres chaque edition, avec la meme validation qu'une sauvegarde manuelle. Le choix est memorise dans le navigateur.
- **Auto Check** : quand actif, les nœuds d'application sont alignes et espaces automatiquement apres chaque edition. Il ne sauvegarde pas tout seul ; combinez-le avec **Auto Save** pour persister la mise en page.
- **Sauvegarder** : affiche seulement s'il y a des changements non sauvegardes. Sauvegarder valide d'abord le graphe (voir la section sur les ports de ce guide) et propage les noms le long des aretes.
- **Lancer** : sauvegarde le graphe, le valide, puis demarre le pipeline. Pendant un run, il est remplace par le temps ecoule en secondes, **Stop** (**Arrêter le pipeline**) et **Réinitialiser**. A un point d'arret humain, un bouton orange **Terminé -> Continuer** apparait aussi.
- **Insights** : affiche apres un run reussi, ouvre le sous-onglet Insights (**Plots et journal du dernier run**).
- **Journal des événements** : affiche ou masque le panneau de logs a droite, avec le nombre d'entrees.

Sans **Auto Save**, les changements faits dans le panneau de configuration ne sont conserves que dans la page jusqu'a ce que vous cliquiez **Sauvegarder** ou pressiez `Ctrl+S`. **Lancer** sauvegarde toujours d'abord.

## Cartes de nœud sur le canvas

Chaque nœud est une carte dont l'en-tete affiche l'icone, le nom et un statut. La bordure et la couleur dans la minicarte suivent le statut d'execution : gris (idle), bleu (running), orange (attend votre action), vert (termine), rouge (echoue).

Elements pouvant apparaitre sur une carte :

- **FREE** (vert, cadenas ouvert) ou **LOCKED** (ambre, cadenas ferme) sur les nœuds Dataset Explorer, Annotation et Inference / Eval. FREE signifie que le nœud n'a aucune arete entrante ; LOCKED signifie qu'il execute un nouveau pipeline. La distinction est expliquee dans [Concepts](concepts.fr.md).
- **Badge d'ordre d'exécution** en haut a droite : le numero d'etape logique du nœud dans le pipeline.
- **Action requise** : le nœud attend a un point d'arret humain.
- **Étape échouée** avec le message d'erreur, ou **HPO échoué , fallback Training activé** pour une etude Optuna en echec avec la politique de continuation.
- **Suivi live** : sous un nœud en cours d'execution, une ligne par sous-etape (par exemple scan, embedding CLIP, creation de subset) avec sa barre de progression, et des puces de resultat a la fin (taille du subset, frames annotees, mAP, hash DVC...).
- **Choisir un subset existant** ou **Choisir une annotation existante** sur les nœuds Dataset Explorer et Annotation en mode FREE : ouvre le panneau de configuration sur la liste des sorties existantes.
- Un lien **Ouvrir** vers la sous-application du nœud.
- La bande de ports en bas : entrees a gauche, sorties a droite, colorees par type de donnee.

Chaque arete porte une etiquette qui dit ce qui transite dessus, par exemple `subset : night_dark` ou `dataset YOLO : Annot_cars-yolo`. L'etiquette affiche `None` tant que la source n'a rien de concret a transmettre. Les aretes sont dessinees a angles droits et evitent les nœuds ; double-cliquez une arete pour ajouter un point de passage et la faire basculer en routage manuel.

## Panneau de configuration et panneau d'aide d'un nœud

Cliquer un nœud ouvre son panneau de configuration a droite. L'en-tete affiche le type du nœud, un bouton d'aide rouge (**Aide , explication des paramètres**), un bouton supprimer (**Supprimer (Suppr)**) et un bouton fermer. Le premier champ de chaque nœud est **Nom du nœud (affiché)** ; les autres champs dependent du type de nœud et sont decrits un par un dans les sections de ce guide.

Regles communes du panneau :

- Un champ grise avec un cadenas est fourni par un nœud branche (infobulle "Fourni par un nœud branché (figé)") ; changez-le sur le nœud source.
- Les champs de chemin acceptent un chemin tape, un chemin Windows ou reseau colle, un dossier glisse depuis l'explorateur Windows, et un bouton **Parcourir...** quand l'application tourne dans VisionNexus. Un chemin UNC comme `\\serveur\partage\images` est traduit pour un backend Linux au moment de l'execution (voir [Configuration](configuration.fr.md)).
- Un bascule de mode propose un mode automatique (par exemple **Full Automatique (IA)**) et un mode manuel, ou le pipeline s'arrete a un point d'arret humain pour que vous travailliez dans la sous-application.
- Un encadre gris **Sortie** en bas resume ce que le nœud va produire et ou cela part.

Le bouton d'aide ouvre un second panneau a cote du panneau de configuration, redimensionnable en tirant son bord gauche. Il liste chaque parametre du nœud avec ce que c'est, ses options et son effet, et se termine par un lien vers la section correspondante de ce guide.

## Connecter les nœuds : ports et compatibilité

Chaque nœud declare des ports types. Le type determine la couleur du port et de l'arete :

| Type de port | Couleur | Produit par |
|---|---|---|
| dataset | ambre | Dataset Source |
| subset | violet | Dataset Explorer |
| dataset YOLO | rose | Annotation (sortie `out_yolo`) |
| GT (.ver) | teal | Annotation (sortie `out_ver`) |
| modèle | bleu | Modèle, Training |
| best params | cyan | Optuna HPO |
| métriques | émeraude | Inference / Eval |

Connexions acceptees, par port d'entree :

| Nœud cible | Port d'entrée | Sources acceptées |
|---|---|---|
| Dataset Explorer | dataset | Dataset Source, Dataset Explorer, Inference / Eval |
| Annotation | images (obligatoire) | Dataset Explorer, Inference / Eval, Dataset Source |
| Optuna HPO | dataset YOLO (obligatoire) | Annotation |
| Training | dataset YOLO (obligatoire) | Annotation |
| Training | modèle | Modèle |
| Training | best params | Optuna HPO |
| Inference / Eval | modèle | Training, Modèle |
| Inference / Eval | dataset (images) | Dataset Source (exclusif avec dataset YOLO) |
| Inference / Eval | dataset YOLO (GT incluse) | Annotation (exclusif avec dataset (images)) |
| Inference / Eval | GT (.ver) | Annotation (n'a de sens qu'avec dataset (images)) |

Dataset Source et Modèle n'ont aucune entree. DVC Commit et MLflow n'ont aucun port du tout : ils observent tout le graphe et ne sont jamais branches.

Une connexion incompatible est refusee pendant que vous la tirez. Brancher une seconde entree exclusive affiche "Entrées exclusives : débranchez d'abord l'autre port.". Une entree obligatoire manquante, deux entrees exclusives, ou un moteur ou une taille incoherente entre nœuds modele bloquent **Sauvegarder** et **Lancer** avec un message tel que "Annotation : entrée obligatoire manquante". Un nœud Dataset Explorer ou Annotation en mode FREE est exempte de la regle d'entree obligatoire. Une entree GT (.ver) sans entree dataset (images) ne leve qu'un avertissement.

Tirer un fil depuis un port et le relacher dans un espace vide ouvre un popup (**Rechercher un nœud compatible...**) qui liste les types de nœud capables de se brancher sur ce port. Tapez pour filtrer, cliquez une entree ou pressez `Entrée` pour creer le nœud deja connecte.

A la sauvegarde, certains noms suivent automatiquement les aretes : un Dataset Explorer reprend le nom de dataset de sa source et propose `subset_<dataset>`, une Annotation reprend le nom de subset et propose `Annot_<subset>`, une Training propose `best_<export>` comme nom de run, et un nœud Modèle impose son moteur et sa taille au Training connecte. Un nom que vous editez a la main est conserve tant que la valeur source ne change pas a nouveau.

## Bandeaux d'exécution, journal et fenêtre de fin de chaîne

Pendant qu'un graphe s'execute, plusieurs elements apparaissent autour du canvas pour suivre le pipeline et demander votre intervention.

### Bandeau de point d'arrêt humain du Sandgraph

Quand le pipeline atteint un point d'arret humain, un bandeau orange intitule **Intervention requise** apparait sous la barre du haut. Il montre l'instruction de l'etape, un lien **Ouvrir <app>** vers la sous-application concernee, le bouton **Terminé -> Continuer** et, apres lui, le libelle de la prochaine etape ("ensuite : ..."). La meme action de continuation existe dans la barre du haut sous le nom **Terminé -> Continuer**.

Pour un nœud Annotation LOCKED en mode manuel, le bandeau liste les exports deja produits pour le projet, groupes en **.ver (GT natif)** et **Dataset YOLO**, et le bouton continuer reste desactive tant que vous n'en cliquez pas un. Pour un nœud Dataset Explorer LOCKED en mode manuel, il liste les subsets existants de la meme facon. La liste se rafraichit toutes les 30 secondes et apres chaque etape d'export.

### Bandeau de divergence de fork du Sandgraph

Un graphe cree par fork d'un run affiche un bandeau indigo sous la barre du haut : **Fork de <run>**, la base figee (dataset, commit Git, mAP50 du parent) et un compteur de parametres divergents. Depliez-le pour voir, par nœud, les parametres qui ont change (ancienne valeur -> nouvelle valeur) et ceux qui restent identiques. Un bloc rouge avertit quand un nœud Dataset Explorer ou Annotation a des parametres changes mais a garde le meme `subset_name` ou `project_name` : le run reutiliserait alors ou ecraserait la sortie existante au lieu d'en creer une nouvelle.

### Journal du Sandgraph

Le bouton **Journal des événements** ouvre le panneau **Logs** a droite. Les entrees sont groupees en blocs repliables, un par nœud, colores par type de nœud, avec un compteur rouge d'erreurs. Chaque entree a une heure, un message et un detail optionnel (l'erreur complete d'une etape en echec, par exemple). Le journal de chaque graphe est conserve dans le navigateur par workspace, et les memes blocs sont montres dans les sous-onglets Insights et Activité.

Quand le pipeline se termine avec succes, une fenetre **Chaîne terminée** s'ouvre. Elle dit si le run est deja versionne ou non ; sinon, le nœud DVC clignote jusqu'a ce que vous creiez une version. **Ouvrir le nœud DVC** le selectionne, **Plus tard** ferme la fenetre.

## Nœud Dataset Source

Le nœud **Dataset Source** est une entree : il pointe vers un dossier d'images sur la machine du backend. Connecte a un Dataset Explorer, il fait scanner le dossier par le pipeline et calculer des embeddings CLIP ; connecte a une Annotation, il importe le dossier directement ; connecte a une Inference / Eval, il fournit la sequence a traiter.

Champs :

- **Nom du dataset** (`dataset_name`, defaut `mon-dataset`) : identifiant du dataset dans Dataset Explorer ; reutilise en aval comme nom de subset ou de projet.
- **Chemin (dossier)** (`dataset_path`) : chemin absolu du dossier d'images. Le panneau demande a Dataset Explorer si ce chemin est deja connu sous un autre nom ; si oui, il affiche "Ce chemin existe déjà dans Dataset Explorer sous ce nom" et une case **Créer quand même un dataset séparé (nouveau scan + ré-embedding CLIP)** (`allow_duplicate`). Sans la case, le dataset existant est reutilise.
- **n_clusters** (defaut 15) : nombre de clusters CLIP affiches dans le playground de Dataset Explorer.

## Nœud Modèle

Le nœud **Modèle** est une entree qui fournit des poids existants, sans Training amont. Connectez-le a une Training pour repartir de ces poids (fine-tuning), ou a une Inference / Eval pour les tester.

Champs :

- **Moteur d'entraînement** (`engine`) : le moteur qui a produit les poids. YOLOX est le defaut ; le selecteur n'apparait que si un plugin fournit d'autres moteurs.
- **Chemin du modèle** (`model_path`), suivi des extensions acceptees du moteur : chemin du fichier de poids. Un avertissement apparait quand l'extension ne correspond pas au moteur ("ces poids ne se chargeront pas").
- **Taille (fige le Training)** (`model_size`) : l'architecture des poids. Quand le nœud est branche sur une Training, le moteur et la taille de la Training sont figes sur ces valeurs, car les poids ne se rechargent qu'avec leur propre moteur et leur propre taille.

## Nœud Dataset Explorer

Le nœud **Dataset Explorer** selectionne un sous-ensemble d'images avec Dataset Explorer. En mode LOCKED (avec une arete entrante) il cree un nouveau subset ; en mode FREE (aucune arete entrante) il expose un subset qui existe deja dans le workspace.

Champs :

- **Dataset source** (`dataset_name`) : rempli depuis la source connectee et fige.
- **Nom du subset (sortie)** (`subset_name`) : nom du subset a creer ou a utiliser. **Parcourir** charge les subsets existants du workspace (`explorer_<user>/subsets/`) avec leur nombre d'images ; en mode FREE, cliquer sur l'un le selectionne.
- **Full Automatique (CLIP)** / **Manuel** (`full_auto`, defaut automatique) : le mode automatique selectionne les images par une requete texte CLIP ; le mode manuel s'arrete a un point d'arret pour que vous creiez le subset vous-meme dans le playground Dataset Explorer.
- **Requête sémantique** (`query`) : texte decrivant les images voulues, par exemple `night dark road car headlight`.
- **top_k** (defaut 50) : nombre d'images selectionnees, les plus proches de la requete.

En mode LOCKED automatique, le nœud produit quatre etapes : un point d'arret pour verifier les clusters CLIP, la creation du subset, un point d'arret pour valider le subset, et l'export du subset vers le dossier d'imports d'Annotation. Chainer deux nœuds Dataset Explorer cree un subset d'un subset.

## Nœud Annotation

Le nœud **Annotation** cree un projet Annotation App depuis son entree, l'annote automatiquement ou attend votre action, puis l'exporte dans deux formats : un dataset YOLO et un fichier de verite terrain `.ver`. En mode FREE il expose un export qui existe deja.

Champs :

- **Subset source** (`subset_name`) : rempli depuis le Dataset Explorer ou le Dataset Source connecte, fige.
- **Nom du projet (à annoter)** (`project_name`) : le projet Annotation App, propose comme `Annot_<subset>`. Le panneau avertit quand le subset a deja ete importe dans un autre projet ("Ce subset a déjà été annoté dans ce projet").
- **Mode** (`annotation_mode`) : **Séquentiel (frame par frame)** (`sequence`, defaut) ou **Aléatoire** (`random`).
- **Train**, **Val**, **Test** (`split_train` 0,8, `split_val` 0,2, `split_test` 0) : repartition de l'export YOLO.
- **Full Automatique (IA)** / **Manuel (annoter dans l'app)** (`full_auto`, defaut manuel pour un nouveau nœud).
- En mode automatique : **Modèle IA** (`ai_model` : **SAM 3** ou **Grounding DINO**), **Prompt texte (open-vocab)** (`ai_text`, par exemple `car. person. tree.`), **Seuil box (box_threshold)** ou **Seuil de confiance** (`ai_threshold`, defaut 0,5 pour un nouveau nœud), et **Valider les annotations avant export (Continuer)** (`review_before_export`), qui ajoute un point d'arret apres l'annotation automatique.
- **Export à utiliser (aval)**, mode FREE seulement : **Parcourir** liste les exports de `annotation_<user>/exports/` en deux blocs, **.ver (-> Inference/Éval)** et **YOLO (-> Training/Optuna)** ; celui choisi est stocke dans `export_name`.
- **Classes (labels)** (`label_classes`) : liste de classes avec une couleur, **+** pour en ajouter une ; un nouveau nœud commence avec `objet`.

En mode LOCKED automatique, l'export est automatique (le dataset `<projet>-yolo` se cree tout seul). En mode LOCKED manuel, l'export a utiliser se choisit dans le bandeau du point d'arret pendant que le pipeline attend.

## Nœud Training

Le nœud **Training** entraine un modele avec Training App. Son formulaire est construit depuis le catalogue du moteur selectionne, recupere aupres de Training App (ou du registre local quand Training App ne tourne pas).

Champs :

- **Nom du run / modèle (sortie)** (`run_label`) : nom du run et des poids finaux.
- **Moteur d'entraînement** (`engine`, defaut YOLOX) : fige par un nœud Modèle connecte. Un message rouge apparait quand une etude Optuna amont optimise un autre moteur.
- **Taille** (`model_size`) : taille du modele dans le catalogue du moteur (pour YOLOX : nano, tiny, s, m, l, x) ; vide signifie le defaut du moteur ; fige par un nœud Modèle connecte.
- **Epochs** (defaut 300 pour un nouveau nœud), **Batch** (16), **Imgsz** (640).
- **Device** : `auto`, `cpu` ou `cuda:0`.
- **Full Automatique (REST)** / **Manuel (lancer dans l'app)** (`full_auto`) : le mode automatique appelle Training App et attend la fin de l'entrainement ; le mode manuel s'arrete a un point d'arret pendant que vous entrainez dans Training App.
- **Tous les hyperparamètres (N)** : liste repliable de chaque hyperparametre du moteur, avec sa valeur par defaut. Quand un nœud Optuna est branche, ces valeurs sont figees ("figés (Optuna)") car les best params de l'etude les remplacent au moment de l'execution.

Le chemin du dataset est derive du nœud Annotation connecte ; vous ne le tapez jamais.

## Nœud Inference / Eval

Le nœud **Inference / Eval** evalue ou execute un modele avec Inference App. Sans aucune entree (FREE), il ouvre une session interactive dans Inference App : choisissez-y un fichier media, un fichier de poids et un mode.

Avec des entrees (LOCKED) :

- **Auto (headless)** / **Manuel (interactif)** (`full_auto`) : le mode manuel s'arrete a un point d'arret pendant que vous lancez YOLO, MOT ou du SOT par clic dans l'application.
- **Tâche** (`task`) : **Tracking (tracker)** (`tracking`, defaut) ou **Détection (YOLO only)** (`detection`).
- **Moteur d'entraînement** et **Architecture** (`engine`, `model_size`) : figes par le modele amont. Un message rouge apparait quand ce nœud declare un autre moteur ou une autre taille que le checkpoint amont.
- **Modèle (best.pt)** (`model_path`) : vide signifie les meilleurs poids de la Training amont (ou le chemin du nœud Modèle).
- **Séquence (source)** (`sequence_dir`) : fige quand un Dataset Source est connecte ; vide avec une Annotation connectee signifie les images du split choisi.
- **Split Annotation (train/val/test)** (`gt_split`, defaut `val`) : affiche quand une Annotation est connectee ; choisit le split utilise comme sequence et verite terrain.
- **GT (dossier .txt YOLO / .ver)** (`annotation_file`) : verite terrain ; vide signifie l'export `.ver` de l'Annotation connectee, sinon les labels du split choisi.
- **conf**, **iou**, **imgsz** (`conf_thresh`, `iou_thresh`, `img_size`).
- Tracking seulement : **Tracker multi-objet** (`tracker_mot` : **Aucun , YOLO pur** ou **ByteTrack**), **Track high**, **Match IoU**, et les blocs repliables **Rendu & sauvegarde** (**Sauver le média annoté**, **Frames max (0 = toutes)**), **Fenêtre & système** (**Device**, **Buffer ByteTrack**) et **yaml brut (tous les params)** (n'importe quelle cle de la configuration Inference App, en JSON).
- **config.yaml complet (tous les params, prérempli)** : chaque cle du `config/defaults.yaml` d'Inference App, groupee ; seuls les champs que vous modifiez sont envoyes.

En mode detection, le nœud lance une validation standard du modele sur le split choisi du dataset YOLO (mAP50, mAP50-95, precision, rappel, courbes PR et F1, matrice de confusion), sans aucun tracker. En mode tracking, il lance YOLO seul ou YOLO plus ByteTrack sur la sequence et rapporte la vitesse et, avec une verite terrain, les metriques de tracking.

## Nœud Optuna HPO

Le nœud **Optuna HPO** lance une etude d'hyperparametres avec Optuna App. Chaque essai est un entrainement complet sur le dataset YOLO de l'Annotation connectee ; les meilleurs parametres transitent par l'arete vers la Training aval.

Champs :

- **Nb trials** (`n_trials`, defaut 20).
- **Direction** (`direction`) : **Maximiser** (defaut) ou **Minimiser**.
- **Métrique objectif** (`metric`) : mAP@50 (defaut), mAP@50-95, Recall ou Precision.
- **Moteur d'entraînement** et **Taille entraînée par les trials** (`engine`, `model_size`) : doivent correspondre a la Training aval, sinon le lancement est refuse.
- **Arrêter le pipeline si aucun trial n'aboutit** (`stop_on_failure`, coche par defaut) : quand decoche et que l'etude echoue, la Training demarre quand meme avec ses propres parametres configures.
- **Full Automatique (étude auto)** / **Manuel (gate , étude dans l'app)** (`full_auto`).
- **Espace de recherche (N sélectionnés)** : les hyperparametres a optimiser, coches ; les plages sont fixees par le catalogue du moteur. Sans rien de coche, la selection par defaut du moteur est utilisee.
- En mode manuel, **best_params (-> Training)** : les meilleurs parametres trouves dans Optuna App, en paires `cle=valeur` separees par des virgules, ou en JSON.

L'echantillonneur est TPE et le pruning est desactive.

## Nœud DVC Commit

Le nœud **DVC Commit** versionne les sorties d'un run termine, a la demande. Il n'a aucun port : il observe tout le graphe. Rien n'est versionne automatiquement au lancement ; tant que vous ne cliquez pas, le run n'est pas trace dans DVC.

Le panneau affiche :

- Une explication ambre : creer une version fait un commit Git de l'instantane avec les metadonnees du run (Run-Id, dataset, mAP50), enregistre le contenu des artefacts coches dans le cache DVC, et le pousse si un remote est configure.
- L'etat de version du dernier run termine : **Versionné** (commit, dataset, date) ou **Non versionné , aucun commit DVC pour ce run**.
- **Message de commit** (`commit_message`).
- **Artefacts du graphe** avec **rafraîchir** : une ligne par artefact du run avec une case, son chemin, sa taille et un lien **télécharger** : le dataset YOLO, les annotations GT (.ver), le meilleur modele, les meilleurs params Optuna, les metriques finales (`metrics.json` de l'Insight) et l'instantane du graphe (JSON). Un artefact pas encore produit affiche "pas encore produit , lancez le pipeline".
- **Créer une version DVC (Git + cache DVC)** : desactive tant qu'un run n'est pas termine, et remplace par **Run déjà versionné** une fois fait.
- **Ouvrir ce run dans DVC App**.

## Nœud MLflow

Le nœud **MLflow (superviseur)** observe le store MLflow du workspace. Il n'a aucun port et aucun parametre. Sa presence fait lancer MLflow App par le pipeline, et chaque etape Training, Inference / Eval et Optuna y logue ses runs sous un nom deterministe `{graphe}/{nœud}`, dans une experience MLflow nommee d'apres le graphe.

Le panneau liste **Ce qui sera loggé** : une ligne par Training (parametres, mAP, plots, poids) et par Inference / Eval (mAP, MOTA, IDF1, benchmark). La carte du nœud montre les runs prevus (**À logger**) et un resume live du store (**Store (live)**), ou "MLflow_App non lancée" quand l'application ne repond pas. **Ouvrir ce run dans MLflow App** ouvre le dernier run.

## Page Expériences

La page **Expériences** liste vos graphes et les gabarits predefinis.

Le bloc **Templates prédéfinis** (lecture seule) a deux groupes :

- **Scénarios mainstream** : **Entraînement rapide**, **Chaîne standard** et **Chaîne + HPO Optuna**.
- **Scénarios exemple / use case** : **Exploration dataset**, **Re-train depuis annotation existante** et **Annotation depuis subset existant**.

Chaque carte de gabarit affiche une description et des etiquettes. **Utiliser ce template** cree un nouveau graphe a partir de lui et l'ouvre dans le Sandgraph. Le contenu de chaque gabarit et comment l'utiliser sont decrits dans [Procédures](workflows.fr.md).

Sous **Mes expériences**, chaque carte de graphe affiche son nom, son badge de statut, son nombre de nœuds et de connexions, une barre de progression des nœuds termines, la derniere modification et le nombre de runs. Actions : **Ouvrir**, **Lancer** (ou **Réinitialiser** pendant qu'il tourne), **Dupliquer** et **Supprimer** (avec confirmation). **Nouvelle** cree un graphe vide.

## Onglet MLOps : sous-onglet Insights

Le sous-onglet **Insights** montre le Run Insight de chaque run : les resultats collectes, les plots et le lineage (la lignée) d'une execution. La liste a gauche affiche une entree par run (nom du graphe, id du run, nombre de plots, date de generation), avec une icone supprimer au survol ; supprimer un Insight ne retire qu'un cache d'affichage. L'en-tete propose un bouton regenerer par graphe recent.

Le detail d'un run contient, de haut en bas :

- **Identité du run** : l'id du run, le badge MLOps ou Experimental, la provenance de fork, et six champs (Git, Dataset, DVC version, MLflow Run, Model, mAP50), chacun soit un vrai lien soit marque comme non lie.
- Actions : **Open MLflow Run**, **Inspect DVC**, **Inspect Dataset**, **View Artifacts**, **Open Sandgraph**, **Open Lineage**, **Track in MLOps** (pour un graphe experimental) et **Fork this run**.
- **Reproduce Run** : une recette en quatre etapes (restaurer la version des donnees dans DVC App, recuperer les fichiers, forker et relancer, comparer au run MLflow d'origine), active seulement quand le run est reproductible.
- **Reproducibility** : la checklist, **Reproducible** ou **Incomplet**, avec le detail de chaque verification.
- **Régénérer** et **Exporter rapport HTML** (un fichier autonome avec des graphiques interactifs).
- **Résultats , modèles entraînés**, **Entraînement , courbes par epoch** (mAP, pertes, precision et rappel), **Optuna , historique de l'étude**, **Analyse détaillée du modèle** (matrice de confusion, courbes PR et F1, distribution des labels, images de validation), **Journal des étapes** et **Logs complets**, et la liste des fichiers persistes dans le workspace.

Le contenu d'un Insight et le sens de chaque verification sont expliques dans [Concepts](concepts.fr.md).

## Onglet MLOps : sous-onglet Plans

Le sous-onglet **Plans** (**Plans d'expériences**) construit une serie d'experiences et la lance en un clic. La liste des plans est a gauche ; **Nouveau plan** en cree un.

Pour le plan selectionne :

- Le nom du plan, **Enregistrer**, **Lancer le plan** et une icone supprimer.
- Une carte par etape : un libelle d'etape, le graphe de base a dupliquer (**graphe de base...**), et des champs de surcharge : **Subset**, **Projet annot.**, **Nb images**, **Seuil annot.**, **Epochs**, **LR par image**, **Batch** et **Run label**. Les champs vides gardent la valeur du graphe de base.
- **Ajouter une étape**.
- Pendant et apres l'execution, un bloc de progression avec le statut de chaque etape et, quand disponible, son mAP50, sa version DVC et son commit Git.

Le texte d'introduction de la page dit qu'un plan committe dans DVC ; ce n'est pas le cas : un plan ne cree jamais de commit DVC, vous versionnez les runs voulus depuis le nœud DVC. La facon dont les surcharges s'appliquent est decrite dans [Concepts](concepts.fr.md).

## Onglet MLOps : sous-onglet Activité

Le sous-onglet **Activité** est le journal brut de chaque execution, le plus recent d'abord. Un champ de recherche (**Filtrer par nom...**), un filtre de statut (**Tous les statuts**) et **Réinitialiser** restreignent la liste ; le pied de page indique combien de lignes sont affichees.

Colonnes : **Statut**, **Expérience** (nom du graphe ou du pipeline), **Étapes** (nombre d'etapes), **Démarré**, **Durée** et **Actions**. Actions par ligne :

- **Ouvrir le graphe** dans le Sandgraph.
- **Voir les logs** : les logs complets du dernier run du graphe, en blocs repliables.
- **Arrêter ce run**, pour un run encore en cours.
- **Dupliquer et refaire** / **Refaire** : duplique le graphe pour le relancer.

Le journal conserve les 200 dernieres executions.

## Onglet MLOps : sous-onglet Lineage

Le sous-onglet **Lineage** (**Lineage des expériences**, la lignée des runs) montre comment tous les runs de tous les graphes se relient : datasets sources communs, subsets extraits, runs, forks, modeles, runs MLflow et artefacts produits.

Controles :

- **Graphe** / **Liste** : vue graphe (runs groupes par experience, dataset source en haut) ou vue liste.
- **Compact** / **Décompact** : masque ou montre les productions de chaque run.
- Un champ de recherche (`Run, dataset, subset...`).
- Cliquer un nœud ouvre **Détails** : entrees consommees, sorties produites, liens directs vers DVC App et MLflow App, **Fork this run** et **Comparer ce run**.

Chaque run apparait aussi comme un jeton deplacable. Deposez deux jetons dans le panneau **Comparaison de runs** pour les comparer section par section : les sections identiques restent discretes, les differences sont marquees comme modifiees, ajoutees ou supprimees, champ par champ. Une sortie absente dans un fork n'est jamais remplacee par celle de son parent. Seuls les runs termines sont montres ; les runs echoues et interrompus sont masques de cette vue.

## Onglet MLOps : sous-onglet Guide

Le sous-onglet **Guide** est la documentation integree : il affiche les neuf pages de cette documentation, dans la langue de l'interface. La colonne de gauche groupe les pages en **Utilisateur**, **Installation et réglages** et **Développeur**, et montre la table des matieres de la page ouverte. Les liens entre pages restent dans le Guide, et l'URL (`/mlops/guide?doc=<page>#h-<n>`) peut etre mise en favori. Quand une page manque dans la langue courante, l'autre langue est montree avec un avertissement.

## Page Applications

La page **Applications** lance et surveille les sept sous-applications (annotation, explorer, training, inference, dvc, mlflow, optuna) demarrees par cette instance Orchestrator. Chaque carte affiche l'id de l'application, une description, le statut de sante (latence en ms, ou `offline`), le workspace de la session en cours, et les boutons **Ouvrir** (frontend de l'application) et **Lancer** ou **Arrêter**.

**Lancer** ouvre une petite fenetre avec **Workspace de base** (vide signifie a l'interieur du workspace Orchestrator), **Utilisateur** (vide signifie l'utilisateur courant) et **Env conda** (defaut `IA_env`). **Launch All** lance toutes les applications non demarrees, **Kill All** les arrete toutes. Une carte en erreur affiche **Échec du démarrage** avec la raison et le chemin du log backend ; une carte en demarrage affiche **Démarrage en cours...**. La page se rafraichit toutes les 3 secondes.

Vous avez rarement besoin de cette page : lancer un graphe demarre automatiquement les applications dont il a besoin (voir [Concepts](concepts.fr.md)). Le pied de page (**Mode indépendant**) rappelle que chaque application peut aussi etre lancee seule avec le lanceur de la suite.

## À propos, Paramètres et anciennes pages cachées

La page **À propos** est une presentation statique de la plateforme (applications, un exemple de boucle d'entrainement, technologies, demarrage rapide, raccourcis). Son contenu date de plusieurs changements (par exemple DVC n'est plus une etape automatique), fiez-vous donc plutot a cette documentation. La page **Paramètres** est un espace vide.

Trois anciennes pages restent accessibles seulement par URL : `/dashboard` (pipelines actifs et activite recente), `/library` (un editeur de pipeline base sur une liste, anterieur au Sandgraph) et `/pipeline/<id>` (la vue d'execution d'un tel pipeline). Elles utilisent l'ancienne API de pipeline et ne sont pas necessaires a l'usage normal.
