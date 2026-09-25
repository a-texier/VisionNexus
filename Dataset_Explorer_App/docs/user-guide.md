---
app: explorer
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [interface, gallery, playground, map, catalog, subsets, settings]
sources: [Dataset_Explorer_App/frontend/src/App.tsx, Dataset_Explorer_App/frontend/src/pages/Gallery.tsx, Dataset_Explorer_App/frontend/src/pages/Dashboard.tsx, Dataset_Explorer_App/frontend/src/pages/DatasetMap.tsx, Dataset_Explorer_App/frontend/src/pages/SemanticSearch.tsx, Dataset_Explorer_App/frontend/src/pages/DuplicateExplorer.tsx, Dataset_Explorer_App/frontend/src/pages/Catalog.tsx, Dataset_Explorer_App/frontend/src/pages/SubsetManager.tsx, Dataset_Explorer_App/frontend/src/pages/SettingsPage.tsx, Dataset_Explorer_App/frontend/src/pages/HelpPage.tsx, Dataset_Explorer_App/frontend/src/components/FilterBar.tsx, Dataset_Explorer_App/frontend/src/components/SubsetDuplicatesModal.tsx, Dataset_Explorer_App/frontend/src/components/UserBadge.tsx, Dataset_Explorer_App/frontend/src/components/help/datasetTourSteps.ts]
---

# User guide

## Sidebar and navigation of Dataset Explorer

The sidebar on the left of every Dataset Explorer page gives access to the six areas of the app. From top to bottom:

- The app name and the orange **Tutorial** button, which starts the interactive tutorial. It glows until you have launched it once.
- **Dataset Gallery**: add, organize, share and pin datasets. This is the home page.
- **Catalog**: search every ready dataset at once, by image content or by metadata, and find duplicates across datasets.
- **Playground**: the processing area. Only pinned datasets appear here; this is where you run the embeddings and open the map, the search and the duplicates of a dataset.
- **Subsets**: the image collections you extracted, ready to export to Annotation App.
- **Documentation**: this documentation.
- **Settings**: default values of the pipeline, link strategy, theme.

The normal path goes from top to bottom: Gallery, then Playground, then Subsets.

When images are selected on the map or in the search results, a box under the menu shows **N image(s) selected** with a **Create subset** link to the Subsets page. The selection is kept while you move between pages.

The user badge at the bottom shows the initials and the name of the current user, then four small buttons: **Open workspace** (opens the workspace folder in the Windows file explorer; it only works inside VisionNexus), **Workspace history** (recent workspaces of this app, click one to open it), **Connected users** (other users running Dataset Explorer on the same installation, with their workspace) and the **FR** / **EN** language toggle.

## Dataset Gallery page

The Dataset Gallery page is the home screen of Dataset Explorer. It lists every dataset you can reach and is the only place where datasets are added.

Three counters sit at the top:

- **In this workspace**: datasets present in your workspace, local or imported from the global gallery.
- **Global available**: shared datasets that other users published and that are not yet in your workspace.
- **Pinned in Playground**: datasets currently shown in the Playground.

Below them come the **Add a dataset** form, the CLIP filter bar, and two sections of dataset cards: **Global gallery** and **My workspace**. While a CLIP filter is active, the two sections are replaced by the filter results. Each part is described in its own section of this guide.

A dataset in the global gallery is not copied: it references the same image folder. Importing it into your workspace makes it analyzable (embeddings, map, subsets) without duplicating the images.

## Add a dataset form of the Gallery

The **Add a dataset** form of the Dataset Gallery page scans a folder and creates a dataset. Only the first field is required.

- **Image folder path**: the path as seen by the backend machine. With a local backend, a Windows path such as `D:\data\images`; with a backend on a Linux VM, a server path such as `/srv/datasets/run01`. Windows network paths such as `\\share-host\datasets\run01` are translated to the server path. In VisionNexus you can also drop a folder from the file explorer onto the field. Press `Enter` or click **Scan**.
- **Name (optional)**: defaults to the folder name. It is the name shown everywhere, including the subset and export folders.
- **Clusters:** the number of KMeans clusters (2 to 200, default 20). It can be changed later without re-encoding the images.
- **Destination folder** selector: files the new dataset into one of your folders (or **Root (no folder)**). When sharing is on, only shared folders are listed.
- **Share** / **Share: ON**: publishes the dataset in the global gallery so every user of the installation sees it. Five thumbnails are copied into the gallery for previews.
- **Scan**: starts the scan. The card appears immediately with the status `scanning` and a progress bar.

Optional associations, on the next rows:

- **Annotations (optional)**: a `.ver` file, a YOLO label folder or a YOLO `.txt` file. The app counts the frames and boxes and shows a badge on the card; the **With annotations** filter uses it. **Annotation name (optional)** labels that badge.
- **Metadata (optional)**: a `.csv`, `.tsv`, `.txt` or Excel file with one row per image. Click **Analyze columns** to read its header, then choose the **Key column:** whose values match the image file names (with or without extension). The other columns become searchable in the **Catalog**. When some columns look like columns already known in the catalog, a blue box lists the matches; it is information only and nothing is renamed.

If the folder is already indexed, the **Path already known** window lists the existing dataset. **Continue anyway** creates a second dataset on the same folder (new scan and full re-encoding); **Cancel** stops.

## CLIP filter bar of the Gallery

The CLIP filter bar of the Dataset Gallery page ranks your datasets by how many of their images match a text description. It only considers datasets of your workspace whose embeddings are computed.

Controls:

- **Query field**: one or more terms separated by commas, for example `drone, forest, night`. Press `Enter` or click **Filter**.
- **OR** / **AND**: an image counts if it matches at least one term (OR) or every term (AND).
- **Matching threshold**: slider from 0 to 100 %, default 25 %. An image counts if its CLIP score for a term reaches this value.
- **Clear**: removes the filter and shows the dataset sections again.
- **With annotations**: a separate toggle that hides the datasets without an annotation file in the normal sections.

The results replace the dataset sections. The header shows **N relevant dataset(s)** and the terms used, with **Sort by** **Absolute** (number of matching images) or **Relative** (percentage of the dataset). Each result card shows the rank, the name, the matching count out of the total, the percentage and the five best images with their score.

Above the results, the purple bar shows **Total retained** and lets you build a new dataset from the matching images only: type a name in **Filtered dataset name...** (default `filtered_<terms>`) and click **Merge filtered -> Playground** (the button shows an arrow). A progress bar follows the phases. The new dataset appears in **My workspace** with the `merged` badge, already embedded; pin it to use it in the Playground.

## Global gallery and My workspace sections

The Dataset Gallery page shows datasets in two sections of cards. **Global gallery** lists every shared dataset of the installation, whether or not it is in your workspace. **My workspace** lists every dataset of your workspace, local or imported.

Each card shows the dataset id, a colored status (`scanning`, `pending`, `embedding`, `ready`, `error`; hover an `error` status to read the message), the name and badges: `global`, `dans workspace` or `disponible` in the global section, `merged` for merged datasets, `Playground` when pinned, and an amber **duplicate of** badge when another dataset uses the same folder. The line below gives the image, embedding and cluster counts and the number of **rejected** images. Annotation and metadata badges, the scan progress and the **Thumbnails** progress appear when relevant; global datasets also show their five fixed thumbnails.

Buttons on the left of a card:

- In **My workspace**: the pin icon, **Pin in the Playground** or **Remove from Playground**.
- In **Global gallery**: a green disk icon when the dataset is already in your workspace, or the download icon **Import into this workspace**, which scans the shared folder into your workspace without pinning it.

Buttons on the right: the **File into a folder** selector, the arrow **View details** and the trash icon. In **My workspace**, the trash deletes the dataset from your workspace (**Delete dataset**), or only removes it from your workspace for a global dataset. In **Global gallery**, only the user who published the dataset can use **Permanently delete from the global gallery**; for other users the icon is disabled.

Each section has a **New folder** button. Folders are collapsible; hover a folder to show **New subfolder** and **Delete folder** (its datasets and subfolders move up to the parent). Folders created in the global section are shared with every workspace.

## Dataset details panel of the Gallery

The details panel opens under a dataset card of the Dataset Gallery page when you click the arrow **View details**. Statistics are loaded only when the panel opens.

It shows:

- **Path**, **Added** (date), **Images**, **Map** (**computed** when the embeddings have run) and **Exclusions** (rejected and active counts) when there are rejected images.
- For a global dataset: the **Preview** of the five fixed gallery thumbnails with a **Refresh** button that regenerates them, or **Generate gallery thumbnails** when none exist, and the **Basic statistics** stored in the shared registry (average size and formats), available even before import.
- For a dataset of your workspace: average dimensions (**Avg. dim.**), minimum and maximum width and height, **Avg. size**, **Total size**, color modes sampled on 20 images and the format distribution, plus five random thumbnails for a local dataset.

At the bottom, **Pin in the Dashboard Playground** pins the dataset, **Pinned in the Playground** confirms it is pinned, and for a global dataset not yet imported the button **Import into this workspace** imports it.

## Playground page

The Playground page (**Dashboard Playground**) is where datasets are processed. It shows only the datasets pinned from the Gallery; with none pinned, it shows **No pinned dataset** and a **Go to the Gallery** link. The header gives the number of pinned datasets and images, and a **Gallery** link.

Each dataset card shows the id, the status, the name, the folder path (or **Merge of:** and the source datasets for a merged dataset), the image, embedding and cluster counts, and, once the map exists, the applied **Clustering** and **Reduction** (for example `KMeans k=20` and `UMAP (nn 15, d 0.1)`). An amber line **Reduction method changed - map needs recomputing** appears when the reduction settings changed since the map was built. When images are rejected, a line shows **Init**, **Discarded** and **Used** counts with a **Reset** button that clears every keep or reject decision of the dataset and recomputes its map.

Buttons on the right of a card:

- **Remove from the Playground (does not delete the dataset)** (pin icon) and the trash icon, which permanently deletes the dataset with its images records, embeddings and subsets after confirmation.
- **Embeddings**: runs the full pipeline (CLIP, index, map, clustering, rarity). While it runs, the button is replaced by **In progress...** and a progress bar shows the phase. A second click never starts a second run; only images without an embedding are encoded again.
- Once the map exists: **Map**, **Search**, **Duplicates**, **Rebuild** (orange, only when images are rejected; it glows when rejected images are still on the map), **Cluster** and **Reduc.**, described in the next section.
- **Recompute map**: shown when the reduction settings changed; recomputes only the 2D map with the current settings.

When at least two pinned datasets have a map, **Merge datasets** opens the merge panel, described in its own section.

### Cluster and Reduc. panels of the Playground

The **Cluster** and **Reduc.** buttons of a Playground card open inline panels that recompute one part of the analysis without encoding the images again.

The **Cluster** panel recomputes the clusters and the rarity scores on the 512-dimension CLIP embeddings:

- **KMeans** with a slider and a field for the number of clusters (2 to 200), or **HDBSCAN** with `min_cluster_size`.
- **Restart** runs it in the background; a teal **Clustering:** progress bar appears.
- **Default** loads the default method and values of the **Settings** page; **current:** reminds the applied configuration.

The **Reduc.** panel recomputes the 2D map only:

- **UMAP** with `n_neighbors` and `min_dist`, **TSNE** with `perplexity` and `learning_rate`, or **PCA** (**No hyperparameter (2 components)**).
- **Restart** runs it in the background with a **Reduction:** progress bar; **Default** and **current:** work as in the Cluster panel.

Neither panel changes the embeddings. The same panels are available on the map page. The meaning of each parameter is explained in [Concepts](concepts.md).

### Merge datasets panel of the Playground

The merge panel of the Playground combines several pinned datasets into a new one without running CLIP again. It opens with **Merge datasets**, shown when at least two pinned datasets have a map.

1. Check the source datasets with the checkboxes that appear on their cards (**Select the datasets to merge**).
2. Once two are checked, set **Name** (default `merged_<names>`) and **Clusters** (default 20).
3. Click **Merge (N sources)**. A progress bar follows the phases.

The merged dataset reuses the stored embeddings, then rebuilds its own index, map (with the current reduction settings), KMeans clusters and rarity scores. It appears in **My workspace** with the `merged` badge and must be pinned to show in the Playground. **Cancel** closes the panel.

## Map page

The Map page shows one dataset as a scatter plot where each point is an image and similar images are close together. Open it with **Map** on a Playground card or on a subset. If the map has not been computed yet, the page shows **Map not computed for this dataset.**

The title shows the dataset name and the reduction method. The counters show the number of selected images and of displayed points. Images rejected as duplicates or excluded are not displayed.

Plot interactions (Plotly toolbar at the top right of the plot):

- The lasso is active by default: draw around points to select them. A new lasso replaces the selection; double-click an empty area to clear it.
- Mouse wheel zooms, the toolbar switches to pan or box zoom, and hovering a point shows its file name.
- Colors follow the color mode, with a legend: one color per cluster (noise points of HDBSCAN are gray), or a green to yellow to red scale for rarity.

The filter row above the plot, described in the next section, filters the points and gives access to the clustering and reduction panels.

### Filters, clustering and reduction on the map

The filter row of the Map page changes what the scatter plot shows.

- **Color:** color mode, **Cluster**, **Rarity** or **Uniform** (single color).
- **Cluster:** shows one cluster only (**All** shows all), with the image count of each cluster.
- **Rarity:** two sliders keep the points whose rarity is between a minimum and a maximum percentage.

On the right, the current clustering and reduction are recalled next to the **Clustering** and **Reduction** buttons. They open the same panels as **Cluster** and **Reduc.** in the Playground (see *Cluster and Reduc. panels of the Playground*), with progress bars; the map refreshes automatically when the job ends.

### Cluster panel and selection panel of the map

When a single cluster is chosen in the filter row of the Map page, a cluster panel appears above the plot. It shows the cluster color and number, its image count and its average rarity (**avg. rarity**), the first 24 thumbnails (click one to select or deselect it, use the magnifier to zoom), **Select all (N)** to add every displayed image of the cluster to the selection and **Deselect all** to remove them.

When images are selected, a selection panel appears under the plot with **N image(s) selected**:

- **Subset name...** and **Create subset**: creates a subset from the selection in this dataset.
- **Exclude from dataset**: marks the selected images as rejected, like a duplicate rejection. They disappear from the map and can no longer be selected on it; use **Rebuild** to recompute the map without them and **Reset** in the Playground to restore them.
- **Clear selection** (cross icon).

A strip shows the selected thumbnails with their cluster and rarity; click one to open it enlarged (with the full-resolution link, the cluster, the rarity and its metadata if any), click its caption to deselect it.

## Semantic search page

The Semantic search page finds the images of one dataset that match a text description. Open it with **Search** on a Playground card. It needs the embeddings.

Controls:

- **Query field**: a description, for example `person walking` or `red car at night`. CLIP understands English best. Press `Enter` or click **Search**.
- **Top-K** mode: returns the N best images, with a slider from 5 to 100 and a field up to 500 (default 20, **results to return**).
- **Threshold %** mode: returns every image whose score reaches the threshold (1 to 99 %, default 35 %), without limit.

The legend line explains the badges. Results are shown as cards ranked by score, with a rank badge, the file name and three badges: the match percentage (green from 70 %, yellow from 50 %, red below), the cluster `C<n>` and the rarity `R<n>%`. Click a thumbnail to open it enlarged with a link to the full-resolution image; click the caption or the checkbox to select it.

The action bar shows **N results for "query"**, a **Select all** / **Deselect all** button, the **Subset name...** field and a save button: **Save selection (N)** when images are selected, otherwise **Save all (N)**, which creates a subset with every result. A new search clears the selection.

## Duplicate explorer page

The Duplicate explorer page (**Duplicate explorer**) groups the near-identical images of one dataset so you can decide which ones to keep. Open it with **Duplicates** on a Playground card. Nothing is ever deleted on disk: a rejected image is only hidden from the map and left out of the clusters after a rebuild (see *Keep and reject decisions* in [Concepts](concepts.md)).

The header shows the number of groups and of images involved, and, when images are rejected, the **Base:**, **Discarded:** and **Used:** counts. A reminder box explains **Keep** and **Reject**.

Controls:

- **Threshold:** slider and field from 80 to 100 % (default 97 %), then **Apply**. The hint reads 80 % approximate, 97 % near-identical, 100 % exactly identical.
- **Auto-select all**: in every group, keeps the N images closest to the reference (N from the group's **Keep** setting, default 1) and rejects the others.
- **Reset all**: clears the pending decisions.
- **Save (N decisions)**: writes the decisions to the dataset.
- **Rebuild UMAP without duplicates (N excluded)**: recomputes the map and clusters without the rejected images.

Each group card shows **Group #id**, its size, **max sim:**, the counts **to keep** and **to reject**, a **Keep** slider and field (0 to the group size) with **Auto** and **Reset** for that group. Each image shows its similarity to the reference (**Reference** for the first one, marked `Ref`), the saved decision if any, and **Keep** / **Reject** buttons. Click a thumbnail to enlarge it.

## Catalog page

The Catalog page (**Catalog**) queries every ready dataset of your workspace as a single set, without merging them first. It has three tabs, described below. A warning appears when no dataset is ready yet. In the first two tabs, clicking result cards selects them; a bar at the bottom then shows the count, a **subset name** field and **Create subset**. A selection that spans several datasets creates one subset per dataset, suffixed `_ds<id>`. Only datasets of your workspace with the status `ready` take part in the visual search and the duplicate analysis; the metadata search also covers datasets whose embeddings are not computed yet.

### Visual search tab of the Catalog

The **Visual search** tab of the Catalog page runs a CLIP text search across all ready datasets at once. Type a description (for example `drone above the forest`), then choose **Top-K** (1 to 500, default 60) or **Threshold** (1 to 99 %, default 28 %) and click **Search**. **Restrict to:** limits the search to some datasets (**all** by default).

The summary line gives the result count, the size of the global index (**global index:** vectors and datasets) and the number of results per dataset. Each card shows the thumbnail, the file name, the dataset and the score. Use it when you do not know which dataset contains an image, or to spot overlaps between campaigns.

### Metadata tab of the Catalog

The **Metadata** tab of the Catalog page searches the CSV or Excel metadata attached to datasets at import. If no dataset has metadata, a warning explains how to attach a file.

- **Search field**: keywords, values or column names, for example `forest_zone fog`. The last word also matches as a prefix. Choose **all words** or **at least one**, then click **Search**.
- **Restrict to:** limits the search to some datasets.
- **Explore a column:** lists every metadata column with the number of datasets that have it. Click one to show its values with their image counts; click a value to search for it.
- **Automatically matched columns:** shows columns with different names that look equivalent across datasets.

Results come by pages of 60 with **previous** and **next**; each card shows the first two metadata fields.

### Cross-dataset duplicates tab of the Catalog

The **Cross-dataset duplicates** tab of the Catalog page finds the same image stored in several datasets. Set the **Similarity threshold** (80 to 100 %, default 99 %), keep **only groups spanning multiple datasets** checked to ignore duplicates internal to one dataset, and click **Analyze**. The elapsed time is shown while the search runs.

The summary gives the groups shown (at most 50, the ones spanning the most datasets first), the total detected and the number of indexed vectors. Each group shows its datasets, its size and, when it has more than 24 images, a **truncated display** badge. Mark images with **keep** or **reject**, then click **Save N decision(s)**. As everywhere, rejecting only sets a marker on the image in its own dataset; no file is deleted.

## Subsets page

The Subsets page (**Subset management**) lists the image collections extracted from your datasets. Each subset is a folder of symbolic links (or copies) under `subsets/` in the workspace.

When images are selected elsewhere in the app, a box at the top offers to **create a subset:** choose the source dataset, type a name and click **Create**. **Filter by dataset:** limits the list.

Each subset card shows its name, the badges **Exported** and **Locked**, the image count and dataset, the link folder, and one line per export with its path and a `symlink` or **copy** badge. Buttons:

- **Map**: opens the map of the source dataset (when it has one).
- **Duplicate**: copies the subset under a numbered name (`name_1`, `name_2`...) that you can edit; works even after export.
- **Duplicates**: opens the subset duplicates window. Disabled once the subset has been exported.
- **Export**: exports to Annotation App (see the export window below).
- Lock icon: **Lock (prevents accidental deletion)** / **Unlock**. A locked subset cannot be deleted, even through the API.
- Trash icon: asks for confirmation, then deletes the subset and its link folder. Original images and exports already made are never removed.

### Subset duplicates window

The subset duplicates window opens with **Duplicates** on a subset card of the Subsets page. It looks for near-duplicates among the images of that subset only.

It works like the Duplicate explorer page: **Threshold:** with **Apply**, **Auto-select all**, **Reset all**, per-group **Keep** count with **Auto** and **Reset**, and **Keep** / **Reject** on each image.

Two actions have different scopes, recalled by a warning box:

- **Save** writes the decisions to the source dataset. The rejected images are then hidden from its map, left out of its rebuild in the Playground, of its searches and of every export, and are no longer selectable on its map.
- **Apply to the subset** saves pending decisions, then removes the rejected images from this subset only (links and database) and closes the window.

To undo decisions on the dataset, use **Reset** on its Playground card.

### Export to Annotation App window

The export of a subset starts with **Export** on its card in the Subsets page. What happens depends on how the app was launched.

- **Standalone**: the **Export to Annotation App** window asks for the **Destination folder**, pre-filled with the default imports folder. The subfolder named after the subset is created inside it. Leave the field empty to use the default path. Click **Export**.
- **Launched by the Orchestrator**: no window; the export goes directly to the imports folder of the Annotation App workspace.

The images are linked (or copied, depending on the link strategy of the **Settings** page) into `<folder>/<subset name>/`. A subset can be exported several times to different folders; exporting twice to the same folder is refused. The toast shows the export path, which you then import in Annotation App.

## Settings page

The Settings page (**Settings**) holds the preferences of the workspace; its header shows the `settings.json` file where they are stored. Changes are written only when you click **Save changes** at the bottom (**No changes** when nothing was modified). Every option is detailed in [Configuration](configuration.md).

Sections:

- **Workspace**: read-only paths of the workspace, the database, the thumbnails and the FAISS indexes.
- **Export Annotation App**: **Imports folder**.
- **Subsets & links**: **Link strategy**, **Symlinks (recommended)** or **Physical copy**.
- **Dimensionality reduction**: **Method** (UMAP, t-SNE or PCA) and its hyperparameters.
- **Clustering**: **Default method** (KMeans or HDBSCAN) and `min_cluster_size`.
- **Default values**: **Clusters KMeans**, **Search Top-K** and **UMAP map color mode (default)**, used as starting values of the matching controls.
- **Visual theme**: **Application background** and **Accent color**. Clicking a theme previews it immediately; save to keep it.
- **Technical guide**: short reminders for developers. The ports it lists are the manual defaults, not the ports of the running instance.

## Documentation page

The Documentation page (**Documentation** in the sidebar) displays this documentation inside the app. The left column lists the pages in three groups, **User**, **Setup and settings** and **Developer**; under the open page it shows the table of contents of its sections. Links between pages stay in the app, and the address of the page (`/help?doc=<page>#<section>`) can be bookmarked.

The pages follow the interface language chosen with the **FR** / **EN** toggle. The orange **Start the interactive tutorial** button at the top restarts the tutorial.

## Interactive tutorial

The interactive tutorial is a guided tour of Dataset Explorer on real data. Start it with **Tutorial** at the top of the sidebar or with **Start the interactive tutorial** on the Documentation page. `Esc` closes it at any time, and the page stays usable during the tour.

The tour fills the **Add a dataset** form with the ten traffic images shipped with the suite (`data_tuto/cars_10_frames` at the suite root), names the dataset **Tuto Cars 10**, sets 3 clusters and scans it. It then pins the dataset, opens the Playground, points at **Embeddings** (you launch it yourself), and presents the map, search, duplicates, the Gallery CLIP filter, the Subsets and Catalog pages, the settings and the documentation. If the sample images are missing from the installation, the tour asks you to type the path of your own folder.

The demo dataset belongs to you and can be deleted like any other. Whether you have launched or completed the tutorial is remembered by VisionNexus for your user (or in the workspace settings outside VisionNexus).
