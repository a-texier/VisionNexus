*[Read in English](README.md)*

# Lanceur de bureau VisionNexus

Programme Electron qui lance les applications de la suite en local ou sur une VM Linux via SSH, ouvre chacune dans un onglet, et héberge la fenêtre Documentation. Il pilote le lanceur Python `launcher.py` à la racine du dépôt et ne contient aucune logique d'application.

```bash
npm ci          # installe les dépendances
npm run build   # compile src/*.ts dans dist/
npm test        # tests unitaires et vérification des ancres de documentation
npm start       # construit, puis lance en mode développement
```

Dossiers : `src/` (processus main, TypeScript), `ui/` (pages du catalogue et de la documentation, HTML et JavaScript simples), `assets/` (icônes), `scripts/` (empaquetage de la documentation et vérifications).

Tout le reste est documenté dans les pages de la suite, aussi disponibles dans la fenêtre **Documentation** sous **VisionNexus** :

- [Guide utilisateur](../docs/user-guide.fr.md) : la fenêtre écran par écran.
- [Configuration](../docs/configuration.fr.md) : prérequis, réglages, ports, construction et empaquetage (`npm run dist:win`, `npm run dist:linux`).
- [Architecture](../docs/architecture.fr.md) et [référence API](../docs/api-reference.fr.md) : modèle de processus, flux de lancement, canaux IPC.
- [Carte du code](../docs/code-map.fr.md) : où modifier quoi, et comment ajouter une app à la suite.
