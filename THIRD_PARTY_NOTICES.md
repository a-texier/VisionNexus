*[Lire en francais](THIRD_PARTY_NOTICES.fr.md)*

# Third-party notices

The root `LICENSE` applies to original Computer_Vision_App code only. A file or
directory carrying its own `LICENSE`, `COPYING` or `NOTICE` remains governed by
that third-party license. Nothing in the root license or a commercial agreement
for Computer_Vision_App replaces those terms.

The repository includes or integrates components such as SAM2, SAMURAI, SAM3,
YOLOX, ByteTrack, XFeat, LightGlue, MiDaS,
Depth Anything, DINOv2, DSINE, FAISS, PyTorch and their transitive
dependencies. This list is an orientation, not a complete software bill of
materials.

SAM3 (Annotation_App) is distributed under Meta's proprietary "SAM License",
not an OSI-approved open source license. It permits redistribution and
commercial use, but carries its own conditions (export/trade-control
compliance, a ban on military use, a patent-litigation termination clause)
that travel with it regardless of the license chosen for the rest of this
repository. Keep its own LICENSE file alongside it; do not represent it as
covered by this project's AGPL-3.0 license.

College London research license -- not open source, and incompatible with any
excluded from the public GitHub build for this reason.

Before a public or commercial release:

1. Preserve all third-party license and notice files.
2. Generate an SBOM and review every direct and vendored dependency.
3. Review model-weight and dataset terms separately from source-code licenses.
4. Do not represent third-party code as code owned by the project copyright
   holder.
5. Obtain separate commercial rights where a dependency's open-source terms
   are incompatible with the intended proprietary deployment.
