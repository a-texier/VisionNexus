*[Lire en francais](README.fr.md)*

# Docs Assistant

Backend-only service (FastAPI, no frontend) that indexes the product documentation of the suite in French and English and answers a question with the most relevant passages. It never generates text. It is the search behind the **Ask the docs** tab of the VisionNexus Documentation window, and runs as a compute resource started from the VisionNexus catalog.

```bash
python launcher.py --app docs --workspace <workspace> --user <user>      # from the repository root
python scripts/download_model.py                                         # once, from Docs_Assistant_App/
python -m pytest                                                         # fast tests, no weights needed
```

The full documentation is in [docs/](docs/README.md): user guide, workflows, concepts, configuration, troubleshooting, architecture, API reference and code map. It is also available in the VisionNexus **Documentation** window under **Docs Assistant**.
