---
app: explorer
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [clip, embeddings, faiss, umap, kmeans, hdbscan, rarity, duplicates]
sources: [Dataset_Explorer_App/backend/core/embedder.py, Dataset_Explorer_App/backend/core/indexer.py, Dataset_Explorer_App/backend/core/reducer.py, Dataset_Explorer_App/backend/core/clusterer.py, Dataset_Explorer_App/backend/core/image_io.py, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/backend/core/metadata_loader.py, Dataset_Explorer_App/backend/core/annotation_ref.py, Dataset_Explorer_App/backend/core/format_registry.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/db/models.py]
---

# Concepts

## Datasets, workspaces and the global gallery

A dataset in Dataset Explorer is a scanned image folder: one record per image (path, file name, size, dimensions, MD5 fingerprint), plus everything computed later (embedding, map position, cluster, rarity, keep or reject decision). The images themselves are never copied or modified; if a file is moved or deleted on disk, the dataset keeps a stale record.

Every dataset lives in a workspace, a folder that belongs to one user (`explorer_<user>` when launched from the suite). Two users working on the same folder each have their own dataset and their own analysis.

The global gallery is shared by every workspace of the same installation. Publishing a dataset (**Share: ON**) registers its path, counts, basic statistics and five fixed thumbnails in the gallery, so other users see it even before importing it. Importing a global dataset scans the same folder into the importing workspace. Folders created in the global section are shared the same way; personal folders stay in one workspace.

Limits: the global gallery sits in the application folder (`data/dataset_gallery/`), not in the workspaces, so it is only shared by users who run the same installation. Only the user who published a dataset can remove it from the gallery. Two datasets can point at the same folder; the Gallery then shows a **duplicate of** badge, and each one is scanned and encoded separately.

## Dataset statuses and background jobs

The status of a Dataset Explorer dataset tells what can be done with it:

- `scanning`: the folder is being listed and the image records created. A counter shows the progress.
- `pending`: the records exist; the dataset can be pinned and its embeddings launched. Thumbnails may still be generated in the background.
- `embedding`: the embeddings pipeline runs.
- `ready`: the embeddings, index, map and clusters exist. Map, search and duplicates are available.
- `error`: the scan or the pipeline failed. Hover the status in the Gallery to read the reason when one was recorded.

Heavy work (scan, embeddings, reclustering, 2D reduction) runs in a pool of background workers on the server, three at a time by default. Starting the same job twice on the same dataset is ignored. The interface refreshes the dataset list every two seconds while a job runs, which drives the progress bars, so you can leave the page and come back. A few operations (merge, rebuild without duplicates, reset of decisions, recompute map) instead stream their progress to the page that started them; they still finish on the server if the page is closed.

If the backend stops during an embedding, the dataset is set back to `pending` at the next start; run **Embeddings** again.

## Pinned datasets and the Playground

Pinning decides which datasets appear in the Playground, the processing page of Dataset Explorer. It does not move, copy or compute anything. Pinned dataset ids are stored in the workspace settings, so they survive a restart.

The Gallery manages datasets (add, share, organize, delete); the Playground processes them (embeddings, map, search, duplicates, clustering, merge). Unpinning a dataset in the Playground only hides it there. New datasets created by a merge or a filtered merge are not pinned automatically; datasets loaded by the Orchestrator are.

## CLIP embeddings

CLIP is a neural network trained on hundreds of millions of image and caption pairs so that an image and a text describing it produce close vectors. Dataset Explorer uses the ViT-B/32 variant: each image is resized to 224 x 224 pixels and turned into a vector of 512 numbers, its embedding. Texts typed in the search fields are turned into vectors in the same space, which is what makes text search possible.

Embeddings are computed on the original image file, never on the thumbnail. They are normalized to length 1, so the similarity of two images is simply the dot product of their vectors (cosine similarity).

Only images without an embedding are encoded when **Embeddings** runs again. The model weights are read from a local file and never downloaded (see [Configuration](configuration.md)).

Limits: CLIP captures the overall content and style of an image, not small details: two frames that differ only by a small object far away get almost the same vector. It knows common objects and scenes well, and specialized imagery (infrared, medical, aerial at unusual angles) less well. An image that cannot be read gets an all-zero vector: it matches nothing and sits apart on the map.

## Similarity score and text queries

The score shown by the search pages, the CLIP filter of the Gallery and the duplicate pages is the cosine similarity between two CLIP vectors, displayed as a percentage.

Between two images, the score is high: near-identical images score above 95 %, very similar shots around 90 %. Between a text and an image, scores are much lower: with CLIP ViT-B/32 a good text match is typically around 25 to 35 %, and 20 % is already weak. This is why the text thresholds default to 25 % (Gallery filter), 28 % (Catalog) and 35 % (dataset search), while the duplicate thresholds default to 97 or 99 %.

Tips for text queries: write in English; describe the scene rather than a single word (`red car on a highway at night` works better than `red`); use several comma-separated terms in the Gallery filter with **OR** to collect variants and **AND** to require all of them. In **Top-K** mode you always get K results, even weak ones; in threshold mode you get every image above the score, possibly none.

## FAISS similarity index and the global index

FAISS is the library that finds the nearest vectors quickly. Dataset Explorer builds one exact index per dataset (inner product on normalized vectors, which equals the cosine similarity), saves it in the workspace (`faiss/<dataset id>/index.faiss`) and reloads it at startup. The dataset search and the duplicate detection use it.

The **Catalog** uses a global index built in memory on demand by concatenating the indexes of every ready dataset. It is rebuilt automatically when a dataset index changes. Up to 200,000 images it is exact; above, it switches to an approximate HNSW index, much faster but which can miss a few neighbors.

Limit: an index describes the images present when it was built. After adding images to a folder, run **Embeddings** again so that the index, map and clusters include them.

## 2D map: UMAP, t-SNE and PCA

The map of a dataset projects the 512-dimension embeddings onto a plane so that you can see the dataset at a glance: similar images end up close together, groups appear as clouds, and outliers sit alone. Three methods are available, chosen in **Settings** or in the **Reduc.** panel:

- **UMAP** (default): keeps both the local neighborhoods and the overall layout reasonably well. `n_neighbors` (default 15) sets how many neighbors each point considers: small values emphasize small groups, large values the global structure. `min_dist` (default 0.1) sets how tightly points are packed inside a group.
- **t-SNE**: separates groups very clearly, but distances between groups and group sizes mean little. `perplexity` (default 30) plays a role similar to `n_neighbors`; `learning_rate` (default 200) the optimization speed.
- **PCA**: a linear projection on the two main directions, fast and deterministic, but it usually shows one overlapping cloud on large datasets.

UMAP and t-SNE use the cosine metric and a fixed random seed, so the same data and parameters give the same map. Automatic fallbacks: UMAP falls back to t-SNE if it fails; fewer than 4 images give a PCA map.

Limits: a 2D map always distorts distances. Two points close on the map are usually similar, but two points far apart are not necessarily very different. This is why clustering is computed on the full embeddings, never on the map.

## Clustering: KMeans and HDBSCAN

Clustering groups the images of a dataset by visual similarity. It always runs on the 512-dimension embeddings, not on the 2D map, and the map only displays the result as colors.

- **KMeans** splits the dataset into exactly the number of clusters you ask for (`n_clusters`, default 20). Every image belongs to a cluster. It is fast and reproducible. A rule of thumb is between 10 and 30 clusters for a few thousand images and more for larger sets; too few mixes different content, too many splits the same content and turns noise into groups.
- **HDBSCAN** finds the number of clusters by itself from the density of the data. `min_cluster_size` (default 5) is the smallest group it accepts; images that belong to no dense group are labeled noise and drawn in gray on the map.

Recompute the clusters at any time with **Cluster** in the Playground or **Clustering** on the map; the embeddings are not recomputed.

Limits: clusters are groups of similar-looking images, not classes: one cluster can mix cars and trucks on the same road, and one object class can be spread over several clusters (day and night). **Rebuild** and **Reset** always recompute KMeans with the dataset's current number of clusters, even if HDBSCAN was used before; run the HDBSCAN clustering again afterwards if needed.

## Rarity score

The rarity score tells how atypical an image is within its own cluster. It is the distance between the image embedding and the center of its cluster, rescaled inside each cluster from 0 (the most central image) to 1 (the farthest). It is shown as a percentage with three bands: common (below 33 %, green), medium, and rare (66 % and above, red).

Use it to review the edges of each group: the rarest images of a cluster are often unusual conditions, rare angles, mislabeled or corrupted images, or simply interesting hard cases. A rare image is not a bad image; rarity is a signal of interest, not of quality.

Limits: the score is relative to its cluster, so every cluster has images near 0 and near 1, even a very homogeneous one. It changes when the clusters change. HDBSCAN noise images all get 50 %.

## Duplicate groups and the similarity threshold

Two images are considered duplicates when the cosine similarity of their embeddings reaches the threshold. Dataset Explorer links every pair above the threshold (looking at the 50 nearest neighbors of each image) and forms groups from the connected pairs. The first image of a group (smallest id) is its reference; every image shows its similarity to the reference.

Choosing the threshold:

- 99 % and above: copies of the same image, resized, recompressed or renamed.
- about 97 % (default): near-identical frames, such as consecutive video frames with little motion.
- 90 to 95 %: very similar shots of the same scene.
- below 90 %: images that only share a theme; groups become large and meaningless.

Because pairs are chained, a group can contain two images less similar than the threshold if others link them. In a very long burst of identical frames, a group larger than 50 images can be split in two. The **Catalog** applies the same method across datasets, on the global index.

## Keep and reject decisions

A keep or reject decision is a marker on an image of a dataset. Nothing is ever deleted on disk. An image can be undecided, kept or rejected; rejecting it happens in the duplicate pages, in the subset duplicates window, in the Catalog duplicates tab, or with **Exclude from dataset** on the map.

A rejected image:

- disappears from the map and from the cluster statistics immediately;
- keeps its old position in the clusters until **Rebuild** recomputes the map and clusters without it;
- is removed from a subset only when you use **Apply to subset** in that subset's duplicates window.

Decisions belong to the dataset, not to a subset: saving decisions from a subset window changes the source dataset for every later use. **Reset** on the Playground card clears every decision of a dataset and recomputes its map on all images.

Effects: a rejected image is left out of the map, the clusters, the text searches of a dataset and of the Catalog, and the export of a subset. A subset keeps its link to a rejected image, without exporting it, until **Apply to the subset** removes it. Nothing is deleted on disk.

## Subsets and exports

A subset is a named collection of images of one dataset, stored as records in the database and as a folder `subsets/<name>/` in the workspace that contains one link per image. Subsets are created from a map selection, from search results, from the Catalog (one subset per dataset) or by duplicating another subset.

Links follow the **Link strategy** of the **Settings** page: symbolic links (default; no copy, instant, but on Windows they need Developer Mode or administrator rights) or physical copies (slower and heavier, but they work everywhere). A link keeps the original file name, so two images with the same name from different subfolders collide: the second one replaces the first.

Exporting a subset creates another folder of links (or copies) named after the subset, by default in the `imports` folder of Annotation App, and records the export. A subset can be exported to several destinations. The **Duplicates** button of a subset is disabled after its first export, so clean a subset before exporting it. A lock prevents a subset from being deleted.

## Merged and filtered datasets

A merged dataset combines the images of several datasets into a new one without running CLIP again: the image records and embeddings are copied, then a new index, map, clusters and rarity scores are computed. Its path is shown as the list of its sources and it carries the `merged` badge.

Two ways create one:

- **Merge datasets** in the Playground takes every embedded image of the chosen datasets and clusters them with KMeans.
- **Merge filtered -> Playground** in the Gallery takes only the images whose CLIP score for the query terms reaches the threshold, and clusters them with the default method of **Settings**.

Limits: a merged dataset is a snapshot. Later changes to the sources (new images, decisions) are not reflected, and decisions made on the merged dataset do not go back to the sources. Deleting a source does not delete the merged dataset, which still points at the same image files.

## Annotations and metadata of a dataset

Two optional files can be attached to a dataset when it is added.

An **annotation file** (`.ver`, a YOLO label folder or a YOLO `.txt` file, as produced by Annotation App) is only described: the app detects its format, counts frames and boxes, and shows a badge. It is used to filter datasets with **With annotations**; the boxes are not drawn on the images.

A **metadata table** (CSV, TSV, TXT or Excel) adds free information to each image: weather, zone, sensor, campaign. A key column is matched against the image file names (full name or name without extension, case ignored); the matching row is attached to the image. The values then appear in the enlarged image view and become searchable in the **Metadata** tab of the Catalog, where columns with different names but similar meaning (`scene` and `scene_name`) are suggested as equivalent. Nothing is renamed automatically.

Limits: an image whose name matches no row simply has no metadata. The metadata search needs the SQLite FTS5 extension, present in standard Python builds.

## 16-bit, infrared and optional formats

Dataset Explorer reads standard images (`.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff`, `.webp`). Images stored with more than 8 bits per channel (16-bit PNG or TIFF, infrared, floating point) are stretched to 8 bits with a window of three standard deviations around the mean before encoding and before making thumbnails. Without this, such images would look black and give meaningless embeddings.

Other formats are handled by optional adapters placed in the backend (`backend/utils/`). The format specialise adapter converts `.optional` sequence files (one file can hold many frames) into PNG images in a `<name>_to_png/` folder next to the source. When a scanned folder contains no standard image but files of an adapter's format, or when the path is a single `.optional` file, they are converted first and the PNG folder is scanned. Removing the adapter file and restarting removes the capability without affecting standard images.

## Architecture and operation of the CLIP ViT-B/32 model

Dataset Explorer relies on a single neural model, CLIP ViT-B/32 with the original OpenAI weights (about 151 million parameters). It is made of two networks trained together, one for images and one for text, that map both to the same space of 512 numbers.

### CLIP image tower: from pixels to a 512-number vector

The image tower is a Vision Transformer. Before it, the preprocessing resizes the image so that its short side is 224 pixels, then crops the central 224 x 224 square: on a wide image, the left and right borders are not seen by the model, which is one reason why a small object at the edge can be missed by a search. The square is cut into 32 x 32 pixel patches, that is 7 x 7 = 49 patches; each patch becomes a token, and a special class token is added, for 50 tokens. Twelve transformer layers of width 768 and 12 attention heads let the tokens exchange information, and the final class token is projected to 512 numbers, then normalized to length 1. This vector is the embedding stored in the dataset and in the FAISS index.

The patch size explains the level of detail: with 32-pixel patches, the model sees a coarse layout, not fine textures. It is quick (few tokens) and captures scene, objects and style, which is what similarity search and duplicate detection need.

### CLIP text tower and contrastive training: why text can search images

The text tower is a transformer of 12 layers and width 512 that reads a prompt of up to 77 tokens (words are split into pieces by a byte-pair tokenizer, so a long query is truncated). The vector of the last token is projected to the same 512 numbers and normalized.

The two towers were trained on hundreds of millions of image and caption pairs with a contrastive objective: within a batch, each image must be closer to its own caption than to all the others, and each caption closer to its own image. Nothing forces the towers to agree on an exact meaning; they only learn that matching pairs must point in the same direction. That has two consequences for Dataset Explorer. A text query can retrieve images without any class list, since the text is placed in the same space as the pictures. And the similarity between a text and an image stays low, around 25 to 35 % for a good match, because the text and image vectors occupy slightly different regions of the space even when they match; image-to-image similarity does not suffer from this gap and reaches 90 % or more for near-identical pictures.

The model has no notion of position or count: `three cars` and `one car` give close vectors, and its vocabulary is mostly English.
