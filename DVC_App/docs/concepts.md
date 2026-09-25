---
app: dvc
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [tracked data, dvc pointer, commit, remote, cache, lineage, trailers]
sources: [DVC_App/backend/core/dvc_runner.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/commits.py, Orchestrator_App/backend/api/graphs.py]
---

# Concepts

## What DVC answers in this suite

DVC (Data Version Control) answers one question: which exact version of the data or the heavy model weights was used? Git alone answers the equivalent question for code and configuration, but is a poor fit for large binary files: committing a multi-gigabyte dataset directly into Git would bloat the repository and make every clone slow. DVC solves this by keeping the actual content out of Git and tracking it through small pointer files instead.

The conceptual framing of Git versus DVC versus MLflow, and why the suite uses all three together, is explained in the Orchestrator's own MLOps guide; this page covers only how DVC itself works and how this app uses it.

## Tracked data and `.dvc` pointer files

A tracked file or folder is any path DVC knows about via `dvc add`. Running it does not commit the file to Git directly; instead it computes a hash of the content, stores that content in DVC's own cache, and writes a small `.dvc` pointer file (plain text, readable, containing the hash and the tracked path) next to it. That pointer file, not the data itself, is what gets committed to Git.

This is why the Datasets page shows both a path and a separate "DVC file" column: the path is the real dataset or model folder on disk, the `.dvc` file is the small pointer Git actually versions. A file's status (`unchanged`, `modified`, `missing`, `new`) compares the content on disk right now against what the current pointer expects.

## Commits and lineage trailers

A commit in DVC App is an ordinary Git commit, filtered to only those that touched at least one `.dvc` file. Each commit is one version: whichever `.dvc` files it added or changed, that many datasets or models got a new version at that point in history. The commit hash identifies the exact code and configuration state; the `.dvc` file inside it identifies the exact data or model state.

When a commit is created from the Orchestrator's DVC node, it carries extra Git trailers in its message: `Run-Id`, `Graph-Id`, `Graph-Name`, `Dataset`, `mAP50`, and one `MLflow-Run` line per matching MLflow run, plus `Parent-Run` when the pipeline was forked. DVC App parses these trailers back out to show the colored chips on the History and Lineage pages, and the "Utilisé par" line on the Diff page. A commit made outside the suite (or with `git commit` directly) simply has no trailers and no chips; nothing is invented in their place.

## Remotes, push and pull

A remote is a destination DVC knows how to copy tracked content to and from: a local or network folder, or a cloud/SSH URL. Git commits (the pointer files) can be shared through any normal Git remote or copy; the actual data behind those pointers is shared separately, through a DVC remote, with `dvc push` and `dvc pull`.

With no remote configured, push and pull have nowhere to go and DVC App blocks the action with a clear message instead of letting the underlying command fail obscurely. A remote can be added directly from the Sync page, with no command line: a plain folder path becomes a local remote (the folder is created automatically if needed), while a URL such as `s3://...` or `ssh://...` is passed through as given.

## Cache and disk usage

DVC's cache stores each unique piece of content once, addressed by its hash: two versions that share the same images do not store those images twice. Whether the working directory (the actual dataset folder you see and that a training reads from) is a second physical copy of that cache, or just a set of links pointing at it, depends on the cache's link mode:

- **copy** (the historical default): the working directory holds its own full copy of every file, doubling disk usage compared to the cache.
- **linked** (hardlink or reflink, the mode this app configures automatically for the suite's repositories): the working directory's files point at the same disk blocks as the cache, so there is only one physical copy even though the file appears in both places.

The Sync page's **Stockage** panel shows which mode is active and lets you switch existing, already-copied files to linked mode retroactively (**Re-lier au cache**) without re-downloading anything, since the content is already present locally in both places.

## Lineage with Git and MLflow

A single tracked version sits at the intersection of three systems, each answering a different question: Git answers which code and configuration, DVC answers which exact data and model weights, and MLflow answers which experiment (parameters, metrics, artifacts) that data and code produced. The suite links all three through one shared identifier, the Orchestrator's run id, carried as the `Run-Id` trailer on the DVC commit and as the `orch_run_id` tag on the matching MLflow run.

This is why a Diff page result names the run that "used" a given revision: it is reading the `Run-Id` trailer of the target commit, not inferring anything from the file contents themselves. A version with no run recorded against it in the trailers is shown as exactly that, an unattributed version, rather than guessed at.
