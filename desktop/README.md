# VisionNexusElectron — lanceur natif independant

Coquille Electron pour les apps de `Computer_Vision_App`. **Independante de
VisionNexus.exe** : zero code partage, zero reglages partages (decision
explicite). Les deux outils peuvent coexister sur le meme poste sans jamais
se marcher dessus.

---

## 1. Ce que fait exactement cet outil, etape par etape

```
1. Fenetre catalogue (ui/catalog.html)
   -> grille d'apps a gauche, Parametres TOUJOURS visibles a droite
   -> reglages stockes dans %APPDATA%\VisionNexusElectron\settings.json

2. Clic sur une app
   -> sshLauncher.ts spawn UNE des deux commandes suivantes :

      VM selectionnee :
        ssh -t <vm> "cd '<cvRoot>' && python launcher.py --app <id>
                     --user <user> --workspace '<ws>' --conda-path '<conda>'"

      Aucune VM (local) :
        cmd /c cd /d "<cvRoot>" && python launcher.py --app <id>
                     --user <user> --workspace "<ws>" --conda-path "<conda>"

   -> C'EST EXACTEMENT LA MEME COMMANDE que VisionNexus (AppRunner.cs,
      TryLaunch) construit. Meme launcher.py, meme _lib/launcher_engine.py,
      rien de different a ce niveau. Ce lanceur ne contourne ni ne remplace
      cette mecanique — il l'appelle depuis Node au lieu de C#.

3. Lecture des VRAIS ports sur la sortie de launcher.py
   -> _lib/launcher_engine.py alloue les ports dynamiquement
      (find_free_port(), voir section 3) et les annonce toujours sur stdout :
        [config] backend   = http://localhost:XXXX
        [config] frontend  = http://localhost:XXXX
   -> sshLauncher.ts lit ces deux lignes en direct (meme flux que le
      terminal montrerait). Tant qu'elles n'apparaissent pas, rien d'autre
      ne se passe.

4. Tunnel (VM uniquement)
   -> une fois les vrais ports connus, un SECOND ssh (pur tunnel,
      `ssh -N -o ExitOnForwardFailure=yes -L port:localhost:port ... <vm>`)
      est ouvert. Necessaire car on ne peut pas ajouter un -L a une connexion
      ssh deja etablie — impossible de tunneler des ports qu'on ne
      connaissait pas encore a l'ouverture de la 1ere connexion.
   -> `ExitOnForwardFailure=yes` n'est PAS cosmetique : si le port local est
      deja pris (tunnel orphelin d'une session precedente, autre instance de
      VisionNexus), ssh se contentait d'un "bind: Address already in use" sur
      stderr et continuait de tourner. Le port repondait quand meme — via
      l'ANCIEN tunnel — et l'onglet s'ouvrait sur un serveur qui n'etait pas
      celui de cette app, alors que la meme URL pointee directement sur la VM
      etait correcte. Le tunnel sort maintenant en erreur, `watchTunnel` la
      remonte dans le log de l'onglet et l'onglet est refuse avec le message
      plutot qu'ouvert sur n'importe quoi.

5. Attente que le serveur reponde (polling http://127.0.0.1:<port>)

6. Fenetre native dediee a l'app, chargee sur ce port.
   -> Pour Annotation App specifiquement : app-image:// (chemin SMB, voir
      section 4) au lieu du tunnel SSH pour les pixels. Les autres apps
      chargent leur frontend en HTTP simple par le tunnel, comme d'habitude.

7. Fermeture de la fenetre de l'app -> tue le(s) process ssh associes
   (lancement + tunnel). L'app distante s'arrete alors cote VM (le process
   `python launcher.py` reagit a la fermeture de la connexion ssh, meme
   mecanique que fermer le terminal de VisionNexus).
```

---

## 2. Difference avec VisionNexus — tableau

| | VisionNexus.exe | VisionNexusElectron.exe |
|---|---|---|
| Langage | C# / WPF | TypeScript / Electron |
| Declenche `launcher.py` | Oui | Oui (**meme commande**) |
| Sortie de launcher.py | Terminal visible (wt.exe/cmd.exe) | Log dans sa propre fenetre |
| Ouverture de l'app | **Manuelle** (vous, dans un navigateur) | **Automatique**, fenetre native |
| Tunnel SSH | A ouvrir a part, manuellement | Ouvert automatiquement (ports reels lus en direct) |
| Chemin des pixels (Annotation) | HTTP classique | SMB (voir section 4) si le partage repond, repli HTTP sinon |
| Reglages | `%APPDATA%\VisionNexus\user_settings.json` | `%APPDATA%\VisionNexusElectron\settings.json` (separe) |
| Prerequis machine cible (Windows) | .NET 9 Desktop Runtime | Aucun (runtime Electron/Node embarque dans l'exe) |

Aucun outil ne remplace l'autre. Meme resultat final (une app qui tourne,
accessible sur `localhost`), chemins differents pour y arriver.

---

## 3. Gestion des ports — oui, `_lib/launcher_engine.py` + `launcher.py`

Confirme en lisant `Computer_Vision_App/_lib/launcher_engine.py` :
`launch_app()` alloue les ports via `find_free_port(base, claimed)` (les
"claimed" venant du registre `.run/.instances.json`) **sauf** si
`--backend-port`/`--frontend-port` sont passes explicitement — et dans ce
cas-la, **aucune verification de collision n'est faite** (lignes 745-747).

**Consequence directe sur la conception de ce lanceur** : `catalog.ts`
contient bien une liste de ports *par defaut* (`backendPort`/`frontendPort`
par app), mais **ils ne sont jamais envoyes en argument** a `launcher.py`.
Ils servent uniquement d'affichage/reference dans le catalogue — le vrai
port utilise a l'execution est **toujours** celui que `launcher.py` annonce
lui-meme sur stdout (section 1, etape 3). Cette approche supporte
correctement plusieurs instances en parallele (chacune obtient un port
libre), exactement comme le fait deja `_lib/launcher_engine.py` pour
n'importe quel autre client (terminal manuel, VisionNexus, ou ce lanceur).

---

## 4. Electron — principe et pourquoi ce choix

**Principe** : Electron empaquette Chromium (le moteur du navigateur) + un
runtime Node.js dans un executable autonome. Le process "main" (Node, tout
ce qui est dans `src/`) a acces au systeme (fichiers, reseau, sous-process).
Le process "renderer" (ce qui s'affiche, ici le frontend React d'une app)
tourne dans une sandbox Chromium standard, sans acces systeme direct — la
posture de securite est la meme qu'un onglet de navigateur normal
(`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` partout
dans ce projet).

**Pourquoi Electron plutot que d'autres options :**
- **Charge le frontend React existant tel quel** — `main.ts` fait juste
  `loadURL('http://127.0.0.1:<port>')`, comme un onglet. Aucune reecriture
  du canvas Konva, des stores Zustand, de la timeline, des 4 onglets de
  tracking d'Annotation App.
- **Tauri** (Rust) n'apporterait rien ici : les deux seuls modules a vraie
  valeur d'ingenierie (`sshLauncher.ts` — decouverte dynamique de ports +
  tunnel ; `imageProtocol.ts` — protocole custom avec repli HTTP) sont deja
  ecrits et fonctionnels en TypeScript, le langage que l'equipe utilise deja
  cote frontend. Les reecrire en Rust n'ajoute aucune capacite, juste du
  travail de traduction, pour un gain de taille de binaire (~10-20 Mo au
  lieu de ~150 Mo) sans enjeu reel pour un outil interne.
- **Qt/PySide** (a la maniere de FrameViewer) demanderait soit d'embarquer
  `QWebEngineView` (= encore un Chromium complet, aucune economie), soit de
  reecrire entierement l'UI en widgets Qt — plusieurs mois, pour un
  frontend web qui fonctionne deja.

**L'avantage concret pour l'utilisateur** : une app "distante" (VM + tunnel
SSH) se comporte comme une app installee en local — fenetre dediee,
epinglable, icone propre — sans rien perdre de la richesse du frontend web
existant.

### Le chemin SMB (Annotation App uniquement, pour l'instant)

`app-image://frame/{id}?tier=preview|display|full` (protocole custom
enregistre dans `imageProtocol.ts`) :
1. Petit GET `/api/frames/{id}/image-path` sur le tunnel SSH deja ouvert —
   renvoie un chemin UNC (`\\<native_share_host>\...`), garanti deja genere sur
   disque cote serveur (meme logique de cache/LUT que l'endpoint HTTP
   normal, jamais dupliquee cote client).
2. Lecture directe du fichier via ce chemin UNC (`fs.readFile`), **hors**
   du tunnel SSH — c'est la tout le gain (voir
   `Annotation_App/cours_2_multiplexage_natif_simulation.html` pour le
   detail "pourquoi SMB gagne").
3. Repli automatique et silencieux sur l'endpoint HTTP normal si l'une des
   deux etapes echoue (partage non monte, permission refusee, backend
   injoignable) — jamais d'image cassee.

**A savoir : le serveur partage réseau natif cote VM n'est pas encore configure dans ce
depot.** Le code client suppose un partage deja accessible (comme celui
qu'utilise deja `/api/workspace/open` de VisionNexus pour "ouvrir dans
l'explorateur") ; si aucun partage ne repond, le repli HTTP prend le relais
automatiquement — la fonctionnalite marche toujours, juste sans le gain de
vitesse tant que le partage n'est pas en place cote VM.

---

## 5. Faut-il tout le depot, ou juste l'exe ?

**Sur le poste Windows qui LANCE les apps** : juste `VisionNexusElectron.exe`
(portable, `release/` apres `npm run dist:win`, ou fourni par
`package_cv_bundle.py --full`). Runtime Electron/Node deja embarque —
aucune installation de Node.js, aucun `npm install` necessaire sur cette
machine.

**Sur la cible lancee** (VM ou machine locale, selon `cvRoot`) : le depot
`Computer_Vision_App/` complet doit y exister (comme avec VisionNexus, cette
exigence est identique et inchangee) — `launcher.py`, `_lib/`, et l'app
elle-meme (backend Python + `frontend/` avec `node_modules`). Rien de
different par rapport a ce que VisionNexus attend deja.

**Pour DEVELOPPER ce lanceur** (modifier son code) : le depot source
(`desktop/src/`, `desktop/ui/`) + Node.js installe + `npm install`.

---

## 6. Modifications necessaires dans chaque app pour profiter de la coquille

**Sans rien changer** : toutes les apps du catalogue beneficient deja de
(1) la fenetre native automatique (plus besoin d'ouvrir un navigateur a la
main), (2) le tunnel SSH automatique avec ports reels, (3) le log de
lancement visible sans terminal externe.

**Le chemin SMB (le vrai gain de vitesse) est aujourd'hui specifique a
Annotation App.** Pour l'etendre a une autre app (ex. Dataset Explorer, si elle sert
aussi beaucoup d'images), il faudrait repliquer exactement le meme motif :

- **Backend de l'app** : un endpoint `GET /api/.../image-path` qui reprend
  la logique de resolution de fichier de l'endpoint image existant, mais
  renvoie `{"native_path": to_native_share_path(str(chemin))}` au lieu de streamer
  les octets (voir `Annotation_App/backend/models/routers/dataset.py`,
  fonctions `resolve_frame_image_path` / `frame_image_path`, et
  `Annotation_App/backend/utils/native_share.py` pour `to_native_share_path`, reutilisable
  tel quel par n'importe quelle app FastAPI du depot).
- **Frontend de l'app** : un helper equivalent a `frameImageUrl()`
  (`Annotation_App/frontend/src/pages/AnnotationPage.tsx`, lignes ~149-157)
  qui bascule vers `app-image://...` quand `window.__ANNOTATION_APP_NATIVE__`
  est vrai, sinon garde l'URL HTTP habituelle.
- **Coquille (`desktop/`)** : `imageProtocol.ts` est deja generique dans sa
  mecanique (appel `/image-path` + lecture SMB + repli HTTP) — il faudrait
  juste le rendre conscient du port backend de la nouvelle app (aujourd'hui
  il ne connait que celui d'Annotation App, cf. `annotationBackendPort` dans
  `main.ts`), ou en faire une variante parametree par app.

Sans ce travail, les autres apps du catalogue restent au meme niveau de
performance qu'aujourd'hui (HTTP par le tunnel) — mais gagnent quand meme
l'ouverture automatique en fenetre native, qui est deja un vrai confort par
rapport a VisionNexus.
