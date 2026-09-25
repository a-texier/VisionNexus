---
app: explorer
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [scan, embeddings, subset, duplicates, catalog, export, orchestrator]
sources: [Dataset_Explorer_App/frontend/src/pages/Gallery.tsx, Dataset_Explorer_App/frontend/src/pages/Dashboard.tsx, Dataset_Explorer_App/frontend/src/pages/DatasetMap.tsx, Dataset_Explorer_App/frontend/src/pages/SemanticSearch.tsx, Dataset_Explorer_App/frontend/src/pages/DuplicateExplorer.tsx, Dataset_Explorer_App/frontend/src/pages/Catalog.tsx, Dataset_Explorer_App/frontend/src/pages/SubsetManager.tsx, Dataset_Explorer_App/frontend/src/components/SubsetDuplicatesModal.tsx, Dataset_Explorer_App/backend/api/orchestrator.py, Dataset_Explorer_App/backend/utils/native_share.py]
---

# Workflows

## Add a dataset from a local or server folder

This workflow creates a dataset in Dataset Explorer from a folder of images that the backend can read.

*Prerequisites*: Dataset Explorer is open on the **Dataset Gallery** page; the folder contains `.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff` or `.webp` images (subfolders are scanned too).

1. In **Add a dataset**, type the folder path as seen by the backend: `D:\data\run01` for a local backend, `/srv/datasets/run01` for a backend on a Linux VM. In VisionNexus, you can drop the folder on the field instead.
2. Optionally type a **Name (optional)**; otherwise the folder name is used.
3. Set **Clusters:** to a value adapted to the dataset (for example 10 to 30 for a few thousand images; see [Concepts](concepts.md)).
4. Optionally choose a destination folder in the selector next to it.
5. Click **Scan** or press `Enter`. If the **Path already known** window appears, the folder is already a dataset: click **Cancel** to reuse it, or **Continue anyway** to create a second one.
6. Watch the card in **My workspace**: status `scanning` with an `X/N images` counter, then `pending`. Thumbnails keep being generated in the background (**Thumbnails** bar); you can continue meanwhile.

*Result*: a dataset with status `pending`, one record per image (path, size, MD5) and thumbnails in the workspace. No image is copied. If the status becomes `error`, hover it to read the reason and see [Troubleshooting](troubleshooting.md).

## Add a dataset from a Windows network share with a remote backend

This workflow indexes images stored on a network share when the Dataset Explorer backend runs on a Linux VM and the interface on a Windows workstation.

*Prerequisites*: the share is mounted on the VM under `/home`, `/mnt`, `/srv`, `/media` or `/data` with the share name as second segment (for example `\\share-host\datasets` mounted as `/srv/datasets`); VisionNexus launched the app with the share host set.

1. In the Windows file explorer, open the folder on the share.
2. Drag the folder onto the path field of **Add a dataset**, or paste its Windows path, for example `\\share-host\datasets\run01`.
3. Click **Scan**. The backend translates the path to the first existing candidate among `/home/datasets/run01`, `/mnt/datasets/run01`, `/srv/datasets/run01`, `/media/datasets/run01` and `/data/datasets/run01`.
4. Wait for the `pending` status as in the previous workflow.

*Result*: the dataset references the images on the server side. Inside VisionNexus, thumbnails and full-resolution images can then be read directly from the share by the Windows shell instead of transiting through the backend. If the scan fails with "Chemin introuvable" (path not found), the mount point does not follow this convention; type the server path instead.

## Attach annotations and a metadata table when adding a dataset

This workflow links an existing annotation file and a CSV or Excel table to a dataset during its import, so that they become visible and searchable.

*Prerequisites*: the **Add a dataset** form is filled with a folder path; the annotation file and the table are readable by the backend.

1. In **Annotations (optional)**, type the path of a `.ver` file, a YOLO label folder or a YOLO `.txt` file. Optionally set **Annotation name (optional)**.
2. In **Metadata (optional)**, type the path of the `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xlsm` or `.xls` file.
3. Click **Analyze columns**. A message gives the number of columns and rows.
4. Check the **Key column:** selected automatically (a column named like `filename`, `image`, `path`, `id`...) and change it if needed. Its values must match the image file names, with or without extension, case ignored.
5. Read the blue box if it appears: it lists columns equivalent to columns already present in the catalog.
6. Click **Scan**.

*Result*: the card shows an annotation badge (`VER` or `YOLO`, with the box count) and a **metadata** badge. Each image receives the row of the table that matches its name; the columns are searchable in the **Metadata** tab of the **Catalog** and shown in the enlarged image view of the map. Annotations are only counted, not displayed on the images.

## Compute the embeddings of a dataset

This workflow runs the analysis pipeline of Dataset Explorer on a dataset: CLIP embeddings, similarity index, 2D map, clusters and rarity scores.

*Prerequisites*: the dataset is in your workspace with status `pending` (or `ready` after adding images); the CLIP model is loaded (see [Troubleshooting](troubleshooting.md) otherwise).

1. On the **Dataset Gallery** page, click the pin icon of the dataset card in **My workspace** (**Pin in the Playground**).
2. Open **Playground** in the sidebar.
3. On the dataset card, click **Embeddings**. The button becomes **In progress...** and a progress bar shows the phases: `embedding` (with an image counter), `indexing`, `umap`, `clustering`, `scoring`.
4. You can leave the page: the computation runs on the server and the bar is restored when you come back.
5. When the status becomes `ready`, the buttons **Map**, **Search**, **Duplicates**, **Cluster** and **Reduc.** appear.

*Result*: every image has a 512-value CLIP vector, a position on the 2D map, a cluster and a rarity score. Running **Embeddings** again later only encodes the images that have no embedding yet, then rebuilds the index, map and clusters.

## Select images on the map and create a subset

This workflow uses the 2D map of a dataset to select a visual group of images and save it as a subset.

*Prerequisites*: the dataset has status `ready`.

1. In the **Playground**, click **Map** on the dataset card.
2. Optionally restrict the display: choose a cluster in **Cluster :**, or move the **Rareté :** sliders (for example 70 to 100 % to show only atypical images).
3. Draw a lasso around the points you want. The selection panel shows the selected thumbnails; click one to check it in full size.
4. To add a whole cluster, choose it in **Cluster :** and click **Select all (N)** in the cluster panel.
5. Type a name in **Subset name...** and click **Create subset**.

*Result*: a subset appears on the **Subsets** page with a folder of links under `subsets/<name>/` in the workspace. The selection is cleared. If you prefer to remove the selected images from the dataset rather than extract them, use **Exclude from dataset** instead (see *Exclude images and rebuild the map*).

## Create a subset from a text search

This workflow finds the images of one dataset that match a description and saves them as a subset.

*Prerequisites*: the dataset has status `ready`.

1. In the **Playground**, click **Search** on the dataset card.
2. Type a description in English, for example `pedestrian crossing at night`, and press `Enter`.
3. Choose how many results to keep: **Top-K** with the number of images, or **Threshold %** to get every image above a score (start around 25 to 30 % and adjust).
4. Review the results. Click a thumbnail to enlarge it; click the caption or checkbox of the images you want to keep, or use **Select all**.
5. Type a name in **Subset name...** and click **Save selection (N)**, or **Save all (N)** to keep every result.

*Result*: a subset on the **Subsets** page with the chosen images. Descriptive sentences give better results than single words; see the section on the similarity score in [Concepts](concepts.md).

## Find and reject duplicates in a dataset

This workflow groups the near-identical images of a dataset and marks the redundant ones as rejected, without deleting any file.

*Prerequisites*: the dataset has status `ready`.

1. In the **Playground**, click **Duplicates** on the dataset card.
2. Adjust **Threshold:** if needed (97 % by default; 99 % for strict copies, 90 to 95 % for very similar shots) and click **Apply**.
3. For each group, choose how many images to keep with **Keep**, then click **Auto** to keep the images closest to the reference, or click **Keep** / **Reject** on each image. **Auto-select all** applies the rule to every group.
4. Click **Save (N decisions)**.
5. Click **Rebuild UMAP without duplicates (N excluded)** to recompute the map and clusters without the rejected images.

*Result*: rejected images disappear from the map and, after the rebuild, from the clusters; they can no longer be selected on the map. The Playground card shows **Init**, **Discarded** and **Used** counts. To undo everything, click **Reset** on the card: all decisions are cleared and the map is recomputed on every image.

## Exclude images and rebuild the map

This workflow removes unwanted images (blurred frames, calibration shots, off-topic images) from the analysis of a dataset without deleting them.

*Prerequisites*: the dataset has status `ready`.

1. In the **Playground**, click **Map** on the dataset card.
2. Select the images to remove with the lasso or the cluster panel. Checking atypical images first is easy with the **Rareté :** sliders.
3. Click **Exclude from dataset** and confirm.
4. Back in the **Playground**, click **Rebuild** on the card (it glows while excluded images are still on the map).

*Result*: the excluded images are marked as rejected, like duplicate rejections. The map, clusters and rarity scores are recomputed on the remaining images; the files stay untouched. **Reset** on the card restores every image.

## Recompute the clusters or the 2D map of a dataset

This workflow changes the clustering or the 2D projection of a dataset without encoding the images again.

*Prerequisites*: the dataset has status `ready`.

1. In the **Playground**, click **Cluster** on the dataset card (or **Clustering** on its map).
2. Choose **KMeans** and a number of clusters, or **HDBSCAN** and `min_cluster_size`, then click **Restart**. Wait for the **Clustering:** bar to finish.
3. To change the projection, click **Reduc.** (or **Reduction** on the map), choose **UMAP**, **TSNE** or **PCA** and its parameters, and click **Restart**.
4. **Default** reloads the values of the **Settings** page.

*Result*: the card and the map show the new configuration (for example `HDBSCAN (min 5) - 12 clusters`). Rarity scores are recomputed with the clusters. Changing the reduction in **Settings** instead affects the next computations and flags existing maps with **Recompute map**.

## Search all datasets at once in the Catalog

This workflow finds images by description or by metadata across every ready dataset, and extracts them as subsets.

*Prerequisites*: at least one dataset of your workspace has status `ready` (for the visual search) or has a metadata table (for the metadata search).

1. Open **Catalog** in the sidebar.
2. In **Visual search**, type a description, choose **Top-K** or **Threshold**, optionally restrict to some datasets with **Restrict to:**, and click **Search**.
3. Or open **Metadata**, click a column in **Explore a column:** to see its values, click a value (or type keywords) and choose **all words** or **at least one**.
4. Click the result cards to select them.
5. Type a **subset name** in the bottom bar and click **Create subset**.

*Result*: one subset per dataset represented in the selection, named `<name>` for a single dataset or `<name>_ds<id>` when several datasets are involved.

## Find images shared between datasets

This workflow detects the same images stored in several datasets, for example two campaigns that overlap.

*Prerequisites*: at least two datasets of your workspace have status `ready`.

1. Open **Catalog**, tab **Cross-dataset duplicates**.
2. Keep the **Similarity threshold** at 99 % for true copies, or lower it for near copies.
3. Keep **only groups spanning multiple datasets** checked.
4. Click **Analyze** and wait; the elapsed time is shown.
5. Review the groups (the ones spanning the most datasets come first). Mark images with **keep** or **reject**.
6. Click **Save N decision(s)**.

*Result*: rejected images are marked in their own dataset and hidden from its map (and left out of its clusters after **Rebuild**). No file is deleted.

## Build a filtered dataset from several datasets with a text query

This workflow creates a new dataset containing only the images that match one or more concepts, taken from several existing datasets.

*Prerequisites*: the source datasets are in your workspace with their embeddings computed.

1. On the **Dataset Gallery** page, type the concepts in the CLIP filter bar, separated by commas, for example `drone, night`.
2. Choose **OR** or **AND**, set the **Matching threshold** and click **Filter**.
3. Review the ranked datasets and their five best images; adjust the threshold until **Total retained** looks right.
4. Type a name in **Filtered dataset name...** and click **Merge filtered -> Playground**.
5. Wait for the end of the progress bar, then click **Clear** and pin the new dataset from **My workspace**.

*Result*: a `merged` dataset already embedded, with its own map, clusters (method from **Settings**) and index, containing only the matched images of every listed dataset. The original images are referenced, not copied.

## Merge several datasets into one

This workflow combines complete datasets into a single one to analyze them together, without running CLIP again.

*Prerequisites*: at least two datasets are pinned in the Playground and have a map.

1. In the **Playground**, click **Merge datasets**.
2. Check the datasets to merge on their cards.
3. Set **Name** (or keep `merged_<names>`) and **Clusters**.
4. Click **Merge (N sources)** and wait for the phases to finish.
5. Pin the new dataset from **My workspace** in the Gallery.

*Result*: a `ready` dataset containing every embedded image of the sources, with its own index, map and KMeans clusters. The **Catalog** is often a better choice to search several datasets without creating a new one.

## Share a dataset with the other users

This workflow publishes a dataset in the global gallery and lets another user import it into their own workspace.

*Prerequisites*: all users run Dataset Explorer from the same installation (the global gallery lives in the application folder); the image folder is readable by the backend of every user.

1. When adding the dataset, click **Share** so that it reads **Share: ON** (optionally choose a shared folder), then click **Scan**.
2. Check that the card appears in **Global gallery** with its five thumbnails.
3. On the other user's side, open the **Dataset Gallery**: the dataset is listed in **Global gallery** with the `disponible` badge and counted in **Global available**.
4. That user clicks **Import into this workspace** (download icon). The folder is scanned into their workspace.
5. The dataset then appears in their **My workspace**, where they pin it and run **Embeddings**.

*Result*: each user has an independent copy of the analysis (embeddings, map, decisions, subsets) on the same image files. Only the publisher can delete the dataset from the global gallery. Shared folders created in the global section are visible in every workspace.

## Clean the duplicates of a subset

This workflow removes near-duplicates from one subset before exporting it.

*Prerequisites*: the subset has not been exported yet (the **Duplicates** button is disabled after an export); its source dataset has embeddings.

1. On the **Subsets** page, click **Duplicates** on the subset card.
2. Adjust **Threshold:** and click **Apply** if needed.
3. Set the decisions with **Auto-select all**, the per-group **Auto**, or **Keep** / **Reject** on each image.
4. Click **Apply to the subset**. Pending decisions are saved, then the rejected images are removed from the subset.

*Result*: the subset loses its rejected images (links and records). Be aware that the decisions are also written to the source dataset: the rejected images are hidden from its map and left out of its clusters after **Rebuild**. Use **Reset** on the Playground card to undo them.

## Export a subset to Annotation App

This workflow sends the images of a subset to Annotation App so that they can be annotated.

*Prerequisites*: the subset exists on the **Subsets** page; on Windows with symbolic links, Developer Mode is enabled (see [Configuration](configuration.md)).

1. On the **Subsets** page, click **Export** on the subset card.
2. In standalone mode, check the **Destination folder** (by default the `imports` folder of Annotation App) and click **Export**. When the app was launched by the Orchestrator, the export starts directly.
3. Read the path in the confirmation message; the card now shows the **Exported** badge and one export line.
4. In Annotation App, create a project and import that folder as a server path (see the Annotation App documentation).

*Result*: a folder `<destination>/<subset name>/` containing links to (or copies of) the original images. You can export the same subset again to another folder; exporting twice to the same folder is refused.

## Run Dataset Explorer from an Orchestrator pipeline

This workflow describes what Dataset Explorer does when an Orchestrator pipeline drives it, so that you can follow and check the steps.

*Prerequisites*: the Orchestrator App launched Dataset Explorer and Annotation App for the same user.

1. The Orchestrator loads the dataset source: if the folder is already a dataset, it is reused (unless the pipeline chose to create a duplicate); otherwise it is scanned. The dataset is pinned in the Playground automatically.
2. It starts the embeddings and waits until the status is `ready` (you can watch the progress in the Playground).
3. It creates a subset from a text query (Top-K or threshold), optionally restricted to the images of another subset. A subset with the same name in the dataset is replaced.
4. It exports the subset into the `imports` folder of the Annotation App workspace, replacing a previous export of the same name.
5. In this mode, the **Export** button of the Subsets page never asks for a folder.

*Result*: the subset is ready in Annotation App's imports. You can open Dataset Explorer at any time during the run to check the clusters or the subset before the next step of the pipeline.
