---
app: explorer
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [errors, clip, faiss, symlinks, scan, export, smb]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/backend/core/embedder.py, Dataset_Explorer_App/backend/api/datasets.py, Dataset_Explorer_App/backend/api/duplicates.py, Dataset_Explorer_App/backend/api/filter.py, Dataset_Explorer_App/backend/api/export.py, Dataset_Explorer_App/backend/core/subset_manager.py, Dataset_Explorer_App/backend/utils/native_share.py, Dataset_Explorer_App/backend/api/settings.py, Dataset_Explorer_App/frontend/src/components/LanguageToggle.tsx]
---

# Troubleshooting

## "Modele CLIP non charge" when launching the embeddings or a search

**Symptom**: clicking **Embeddings** in the Playground, running a search, the Gallery CLIP filter or the Catalog visual search shows an error containing "Modele CLIP non charge" (CLIP model not loaded).

**Cause**: the backend could not load the CLIP ViT-B/32 weights at startup. It works offline and never downloads them: if `CLIP_WEIGHTS` is not set, `Dataset_Explorer_App/models/ViT-B-32-openai.safetensors` is missing and the Hugging Face cache does not contain the model, loading fails. The backend keeps running for everything that does not need CLIP (Gallery, map of already computed datasets, subsets).

**Solution**:

1. Open `http://localhost:<backend port>/health`: `"clip_loaded": false` confirms the cause.
2. Read the backend log: the line "Impossible de charger CLIP" gives the detail.
3. Place the weights file as described in the section *CLIP model weights* of [Configuration](configuration.md), or set `CLIP_WEIGHTS` to its path.
4. Restart the backend: the model is loaded only at startup.

## The dataset card shows the status error after a scan

**Symptom**: after **Scan**, the card goes from `scanning` to a red `error` status. Hovering the status shows a message.

**Cause**: the message tells which case occurred:

- "Aucune image trouvee dans ..." (no image found): the folder contains no `.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff` or `.webp` file, and no file of an optional format (such as `.optional`).
- "Acces refuse a ..." (access denied): the backend process cannot read the folder.
- Another message: an unexpected error during the scan (unreadable file system, corrupted files).

**Solution**:

1. Check the path and the file extensions. Remember the path is read by the backend machine: a Windows path does not exist on a Linux VM.
2. For an access error, give the backend user read rights on the folder (on a VM, check the mount options of the share).
3. Delete the failed dataset with the trash icon of its card, then scan again.

## "Chemin introuvable" when adding a dataset

**Symptom**: **Scan** immediately shows an error "Chemin introuvable : ..." (path not found) and no card is created.

**Cause**: the backend does not find the folder. Three common cases:

- The path is written for another machine: a local Windows path while the backend runs on a VM, or the reverse.
- A Windows network path (`\\host\share\...`) was translated to a server path that does not exist: a Linux backend converts such paths to `/home`, `/mnt`, `/srv`, `/media` or `/data` followed by the share name. On a VM whose mount point does not follow this rule, the translation fails.
- The backend runs locally on Windows and the network path `\\host\share\...` is not reachable from the backend machine: a Windows backend uses the path as typed, without translation, so it must be reachable with that exact spelling.

**Solution**:

1. On a VM, type the server path directly (for example `/srv/datasets/run01`), or mount the share following the convention described in [Configuration](configuration.md).
2. With a local Windows backend, map the network share to a drive letter in Windows and use a path such as `Z:\run01`.
3. Check the case and spelling: Linux paths are case-sensitive.

## The Path already known window appears when adding a dataset

**Symptom**: after **Scan**, a window **Path already known** lists one or more existing datasets.

**Cause**: the same folder (after resolving links and relative parts) is already a dataset of this workspace, possibly under another name. Scanning it again would create an independent second dataset and encode the same images twice.

**Solution**:

1. Click **Cancel** and use the existing dataset: find it in **My workspace**, rename nothing, and pin it.
2. If you really need a second analysis of the same folder (for example with other settings), click **Continue anyway**. Both cards then show a **duplicate of** badge.
3. To replace the old dataset, delete it first with its trash icon, then scan again.

## The embeddings stay "In progress..." or the dataset returns to pending

**Symptom**: the Playground card shows **In progress...** with a progress bar that no longer moves, or a dataset that was `embedding` is back to `pending` after a restart of the backend.

**Cause**: the embeddings pipeline runs in a background job on the server. If the backend is stopped or reloaded during the run (crash, closing VisionNexus, automatic reload after a code change), the job is lost; at the next start the dataset is set back to `pending`. A bar that does not move can also simply be a long phase: the `umap` and `clustering` phases have no intermediate progress and can last minutes on large datasets. Only three heavy jobs run at the same time; others wait in the queue.

**Solution**:

1. Look at the backend log: "Embed termine" means the run finished; an error trace explains a failure (the status then becomes `error`).
2. Check `http://localhost:<backend port>/health`: the `jobs` list shows running and queued jobs.
3. If the dataset is back to `pending`, click **Embeddings** again. Images already encoded are not encoded again.

## The Map, Search and Duplicates buttons are missing in the Playground

**Symptom**: a pinned dataset in the Playground shows only **Embeddings**, without **Map**, **Search**, **Duplicates**, **Cluster** or **Reduc.**; the map page shows **Map not computed for this dataset.**

**Cause**: these tools need the embeddings pipeline to have completed at least once (the map is marked as computed only at the end). A dataset in `pending`, `scanning` or `error`, or whose pipeline failed, has no map.

**Solution**:

1. Click **Embeddings** and wait for the `ready` status.
2. If the status becomes `error`, read the backend log. Common causes are the CLIP model not loaded (see the first section of this page) and a lack of GPU memory (see *Out of memory during the embeddings*).
3. A dataset missing from the Playground altogether is simply not pinned: pin it from the Gallery.

## Search or duplicates fail with "Index FAISS non charge"

**Symptom**: the search page or the duplicate page of a `ready` dataset shows an error such as "Index FAISS non charge en memoire" or "Index FAISS non disponible".

**Cause**: the similarity index of the dataset is not in memory. At startup the backend reloads the index file `faiss/<dataset id>/index.faiss` of every `ready` dataset; if the file is missing or unreadable (workspace copied without the `faiss/` folder, file deleted, disk error), the log shows "Index FAISS non rechargé pour dataset N" and the dataset stays `ready` without index.

**Solution**:

1. Click **Embeddings** on the dataset in the Playground: the index is rebuilt from the stored embeddings, without encoding the images again.
2. When moving a workspace, copy the whole folder, including `faiss/`.

## A subset folder stays empty or the export fails on Windows

**Symptom**: after **Create subset**, the subset card has no link folder; or **Export** fails with "Export echoue" and a message about symbolic links or privileges.

**Cause**: the link strategy is **Symlinks** and Windows refuses to create symbolic links without Developer Mode or administrator rights. The subset is saved in the database, but its folder cannot be filled; the export cannot be written at all. A network share that forbids links has the same effect.

**Solution**:

1. Enable Developer Mode in Windows (Settings, For developers), then restart the backend. Or choose **Physical copy** in **Subsets & links** of the **Settings** page and click **Save changes**.
2. Export again. For a subset without folder, create it again (or duplicate it with **Duplicate**) so that the folder is created with the new strategy.

## "Ce chemin d'export existe déjà" when exporting a subset

**Symptom**: **Export** on a subset shows "Ce chemin d'export existe déjà : ..." (this export path already exists).

**Cause**: the subset was already exported to exactly this folder. Each subset keeps the list of its exports and refuses a second export to the same destination. Note that missing images are still added to the folder before the refusal.

**Solution**:

1. If the goal is a second copy, choose another **Destination folder** in the export window (standalone mode).
2. If the goal is to refresh the export after changing the subset, delete or rename the folder `<destination>/<subset name>/` on disk, then use **Duplicate** on the subset and export the copy, since the old export record remains attached to the original subset.

## A subset cannot be deleted

**Symptom**: the trash icon of a subset is disabled, or deleting shows "Subset verrouillé" (subset locked).

**Cause**: the subset is locked. The lock is stored on the server and also blocks deletion through the API.

**Solution**: click the lock icon of the subset (**Unlock**), then delete it. Deleting a subset removes its record and its link folder; the original images and the folders already exported to Annotation App are kept. The lock and the deletion are both recorded in the audit log of the workspace.

## A rejected image is missing from the map, the searches or an export

**Symptom**: an image is not proposed by the text search, does not appear on the map or in the Catalog, or is absent from an exported subset, although it is still on disk.

**Cause**: the image was marked as rejected, in the duplicate pages or with **Exclude from dataset**. A rejected image is left out of the map, the clusters, the text searches of a dataset and of the Catalog, and the export of a subset, even if the subset still holds a link to it. Nothing is deleted on disk. A subset only loses its link to a rejected image when **Apply to the subset** is used.

**Solution**:

1. Open the duplicate page of the dataset and set the image back to **Keep**, then **Save**.
2. To clear all decisions of a dataset, use **Reset** on its Playground card (this also recomputes the map and clusters).
3. After changing decisions, rebuild the map with **Rebuild** so that the clusters match the images kept.

## The Metadata tab of the Catalog finds nothing

**Symptom**: the **Metadata** tab shows a warning that no dataset has metadata, or a search returns no result although the table contains the words.

**Cause**: metadata exists only for datasets added with a table in **Metadata (optional)**, and only for images whose name matched the key column. If the key column was wrong, no image received metadata. A missing SQLite FTS5 extension also disables the search (the log shows "FTS5 indisponible").

**Solution**:

1. Check the **metadata** badge on the dataset card: without it, no table was attached. Tables can only be attached when adding a dataset: delete it and add it again with the table.
2. Make sure the key column contains the image file names (with or without extension).
3. Use **Explore a column:** to see the values actually indexed.

## The language is not the one expected outside VisionNexus

**Symptom**: in a browser outside VisionNexus, the app opens in a different language than the one chosen last.

**Cause**: outside VisionNexus, the language is looked up in this order: the `?lang=` parameter of the address, then the choice stored in the browser, then the `ui_language` field of the workspace settings. Switching **FR** / **EN** updates the last two. A browser with cleared data, or an address that still carries an old `?lang=`, gives the earlier language. Inside VisionNexus, the language comes from the launcher and this does not apply.

**Solution**: switch again with **FR** / **EN**, remove `?lang=` from the address, or set `"ui_language": "fr"` (or `"en"`) directly in `settings.json` of the workspace.

## Exports go to an unexpected folder

**Symptom**: an export to Annotation App lands in a folder other than the one expected.

**Cause**: the export folder is chosen in this order: the **Destination folder** typed in the export window (standalone mode only), then the **Imports folder** of **Export Annotation App** in the Settings page, whose initial value comes from `ANNOTATION_APP_IMPORTS`. When the app is launched by the Orchestrator, the export folder is always the one the Orchestrator provides and neither of the two applies.

**Solution**: type the wanted folder in **Destination folder**, or change **Imports folder** in the Settings page and save. Check that the change was saved: the folder used is written in the audit log entry of the export.

## Out of memory during the embeddings

**Symptom**: the embeddings fail with a CUDA "out of memory" error in the backend log and the dataset status becomes `error`, or the machine becomes very slow during the `embedding` phase.

**Cause**: images are encoded by batches of 64. Several embeddings pipelines can run at the same time (up to three by default), each loading its own batches on the same GPU, while other apps of the suite (Annotation App with SAM2, training) may use the GPU too. Very large images also make the decoding step heavy in memory.

**Solution**:

1. Run one embeddings pipeline at a time, or start the backend with `EXPLORER_JOB_WORKERS=1`.
2. Free the GPU used by other apps, then click **Embeddings** again; images already encoded are skipped.
3. Without a GPU, CLIP runs on CPU: slower but without this limit.

## The Documentation page shows Documentation not available

**Symptom**: the **Documentation** page shows **Documentation not available** with the message that the backend is not responding, or that the page is not written yet.

**Cause**: the pages are served by the backend from the `docs/` folder of the app. If the backend is not running or not reachable, nothing can be displayed. The second message means the page file is missing from `docs/`, for example in a partial copy of the application.

**Solution**:

1. Check that the backend answers on `http://localhost:<backend port>/health`, and restart the app if needed.
2. Check that `Dataset_Explorer_App/docs/` contains the page and its `.fr.md` translation.

## The Open workspace button does nothing

**Symptom**: the folder icon **Open workspace** of the user badge, or the folder icons of **Connected users** and **Workspace history**, do not open anything.

**Cause**: opening a folder in the Windows file explorer needs the VisionNexus shell, which translates the server path and opens it on the workstation. In a normal browser, the action silently fails. With a remote VM, the path must also be reachable from Windows through the share host.

**Solution**: open the app from VisionNexus with the share host configured (see [Configuration](configuration.md)), or copy the workspace path from the **Workspace** section of the **Settings** page and open it yourself.
