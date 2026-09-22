*[Read in English](README.md)*

# data_tuto -- donnees d'exemple partagees par les tutoriels

Zone UNIQUE de donnees de demonstration, a la racine de Computer_Vision_App :
toutes les apps de la suite pointent ici pour leur tutoriel interactif, il n'y
a donc qu'une seule copie de ces images dans le depot.

Ce dossier est livre avec le code (il n'est PAS dans un workspace utilisateur) :
un nouvel utilisateur peut suivre n'importe quel tutoriel sans rien fournir.

## cars_10_frames

10 frames consecutives d'une scene routiere de nuit sous la pluie, extraites de
la sequence `Hadsundvej-2` (camera visible) du jeu de donnees public
**AAU RainSnow** (Aalborg University, trafic routier par temps de pluie et de
neige). Vehicules nettement visibles, mouvement lent : de quoi montrer une bbox
puis la propagation SAMURAI/SAM2 sur quelques frames, et de quoi remplir un
petit dataset a explorer.

Format PNG (source d'origine, sans recompression). Utilise par :

- **Annotation App** -- projet demo "Template Cars Annotation" cree par le
  tutoriel (`GET /api/samples/sequences`).
- **Dataset Explorer App** -- dataset demo du tutoriel
  (`GET /api/samples/datasets`).

Chaque backend resout ce chemin a partir de la racine du depot, avec surcharge
possible par la variable d'environnement `CV_DATA_TUTO`. Ne pas renommer
`cars_10_frames` sans mettre a jour les constantes `TEMPLATE_SAMPLE_ID` /
`TUTO_DATASET_ID` cote backend.
