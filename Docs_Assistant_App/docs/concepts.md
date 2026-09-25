---
app: docs
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [passages, embeddings, hybrid search, bm25, language twins, incremental indexing, seed index]
sources: [Docs_Assistant_App/backend/core/chunker.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/backend/core/store.py, Docs_Assistant_App/backend/core/embedder.py]
---

# Concepts

## Passages

A passage is the unit the Docs Assistant searches and returns: one section of a documentation page, or a piece of a long section. Search never returns a whole page nor a loose sentence, so every result is small enough to read at once and complete enough to be understood alone.

Pages are cut at their headings, from level 1 to level 3. A section shorter than about 60 words is merged with the next one, since a few lines rarely answer a question on their own. A section longer than about 300 words is cut at paragraph boundaries into several passages that overlap by about 35 words, so a sentence at a cut is not lost. A code block or a table is never cut in the middle. Each passage remembers the path of headings that leads to it and the number of the heading it starts at, which is what lets the Documentation window scroll to the right place. The text that is indexed for a passage also starts with the name of its app as titled in the app README, for example `Training App - Workflows > ...`, so a question that names an app finds the pages of that app.

This is why the documentation is written in self-contained sections whose title names their subject: the title and its heading path are part of what the search reads, and a section that needs the previous one to be understood makes a poor answer. A section of 150 to 600 words gives one to three passages.

## Embeddings and the embedding model

An embedding is a list of numbers that represents the meaning of a text, so that two texts about the same thing have close lists even when they share no word. The Docs Assistant computes one for each passage and one for each question, with the multilingual model `intfloat/multilingual-e5-small`, which understands French and English together. A French question is therefore close to the English passage that answers it, and the reverse.

The model is loaded from files on disk, never downloaded while the service runs, and it uses the GPU when there is one. The larger `multilingual-e5-base` can be chosen instead: it is more precise on some questions, takes more memory and gives vectors of a different size, so choosing it re-computes the index once. Comparing a question with every passage is a plain scalar product on a small matrix, exact and fast for a documentation of a few thousand passages.

Embeddings have limits. They are good at meaning and weaker at exact names such as a button label or an option key, which is one reason keywords are combined with them.

## Hybrid search: keywords and meaning

The search runs two rankings and merges them. The keyword ranking uses the full-text search of SQLite (BM25): it finds passages that contain the words of the question, without regard to accents or capitals, and counts a word in a heading or in the tags of the page more than a word in the body. Long words also match their beginning, so `propagate` reaches `propagation`. Common words such as `the`, `how` or `comment` are ignored. The meaning ranking compares the embedding of the question with the embedding of every passage.

Each ranking gives its best 50 passages. They are merged by reciprocal rank fusion: a passage gains points for its position in each list, so one that is high in both lists wins, and one that is first in a single list still stays visible. Then two mild adjustments are applied, and the results are filtered and grouped: filters on app, audience and language apply, each section appears once when both languages are searched, and at most two passages per page are kept.

The two adjustments only nudge the order. First, the generated reference pages (API reference and code map) contain the names of everything in an app, so they would often come before the step-by-step pages; unless the question looks like a developer question, they are ranked slightly lower, and README pages a little lower as well. A question is a developer question when it contains something that looks like code, such as a path, a `snake_case` name, an `UPPER_CASE_VARIABLE` or a file name, or words such as endpoint, API, module, function, schema, IPC, "how does" or "where is"; the reference pages are then left where they are. Second, when the question names an app, by its name as titled in its README or by the French word `entrainement` for Training, the pages of that app are ranked slightly higher.

Two figures come with the results and are not the rank. The **relevance** of a result is measured from the similarity between the embedding of the question and the one of the passage, on a scale from 0 to 100 %: it stays low when nothing in the documentation is close to the question, even for the first result. It is only available for the default model, which is calibrated for it, and only for passages the semantic ranking has scored; otherwise it is unknown. The **confidence** of the whole answer is low when the best similarity is under a threshold measured for that model, meaning that no section really answers the question. A question of one or two words whose exact words rank first by keywords is not flagged, since a short keyword gives a vague embedding but a reliable match. A low confidence makes the window show a note asking to rephrase; it does not remove any result.

If the model is missing or still loading, only the keyword ranking runs and the answer says so. The service then still works, less well on questions that share no word with the page.

## Language twins and the language filter

Every documentation page exists in French and in English, with the same sequence of headings. Two sections that sit at the same place in the two files are twins, and the service links them with a key made of the source, the page and the heading number. This is what lets a result offer **Same section in French** or **Same section in English**, and what lets a search over both languages show each section once.

The language filter chooses which files are searched, and it is **Both** by default. A question and a page do not have to be in the same language, thanks to the multilingual model, so the semantic ranking finds the right section whatever the language of the question. Keywords only match within a language: an English word rarely matches a French page. Searching both languages is therefore broader, and searching a single one is sharper on keywords but cannot find what exists only in the other language.

With **Both**, the language of the question decides which twin is shown. The service recognizes French or English from the common words and accents of the question; when a section exists in both languages, it returns the one in that language, and it credits that section with the better score of its two twins so that it is not penalized for being displayed in the other language. When the question does not decide, for example a single keyword such as `SAM2`, the language of the Documentation window is used instead. Choosing **FR** or **EN** restricts the search to that language and forces the display language. Recognition is a simple count of common words and accents, so a very short or mixed question may be attributed to the wrong language; the link to the twin section then opens the other version in one click. If the twins ever drift apart, for example when one file gets an extra heading, the links point to the wrong section; this is checked by the documentation lint.

## Incremental indexing

The index is updated, not rebuilt, at every start. The service computes a fingerprint of each documentation file and compares it with the one stored. An unchanged file is skipped entirely. A changed file is cut again, and each of its passages has its own fingerprint: only passages whose fingerprint has no vector yet are embedded. Editing a paragraph therefore embeds only the passages of its section, and moving or renaming a file embeds nothing. Files that disappeared are removed, and orphan vectors are deleted.

Keyword search is available as soon as the passages are stored, before any embedding is computed, so search works during a long synchronization with a reduced quality. Changing the embedding model is the one case that recomputes everything, because vectors of two models cannot be compared.

## The seed index

The seed index is an optional index computed in advance, so that a fresh machine does not start with an empty index. It is never published nor shipped in the suite bundles: by default the service builds its index on the first start, from the pages present on the machine. When a seed is provided (an internal deployment, for example), on its first start, if no index exists in the workspace yet, the service copies the seed there, provided it was built with the same embedding model and the same storage version. It then synchronizes as usual: the seed already holds most passages, so only the differences are processed.

The seed is a build artifact: it reflects the documentation at the time it was built and must be rebuilt after a notable change of the documentation to stay useful. A seed built with an older storage version is not used at all, so it has to be rebuilt after a change of that version. An outdated seed is harmless, since the synchronization corrects it, but it saves less work. The index status tells whether the seed was used.

## Why the first start can take longer

A first start does more than the following ones. The embedding model, about 470 MB, is read from disk and moved to the GPU, which typically takes ten to twenty seconds. Without a seed, or with a seed built for another model, every passage of the documentation is embedded: seconds on a GPU, noticeably longer on a processor only. On a VM, the launch also opens the tunnel and may read the repository from a slower disk.

None of this blocks the interface. The service answers as soon as it is started, keyword search works while the index fills, and the model loads in the background. A search made too early falls back on keywords and says so, and the window repeats it by itself once the model is ready. From the second start on, the index is reused and only changed pages are processed.

## Limits of the search

The Docs Assistant returns existing sections; it does not write answers, summarize or combine several pages. It only knows the documentation that was present when the service last synchronized: pages edited later are not found until the next synchronization. A question shorter than two characters or made only of common words returns nothing useful, and a question is limited to 500 characters. Results are capped at thirty, two per page.

The index is stored in your own workspace folder and is not shared between users. It contains only text of the documentation, no data from your projects.

## Architecture of the embedding model multilingual-e5-small

The Docs Assistant uses one neural model, `intfloat/multilingual-e5-small`, to turn every passage and every question into a vector of 384 numbers. It has about 118 million parameters, most of them in its vocabulary.

### e5-small encoder: a small BERT with a multilingual vocabulary

The model is a BERT encoder: 12 transformer layers, 12 attention heads, hidden size 384 and a feed-forward size of 1536, with a position table for up to 512 tokens. What makes it multilingual is its tokenizer: a SentencePiece vocabulary of about 250,000 pieces shared by about a hundred languages, which alone holds about 96 million of the parameters. The 12 layers themselves hold only about 21 million, which is why the model is fast even on a processor. Text longer than 512 tokens is truncated; the passages of the suite (60 to 300 words) fit within that limit.

The text is not embedded as it is. A passage is prefixed with `passage: ` and a question with `query: `, because the model was trained with these two roles and gives better similarities when it knows which is which. The 384 numbers of a text are the average of the vectors of all its tokens (mean pooling, ignoring padding), normalized to length 1. Since all vectors have length 1, the scalar product of a question and a passage is their cosine similarity.

### How e5 was trained and what its similarity scores mean

E5 models start from a multilingual encoder and are trained with a contrastive objective: on large sets of text pairs (a question and the text that answers it, a title and its article), each text must be closer to its own partner than to the other texts of the batch. A last stage fine-tunes the model on labeled retrieval data. Because the training used pairs in many languages, a French question and the English passage that answers it end up close in the same space, which is why the search works across languages.

The training temperature is low, so the similarities are compressed toward the high end: two unrelated texts still score around 0.80, and an excellent match around 0.92. A score of 0.85 is therefore not "85 % relevant"; what matters is the ranking and the gap to the other passages. The Docs Assistant does not show the raw cosine: it rescales it between these two bounds (0.80 and 0.92 for this model) to a relevance, and it flags a low confidence when even the best passage stays below the calibrated threshold (0.845). Names of buttons and options are the weak point of embeddings, which is why the keyword search is combined with them.
