---
app: explorer
doc_type: troubleshooting
audience: both
lang: fr
title: Dépannage
order: 50
tags: [erreurs, clip, faiss, liens symboliques, scan, export, smb]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/core/embedder.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/api/duplicates.py, Dataset_Explorer_App/backend/api/filter.py, Dataset_Explorer_App/backend/api/export.py, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/backend/utils/native_share.py, Dataset_Explorer_App/backend/api/settings.py, Dataset_Explorer_App/frontend/src/components/LanguageToggle.tsx]
---

# Dépannage

## "Modele CLIP non charge" au lancement des embeddings ou d'une recherche

**Symptôme** : un clic sur **Embeddings** dans le Playground, une recherche, le filtre CLIP de la Gallery ou la recherche visuelle du Catalogue affiche une erreur contenant "Modele CLIP non charge".

**Cause** : le backend n'a pas pu charger les poids CLIP ViT-B/32 au démarrage. Il fonctionne hors ligne et ne les télécharge jamais : si `CLIP_WEIGHTS` n'est pas défini, que `Dataset_Explorer_App/models/ViT-B-32-openai.safetensors` manque et que le cache Hugging Face ne contient pas le modèle, le chargement échoue. Le backend continue de fonctionner pour tout ce qui n'a pas besoin de CLIP (Gallery, carte des datasets déjà calculés, subsets).

**Solution** :

1. Ouvrez `http://localhost:<port du backend>/health` : `"clip_loaded": false` confirme la cause.
2. Lisez le journal du backend : la ligne "Impossible de charger CLIP" donne le détail.
3. Placez le fichier de poids comme décrit dans la section *Poids du modèle CLIP* de [Configuration](configuration.fr.md), ou pointez `CLIP_WEIGHTS` vers son chemin.
4. Redémarrez le backend : le modèle n'est chargé qu'au démarrage.

## La carte du dataset affiche le statut error après un scan

**Symptôme** : après **Scanner**, la carte passe de `scanning` à un statut rouge `error`. Le survol du statut affiche un message.

**Cause** : le message indique le cas rencontré :

- "Aucune image trouvee dans ..." : le dossier ne contient aucun fichier `.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff` ou `.webp`, ni de fichier d'un format optionnel (comme `.optional`).
- "Acces refuse a ..." : le processus du backend ne peut pas lire le dossier.
- Un autre message : une erreur inattendue pendant le scan (système de fichiers illisible, fichiers corrompus).

**Solution** :

1. Vérifiez le chemin et les extensions des fichiers. Rappel : le chemin est lu par la machine du backend ; un chemin Windows n'existe pas sur une VM Linux.
2. Pour une erreur d'accès, donnez à l'utilisateur du backend les droits de lecture sur le dossier (sur une VM, vérifiez les options de montage du partage).
3. Supprimez le dataset en erreur avec la corbeille de sa carte, puis scannez de nouveau.

## "Chemin introuvable" à l'ajout d'un dataset

**Symptôme** : **Scanner** affiche immédiatement une erreur "Chemin introuvable : ..." et aucune carte n'est créée.

**Cause** : le backend ne trouve pas le dossier. Trois cas fréquents :

- Le chemin est écrit pour une autre machine : un chemin Windows local alors que le backend tourne sur une VM, ou l'inverse.
- Un chemin réseau Windows (`\\hote\partage\...`) a été traduit vers un chemin serveur qui n'existe pas : un backend Linux convertit ces chemins vers `/home`, `/mnt`, `/srv`, `/media` ou `/data` suivi du nom du partage. Sur une VM dont le point de montage ne suit pas cette règle, la traduction échoue.
- Le backend tourne en local sous Windows et le chemin réseau `\\hote\partage\...` n'est pas accessible depuis la machine du backend : un backend Windows utilise le chemin tel qu'il est saisi, sans traduction, il doit donc être accessible avec cette orthographe exacte.

**Solution** :

1. Sur une VM, saisissez directement le chemin serveur (par exemple `/srv/datasets/run01`), ou montez le partage selon la convention décrite dans [Configuration](configuration.fr.md).
2. Avec un backend Windows local, associez le partage réseau à une lettre de lecteur dans Windows et utilisez un chemin comme `Z:\run01`.
3. Vérifiez la casse et l'orthographe : les chemins Linux distinguent majuscules et minuscules.

## La fenêtre Chemin déjà connu apparaît à l'ajout d'un dataset

**Symptôme** : après **Scanner**, une fenêtre **Chemin déjà connu** liste un ou plusieurs datasets existants.

**Cause** : le même dossier (après résolution des liens et des parties relatives) est déjà un dataset de ce workspace, éventuellement sous un autre nom. Le scanner de nouveau créerait un second dataset indépendant et encoderait deux fois les mêmes images.

**Solution** :

1. Cliquez sur **Annuler** et utilisez le dataset existant : retrouvez-le dans **Mon workspace** et épinglez-le.
2. Si vous avez vraiment besoin d'une seconde analyse du même dossier (par exemple avec d'autres réglages), cliquez sur **Continuer quand même**. Les deux cartes affichent alors un badge **doublon de**.
3. Pour remplacer l'ancien dataset, supprimez-le d'abord avec sa corbeille, puis scannez de nouveau.

## Les embeddings restent sur "En cours..." ou le dataset repasse en pending

**Symptôme** : la carte du Playground affiche **En cours...** avec une barre de progression qui n'avance plus, ou un dataset qui était en `embedding` est revenu en `pending` après un redémarrage du backend.

**Cause** : le pipeline d'embeddings tourne dans une tâche de fond sur le serveur. Si le backend est arrêté ou rechargé pendant le calcul (plantage, fermeture de VisionNexus, rechargement automatique après une modification du code), la tâche est perdue ; au démarrage suivant le dataset repasse en `pending`. Une barre immobile peut aussi être simplement une phase longue : les phases `umap` et `clustering` n'ont pas de progression intermédiaire et peuvent durer plusieurs minutes sur un grand dataset. Seules trois tâches lourdes tournent en même temps ; les autres attendent dans la file.

**Solution** :

1. Regardez le journal du backend : "Embed termine" signifie que le calcul est fini ; une trace d'erreur explique un échec (le statut passe alors à `error`).
2. Consultez `http://localhost:<port du backend>/health` : la liste `jobs` montre les tâches en cours et en attente.
3. Si le dataset est revenu en `pending`, cliquez de nouveau sur **Embeddings**. Les images déjà encodées ne sont pas réencodées.

## Les boutons Carte, Recherche et Doublons manquent dans le Playground

**Symptôme** : un dataset épinglé dans le Playground n'affiche que **Embeddings**, sans **Carte**, **Recherche**, **Doublons**, **Cluster** ni **Réduc.** ; la page de carte affiche **Carte non calculée pour ce dataset.**

**Cause** : ces outils exigent que le pipeline d'embeddings soit allé au bout au moins une fois (la carte n'est marquée calculée qu'à la fin). Un dataset en `pending`, `scanning` ou `error`, ou dont le pipeline a échoué, n'a pas de carte.

**Solution** :

1. Cliquez sur **Embeddings** et attendez le statut `ready`.
2. Si le statut passe à `error`, lisez le journal du backend. Causes fréquentes : modèle CLIP non chargé (voir la première section de cette page) et manque de mémoire GPU (voir *Mémoire insuffisante pendant les embeddings*).
3. Un dataset absent du Playground n'est tout simplement pas épinglé : épinglez-le depuis la Gallery.

## La recherche ou les doublons échouent avec "Index FAISS non charge"

**Symptôme** : la page de recherche ou la page des doublons d'un dataset `ready` affiche une erreur comme "Index FAISS non charge en memoire" ou "Index FAISS non disponible".

**Cause** : l'index de similarité du dataset n'est pas en mémoire. Au démarrage, le backend recharge le fichier `faiss/<id du dataset>/index.faiss` de chaque dataset `ready` ; si le fichier manque ou est illisible (workspace copié sans le dossier `faiss/`, fichier supprimé, erreur disque), le journal affiche "Index FAISS non rechargé pour dataset N" et le dataset reste `ready` sans index.

**Solution** :

1. Cliquez sur **Embeddings** sur le dataset dans le Playground : l'index est reconstruit à partir des embeddings stockés, sans réencoder les images.
2. Quand vous déplacez un workspace, copiez tout le dossier, y compris `faiss/`.

## Le dossier d'un subset reste vide ou l'export échoue sous Windows

**Symptôme** : après **Créer subset**, la carte du subset n'a pas de dossier de liens ; ou **Exporter** échoue avec "Export echoue" et un message sur les liens symboliques ou les privilèges.

**Cause** : la stratégie de liens est **Symlinks** et Windows refuse de créer des liens symboliques sans Mode développeur ni droits administrateur. Le subset est enregistré en base, mais son dossier ne peut pas être rempli ; l'export ne peut pas du tout être écrit. Un partage réseau qui interdit les liens a le même effet.

**Solution** :

1. Activez le Mode développeur de Windows (Paramètres, Espace développeurs), puis redémarrez le backend. Ou choisissez **Copie physique** dans **Subsets & liens** de la page **Paramètres** et cliquez sur **Sauvegarder les modifications**.
2. Exportez de nouveau. Pour un subset sans dossier, recréez-le (ou dupliquez-le avec **Dupliquer**) pour que le dossier soit créé avec la nouvelle stratégie.

## "Ce chemin d'export existe déjà" à l'export d'un subset

**Symptôme** : **Exporter** sur un subset affiche "Ce chemin d'export existe déjà : ...".

**Cause** : le subset a déjà été exporté vers exactement ce dossier. Chaque subset garde la liste de ses exports et refuse un second export vers la même destination. Les images manquantes sont tout de même ajoutées au dossier avant le refus.

**Solution** :

1. Si le but est une seconde copie, choisissez un autre **Dossier de destination** dans la fenêtre d'export (mode autonome).
2. Si le but est de rafraîchir l'export après avoir modifié le subset, supprimez ou renommez le dossier `<destination>/<nom du subset>/` sur le disque, puis utilisez **Dupliquer** sur le subset et exportez la copie, car l'ancien enregistrement d'export reste attaché au subset d'origine.

## Un subset ne peut pas être supprimé

**Symptôme** : la corbeille d'un subset est désactivée, ou la suppression affiche "Subset verrouillé".

**Cause** : le subset est verrouillé. Le verrou est stocké sur le serveur et bloque aussi la suppression par l'API.

**Solution** : cliquez sur l'icône de cadenas du subset (**Déverrouiller**), puis supprimez-le. Supprimer un subset retire sa fiche et son dossier de liens ; les images originales et les dossiers déjà exportés vers Annotation App sont conservés. Le verrouillage et la suppression sont tous deux tracés dans le journal d'audit du workspace.

## Une image rejetée manque sur la carte, dans les recherches ou dans un export

**Symptôme** : une image n'est pas proposée par la recherche par texte, n'apparaît pas sur la carte ni dans le Catalogue, ou est absente d'un subset exporté, alors qu'elle est toujours sur le disque.

**Cause** : l'image a été marquée comme rejetée, dans les pages de doublons ou avec **Exclure du dataset**. Une image rejetée est écartée de la carte, des clusters, des recherches par texte d'un dataset et du Catalogue, et de l'export d'un subset, même si le subset garde encore un lien vers elle. Rien n'est supprimé sur le disque. Un subset ne perd son lien vers une image rejetée que lorsque **Appliquer au subset** est utilisé.

**Solution** :

1. Ouvrez la page de doublons du dataset et remettez l'image sur **Garder**, puis **Sauvegarder**.
2. Pour effacer toutes les décisions d'un dataset, utilisez **Reset** sur sa carte du Playground (la carte et les clusters sont alors recalculés).
3. Après avoir changé des décisions, reconstruisez la carte avec **Rebuild** pour que les clusters correspondent aux images conservées.

## L'onglet Métadonnées du Catalogue ne trouve rien

**Symptôme** : l'onglet **Métadonnées** affiche un avertissement indiquant qu'aucun dataset n'a de métadonnées, ou une recherche ne renvoie rien alors que le tableau contient les mots.

**Cause** : les métadonnées n'existent que pour les datasets ajoutés avec un tableau dans **Métadonnées (optionnel)**, et seulement pour les images dont le nom correspond à la colonne clé. Si la colonne clé était mauvaise, aucune image n'a reçu de métadonnées. L'absence de l'extension SQLite FTS5 désactive aussi la recherche (le journal affiche "FTS5 indisponible").

**Solution** :

1. Vérifiez le badge **métadonnées** sur la carte du dataset : sans lui, aucun tableau n'a été associé. Un tableau ne s'associe qu'à l'ajout d'un dataset : supprimez-le et ajoutez-le de nouveau avec le tableau.
2. Assurez-vous que la colonne clé contient les noms de fichiers image (avec ou sans extension).
3. Utilisez **Explorer une colonne :** pour voir les valeurs réellement indexées.

## La langue n'est pas celle attendue hors de VisionNexus

**Symptôme** : dans un navigateur hors de VisionNexus, l'application s'ouvre dans une autre langue que la dernière choisie.

**Cause** : hors de VisionNexus, la langue est cherchée dans cet ordre : le paramètre `?lang=` de l'adresse, puis le choix mémorisé dans le navigateur, puis le champ `ui_language` des paramètres du workspace. Basculer **FR** / **EN** met à jour les deux derniers. Un navigateur dont les données ont été effacées, ou une adresse qui porte encore un ancien `?lang=`, redonne la langue précédente. Dans VisionNexus, la langue vient du lanceur et cela ne s'applique pas.

**Solution** : rebasculez avec **FR** / **EN**, retirez `?lang=` de l'adresse, ou renseignez `"ui_language": "fr"` (ou `"en"`) directement dans `settings.json` du workspace.

## Les exports arrivent dans un dossier inattendu

**Symptôme** : un export vers Annotation App atterrit dans un autre dossier que celui attendu.

**Cause** : le dossier d'export est choisi dans cet ordre : le **Dossier de destination** saisi dans la fenêtre d'export (mode autonome seulement), puis le **Dossier d'imports** de **Export Annotation App** dans la page Paramètres, dont la valeur initiale vient de `ANNOTATION_APP_IMPORTS`. Quand l'application est lancée par l'Orchestrateur, le dossier d'export est toujours celui que l'Orchestrateur fournit et aucun des deux ne s'applique.

**Solution** : saisissez le dossier voulu dans **Dossier de destination**, ou changez le **Dossier d'imports** dans la page Paramètres et sauvegardez. Vérifiez que le changement a bien été enregistré : le dossier utilisé est écrit dans l'entrée du journal d'audit de l'export.

## Mémoire insuffisante pendant les embeddings

**Symptôme** : les embeddings échouent avec une erreur CUDA "out of memory" dans le journal du backend et le statut du dataset passe à `error`, ou la machine devient très lente pendant la phase `embedding`.

**Cause** : les images sont encodées par lots de 64. Plusieurs pipelines d'embeddings peuvent tourner en même temps (jusqu'à trois par défaut), chacun chargeant ses lots sur le même GPU, pendant que d'autres applications de la suite (Annotation App avec SAM2, entraînement) utilisent aussi le GPU. Des images très grandes alourdissent aussi le décodage en mémoire.

**Solution** :

1. Lancez un seul pipeline d'embeddings à la fois, ou démarrez le backend avec `EXPLORER_JOB_WORKERS=1`.
2. Libérez le GPU utilisé par les autres applications, puis cliquez de nouveau sur **Embeddings** ; les images déjà encodées sont sautées.
3. Sans GPU, CLIP tourne sur CPU : plus lent mais sans cette limite.

## La page Documentation affiche Documentation non disponible

**Symptôme** : la page **Documentation** affiche **Documentation non disponible** avec le message que le backend ne répond pas, ou que la page n'est pas encore écrite.

**Cause** : les pages sont servies par le backend depuis le dossier `docs/` de l'application. Si le backend ne tourne pas ou n'est pas joignable, rien ne peut s'afficher. Le second message signifie que le fichier de la page manque dans `docs/`, par exemple dans une copie partielle de l'application.

**Solution** :

1. Vérifiez que le backend répond sur `http://localhost:<port du backend>/health`, et relancez l'application si besoin.
2. Vérifiez que `Dataset_Explorer_App/docs/` contient la page et sa traduction `.fr.md`.

## Le bouton Ouvrir workspace ne fait rien

**Symptôme** : l'icône de dossier **Ouvrir workspace** du badge utilisateur, ou les icônes de dossier de **Utilisateurs connectes** et **Historique des workspaces**, n'ouvrent rien.

**Cause** : ouvrir un dossier dans l'explorateur Windows nécessite la coquille VisionNexus, qui traduit le chemin serveur et l'ouvre sur le poste. Dans un navigateur ordinaire, l'action échoue sans message. Avec une VM distante, le chemin doit aussi être accessible depuis Windows via l'hôte de partage.

**Solution** : ouvrez l'application depuis VisionNexus avec l'hôte de partage configuré (voir [Configuration](configuration.fr.md)), ou copiez le chemin du workspace depuis la section **Workspace** de la page **Paramètres** et ouvrez-le vous-même.
