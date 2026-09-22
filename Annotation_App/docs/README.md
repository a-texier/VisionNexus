*[Lire en francais](README.fr.md)*

# Documentation - Annotation App

Topic index. For launch commands and invariants to respect, see the
[README.md](../README.md) at the app root (Launching and Preserved Invariants sections).

- [architecture.md](architecture.md): backend structure (routers, services, models),
  frontend structure (stores, canvas, tracking), and main data flows.
- [code-navigation.md](code-navigation.md): where to start reading the code, who talks to
  whom, and how to debug offline (DB, network, common errors).
- [algorithmes.md](algorithmes.md): how each tracking algorithm actually works
  (SAMURAI, SAM2, Grounding DINO, SAM3, custom YOLO, homography, optical flow), effective
  parameters, and assumptions of each.
- [explained_loading_image.md](explained_loading_image.md): what happens in RAM/disk when
  a frame is loaded, during video extraction, and on upload (with the JPEG vs PNG trade-offs).
- [optimisation_http_smb.md](optimisation_http_smb.md): HTTP/SMB transport optimizations
  for remote usage (SSH), measurements and fixes.
- [SETUP_STEP_BY_STEP.md](SETUP_STEP_BY_STEP.md): full step-by-step installation (offline,
  Windows, machines with no internet).
