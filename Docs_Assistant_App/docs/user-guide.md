---
app: docs
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [catalog card, ask the docs, filters, results, twin language, keyword mode, indexing]
sources: [desktop/ui/ask.js, desktop/ui/ask-render.js, desktop/ui/docs.html, desktop/ui/catalog.html, desktop/ui/i18n.js, desktop/src/services.ts]
---

# User guide

## The Docs Assistant card in the catalog

The **Docs Assistant** card sits in the **Compute resources** section of the VisionNexus home tab. From left to right it shows the service icon, its name, a chip with the target it runs on (**Local** or the name of the selected VM), a one-line description, its status, and a switch on the right.

The switch turns the service on and off. It is disabled while the VisionNexus settings are incomplete (its tooltip then says **Fill in Settings before switching a resource on.**) and while the service is stopping. The status line, with a coloured dot, reads:

- **Off**: the service is not running.
- **Starting...**: the launcher is starting it. The first start on a VM can take a minute.
- **Ready**: the service answers and the index is not known yet.
- **Indexing n/N**: it is reading the documentation. `n` counts documentation files while pages are read and passages while they are embedded. Search stays available meanwhile.
- **N indexed passages**: the normal running state, with the size of the index.
- **Stopping...** and **Error**: shutdown in progress, or a failure. On error, a red message under the status gives the cause in the language of the window, and hovering it shows the last lines of the launcher output as a tooltip when there are some. Clicking the switch again retries.

While the service is starting or ready, the **Documentation** button of the top bar turns orange and an orange **Open documentation** button appears on the card, left of the switch: it opens the Documentation window directly on the **Ask the docs** tab. Both disappear when the service is off.

If you change the **Target VM** while the service runs, a notice under the status says that it still runs on the previous target and must be switched off and on to move. Start-up lines appear in the **Launches** panel under **Docs Assistant**, where **Stop** also turns the service off.

## The Ask the docs tab

Open the **Documentation** window with the **Documentation** button, then click the **Ask the docs** tab. A bar at the top repeats the service: icon, name, target chip, status and the same switch. What appears under the bar depends on the state of the service.

- **Off**: a panel titled **Docs Assistant is off** explains that doc search is a service running on the selected compute target and shows **Target:** with its name. Click **Turn on** to start it.
- **Starting**: a spinner and **Starting the service...**, with the hint that on a VM the first start can take a minute.
- **Stopping**: **Stopping the service...**.
- **Error**: **The service ran into a problem**, the message in the language of the window, and a **Retry** button. When the launcher never announced its port or the service stopped by itself, a collapsible **Last launcher output** block under the message shows the last lines the launcher printed, as they are (they are not translated); open it to see the technical cause.
- **Ready**: the search form, the filters and the results appear.

The window keeps the same state as the catalog card: turning the service on from either place updates both at once.

## Ask a question

When the service is ready, type your question in the field under the tab and click **Search**, or press Enter. Write it as you would ask a colleague, for example `how do I export to YOLO?`, or type a few exact words such as the name of a button. The question can be in French or in English whatever the language of the pages. It is limited to 500 characters and needs at least two characters: with fewer, the window shows **Type at least 2 characters.** and does not search.

While the search runs the meta line reads **Searching...**. When it ends, the line shows the number of results, the time in milliseconds and the mode: **semantic + keywords** in the normal case, **keywords** when the embedding model is not available yet. At most eight results are returned, and at most two per documentation page, so one long page cannot fill the list. If you start a second search before the first answers, only the newest answer is displayed.

## Filter by app, audience and language

Three filters sit under the search field. Changing any of them repeats the current search at once with the new filters, as soon as a search has been made; there is no need to click **Search** again.

- **Apps**: one button per source that has indexed content (VisionNexus, each app, Docs Assistant), plus **All**. Select one or several to restrict the search to them; **All** clears the selection. A source whose pages are not indexed does not appear.
- **Audience**: **All**, **User** or **Developer**. Pages written for both audiences match **User** and **Developer**. Developer pages are the architecture, API reference and code map; user pages are the user guide, workflows and concepts; the README, configuration and troubleshooting pages are for both.
- **Language**: **FR**, **EN** or **Both**. **Both** is the default: every page is searched, whatever the language of the question or of the window. The results are shown in the language of your question: the service recognizes French or English from the words and accents of the question, and when a section exists in both languages it returns the version in that language, once. When the question does not decide, for example a single keyword such as `SAM2`, the language of the Documentation window decides. Choose **FR** or **EN** to search only the pages of that language; the results are then all displayed in it. Choose **Both** to come back to the default.

Switching the window language with its own **EN** and **FR** buttons does not turn **Both** into another choice, but it repeats your last search, because the window language is the fallback for questions that do not decide. A manual **FR** or **EN** choice goes back to **Both** at that moment.

## Read the result cards

Each result is a card that shows, from top to bottom:

- the icon and name of the source (for example **Annotation**), a badge **FR** or **EN** for the language of the section, and a small bar for the relevance: it shows how close the section is to your question, from 0 to 100 %, measured by the semantic model, and hovering it shows the percentage (**Relevance** followed by the value). The bar does not depend on the other results, so a weak best answer shows a short bar. When the relevance cannot be measured, for instance for a result found by keywords only, the bar is half full and the tooltip reads **Ranking (relevance not measured)**;
- the title of the documentation page, and under it the path of headings that leads to the section, for example the page name then the section name;
- an excerpt of the section, the sentence that best matches your words, with the matching words highlighted whatever their accents or capitals.

Click anywhere on the card to open the section. The window switches to the **Docs per app** tab, selects the source and the page, scrolls to the exact section and highlights it for a moment. If the section is in the other language than the window, the window language changes with it.

## Open the same section in the other language

Under a card, a link **Same section in French** or **Same section in English** appears when the section also exists in the other language, which is the case for every page of the documentation sets. Click it to open the twin section: the window switches language and scrolls to the matching heading. The link is what lets you read a French answer to an English question, or the reverse, without repeating the search.

Twin sections are matched by their position in the page, so a French section and its English twin always carry the same heading number. This is why both languages of a page must keep the same sequence of headings.

## Notices above the results: keyword-only, low confidence and indexing

Three notices can appear above the results. All are amber and none blocks the search.

The **keyword-only** notice appears when the embedding model is missing or still loading. The service then ranks by exact words only, and the meta line says **keywords**. The message comes from the service and explains the reason: model files not found (with the command that downloads them), model loading in the background, or no vector in the index yet. If the service gives none, the window shows **Keyword search only for now (the semantic model is loading).** The model takes about ten seconds to load after the service is switched on. A search made in that window falls in this mode, and the window repeats it by itself as soon as the model is ready, so the results switch to **semantic + keywords** without you searching again.

The **low-confidence** notice reads **No section really answers this question. These are the closest: rephrase with words from the interface (a button or option name) or widen the filters.** It appears when no passage looks close enough to your question, which is typical of a question that the documentation does not cover. The closest sections are still listed, but they are probably not what you need. Rephrase with the words the interface uses, such as the name of a button or an option, or widen the filters. A query of one or two exact words that the pages contain does not trigger it. The notice is not shown in keyword-only mode, where the confidence cannot be measured.

The **indexing** notice reads **Indexing in progress (n/N): search stays available, results may be incomplete.** It appears while the service reads the documentation, for instance right after a start. Pages not processed yet are missing from the results until it ends.

## Empty results and error messages

When nothing matches, the window shows **No results for "your question".** with advice: try fewer words or an exact word of the interface (a button or option name), then widen the filters to all apps, all audiences and both languages. A question of fewer than two characters is not sent: the window asks for at least two characters.

When the request fails, a red message replaces the results:

- **Service unreachable: it may have stopped, or the tunnel is down.**: the service or the SSH tunnel is gone. The status bar is refreshed and usually shows **Off** or **Error**.
- **The service is not responding (timed out).**: no answer after 10 seconds.
- **Request rejected: ...**: the question or a filter was refused, for example a question over 500 characters.
- **Service error: ...**: the service answered with an HTTP error, with its detail.
- **Unexpected error: ...**: anything else.

Causes and fixes are in [Troubleshooting](troubleshooting.md).

## Navigate between results and pages

A bar under the title of the Documentation window keeps the trail of what you looked at, so you can go back and forth between questions and pages without searching again.

- **Back** and **Forward** (or `Alt+Left` and `Alt+Right`, or the back and forward buttons of the mouse) move through the views you visited: each search with its results, and each page or section you opened. Going back to a search restores its results, its question and its filters without asking the service again.
- When a page was opened from a result card, the bar also shows **Back to results**, the position (**Result 2 / 8**), the title of the section, and **Previous result** and **Next result** (or `Alt+Up` and `Alt+Down`). They open the neighbor result of the same search, so you can read the best answers one after the other. Following a link inside a page, choosing another page or another app ends this mode.
- Under the question field, **Recent questions** lists your last eight questions. Click one to ask it again, or **Clear** to empty the list. The list is kept on this computer only.

A new question after going back removes the views that were ahead, as in a web browser.
