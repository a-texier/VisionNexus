*[Lire en francais](README.fr.md)*

# data_tuto -- sample data shared by the tutorials

The ONE demo-data location, at the root of Computer_Vision_App: every app
in the suite points here for its interactive tutorial, so there is only a
single copy of these images in the repository.

This folder ships with the code (it is NOT inside a user workspace): a new
user can follow any tutorial without providing anything.

## cars_10_frames

10 consecutive frames of a rainy nighttime road scene, extracted from the
`Hadsundvej-2` sequence (visible camera) of the public **AAU RainSnow**
dataset (Aalborg University, road traffic in rain and snow). Vehicles are
clearly visible, movement is slow: enough to demonstrate drawing a bbox and
then SAMURAI/SAM2 propagation over a few frames, and enough to populate a
small dataset to explore.

PNG format (original source, no recompression). Used by:

- **Annotation App** -- the "Template Cars Annotation" demo project created
  by the tutorial (`GET /api/samples/sequences`).
- **Dataset Explorer App** -- the tutorial's demo dataset
  (`GET /api/samples/datasets`).

Each backend resolves this path from the repository root, with an optional
override via the `CV_DATA_TUTO` environment variable. Do not rename
`cars_10_frames` without updating the `TEMPLATE_SAMPLE_ID` /
`TUTO_DATASET_ID` constants on the backend side.
