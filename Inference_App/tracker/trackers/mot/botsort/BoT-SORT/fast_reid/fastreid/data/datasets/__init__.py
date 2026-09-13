# encoding: utf-8
"""
@author:  liaoxingyu
@contact: sherlockliao01@gmail.com
"""

from ...utils.registry import Registry

DATASET_REGISTRY = Registry("DATASET")
DATASET_REGISTRY.__doc__ = """
Registry for datasets
It must returns an instance of :class:`Backbone`.
"""

# Person re-id datasets
from .AirportALERT import AirportALERT
from .caviara import CAVIARa
from .cuhk03 import CUHK03
from .cuhk_sysu import cuhkSYSU
from .dukemtmcreid import DukeMTMC
from .grid import GRID
from .iLIDS import iLIDS
from .lpw import LPW
from .market1501 import Market1501
from .mot17 import MOT17
from .mot20 import MOT20
from .msmt17 import MSMT17
from .pes3d import PeS3D
from .pku import PKU
from .prai import PRAI
from .prid import PRID
from .saivt import SAIVT
from .sensereid import SenseReID
from .shinpuhkan import Shinpuhkan
from .sysu_mm import SYSU_mm
from .thermalworld import Thermalworld
from .vehicleid import LargeVehicleID, MediumVehicleID, SmallVehicleID, VehicleID

# Vehicle re-id datasets
from .veri import VeRi
from .veriwild import LargeVeRiWild, MediumVeRiWild, SmallVeRiWild, VeRiWild
from .viper import VIPeR
from .wildtracker import WildTrackCrop

__all__ = [k for k in globals().keys() if "builtin" not in k and not k.startswith("_")]
