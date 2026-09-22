*[Read in English](explained_loading_image.md)*

# Chargement des frames et gestion de la RAM — Explications complètes

## 1. Les frames stockées sur disque — à quoi ça sert ?

### Vidéo MP4 / dossier d'images

Quand tu importes une vidéo ou des images, chaque frame est **extraite et écrite en JPEG sur le disque** :

```
data/projects/{project_id}/frames/
    frame_000000.jpg   ← image pleine résolution (ex: 1920×1080)
    frame_000001.jpg
    ...
    frame_000999.jpg

data/projects/{project_id}/thumbnails/
    frame_000000_thumb.jpg   ← miniature 160×90 pour la timeline
    frame_000001_thumb.jpg
```

### Fichier format specialise

Pour les fichiers `.optional`, la conversion est différente. Les frames sont converties en **PNG lossless** et stockées **à côté du fichier .optional** (pas dans `data/`) :

```
{dossier_du_fichier_format specialise}/
    mon_video.optional              ← fichier source (non modifié)
    mon_video_png/             ← dossier créé à l'import
        frame_000000.png       ← image pleine résolution, sans perte
        frame_000001.png
        ...
        frame_000999.png

data/projects/{project_id}/thumbnails/
    frame_000000_thumb.jpg     ← miniatures générées lors de la conversion
```

La décision de stocker en PNG à côté du .optional (et non dans `data/`) évite la duplication de datasets volumineux dans l'espace de travail. L'export YOLO peut symlinkter directement vers ces PNG sans créer de JPEG intermédiaire.

---

Ce dossier est **la source de vérité permanente**. Les frames ne sont pas dans la base SQLite (trop lourd) — SQLite stocke juste les métadonnées (nom, index, is_extracted) et les annotations.

---

## 2. Quand tu cliques sur la frame 100 — que se passe-t-il ?

**Rien n'est pré-chargé en RAM Python.** Voici le flux exact :

```
Clic frame 100
    → React change currentFrameIndex = 100
    → Canvas fait une requête HTTP GET /media/projects/1/frames/frame_000100.jpg
    → FastAPI (StaticFiles) lit le fichier depuis le disque
    → Le fichier JPEG est streamé vers le navigateur
    → Le navigateur décode le JPEG et l'affiche sur le canvas Konva.js
    → RAM Python = 0 octet conservé
```

Le serveur Python ne garde **aucune frame en mémoire**. Les StaticFiles de FastAPI ouvrent le fichier, le streament, et ferment. C'est le **navigateur** qui met en cache le JPEG dans sa mémoire interne (cache HTTP).

> **Réponse directe :** quand tu cliques sur frame 100, elle est chargée depuis le disque à la volée. Elle n'était pas pré-chargée en RAM.

---

## 3. Le background extraction — RAM utilisée

L'extraction en arrière-plan fonctionne ainsi :

```python
for batch in batches:                    # ex: batch de 10 frames
    for filename, source_idx in batch:
        cap.seek(source_idx)             # seek dans la vidéo
        frame = cap.read()               # UNE frame en RAM (~6 MB pour 1080p)
        cv2.imwrite(frame_path, frame)   # écrite sur disque en JPEG
        del frame                        # RAM libérée immédiatement
    db.commit()                          # mise à jour is_extracted en BDD
```

**RAM maximum pendant l'extraction = 1 frame à la fois ≈ 6 MB pour du 1080p.**

Le paramètre "Frames par batch" (défaut 10) contrôle uniquement :
- Le nombre de frames entre deux commits BDD
- La fréquence de mise à jour de la barre de progression
- **PAS la RAM** (toujours 1 frame en RAM à la fois)

À la fin de l'extraction de 1000 frames :
- ✅ 1000 fichiers JPEG sur disque
- ✅ 0 frame en RAM Python
- ✅ Le navigateur peut charger n'importe quelle frame à la demande

---

## 4. Le chunk upload vidéo — RAM pendant l'upload HTTP

Quand tu uploades une vidéo de 162 MB :

```
Navigateur envoie le fichier en une seule requête HTTP multipart
    → FastAPI lit le flux entrant par morceaux de N MB (chunk_size_mb)
    → Chaque chunk est écrit sur disque immédiatement
    → chunk suivant lu, etc.
    → RAM serveur pendant l'upload = N MB maximum
```

Avec chunk_size_mb = 8 MB : RAM max = **8 MB** (pas 162 MB).
Avec chunk_size_mb = 200 MB : RAM max = **200 MB** (plus rapide si tu as la RAM).
Avec chunk_size_mb = 1000 MB : le fichier entier est bufferisé en RAM avant écriture.

> **Pour un MP4 de 1 Go :** avec chunk=8 MB, RAM max = 8 MB. Sans chunking = 1 GB de RAM.

---

## 5. JPEG et algorithmes — Problème réel et solutions

### Ce qui se passe actuellement

Les algorithmes (ByteTrack, homographie XFeat/SIFT, flux optique Lucas-Kanade) utilisent **les mêmes fichiers JPEG** que l'affichage canvas. Ils chargent les frames via `cv2.imread()` depuis le disque.

```python
frame = cv2.imread("frame_000100.jpg")   # JPEG compressé
result = compute_homography(frame_prev, frame_curr)  # sur données compressées
```

### Impact de la compression JPEG sur les algorithmes

| Algorithme | Impact JPEG | Explication |
|---|---|---|
| ByteTrack (tracking boîtes) | ⚠️ Faible | Utilise les bounding boxes annotées, pas les pixels |
| Homographie XFeat/SIFT | ⚠️ Modéré | Détection de keypoints = sensible aux artefacts blocs |
| Flux optique Lucas-Kanade | ⚠️ Modéré | Gradients de pixels = artifacts JPEG peuvent fausser les vecteurs |
| Grounding DINO / SAM2 | ✅ Faible | Les modèles sont robustes à la compression |

### Solutions selon ton besoin

**Option A — Qualité 95 (recommandé pour algorithmes)** : dans Options d'optimisation, monte la qualité à 95. JPEG 95 = artefacts quasi-invisibles, taille ~3× plus grande que Q85.

**Option B — Qualité 100** : JPEG 100 est quasi-lossless (~10× plus grand que Q85). Presque identique au PNG mais reste JPEG (encodage DCT avec arrondi).

**Option C — Stockage PNG (lossless, implémenté pour format specialise)** : stocker les frames en PNG garantit zéro perte. Impact : taille disque 5–10× plus grande par rapport au JPEG. **Pour les fichiers format specialise, c'est le comportement par défaut et obligatoire** — toutes les frames sont converties en PNG lossless dans `{format specialise_dir}/{format specialise_stem}_png/`. Pour les MP4, les frames restent en JPEG.

> **Résumé :** pour les algorithmes sensibles (homographie, flux optique), utilise **qualité 95+**. Pour une annotation pure (ByteTrack, annotation manuelle), 85 est suffisant.

---

## 6. Récapitulatif complet — Qui utilise quoi

```
┌────────────────────────────────────────────────────────────────────┐
│  SOURCE MP4/images :                                               │
│  data/projects/{id}/frames/frame_XXXXXX.jpg (JPEG, disque)        │
├────────────────────────────────────────────────────────────────────┤
│  SOURCE format specialise :                                                      │
│  {format specialise_dir}/{format specialise_stem}_png/frame_XXXXXX.png (PNG lossless, disque) │
└────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌──────────────────────┐    ┌─────────────────────────────────────┐
│  AFFICHAGE CANVAS    │    │  ALGORITHMES CV                     │
│  HTTP GET → browser  │    │  cv2.imread() → numpy array         │
│  RAM Python = 0      │    │  RAM Python = 1 frame (~6–25 MB)    │
│  RAM browser = cache │    │  Libérée après traitement           │
└──────────────────────┘    └─────────────────────────────────────┘

THUMBNAILS (160×90) : générés à l'extraction/conversion, stockés dans
data/projects/{id}/thumbnails/. Utilisés dans la timeline et le panneau
frames. Jamais par les algos.
```

---

## 7. Paramètres d'optimisation — Guide rapide

| Paramètre | Défaut | Recommandation |
|---|---|---|
| Qualité JPEG | 85 | 85 pour annotation, 95 pour algorithmes |
| RAM chunk upload | 8 MB | 8 MB (peu de RAM) → 200 MB (beaucoup de RAM, upload plus rapide) |
| Frames par batch extraction | 10 | 10–50 selon la charge CPU souhaitée |
| Décimation | Tout | 1/2 ou 1/3 pour vidéos > 30fps si les frames sont redondantes |
