*[Lire en francais](README.fr.md)*

# VisionNexus desktop launcher

Electron program that launches the applications of the suite locally or on a Linux VM over SSH, opens each one in a tab, and hosts the Documentation window. It drives the Python launcher `launcher.py` at the repository root and contains no application logic.

```bash
npm ci          # install the dependencies
npm run build   # compile src/*.ts into dist/
npm test        # unit tests and documentation anchor check
npm start       # build, then run in development mode
```

Folders: `src/` (main process, TypeScript), `ui/` (catalog and documentation pages, plain HTML and JavaScript), `assets/` (icons), `scripts/` (documentation bundling and checks).

Everything else is documented in the suite pages, also available in the **Documentation** window under **VisionNexus**:

- [User guide](../docs/user-guide.md): the window screen by screen.
- [Configuration](../docs/configuration.md): prerequisites, settings, ports, building and packaging (`npm run dist:win`, `npm run dist:linux`).
- [Architecture](../docs/architecture.md) and [API reference](../docs/api-reference.md): process model, launch flow, IPC channels.
- [Code map](../docs/code-map.md): where to change what, and how to add an app to the suite.
