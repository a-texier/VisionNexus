*[Read in English](README.md)*

# Docs Assistant

Service backend seul (FastAPI, sans frontend) qui indexe la documentation produit de la suite en français et en anglais et répond à une question avec les passages les plus pertinents. Il ne génère jamais de texte. C'est la recherche qui se trouve derrière l'onglet **Demander a la doc** de la fenêtre Documentation de VisionNexus, et il tourne comme une ressource de calcul démarrée depuis le catalogue de VisionNexus.

```bash
python launcher.py --app docs --workspace <workspace> --user <utilisateur>   # depuis la racine du dépôt
python scripts/download_model.py                                             # une fois, depuis Docs_Assistant_App/
python -m pytest                                                             # tests rapides, sans poids
```

La documentation complète est dans [docs/](docs/README.fr.md) : guide utilisateur, procédures, concepts, configuration, dépannage, architecture, référence API et carte du code. Elle est aussi disponible dans la fenêtre **Documentation** de VisionNexus sous **Docs Assistant**.
