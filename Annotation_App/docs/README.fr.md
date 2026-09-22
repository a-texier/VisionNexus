*[Read in English](README.md)*

# Documentation - Annotation App

Index thematique. Pour les commandes de lancement et les invariants a respecter, voir le
[README.md](../README.md) a la racine de l'app (sections Lancement et Invariants Conserves).

- [architecture.md](architecture.md) : structure du backend (routers, services, models),
  structure du frontend (stores, canvas, tracking), et flux de donnees principaux.
- [code-navigation.md](code-navigation.md) : par ou commencer a lire le code, qui parle avec
  qui, et comment debugger hors-ligne (DB, reseau, erreurs courantes).
- [algorithmes.md](algorithmes.md) : fonctionnement reel de chaque algorithme de tracking
  (SAMURAI, SAM2, Grounding DINO, SAM3, YOLO custom, homographie, flux optique), parametres
  effectifs et hypotheses de chacun.
- [explained_loading_image.md](explained_loading_image.md) : ce qui se passe en RAM/disque au
  chargement d'une frame, a l'extraction video et a l'upload (avec les compromis JPEG vs PNG).
- [optimisation_http_smb.md](optimisation_http_smb.md) : optimisations de transport HTTP/SMB
  en usage distant (SSH), mesures et correctifs.
- [SETUP_STEP_BY_STEP.md](SETUP_STEP_BY_STEP.md) : installation complete pas-a-pas (offline,
  Windows, machines sans internet).
