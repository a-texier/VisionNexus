---
app: explorer
doc_type: readme
audience: both
lang: en
title: Dataset Explorer
order: 0
tags: [dataset, clip, faiss, umap, clustering, duplicates, subsets]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/launcher.py, _lib/launcher_engine.py, Dataset_Explorer_App/frontend/src/App.tsx]
---

# Dataset Explorer

## What Dataset Explorer does

Dataset Explorer is the dataset curation tool of the Computer Vision suite. It answers a simple question before any annotation or training: what is really inside my image folders? It encodes every image with the CLIP ViT-B/32 model, then lets you look at the whole dataset as a map, search it with plain text, track duplicates and extract the images that are worth annotating.

Main features:

- **Scan a folder** (local disk, mounted share or Windows network path) and index its images with thumbnails, optional annotation files (`.ver`, YOLO) and an optional CSV or Excel metadata table.
- **Embeddings pipeline**: CLIP embeddings, a FAISS similarity index, a 2D map (UMAP, t-SNE or PCA), clusters (KMeans or HDBSCAN) and a rarity score per image, all computed in the background.
- **Explore**: an interactive map with lasso selection, text search inside one dataset, and a **Catalog** that searches every ready dataset at once, by image content or by metadata.
- **Clean**: duplicate groups inside one dataset, inside one subset or across datasets, with keep and reject decisions that never delete a file.
- **Extract**: subsets (folders of symbolic links or copies) that you export to Annotation App.
- **Share**: a global gallery that makes a dataset visible to every user of the same installation, with shared folders to organize it.

The app runs in a browser or inside the VisionNexus launcher, locally or with the backend on a Linux GPU VM. It never modifies or deletes your original images.

## Place of Dataset Explorer in the suite pipeline

Dataset Explorer is the first step of the Computer Vision suite pipeline:

1. **Dataset Explorer** scans raw image folders, removes redundancy and exports a subset.
2. **Annotation App** imports that subset (the export folder is its `imports/` folder by default) and annotates it.
3. **Training App** and **Optuna App** train and tune a model on the annotated dataset; **Inference App** runs it; **MLflow App** and **DVC App** track runs and data versions.

The **Orchestrator App** can drive Dataset Explorer automatically: it loads a dataset, runs the embeddings, creates a subset from a text query and exports it into the workspace of Annotation App (see the section *Run Dataset Explorer from an Orchestrator pipeline* of [Workflows](workflows.md)). Dataset Explorer also works alone, without any other app.

Each user gets an isolated workspace (`explorer_<user>` under the workspaces root) holding the database, the thumbnails, the FAISS indexes, the subsets and the settings. The layout is described in [Configuration](configuration.md).

## Quick start in five steps

This quick start assumes the app is installed and launched from VisionNexus, or with `python launcher.py --app explorer --workspace <root> --user <name>` from the suite root (see [Configuration](configuration.md)).

1. On the **Dataset Gallery** page, type the folder path in **Add a dataset** (or drop the folder onto the field in VisionNexus), optionally a name and a number of clusters, then click **Scan**.
2. On the new dataset card in **My workspace**, click the pin icon to pin it in the **Playground**.
3. Open **Playground** in the sidebar and click **Embeddings** on the dataset. Wait until the status becomes `ready`.
4. Click **Map**, draw a lasso around a group of points, type a name and click **Create subset**. **Search** and **Duplicates** work the same way from the Playground.
5. Open **Subsets**, then click **Export** on your subset: its images are linked into the Annotation App imports folder.

The interactive tutorial (**Tutorial** button at the top of the sidebar) walks through the same steps on ten sample images in a few minutes.

## Documentation pages for Dataset Explorer

The Dataset Explorer documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): screen-by-screen tour of every page, panel and button, and when to use each one.
- [Workflows](workflows.md): complete tasks from start to finish in numbered steps, from scanning a folder to exporting a subset or sharing a dataset.
- [Concepts](concepts.md): datasets, statuses, CLIP embeddings, the similarity score, the 2D map, clustering, rarity, duplicates, subsets and the global gallery, with their limits.
- [Configuration](configuration.md): installation, CLIP weights, launch commands, ports, environment variables, workspace layout and every option of the **Settings** page.
- [Troubleshooting](troubleshooting.md): known problems described by their symptom, with cause and solution.
- [Architecture](architecture.md): backend and frontend components, the embeddings pipeline, background jobs, storage and the invariants that must not be broken.
- [API reference](api-reference.md): HTTP endpoints grouped by domain.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
