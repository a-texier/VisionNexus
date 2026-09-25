---
app: suite
doc_type: troubleshooting
audience: both
lang: fr
title: Dépannage
order: 50
tags: [lancement, ssh, tunnel, ports, réglages, chemin natif, fenêtre documentation, processus orphelins]
sources: [desktop/src/main.ts, desktop/src/sshLauncher.ts, desktop/src/tunnelClassify.ts, desktop/src/services.ts, desktop/ui/catalog.html, desktop/ui/i18n.js, _lib/launcher_engine.py, launcher.py]
---

# Dépannage

Les messages cités ci-dessous sont reproduits tels que le lanceur les imprime, le plus souvent en français. Ouvrez le panneau **Lancements**, ou le fichier de journal derrière le bouton **Logs**, avant toute autre chose : la cause y est presque toujours écrite.

## Toutes les tuiles sont grisées et inactives

**Symptôme** : le bandeau orange affiche **Renseigne les champs ci-dessous pour pouvoir lancer une app.** et aucune tuile ne réagit. L'interrupteur du Docs Assistant est lui aussi désactivé, avec l'info-bulle **Renseigne les Parametres avant d'allumer une ressource.**

**Cause** : au moins un des quatre réglages obligatoires est vide : **Utilisateur**, **Workspace**, **Racine Computer_Vision_App** ou **Chemin conda**. **Chemin conda** est celui qu'on oublie, car son intitulé ne dit pas qu'il est obligatoire.

**Solution** : renseignez les quatre champs et cliquez sur **Enregistrer**. Le bandeau devient vert. Si un lancement a malgré tout été tenté, le message est `Renseigne Utilisateur / Workspace / Racine / Conda dans Parametres avant de lancer une app.`

## Un avertissement indique que l'identifiant utilisateur n'est pas valable

**Symptôme** : cliquer sur une tuile ouvre une boîte intitulée **Identifiant utilisateur non valable**, et le lancement ne démarre pas.

**Cause** : la valeur de **Utilisateur** est l'une de `unknown`, `user`, `default`, `none`, `null`, `admin` ou `test`. Ces noms génériques feraient partager à plusieurs personnes un même workspace et les mêmes bases de données.

**Solution** : saisissez votre vrai login dans **Utilisateur**, cliquez sur **Enregistrer**, puis relancez.

## Le lanceur n'annonce jamais ses ports

**Symptôme** : la tuile devient rouge et le journal se termine par `launcher.py n'a jamais annonce ses ports (verifie la connexion/les identifiants).`, parfois précédé de `[launcher.py] termine prematurement (code N) avant d'annoncer ses ports`.

**Cause** : `launcher.py` n'a pas démarré ou s'est arrêté avant d'imprimer ses lignes `[config]`. Raisons typiques : la connexion SSH a échoué ou demande un mot de passe, **Racine Computer_Vision_App** n'existe pas sur la cible, `python` n'est pas trouvé par le shell distant, ou le lanceur a levé une erreur visible juste au-dessus dans le journal. Sinon, rien n'est annoncé pendant 60 secondes.

**Solution** : lisez les lignes au-dessus de l'erreur. En mode VM, exécutez `ssh <vm>` dans un terminal et vérifiez qu'aucun mot de passe n'est demandé. Vérifiez que **Racine Computer_Vision_App** est un chemin de la cible (chemin Windows en local, chemin Linux en mode VM) et que `python launcher.py --help` fonctionne à cet endroit.

## Un port local est déjà occupé et le tunnel est refusé

**Symptôme** : le journal indique `Port(s) local/locaux deja occupe(s) sur ce poste : <ports>` et le lancement s'arrête avant d'ouvrir le tunnel.

**Cause** : la VM a choisi des numéros de ports déjà pris sur votre machine Windows. Le coupable habituel est un tunnel `ssh.exe` orphelin d'une session précédente, une autre instance du lanceur, ou n'importe quel programme Windows qui écoute sur ce port. Le tunnel doit réutiliser les mêmes numéros, il ne peut donc pas démarrer.

**Solution** : ouvrez le panneau **Ports**, repérez le port dans le tableau **Local (cette machine)** et cliquez sur **Tuer** s'il s'agit d'un reste ; ou terminez les processus `ssh.exe` dans le gestionnaire des tâches Windows. Puis cliquez de nouveau sur la tuile.

## Le tunnel SSH échoue avec une erreur de réseau, de clé ou d'hôte

**Symptôme** : le journal affiche `Tunnel SSH en echec : <message ssh>` ou `Tunnel SSH termine prematurement (code N) : forward non etabli`, et l'application ne s'ouvre pas.

**Cause** : la seconde connexion SSH, le tunnel, n'a pas pu être établie. Le lanceur traite ces messages ssh comme fatals : `address already in use`, `cannot listen`, `bind:`, `permission denied`, `could not resolve`, `connection refused`, `connection closed`, `connection timed out` et `host key verification failed`. Un code 255 est une erreur ssh (résolution de nom, authentification, forward refusé) ; un autre code vient d'un `ProxyCommand` ou `ProxyJump` de votre configuration ssh, d'un wrapper autour de `ssh`, ou d'un processus tué de l'extérieur. Le journal imprime aussi la version de ssh utilisée, car Windows peut en avoir plusieurs.

**Solution** : appliquez le remède qui correspond au message : corrigez le nom de la VM, chargez votre clé dans l'agent, acceptez une fois la clé d'hôte avec un `ssh <vm>` manuel, ou rétablissez le VPN. Les messages du type `channel N: open failed: connect failed` sont normaux tant que le backend charge ses modèles et ne sont pas des erreurs.

## Le lancement dépasse le délai d'attente du serveur ou du backend

**Symptôme** : le journal se termine par `[timeout] le serveur ne repond pas apres 60s.` ou `[timeout] le backend ne repond pas apres 120s.`, et la tuile devient rouge.

**Cause** : le serveur de dev du frontend n'a pas répondu en 60 secondes (dépendances non installées ou non construites, Vite planté), ou le backend n'a pas répondu sur `/health` en 120 secondes (chargement de modèles sur un disque ou un GPU lent, erreur d'import Python).

**Solution** : lisez les lignes du lanceur au-dessus pour y trouver une erreur Python ou Node. Assurez-vous que les dépendances des frontends sont installées (`python rebuild_all.py`). Si le backend est simplement lent, relancez une fois que le premier démarrage a réchauffé le cache disque. **Stop** annule un lancement encore en attente.

## Un onglet reste vide, affiche une page d'erreur ou montre une autre application

**Symptôme** : l'onglet d'une application est vide, affiche une page d'erreur de Chromium, ou montre autre chose que l'application lancée. Le journal peut imprimer `[renderer] chargement echoue ...` et `nouvelle tentative n/5`.

**Cause** : le port local répond, mais pas à travers le tunnel de ce lancement, par exemple parce qu'un tunnel orphelin d'une session précédente le tient encore ; ou le serveur de dev a redémarré et la page n'a pas pu se charger. Un onglet réessaie jusqu'à cinq fois, avec un délai croissant de 1,5 à 7,5 secondes, avant d'abandonner. Quand le tunnel d'un lancement signale une erreur fatale, le lanceur refuse d'ouvrir l'onglet plutôt que d'afficher un autre serveur.

**Solution** : fermez l'onglet, utilisez **Ports** pour tuer le `ssh.exe` ou le processus local qui tient ce port, puis relancez. Faites un clic droit sur l'onglet et choisissez **Copier l'URL** ou **Ouvrir dans le navigateur** pour tester l'adresse en dehors de VisionNexus.

## Les applications démarrent sur la VM alors que le mode local était choisi

**Symptôme** : après avoir cliqué sur **Enregistrer**, la liste **VM cible** affiche de nouveau une VM et les lancements passent par SSH.

**Cause** : **VM cible** n'affiche pas **(local, pas de VM)**. **Enregistrer** conserve la sélection courante, mais si la VM sélectionnée a été retirée de **VM(s) connue(s)**, la première VM de la liste est sélectionnée à la place.

**Solution** : choisissez **(local, pas de VM)** dans **VM cible**. La sélection est enregistrée dès que vous la changez. Videz **VM(s) connue(s)** quand vous n'avez pas besoin du mode VM.

## Le chemin natif reste en HTTP


**Cause** : l'info-bulle de l'étiquette donne la raison : `Aucun hote de partage reseau configure (Parametres)` quand le champ est vide ; `Hote "<hôte>" injoignable -- repli HTTP` quand le dernier test a échoué, c'est-à-dire que le port SMB 445 de l'hôte n'a pas répondu en 3 secondes ; ou le partage ne contient pas le chemin de l'image, si bien que chaque image se replie individuellement.

**Solution** : renseignez **Partage reseau natif (optionnel)**, cliquez sur **Tester** et corrigez le nom d'hôte ou le VPN jusqu'à voir **Joignable**, puis enregistrez et relancez l'application. Si l'hôte répond mais que l'étiquette reste ambre, le partage n'expose pas le dossier qui contient vos images : vérifiez le mappage sur le serveur de fichiers.

## La fenêtre Documentation n'affiche aucune page

**Symptôme** : une entrée affiche `Pas de documentation trouvee pour cette entree depuis ce poste...` (ou sa version anglaise).

**Cause** : VisionNexus n'a trouvé ni le dépôt ni sa copie embarquée des pages. En mode VM, le champ **Racine Computer_Vision_App** contient un chemin Linux, que le programme Windows ne peut pas lire ; il cherche donc le dépôt à côté de lui puis se replie sur la copie embarquée dans le programme.

**Solution** : en mode local, renseignez **Racine Computer_Vision_App** avec le chemin Windows local du dépôt. En mode VM, gardez une copie du dépôt à côté du programme, ou utilisez une version qui embarque la documentation. Rouvrez ensuite la fenêtre.

## Le Docs Assistant ne s'allume pas

**Symptôme** : la carte du Docs Assistant devient rouge avec **Erreur** et un message, ou reste sur **Demarrage...**.

**Cause** : les messages de démarrage viennent du lanceur et dépendent de la phase. `Le service ne repond pas apres 90 s.` : le backend n'a pas répondu sur `/health` à temps. `Le service s'est arrete (code N). Voir le journal du lancement.` : le processus s'est terminé. `launcher.py n'a jamais annonce son port ...`, `Port local deja occupe sur ce poste : <port>` et les messages de tunnel ont les mêmes causes que pour une application. `Arret en cours, reessaie dans un instant.` signifie que l'arrêt précédent n'est pas terminé.

**Solution** : lisez le panneau **Lancements** sous **Docs Assistant**, corrigez la cause comme pour une application, puis rallumez le service. Les problèmes de modèle ou d'index une fois le service démarré sont traités dans le [dépannage du Docs Assistant](../Docs_Assistant_App/docs/troubleshooting.fr.md).

## Le panneau Ports marque des processus « a verifier » ou n'affiche aucun tableau de VM

**Symptôme** : beaucoup de lignes portent le badge **a verifier**, une ligne affiche `? (droits insuffisants sur la VM)` comme processus, ou le tableau **VM** est vide ou absent.

**Cause** : **a verifier** signifie seulement que le port n'est lié ni à une application pilotée par VisionNexus ni au registre partagé : ce peut être un reste, ou un programme sans rapport avec la suite. Des droits insuffisants signifient que la VM n'a pas laissé `ss` nommer le processus propriétaire. Un tableau de VM vide signifie que le scan SSH a échoué : il s'exécute sans aucune invite et abandonne après 5 secondes.

**Solution** : ne tuez que les lignes que vous reconnaissez ; sur une VM partagée, regardez d'abord la colonne **Utilisateur**. Pour le tableau de la VM, vérifiez que `ssh <vm>` fonctionne sans mot de passe depuis un terminal.

## Une sous-app de l'Orchestrator refuse de s'ouvrir

**Symptôme** : choisir **Ouvrir (onglet)** affiche `Orchestrator n'est plus lance.`, `<app> n'est pas prete (statut : ...)` ou `Le frontend de <app> n'a pas repondu (port N)...`.

**Cause** : l'onglet Orchestrator a été fermé, la sous-application n'est pas encore à l'état actif, ou son serveur de dev frontend est encore en train de démarrer. En mode VM, le même message de port occupé que pour un lancement normal peut apparaître quand son port local est pris.

**Solution** : gardez l'onglet Orchestrator ouvert, lancez la sous-application avec **Lancer** depuis le même menu et attendez que son compteur augmente, puis ouvrez-la de nouveau quelques secondes plus tard.

## Le lanceur s'arrête avec une erreur de port ou de verrou

**Symptôme** : le journal affiche `Cannot acquire port lock (...). Remove the file if no launcher is starting.` ou `No free port found between N and M.`

**Cause** : le fichier de verrou `.run/.port_lock` a été laissé par un lanceur qui a planté pendant l'allocation des ports, ou les 200 ports qui suivent le port de base sont tous occupés.

**Solution** : pour le verrou, supprimez le fichier nommé dans le message une fois certain qu'aucun lanceur ne démarre. Pour les ports, libérez-en avec le panneau **Ports**.

## Le mauvais environnement Python est utilisé

**Symptôme** : le journal imprime `[warning] --conda-path '<chemin>' invalide (python introuvable), repli sur la recherche par nom d'env 'IA_env'` ou `[warning] Conda env 'IA_env' not found, using sys.executable`, puis des imports échouent.

**Cause** : **Chemin conda** ne mène pas à un interpréteur Python sur la cible, et la recherche de repli n'a pas trouvé d'environnement nommé `IA_env`.

**Solution** : renseignez **Chemin conda** avec le dossier de l'environnement (celui qui contient `bin/python` sous Linux ou `python.exe` sous Windows), son script `bin/activate`, ou l'interpréteur lui-même, tels que la machine cible les voit.

## VisionNexus n'ouvre pas de seconde fenêtre

**Symptôme** : démarrer de nouveau le programme ne provoque rien de visible.

**Cause** : un seul lanceur peut tourner à la fois. Le second démarrage se termine aussitôt et ramène la fenêtre existante au premier plan. Cela évite que deux lanceurs se disputent les mêmes ports.

**Solution** : utilisez la fenêtre existante. Si elle n'est pas visible, cherchez-la dans la barre des tâches ; si le programme semble figé, terminez son processus dans le gestionnaire des tâches et redémarrez-le.

## Des processus restent sur la VM après la fermeture d'une application

**Symptôme** : après la fermeture d'un onglet ou de la fenêtre, le panneau **Ports** liste encore les ports de l'application sur la VM.

**Cause** : la fermeture termine les processus `ssh` locaux. Les processus de l'application sur la VM s'arrêtent quand leur lanceur se termine proprement, mais une connexion coupée ou un plantage peut les laisser tourner.

**Solution** : cliquez sur **Tuer** sur leurs lignes du tableau **VM**, ou utilisez **Tout arreter**, qui tue aussi les ports connus sur la VM et les entrées du registre à votre nom. S'il reste des ports, **Nettoyer la VM** arrête d'un coup tous vos serveurs de la suite sur la VM. Ces actions n'atteignent que vos propres processus : un processus d'un autre compte est signalé comme un échec en haut du panneau.

## Une application s'ouvre sans données et ses requêtes renvoient 401

**Symptôme** : un onglet ou un navigateur affiche l'interface d'une application mais aucun projet, aucune image, aucune liste ; la console du navigateur ou le log du backend montre des réponses `401` avec le message "Jeton de session manquant ou invalide.".

**Cause** : chaque backend exige le jeton de session de son instance. La page a été ouverte sans lui : adresse nue collée dans un navigateur, favori, lien gardé d'une session précédente, ou backend redémarré avec un nouveau jeton pendant que la page restait ouverte.

**Solution** : dans VisionNexus, faites un clic droit sur l'onglet et choisissez **Ouvrir dans le navigateur** ou **Copier l'URL** : les deux donnent un lien à usage unique neuf. Pour un onglet resté vide après le redémarrage de son backend, fermez-le et relancez l'application. Hors de VisionNexus, utilisez le lien `[auth] navigateur` affiché par le lanceur au démarrage. [Sécurité](security.fr.md) décrit le jeton et le lien.

## Un lien navigateur est signalé invalide ou déjà utilisé

**Symptôme** : l'ouverture d'un lien copié depuis VisionNexus affiche le message "Lien de connexion invalide ou deja utilise." au lieu de l'application.

**Cause** : un lien à usage unique fonctionne une fois et pendant 120 secondes ; le lien affiché par un lanceur dans un terminal fonctionne une fois et pendant 30 minutes. Un second usage, un lien expiré, ou un lien antérieur au redémarrage de l'application est refusé.

**Solution** : refaites un clic droit sur l'onglet et choisissez **Copier l'URL** ou **Ouvrir dans le navigateur** pour obtenir un nouveau lien, et ouvrez-le aussitôt dans un navigateur du même ordinateur. Un navigateur qui a déjà ouvert l'application une fois garde son cookie de session jusqu'à l'arrêt de l'application : il n'a pas besoin d'un nouveau lien entre-temps.

