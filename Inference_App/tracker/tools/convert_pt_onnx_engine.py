#!/usr/bin/env python3
##########################################
# Project  : VisionNexus
# File     : convert_pt_onnx_engine.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : CLI tool to convert YOLO .pt models to ONNX and TensorRT .engine format.
##########################################

import argparse
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

# ## trtexec par défaut (Jetson Orin Nano JetPack) ##########################
_TRTEXEC_DEFAULT = Path("/usr/src/tensorrt/bin/trtexec")

# ## Exemples d'utilisation (affichés dans -h et rappelés en fin de fichier) #
_EXAMPLES = """\
Exemples d'utilisation
----------------------
  # 1) PT -> ONNX seulement
  python tools/convert_pt_onnx_engine.py weights/last.pt --onnx

  # 2) PT -> ONNX -> Engine, FP16 (defaut), builder auto-detecte
  python tools/convert_pt_onnx_engine.py weights/last.pt --engine

  # 3) ONNX -> Engine directement
  python tools/convert_pt_onnx_engine.py model.onnx

  # 4) CIBLE AIR-GAP sans trtexec : forcer l'API Python TensorRT
  python tools/convert_pt_onnx_engine.py model.onnx --builder python

  # 5) Depuis l'env standalone deploye (conda-pack), sur la cible :
  #    (l'engine DOIT etre reconstruit sur la cible : specifique GPU + version TRT)
  ./run.sh tools/convert_pt_onnx_engine.py visionnexus_inference/weights/last.pt --engine --builder python

  # 6) FP32 (desactive FP16), workspace 8 Gio
  python tools/convert_pt_onnx_engine.py model.onnx --no-fp16 --workspace 8192

  # 7) trtexec explicite (Jetson / machine avec TensorRT systeme)
  python tools/convert_pt_onnx_engine.py model.onnx --builder trtexec \\
      --trtexec /usr/src/tensorrt/bin/trtexec
"""

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("convert")


# ###########################################################################
# PT -> ONNX  (via ultralytics)
# ###########################################################################


def pt_to_onnx(
    pt_path: Path,
    onnx_path: Path,
    imgsz: int = 640,
    batch: int = 1,
    opset: int = 17,
    half: bool = False,
    simplify: bool = True,
    verbose: bool = False,
) -> Path:
    """
    Exporte un modèle YOLO .pt vers .onnx avec ultralytics.
    Retourne le chemin final du .onnx.
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        log.error("ultralytics non trouvé -> pip install ultralytics")
        sys.exit(1)

    log.info("PT -> ONNX  |  %s", pt_path.name)
    log.info(
        "  imgsz=%d  batch=%d  opset=%d  half=%s  simplify=%s", imgsz, batch, opset, half, simplify
    )

    model = YOLO(str(pt_path))

    # ultralytics dépose le .onnx dans le même dossier que le .pt
    exported_raw = model.export(
        format="onnx",
        imgsz=imgsz,
        batch=batch,
        opset=opset,
        half=half,
        simplify=simplify,
        verbose=verbose,
        dynamic=False,
    )

    exported = Path(str(exported_raw))
    if not exported.exists():
        log.error("ultralytics n'a pas produit de fichier : %s", exported)
        sys.exit(1)

    if exported.resolve() != onnx_path.resolve():
        log.info("  déplacement  %s  ->  %s", exported.name, onnx_path)
        shutil.move(str(exported), str(onnx_path))

    log.info("ONNX produit : %s  (%.1f Mo)", onnx_path, onnx_path.stat().st_size / 1e6)
    return onnx_path


# ###########################################################################
# ONNX -> Engine  (via trtexec)
# ###########################################################################


def _workspace_flag(trtexec: Path, workspace_mib: int) -> list:
    """
    TRT 8.4+ supporte --memPoolSize=workspace:N (recommandé, sans warning).
    Versions plus anciennes : --workspace=N.
    Détection par grep dans --help plutôt que par parsing de version.
    """
    try:
        help_txt = subprocess.check_output(
            [str(trtexec), "--help"], stderr=subprocess.STDOUT, text=True, timeout=10
        )
        if "memPoolSize" in help_txt:
            return [f"--memPoolSize=workspace:{workspace_mib}"]
    except Exception:
        pass
    return [f"--workspace={workspace_mib}"]


def onnx_to_engine(
    onnx_path: Path,
    engine_path: Path,
    fp16: bool = True,
    int8: bool = False,
    workspace_mib: int = 4096,
    trtexec: Path = _TRTEXEC_DEFAULT,
    verbose: bool = False,
) -> Path:
    """
    Convertit un .onnx en TensorRT .engine via trtexec.
    Retourne le chemin final du .engine.
    """
    if not trtexec.exists():
        log.error("trtexec introuvable : %s", trtexec)
        log.error(
            "Vérifiez que TensorRT est installé (/usr/src/tensorrt/) ou passez --trtexec <chemin>"
        )
        sys.exit(1)

    log.info("ONNX -> Engine  |  %s", onnx_path.name)
    log.info("  fp16=%s  int8=%s  workspace=%d MiB", fp16, int8, workspace_mib)

    cmd = [
        str(trtexec),
        f"--onnx={onnx_path}",
        f"--saveEngine={engine_path}",
    ]

    cmd += _workspace_flag(trtexec, workspace_mib)

    if fp16:
        cmd.append("--fp16")
    if int8:
        cmd.append("--int8")
        log.warning(
            "INT8 activé mais aucune donnée de calibration fournie - "
            "résultats potentiellement dégradés."
        )
    if verbose:
        cmd.append("--verbose")

    log.info("Commande : %s", " ".join(cmd))

    # ## Environnement ########################################################
    # Hérite explicitement de l'env courant (CUDA_HOME, LD_LIBRARY_PATH, etc.)
    # et supprime CUDA_VISIBLE_DEVICES="" / "-1" qui bloque la détection GPU.
    env = os.environ.copy()
    cuda_vis = env.get("CUDA_VISIBLE_DEVICES")
    if cuda_vis in ("", "-1"):
        env.pop("CUDA_VISIBLE_DEVICES")
        log.warning(
            "CUDA_VISIBLE_DEVICES='%s' supprimé pour laisser trtexec détecter le GPU", cuda_vis
        )

    # ## Exécution ############################################################
    # stderr n'est jamais capturé : trtexec écrit directement sur le terminal.
    # Cela évite que la création du pipe stdin/stdout/stderr (capture_output)
    # interfère avec l'initialisation CUDA sur Jetson iGPU.
    result = subprocess.run(
        cmd,
        stdout=subprocess.DEVNULL if not verbose else None,
        stderr=None,  # passthrough -> toujours visible, même en mode non-verbose
        env=env,
    )

    if result.returncode != 0:
        log.error("trtexec a échoué (code %d)", result.returncode)
        if result.returncode == -6:  # SIGABRT : typique d'un échec CUDA init
            log.error(
                "Signal SIGABRT = échec d'initialisation CUDA.\n"
                "  Solution : lancez la commande directement dans votre terminal :\n"
                "    %s",
                " ".join(cmd),
            )
        sys.exit(result.returncode)

    if not engine_path.exists():
        log.error("trtexec a réussi mais le fichier engine est absent : %s", engine_path)
        sys.exit(1)

    log.info("Engine produit : %s  (%.1f Mo)", engine_path, engine_path.stat().st_size / 1e6)
    return engine_path


# ###########################################################################
# ONNX -> Engine  (via l'API Python TensorRT - AUCUN binaire externe requis)
# ###########################################################################


def onnx_to_engine_python(
    onnx_path: Path,
    engine_path: Path,
    fp16: bool = True,
    int8: bool = False,
    workspace_mib: int = 4096,
    verbose: bool = False,
) -> Path:
    """
    Convertit un .onnx en TensorRT .engine avec les bindings Python
    (tensorrt.Builder + OnnxParser). N'a besoin QUE du wheel `tensorrt`, pas du
    binaire trtexec : c'est le chemin a utiliser sur la cible air-gap ou seul
    l'environnement conda-pack (qui embarque tensorrt) est disponible.

    L'engine produit est specifique au GPU + a la version de TensorRT : il doit
    donc etre (re)construit sur la machine cible, pas copie depuis le build.
    Retourne le chemin final du .engine.
    """
    try:
        import tensorrt as trt
    except ImportError:
        log.error(
            "Bindings Python TensorRT introuvables (import tensorrt).\n"
            "  Sur la cible standalone : lancer via ./run.sh (env conda-pack).\n"
            "  Ailleurs : pip install tensorrt"
        )
        sys.exit(1)

    log.info("ONNX -> Engine (API Python TensorRT %s)  |  %s", trt.__version__, onnx_path.name)
    log.info("  fp16=%s  int8=%s  workspace=%d MiB", fp16, int8, workspace_mib)

    # CUDA_VISIBLE_DEVICES="" / "-1" masque le GPU -> le builder echoue. On le
    # neutralise dans le process courant avant toute initialisation CUDA.
    cuda_vis = os.environ.get("CUDA_VISIBLE_DEVICES")
    if cuda_vis in ("", "-1"):
        os.environ.pop("CUDA_VISIBLE_DEVICES", None)
        log.warning("CUDA_VISIBLE_DEVICES='%s' supprime pour laisser TensorRT voir le GPU", cuda_vis)

    trt_logger = trt.Logger(trt.Logger.VERBOSE if verbose else trt.Logger.WARNING)
    builder = trt.Builder(trt_logger)

    # EXPLICIT_BATCH obligatoire pour les modeles ONNX (ultralytics exporte ainsi).
    network_flags = 1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH)
    network = builder.create_network(network_flags)
    parser = trt.OnnxParser(network, trt_logger)

    onnx_bytes = Path(onnx_path).read_bytes()
    if not parser.parse(onnx_bytes):
        log.error("Echec du parsing ONNX (%d erreur(s)) :", parser.num_errors)
        for i in range(parser.num_errors):
            log.error("  [%d] %s", i, parser.get_error(i))
        sys.exit(1)

    config = builder.create_builder_config()

    # Workspace : API TRT 8.4+ (set_memory_pool_limit) avec repli sur l'ancienne.
    ws_bytes = int(workspace_mib) * 1024 * 1024
    if hasattr(config, "set_memory_pool_limit"):
        config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, ws_bytes)
    else:  # TRT < 8.4
        config.max_workspace_size = ws_bytes

    if fp16:
        if builder.platform_has_fast_fp16:
            config.set_flag(trt.BuilderFlag.FP16)
        else:
            log.warning("FP16 demande mais non supporte par ce GPU - ignore")
    if int8:
        if builder.platform_has_fast_int8:
            config.set_flag(trt.BuilderFlag.INT8)
            log.warning(
                "INT8 active sans calibrateur - precision potentiellement degradee."
            )
        else:
            log.warning("INT8 demande mais non supporte par ce GPU - ignore")

    log.info("Construction de l'engine en cours (peut prendre plusieurs minutes)...")

    # TRT 8.0+ : build_serialized_network (renvoie un IHostMemory serialisable
    # directement). Repli sur build_engine().serialize() pour les versions < 8.0.
    if hasattr(builder, "build_serialized_network"):
        serialized = builder.build_serialized_network(network, config)
        if serialized is None:
            log.error("build_serialized_network a renvoye None : construction echouee.")
            sys.exit(1)
        Path(engine_path).write_bytes(bytes(serialized))
    else:  # TRT < 8.0
        engine = builder.build_engine(network, config)
        if engine is None:
            log.error("build_engine a renvoye None : construction echouee.")
            sys.exit(1)
        Path(engine_path).write_bytes(bytes(engine.serialize()))

    if not engine_path.exists():
        log.error("Construction reussie mais fichier engine absent : %s", engine_path)
        sys.exit(1)

    log.info("Engine produit : %s  (%.1f Mo)", engine_path, engine_path.stat().st_size / 1e6)
    return engine_path


def _build_engine(onnx_path: Path, engine_path: Path, args, use_fp16: bool) -> Path:
    """Dispatche vers trtexec ou l'API Python selon --builder.

    'auto' : trtexec si le binaire existe, sinon repli sur l'API Python. Sur la
    cible air-gap (pas de trtexec) 'auto' bascule donc seul sur Python.
    """
    builder_mode = args.builder
    if builder_mode == "auto":
        builder_mode = "trtexec" if Path(args.trtexec).exists() else "python"
        log.info("Builder auto-detecte : %s", builder_mode)

    if builder_mode == "python":
        return onnx_to_engine_python(
            onnx_path=onnx_path,
            engine_path=engine_path,
            fp16=use_fp16,
            int8=args.int8,
            workspace_mib=args.workspace,
            verbose=args.verbose,
        )
    return onnx_to_engine(
        onnx_path=onnx_path,
        engine_path=engine_path,
        fp16=use_fp16,
        int8=args.int8,
        workspace_mib=args.workspace,
        trtexec=args.trtexec,
        verbose=args.verbose,
    )


# ###########################################################################
# CLI
# ###########################################################################


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Convertit un modèle YOLO .pt -> .onnx et/ou TensorRT .engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=_EXAMPLES,
    )

    p.add_argument("input", type=Path, help="Modèle source : .pt ou .onnx")

    # ## mode de conversion ##################################################
    mode = p.add_argument_group("Mode de conversion (obligatoire pour .pt)")
    mx = mode.add_mutually_exclusive_group()
    mx.add_argument("--onnx", action="store_true", help=".pt -> .onnx uniquement (stop)")
    mx.add_argument(
        "--engine", action="store_true", help=".pt -> .onnx -> .engine  (les deux étapes)"
    )

    # ## chemin de sortie ####################################################
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Chemin de sortie (sans extension). Défaut : même répertoire et même stem que l'input",
    )

    # ## options ONNX ########################################################
    onnx_g = p.add_argument_group("Options ONNX (export .pt -> .onnx)")
    onnx_g.add_argument("--imgsz", type=int, default=640, help="Taille image (défaut : 640)")
    onnx_g.add_argument("--batch", type=int, default=1, help="Taille de batch (défaut : 1)")
    onnx_g.add_argument("--opset", type=int, default=17, help="Version opset ONNX (défaut : 17)")
    onnx_g.add_argument(
        "--half", action="store_true", help="Exporte les poids en FP16 dans le .onnx"
    )
    onnx_g.add_argument("--no-simplify", action="store_true", help="Désactive onnx-simplifier")

    # ## options TensorRT ####################################################
    trt_g = p.add_argument_group("Options TensorRT (construction .engine)")
    trt_g.add_argument(
        "--fp16", action="store_true", default=True, help="Précision FP16 TRT (défaut : activé)"
    )
    trt_g.add_argument("--no-fp16", action="store_true", help="Désactive FP16 TRT")
    trt_g.add_argument(
        "--int8", action="store_true", help="Précision INT8 TRT (nécessite données de calibration)"
    )
    trt_g.add_argument(
        "--workspace", type=int, default=4096, help="Mémoire workspace TRT en MiB (défaut : 4096)"
    )
    trt_g.add_argument(
        "--builder",
        choices=("auto", "trtexec", "python"),
        default="auto",
        help=(
            "Moteur de construction de l'engine. 'auto' (defaut) : trtexec si present, "
            "sinon API Python. 'python' : bindings tensorrt.Builder, aucun binaire externe "
            "(a utiliser sur la cible air-gap). 'trtexec' : force le binaire."
        ),
    )
    trt_g.add_argument(
        "--trtexec",
        type=Path,
        default=_TRTEXEC_DEFAULT,
        help=f"Chemin vers trtexec (défaut : {_TRTEXEC_DEFAULT})",
    )

    # ## divers ##############################################################
    p.add_argument(
        "--verbose", action="store_true", help="Affiche la sortie complète ultralytics / trtexec"
    )

    return p.parse_args()


# ###########################################################################
# Main
# ###########################################################################


def main():
    args = parse_args()

    input_path: Path = args.input.resolve()
    suffix = input_path.suffix.lower()

    # ## validation du fichier source ########################################
    if not input_path.exists():
        log.error("Fichier introuvable : %s", input_path)
        sys.exit(1)

    if suffix not in (".pt", ".onnx"):
        log.error("Extension non supportée : %s  (attendu .pt ou .onnx)", suffix)
        sys.exit(1)

    # ## base de sortie ######################################################
    out_base: Path = args.out.resolve() if args.out else input_path.parent / input_path.stem

    onnx_path: Path = out_base.with_suffix(".onnx")
    engine_path: Path = out_base.with_suffix(".engine")

    # ## logique de conversion ###############################################
    if suffix == ".pt":
        if not args.onnx and not args.engine:
            log.error("Input .pt : précisez --onnx (PT->ONNX) ou --engine (PT->ONNX->Engine)")
            sys.exit(1)

        use_fp16 = args.fp16 and not args.no_fp16

        pt_to_onnx(
            pt_path=input_path,
            onnx_path=onnx_path,
            imgsz=args.imgsz,
            batch=args.batch,
            opset=args.opset,
            half=args.half,
            simplify=not args.no_simplify,
            verbose=args.verbose,
        )

        if args.engine:
            _build_engine(onnx_path, engine_path, args, use_fp16)

    else:  # suffix == ".onnx"
        if args.onnx:
            log.error("--onnx inutile : l'input est déjà un .onnx")
            sys.exit(1)

        # Si l'input .onnx n'est pas au chemin de sortie voulu, on le copie
        if input_path.resolve() != onnx_path.resolve():
            log.info("Copie ONNX source -> %s", onnx_path)
            shutil.copy2(str(input_path), str(onnx_path))

        use_fp16 = args.fp16 and not args.no_fp16

        _build_engine(onnx_path, engine_path, args, use_fp16)

    log.info("#" * 60)
    if suffix == ".pt" and args.onnx:
        log.info("Terminé - ONNX : %s", onnx_path)
    elif engine_path.exists():
        log.info("Terminé - Engine : %s", engine_path)
        if onnx_path.exists():
            log.info("          ONNX   : %s", onnx_path)


if __name__ == "__main__":
    main()

# ###########################################################################
# EXEMPLES D'UTILISATION  (reference rapide en fin de fichier)
# ###########################################################################
#   # PT -> ONNX seulement
#   python tools/convert_pt_onnx_engine.py weights/last.pt --onnx
#
#   # PT -> ONNX -> Engine (FP16, builder auto)
#   python tools/convert_pt_onnx_engine.py weights/last.pt --engine
#
#   # ONNX -> Engine directement
#   python tools/convert_pt_onnx_engine.py model.onnx
#
#   # CIBLE AIR-GAP sans trtexec : API Python TensorRT (bindings du wheel)
#   python tools/convert_pt_onnx_engine.py model.onnx --builder python
#
#   # Sur la cible standalone (env conda-pack), via run.sh :
#   ./run.sh tools/convert_pt_onnx_engine.py visionnexus_inference/weights/last.pt --engine --builder python
#
#   # FP32 + workspace 8 Gio
#   python tools/convert_pt_onnx_engine.py model.onnx --no-fp16 --workspace 8192
#
#   # trtexec explicite (Jetson / TensorRT systeme)
#   python tools/convert_pt_onnx_engine.py model.onnx --builder trtexec \
#       --trtexec /usr/src/tensorrt/bin/trtexec
# ###########################################################################
