# Tracker SOT Dummy

**Niveau 0** - aucun overhead, aucun GPU.

## Clé CLI
`--tracker-sot dummy`  (défaut)

## Rôle
Valider la machine d'états MOT↔SOT et le parsing des clics sans toucher au GPU.
La "cible" SOT est simplement la track MOT dont la bbox contient le point cliqué.
Affichage : couleur spéciale, label "TARGET", épaisseur x2.

## Transition SOT->MOT
Quand la track MOT cible disparaît du MOT (ID absent depuis N frames).
N = `sot_loss_threshold` dans config/paths.yaml (défaut 10).
