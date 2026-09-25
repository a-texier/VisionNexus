---
app: docs
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [turn on, vm, ask a question, refresh index, rebuild index, language, turn off]
sources: [desktop/ui/ask.js, desktop/src/main.ts, Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/scripts/download_model.py]
---

# Workflows

## Turn the Docs Assistant on locally

This workflow starts the documentation search on your own machine.

*Prerequisites*: the VisionNexus settings are complete and **Target VM** is on **(local, no VM)**. Optional but recommended: the embedding model is downloaded, with `python scripts/download_model.py` from `Docs_Assistant_App/` (see [Configuration](configuration.md#model-weights-and-download-script)).

1. In the **Compute resources** section of the VisionNexus home tab, click the switch of the **Docs Assistant** card. The **Launches** panel opens on **Docs Assistant**.
2. Watch the log: `Lancement de Docs Assistant (local)...`, then `Port reel : backend=<port> (pas de frontend)`, then `Pret.`
3. Wait until the card shows **N indexed passages**. If it shows **Indexing n/N**, the search already works and gets more complete as the index fills.

*Result*: the service runs on `127.0.0.1:<port>`, its index is stored in `<workspace>/docs_<user>/index.sqlite`, and the **Ask the docs** tab of the Documentation window is ready. The service searches the documentation of the repository it runs from.

## Turn the Docs Assistant on with a Linux GPU VM

This workflow runs the service on the VM, where it uses the GPU for the embedding model, and reaches it through a tunnel.

*Prerequisites*: launching applications on the VM already works (see the VisionNexus workflow for running the suite on a VM); the repository is deployed on the VM with its documentation; the embedding model is present in `Docs_Assistant_App/backend/models/` on the VM.

1. Choose the VM in **Target VM** and check that **Computer_Vision_App root**, **Workspace** and **Conda path** are Linux paths of the VM.
2. Click the switch of the **Docs Assistant** card. Its chip now shows the VM name.
3. In the **Launches** panel, wait for `Tunnel ouvert (local <port> -> <vm>).`, then `Pret.` The first start can take a minute: the model loads on the GPU and the index is created or completed.
4. Check that the card shows the number of indexed passages.

*Result*: the search runs on the VM and answers through a single forwarded port. It searches the pages that are deployed on the VM, so a documentation change must be present there to be found. If you change **Target VM** afterwards, the service keeps running on the target it started on; switch it off and on to move it.

## Ask a question and open the answer

This workflow finds a section of the documentation from a question and reads it.

*Prerequisites*: the Docs Assistant is on and the card shows **Ready** or a number of indexed passages.

1. Click **Documentation** in the VisionNexus header, then the **Ask the docs** tab.
2. Type your question, in French or English, in the search field, for example `how do I export to YOLO?`.
3. Optionally narrow the search: select one or more apps under **Apps**, choose **User** or **Developer** under **Audience**, or change the **Language** filter. Once a search has been made, each change repeats it at once.
4. Click **Search**. The results appear as cards, with the number of results and the search mode above them. If a note says that no section really answers the question, rephrase with words from the interface or widen the filters.
5. Click the card that looks right. The **Docs per app** tab opens on the page, scrolled to the section.
6. If you would rather read it in the other language, go back and click **Same section in French** or **Same section in English** under the card.

*Result*: you are reading the exact section of the documentation that answers the question. To search again with other words, return to the **Ask the docs** tab: your last question is kept.

## Refresh the index so that edited pages are found

This workflow makes the search take into account documentation pages that you added or edited.

*Prerequisites*: the pages are saved in the repository the service runs from (on the VM if it runs there). Both language files of a page keep the same sequence of headings, checked with `python tools/docs/lint_docs.py --all`.

1. Switch the **Docs Assistant** off with its switch, then on again. Each start begins with a synchronization.
2. Watch the status: **Indexing n/N** counts the changed files, then the passages to embed. Only files whose content changed are read again, and only their passages are embedded again.
3. When the card shows the passage count again, search for a phrase you wrote.

*Result*: new and changed sections are searchable, deleted pages are removed from the index, and unchanged pages cost nothing. Without restarting, a synchronization can also be requested with `POST /index/sync` on the service port (shown in the launch log as `Port reel`); it returns immediately and runs in the background. The current window has no button for it.

## Rebuild the index from scratch

This workflow forces a full reindexing: it throws the index away and builds it again, for example when results look inconsistent after manual changes to the index file.

*Prerequisites*: none. A rebuild takes longer than a refresh, since every passage is embedded again.

1. With the service on, send `POST /index/rebuild` to the service port. It answers 202 and starts in the background; it answers 409 if a synchronization is already running, in which case wait for it to end.
2. Watch **Indexing n/N** until the passage count returns.

*Result*: the chunks and their embeddings were deleted and rebuilt from the documentation. Without a running service, deleting `<workspace>/docs_<user>/index.sqlite` has the same effect: the next start installs the seed index if there is one, then synchronizes. Changing the embedding model rebuilds the vectors by itself, once, and so does an update of the service that changes the index layout: the old index is dropped at start and rebuilt from the pages.

## Switch the search language

This workflow changes which language the search looks in and in which language the results are shown.

*Prerequisites*: the **Ask the docs** tab is open with the service ready, and a search has been made.

1. Leave **Language** on **Both**, the default, to search every page. The results are shown in the language of your question, and a section that exists in both languages appears once, in that language. When the question does not decide, for example a single keyword such as `SAM2`, the language of the Documentation window is used.
2. To search one language only, click **FR** or **EN** under **Language**. The current search is repeated at once, only the pages of that language are searched, and the results are all shown in it.
3. Click **Both** to return to the default. The search is repeated again.
4. To change the language of the whole window, use its **EN** and **FR** buttons at the top right: the window reloads the pages in that language and repeats your last search. This does not change the **Language** filter, except that a manual **FR** or **EN** choice goes back to **Both**.

*Result*: with **Both**, the results follow the language you write in; with **FR** or **EN**, they come from the pages of that language only. A question in one language can still find pages in the other, since the model understands both, and the **Same section in French** or **Same section in English** link opens the twin.

## Turn the Docs Assistant off

This workflow stops the service and frees its port.

*Prerequisites*: the service is on.

1. Click the switch of the card, or of the bar in the **Ask the docs** tab. **Stop** in the **Launches** panel does the same.
2. Wait for **Off**.

*Result*: the process and its tunnel are stopped, the index stays on disk for the next start, and the port is freed. Closing VisionNexus stops the service too.
