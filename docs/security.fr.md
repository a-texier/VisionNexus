---
app: suite
doc_type: security
audience: both
lang: fr
title: Sécurité
order: 55
tags: [sécurité, jeton de session, boucle locale, tunnel ssh, cookie, vm multi-utilisateur, ports]
sources: [_lib/session_auth.py, _lib/launcher_engine.py, launcher.py, desktop/src/sessionTokens.ts, desktop/src/sshLauncher.ts, desktop/src/main.ts, desktop/src/imageProtocol.ts, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/backend/api/launcher_api.py]
---

# Sécurité

## Qui peut atteindre une application lancée

Une application lancée, ce sont deux serveurs : un backend FastAPI, qui lit et écrit vos fichiers, et un frontend Vite, qui sert l'interface. Tous deux écoutent sur un port TCP de la machine qui les exécute : votre poste Windows en mode local, ou la VM Linux en mode VM. Trois groupes de personnes peuvent tenter d'atteindre ces ports.

- **N'importe qui sur le réseau de l'entreprise.** Un serveur qui écoute sur toutes les interfaces réseau (`0.0.0.0`) répond sur l'adresse réseau de la machine, par exemple `http://<IP de la VM>:<port>`. Aucun compte ni mot de passe n'est nécessaire : un navigateur suffit.
- **Les autres comptes de la même VM.** L'adresse de boucle locale `127.0.0.1` est commune à tous les comptes d'une machine Linux. Linux ne vérifie pas quel utilisateur ouvre une connexion TCP : tout compte connecté à la VM peut lancer `curl http://127.0.0.1:<port>` ou ouvrir son propre tunnel `ssh -L` vers votre port.
- **Vous**, par l'onglet VisionNexus ou un navigateur sur votre poste.

Le backend tourne sous votre compte Unix. Qui l'atteint lit vos fichiers avec vos droits. La suite ferme donc les deux premiers chemins avec trois couches : des serveurs liés à la boucle locale, des tunnels SSH pour transporter le trafic, et un jeton de session par instance d'application. Les sections suivantes décrivent chaque couche, et la section [Ce que ces protections ne couvrent pas](#ce-que-ces-protections-ne-couvrent-pas) en donne les limites.

## Serveurs liés à la boucle locale

Chaque backend (uvicorn) et chaque frontend (Vite) de la suite n'écoute que sur `127.0.0.1`. Rien n'écoute sur l'adresse réseau de la machine : une requête vers `http://<IP de la VM>:<port>` depuis un autre ordinateur est refusée avant d'atteindre la moindre application.

Cela vaut pour toutes les façons de démarrer une application :

- le lanceur global (`launcher.py`, `_lib/launcher_engine.py`), utilisé par VisionNexus ;
- les lanceurs propres à chaque application (`<App>/launcher.py`) et les scripts `start.sh` ;
- les sous-applications démarrées par l'Orchestrator (`Orchestrator_App/backend/core/app_launcher.py`), qui passent `--host 127.0.0.1` à Vite ;
- un `npm run dev` manuel, car chaque `vite.config.ts` lit l'hôte dans `CV_BIND_HOST`, avec `127.0.0.1` par défaut.

VisionNexus refuse aussi d'envoyer au navigateur système un lien qui pointe vers l'adresse réseau de la VM. Un lien comme `http://<IP de la VM>:<port>` ouvert depuis un onglet est réécrit en `http://127.0.0.1:<port>` et dirigé vers l'onglet correspondant, car le seul chemin légitime vers une application passe par le tunnel.

La liaison à la boucle locale ferme le réseau. Elle ne sépare pas les comptes d'une VM partagée : c'est le rôle du jeton de session décrit dans [Jeton de session de chaque instance d'application](#jeton-de-session-de-chaque-instance-dapplication).

## Tunnels SSH entre le poste et la VM

En mode VM, l'application tourne sur la VM et l'interface s'affiche sur votre poste. VisionNexus relie les deux avec SSH, qui vous authentifie par votre clé et chiffre tout ce qu'il transporte.

1. VisionNexus lance `ssh <vm> python launcher.py --app <id> ...`. Le lanceur démarre le backend et le frontend sur la VM, sous votre compte, liés à `127.0.0.1`.
2. Une fois les ports annoncés par le lanceur, VisionNexus ouvre une deuxième connexion, `ssh -N -L <port>:localhost:<port> <vm>`, pour le port du backend et celui du frontend.
3. Sur votre poste, `ssh.exe` écoute sur `127.0.0.1:<port>`, que seul votre poste peut joindre. L'onglet charge `http://127.0.0.1:<port frontend>`.
4. Chaque requête entre dans le tunnel sur votre poste, traverse le réseau chiffrée sur le port 22, et le serveur SSH de la VM la remet à `localhost:<port>` sur la VM.

Le tunnel protège le trajet entre votre poste et la VM : personne sur le réseau ne peut lire ni modifier le trafic, et personne ne peut ouvrir de tunnel sans compte ni clé sur la VM. Il ne protège pas l'extrémité du trajet. Sur la VM, l'application écoute sur l'adresse de boucle locale partagée, où tout autre compte de la VM peut se connecter. Il en va de même pour la redirection de port d'un IDE par SSH : elle protège le transport, pas l'application vers laquelle elle redirige.

## Jeton de session de chaque instance d'application

À chaque démarrage d'une application, son lanceur tire un secret aléatoire de 43 caractères, le jeton de session. Le backend refuse toute requête qui ne le présente pas. Un autre compte de la VM qui atteint votre port reçoit `401 Unauthorized` et aucun fichier n'est ouvert.

Le jeton appartient à une seule instance : un nouveau lancement tire toujours un nouveau jeton, et le jeton devient inutilisable à l'arrêt de l'application. Il ne dérive ni de votre nom d'utilisateur, ni du port, ni du workspace, ni d'aucun mot de passe.

La protection est écrite une seule fois, dans `_lib/session_auth.py`, et installée par chaque backend de la suite (Annotation, Dataset Explorer, Training, Inference, DVC, MLflow, Optuna, Orchestrator et le Docs Assistant) juste après sa configuration CORS. La vérification est une comparaison à temps constant de deux chaînes en mémoire. Elle coûte quelques microsecondes par requête, sans accès disque, et ne change pas la vitesse de chargement des images, dominée par le réseau et le stockage.

### Trajet du jeton du lanceur jusqu'à l'onglet

1. Le lanceur génère le jeton avec `secrets.token_urlsafe(32)` et le transmet au backend dans la variable d'environnement `CV_SESSION_TOKEN`. Il ne passe jamais sur une ligne de commande, que tous les comptes de la machine peuvent lire avec `ps` ; l'environnement d'un processus n'est lisible que par son propriétaire.
2. Avant d'annoncer ses ports, le lanceur affiche une fois la ligne `[token] <jeton>`. En mode VM, cette sortie arrive à VisionNexus par votre connexion SSH, donc chiffrée.
3. VisionNexus garde le jeton en mémoire et remplace la ligne par `[auth] jeton de session recu (masque)` dans le journal de lancement et dans le fichier de log. Le jeton n'est jamais écrit sur le disque du poste.
4. VisionNexus ajoute le jeton dans l'en-tête `X-VN-Token` de chaque requête qu'un onglet envoie à cette instance, sur son port frontend comme sur son port backend, images et connexions WebSocket comprises. Il pose aussi le cookie `vn_<port backend>` dans la session de navigation des onglets.

Les frontends des applications n'ont rien à changer : l'en-tête est ajouté par VisionNexus, le cookie est envoyé par le moteur de navigation lui-même, et le proxy Vite transmet les deux au backend.

### Ce que le backend vérifie à chaque requête

Le middleware accepte une requête quand son en-tête `X-VN-Token` est égal au jeton, ou quand son cookie `vn_<port backend>` l'est. Le cookie porte un nom par instance, car un navigateur ne distingue pas les cookies par port : sans le port dans le nom, deux applications ouvertes dans le même navigateur écraseraient mutuellement leur jeton.

Quelques chemins restent publics, car ils ne renvoient aucune donnée et doivent répondre avant que le jeton soit connu :

- `/health` et `/api/health`, interrogés par VisionNexus et par l'Orchestrator pour savoir quand un backend est prêt ;
- `/api/_auth/bootstrap`, le lien à usage unique décrit dans [Ouvrir une application dans un navigateur externe](#ouvrir-une-application-dans-un-navigateur-externe) ;
- les requêtes de prévol CORS (`OPTIONS`), qu'un navigateur envoie toujours sans identifiants.

Toute autre requête HTTP sans jeton valide reçoit `401` avec le message "Jeton de session manquant ou invalide.". Une connexion WebSocket sans jeton valide est fermée avant d'être acceptée.

### Appels entre applications du même utilisateur

Certains backends en appellent d'autres : l'Orchestrator pilote ses sous-applications, et une application appelle parfois sa propre API. Ces appels portent le jeton sans aucune modification du code des applications.

Au démarrage, chaque backend protégé écrit son jeton dans `~/.visionnexus/tokens/<nom d'hôte>_<port backend>`, dans un dossier en mode `700` et un fichier en mode `600` : seul son propriétaire peut le lire. Le nom d'hôte dans le nom du fichier sépare deux VM qui partagent le même dossier personnel. Chaque appel `httpx` sortant d'un backend est ensuite examiné : s'il vise `127.0.0.1` ou `localhost` sur un port qui a un fichier de jeton, l'en-tête `X-VN-Token` est ajouté. Un appel vers tout autre hôte n'est jamais modifié.

L'Orchestrator tire un jeton distinct pour chaque sous-application qu'il démarre et retire son propre jeton de leur environnement. Sa route `GET /api/apps`, protégée par son propre jeton, renvoie le `session_token` de chaque sous-application en marche, relu dans les mêmes fichiers de jeton. VisionNexus s'en sert pour ouvrir une sous-application dans un onglet. Le jeton reste dans le processus principal et n'est pas transmis à la page du catalogue.

DVC et MLflow appellent le backend de l'Orchestrator par leur propre proxy Vite (`/orchestrator-api`). L'en-tête ajouté par VisionNexus est alors le jeton de DVC ou de MLflow, pas celui de l'Orchestrator ; la requête est acceptée grâce au cookie `vn_<port>` de l'Orchestrator, que VisionNexus pose au démarrage de l'Orchestrator.

## Ouvrir une application dans un navigateur externe

Un navigateur externe comme Edge ou Chrome ne partage pas la session de VisionNexus et n'a pas le jeton : l'adresse nue d'une application affiche l'interface sans aucune donnée, car chaque appel d'API renvoie `401`. VisionNexus l'ouvre donc avec un lien à usage unique.

1. Faites un clic droit sur un onglet et choisissez **Ouvrir dans le navigateur**, ou **Copier l'URL** pour coller l'adresse vous-même.
2. VisionNexus demande un code au backend avec `POST /api/_auth/bootstrap-code`, authentifié par le jeton. Le code est valable 120 secondes et pour un seul usage.
3. Le navigateur ouvre `http://127.0.0.1:<port>/api/_auth/bootstrap?code=<code>&next=<page>`. Le backend vérifie le code et le supprime, pose le cookie `vn_<port backend>` avec les options `HttpOnly` et `SameSite=Strict`, puis redirige vers la page demandée.

L'URL qui reste dans l'historique du navigateur ne contient aucun jeton, et le code qu'elle porte est déjà consommé. Le cookie ne peut pas être lu par le JavaScript de la page (`HttpOnly`) et n'est pas envoyé par les requêtes venant d'autres sites (`SameSite=Strict`). Le paramètre `next` n'accepte qu'un chemin du même site : le lien ne peut pas rediriger ailleurs.

Quand une application est démarrée depuis un terminal, sans VisionNexus, le lanceur affiche une ligne `[auth] navigateur ... : http://127.0.0.1:<port>/api/_auth/bootstrap?code=<code>`. Ce premier code est valable 30 minutes et pour un seul usage ; ouvrez-le dans le navigateur de la machine qui porte le tunnel ou qui exécute l'application.

Le navigateur externe atteint l'application par la même adresse `127.0.0.1` : il ne fonctionne donc que sur le poste qui porte le tunnel SSH, ou sur la machine qui exécute l'application en mode local.

## Configuration des protections

Deux variables d'environnement, lues par les lanceurs au démarrage d'une application, modifient les protections. Elles sont réservées aux cas exceptionnels.

| Variable | Défaut | Effet |
|---|---|---|
| `CV_BIND_HOST` | `127.0.0.1` | Adresse d'écoute des backends et des frontends. `0.0.0.0` expose de nouveau l'application à tout le réseau. |
| `CV_AUTH` | `1` | `0` désactive le jeton de session : aucun jeton n'est tiré et les backends acceptent toutes les requêtes. |

Gardez les deux valeurs par défaut sur une VM partagée. Avec `CV_AUTH=0`, le journal de lancement de VisionNexus affiche `[auth] aucun jeton annonce : backend sans protection`, et tout compte de la VM peut de nouveau utiliser votre backend.

Un backend démarré à la main avec `uvicorn`, sans lanceur, n'a pas de jeton dans son environnement et garde le comportement non protégé. Il écoute sur l'adresse donnée à uvicorn : passez `--host 127.0.0.1`. Un backend qui trouve `CV_SESSION_TOKEN` dans son environnement mais ne peut pas importer `_lib/session_auth.py`, par exemple une application copiée sans le reste du dépôt, refuse de démarrer plutôt que de tourner sans protection.

## Arrêter les processus et nettoyer la VM

Un processus resté en place après un plantage garde son port et, avec lui, son fichier de jeton et son accès aux données. Le panneau **Ports** de VisionNexus permet de les arrêter ; le [Guide utilisateur](user-guide.fr.md) décrit ses tableaux.

- **Tuer** sur une ligne arrête le processus qui tient le port. Sur la VM, l'identifiant du processus vient de `ss`, tout le groupe de processus est arrêté (`SIGTERM`, puis `SIGKILL`), et le port est vérifié ensuite. Si le port écoute encore, le panneau affiche la raison en haut au lieu de ne rien faire en silence. Un processus d'un autre compte ne peut pas être tué : Linux le refuse, et le panneau le signale.
- **Tout arreter** arrête toutes les applications lancées par VisionNexus, puis tue les ports connus, en local et sur la VM, dans une seule session SSH. Sur la VM, il utilise aussi le registre partagé `.run/.instances.json`, mais seulement pour les entrées à votre nom d'utilisateur.
- **Nettoyer la VM** arrête, dans une seule session SSH, vos propres processus `node` et `python` dont le dossier de travail est dans la racine `Computer_Vision_App` et dont la ligne de commande est un serveur de la suite (`vite`, `uvicorn`, `launcher.py`, `esbuild`, processus multiprocessing). Un serveur d'IDE, un notebook ou vos autres scripts ne sont pas touchés, même s'ils tournent dans le même dossier.

## Ce que ces protections ne couvrent pas

- **Root et les administrateurs de la VM.** Ils peuvent lire la mémoire, l'environnement ou les fichiers de n'importe quel processus, fichiers de jeton compris. Les protections séparent les comptes ordinaires, pas les administrateurs.
- **Votre propre compte Unix.** Tout processus qui tourne sous votre compte peut lire vos fichiers de jeton, par construction : c'est ce qui permet à l'Orchestrator d'appeler ses sous-applications. Un programme malveillant qui tourne sous votre compte sort de ce périmètre.
- **Le serveur frontend Vite.** Il sert le code de l'interface, le même que dans le dépôt, sans vérifier le jeton. Les données restent derrière le backend, que le proxy de Vite n'atteint qu'avec un jeton valide.
- **Les autres services de la VM.** Un serveur de suivi ou tout outil qui n'est pas un backend de la suite, par exemple un serveur de tracking MLflow démarré à part, n'est pas protégé par ce jeton.
- **Votre poste.** L'extrémité du tunnel écoute sur `127.0.0.1` de votre poste. En mode local sur une machine Windows partagée, les autres sessions de cette machine peuvent l'atteindre ; le jeton protège toujours les backends.
- **Le déni de service.** Un compte de la VM qui atteint votre port ne peut rien lire, mais il peut toujours envoyer des requêtes, qui seront refusées.

## Vérifier les protections après une mise à jour

Ces vérifications confirment les trois couches sur une VM après une mise à jour ou un changement de configuration. Lancez-les pendant qu'au moins une application est ouverte.

1. Sur la VM, listez les ports en écoute de la suite. Chaque adresse doit être `127.0.0.1`, jamais `0.0.0.0` ni l'adresse de la VM.

   ```bash
   ss -tlnp | grep -E 'uvicorn|node|python'
   ```

2. Depuis votre poste, l'adresse réseau de la VM doit refuser la connexion : `curl http://<IP de la VM>:<port backend>/health` échoue.
3. Sur la VM, une requête sans jeton doit être refusée, et la sonde de santé doit répondre :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port backend>/api/settings
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port backend>/health
   ```

   La première commande affiche `401`, la seconde `200`.
4. Les fichiers de jeton sont privés : `ls -la ~/.visionnexus/tokens` affiche `drwx------` pour le dossier et `-rw-------` pour chaque fichier.
5. Dans VisionNexus, le journal de lancement affiche `[auth] jeton de session recu (masque)` et jamais le jeton lui-même. **Ouvrir dans le navigateur** ouvre l'application avec ses données.
