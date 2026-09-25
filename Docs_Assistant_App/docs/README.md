---
app: docs
doc_type: readme
audience: both
lang: en
title: Docs Assistant
order: 0
tags: [documentation search, passages, embeddings, hybrid search, compute resource, ask the docs]
sources: [Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/sync.py, desktop/ui/ask.js, desktop/src/services.ts]
---

# Docs Assistant

## What the Docs Assistant does

The Docs Assistant is the documentation search of the suite. You type a question in French or English, and it returns the passages of the product documentation that answer it best. It never writes an answer of its own: every result is an existing section of a documentation page, shown with its heading path, a short excerpt and a link to the same section in the other language.

- **It searches every documented source**: the pages of all the apps, of VisionNexus itself and of the Docs Assistant, in both languages.
- **It combines two ways of searching**: exact words (keywords) and meaning (an embedding model), so a question phrased differently from the page still finds it.
- **It runs as a compute resource**: a backend with no interface, switched on from the **Compute resources** section of VisionNexus, locally or on a Linux GPU VM.
- **It keeps itself up to date**: each time it starts, it re-reads the documentation and only reprocesses the pages that changed.

You use it from the **Ask the docs** tab of the **Documentation** window. The service can also be called over HTTP, which is described in the [API reference](api-reference.md).

## Place of the Docs Assistant in the suite

The Docs Assistant is not one of the applications of the diagram: it has no tile, no tab and no workspace screens. It is a compute resource that the **Documentation** window uses to answer questions. VisionNexus starts it with the same launcher as the apps (`python launcher.py --app docs --backend-only`), forwards its port through the SSH tunnel when a VM is selected, and relays the searches of the window to it; the window never talks to the service directly.

The service reads the documentation of the repository it runs from, so on a VM it searches the pages deployed there. Its data, the index, lives in the workspace folder `docs_<user>/`, next to the workspaces of the applications. The relation with the other pages of the suite is described in [Concepts](concepts.md).

## Quick start in five steps

This quick start assumes VisionNexus settings are complete. Prerequisites are detailed in [Configuration](configuration.md).

1. Once per machine that runs the service, download the embedding model: from `Docs_Assistant_App/`, run `python scripts/download_model.py`. Without it, the search still works with keywords only.
2. In the **Compute resources** section of VisionNexus, click the switch of **Docs Assistant**. The status goes from **Starting...** to **Ready**, then shows the number of indexed passages.
3. Click **Documentation**, then the **Ask the docs** tab.
4. Type a question, for example `how do I export to YOLO?`, and click **Search**.
5. Click a result to open the section in the **Docs per app** tab.

## Documentation pages for the Docs Assistant

The Docs Assistant documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): the catalog card and the **Ask the docs** tab, the filters, the result cards, the keyword-only mode.
- [Workflows](workflows.md): turning the service on locally or on a VM, asking a question, refreshing or rebuilding the index, switching the search language.
- [Concepts](concepts.md): passages, embeddings, hybrid search, language twins, incremental indexing, the seed index and the slower first start.
- [Configuration](configuration.md): environment variables, model weights, offline operation, device, workspace, port and the seed.
- [Troubleshooting](troubleshooting.md): model missing, empty index, service unreachable, slow first query.
- [Architecture](architecture.md): the chunker, the store schema, synchronization, search, the launcher integration and the desktop bridge.
- [API reference](api-reference.md): the HTTP endpoints, with request and response fields.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
