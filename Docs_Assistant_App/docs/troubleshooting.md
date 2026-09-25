---
app: docs
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [model missing, empty index, keyword only, unreachable, timeout, slow first query, sync error]
sources: [Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py, Docs_Assistant_App/backend/core/store.py, Docs_Assistant_App/backend/core/embedder.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/backend/main.py, desktop/ui/ask.js, desktop/src/services.ts]
---

# Troubleshooting

Notices coming from the service are written in French; they are quoted as the service sends them. The messages of the launcher on the error panel are shown in the language of the window.

## A notice says the embedding model was not found

**Symptom**: results are labeled **keywords** and an amber notice reads `Modele d'embeddings introuvable dans <folder> (manque : ...). Lancez python scripts/download_model.py une fois en ligne. Mots-cles seuls.`

**Cause**: the model folder `Docs_Assistant_App/backend/models/<model name>/` (or the one given by `DOCS_ASSISTANT_MODEL_DIR`) does not contain everything the model needs. The message lists what is missing among `config.json`, `model.safetensors` and `tokenizer.json`. On a VM, the model must be on the VM, not only on your machine.

**Solution**: download the model with `python scripts/download_model.py` from `Docs_Assistant_App/` on a machine with internet access, and copy the folder to the machine that runs the service if it is another one. Switch the service off and on. Keyword search keeps working meanwhile.

## A notice says the model is loading

**Symptom**: the notice reads `Modele d'embeddings en cours de chargement : mots-cles seuls pour le moment.` or `Aucun vecteur dans l'index pour l'instant (indexation en cours) : mots-cles seuls.`

**Cause**: the service has just started. The model, about 470 MB, is loaded in the background after the synchronization, and the first search asks for it too. Before it is loaded, or before the first vectors exist, only keywords are used.

**Solution**: wait about ten seconds, or longer on a processor or a slow VM. A search made while the model was loading is repeated by itself once the model is ready, and the meta line goes back to **semantic + keywords**; with the notice about missing vectors, search again when **Indexing** has ended. If the model never becomes ready, see the section on a model that fails to load.

## The model fails to load

**Symptom**: the search stays in keyword mode, and the index status shows a message `Chargement du modele en echec : <error>`, or a notice `Recherche vectorielle indisponible (<error type>: <detail>). Mots-cles seuls.`

**Cause**: the files are present but cannot be used: damaged or partial weights, no CUDA device although one was requested with `DOCS_ASSISTANT_DEVICE`, or not enough GPU memory because other jobs use it.

**Solution**: read the error in the message. Download the model again if a file is corrupted. Set `DOCS_ASSISTANT_DEVICE=cpu` to run on the processor, or free GPU memory, then switch the service off and on.

## The index is empty or the card shows no passages

**Symptom**: searches return nothing whatever the question, the filter buttons show no apps, or the card stays on **Ready** without a passage count.

**Cause**: no documentation was indexed. Typical reasons: `DOCS_ASSISTANT_DOCS_ROOT` points to a folder without `docs/docs_manifest.json`, the repository on the VM has no documentation folders, or the synchronization failed with an error such as `Sources de doc illisibles (<root>) : ...`, which appears as the last error of the index status.

**Solution**: check that the repository the service runs from contains `docs/docs_manifest.json` and the documentation folders of the apps. Fix the path or copy the missing folders, then switch the service off and on. If an index file was damaged, delete `<workspace>/docs_<user>/index.sqlite` while the service is off.

## New or edited pages are not found

**Symptom**: a page you just wrote does not appear in the results, or an old wording still does.

**Cause**: the index is only refreshed when the service starts, or on a synchronization request. Other reasons: the service runs on a VM whose copy of the repository does not have your change yet, the page is not in the documentation folder of a source listed with `indexed` in the manifest, or the file is not valid UTF-8 and was skipped with a warning.

**Solution**: switch the service off and on and watch **Indexing n/N** until the passage count returns; do it on the machine that runs the service. Check the file location, its encoding and the manifest. See [Workflows](workflows.md#refresh-the-index-so-that-edited-pages-are-found).

## Results come from the wrong language

**Symptom**: a French question returns English sections, or the reverse, or fewer results than expected, or a page you know exists in one language is not found.

**Cause**: the **Language** filter is **Both** by default, so all pages are searched and each section is shown once, in the language of the question. The service recognizes that language from the common words and accents of the question; a single keyword such as `SAM2`, or a very short or mixed question, does not decide, and the language of the Documentation window is used. If you chose **FR** or **EN** under **Language**, only that language is searched and shown: an English word does not match a French page by keywords, and a section that exists only in the other language is not found. Switching the window language with its own **EN** and **FR** buttons sends a manual **FR** or **EN** choice back to **Both**.

**Solution**: choose **Both** under **Language**, and write the question with a few complete words so that its language is recognized. To read a section in the other language, use the **Same section in French** and **Same section in English** links on the card. Keep the two language files of a page on the same sequence of headings, or the twin links point to the wrong section.

## The results look unrelated to my question

**Symptom**: an amber note above the results reads **No section really answers this question. These are the closest: rephrase with words from the interface (a button or option name) or widen the filters.**, or the relevance bars of the cards are short and the cards do not address the question.

**Cause**: no passage is close enough to the question. Either the documentation does not cover it, or the question uses words that the documentation does not, or the filters leave out the app or the audience that has the answer. The closest sections are listed anyway, so the list is never empty; the note only warns that they are probably not the answer. The note is not shown in keyword-only mode, where closeness cannot be measured.

**Solution**: rephrase with the words the interface uses, such as the exact name of a button, a tab or an option, and name the app in the question (`Dataset Explorer`, `Training`). Widen the filters: **All** under **Apps**, **All** under **Audience**, **Both** under **Language**. Check that the app you expect appears among the **Apps** buttons; a source that is not indexed does not. If the answer is really missing from the documentation, none of these help and the page has to be written.

## The search says the service is unreachable or times out

**Symptom**: a red message reads **Service unreachable: it may have stopped, or the tunnel is down.** or **The service is not responding (timed out).**

**Cause**: the service process ended (the machine went to sleep, the VM restarted, a crash), the SSH tunnel dropped, or the service is busy: a search that takes more than 10 seconds is abandoned. The status bar is refreshed after the failure and usually shows **Off** or **Error**.

**Solution**: switch the service on again from the card or the **Ask the docs** tab, then search again. If it keeps happening on a VM, check the network and the tunnel messages in the **Launches** panel. Start-up problems such as a busy port or a failed tunnel are covered in the VisionNexus [troubleshooting](../../docs/troubleshooting.md#the-docs-assistant-does-not-turn-on).

## The first search is slow or is not semantic

**Symptom**: the first question after a start takes long or answers in **keywords** mode, and the following ones are fast.

**Cause**: the model loads once per start, after the synchronization; a start without a seed index also has to embed every passage first. The same happens after an update that changes the index layout: the service drops the old index and rebuilds it from the pages at start, in a few seconds on a GPU. See [Concepts](concepts.md#why-the-first-start-can-take-longer).

**Solution**: wait for the card to show the passage count; a keyword-only search is repeated by itself when the model is ready. To shorten the first start on a new machine, provide a seed index built with the same model (see [Configuration](configuration.md#building-the-seed-index)).

## The index status shows a synchronization error

**Symptom**: the index status shows a last error such as `Embeddings interrompus : <type>: <detail>` or an exception name and message, while the search still works.

**Cause**: the synchronization stopped in the middle. When embeddings are interrupted, for example by an out-of-memory error, the passages are stored and searchable by keywords, but some have no vector yet. Other errors come from the documentation sources or the disk.

**Solution**: fix the cause named in the message and switch the service off and on: the next synchronization only embeds what is missing. The **Indexing** notice stays until it ends.

## A rebuild request is refused

**Symptom**: `POST /index/rebuild` answers HTTP 409 `Une synchronisation est deja en cours.`

**Cause**: a synchronization or a rebuild (a forced reindexing) is already running, and only one runs at a time.

**Solution**: wait for **Indexing n/N** to end, then send the request again.
