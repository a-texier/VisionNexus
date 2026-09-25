---
app: orchestrator
doc_type: troubleshooting
audience: both
lang: fr
title: Dépannage
order: 50
tags: [démarrage, sse, point d'arrêt humain, sous-applications, ports, dvc, optuna, chemins unc]
sources: [Orchestrator_App/backend/config.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/core/pipeline_runner.py, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/backend/utils/native_share.py, Orchestrator_App/launcher.py]
---

# Dépannage

## Le backend refuse de démarrer en se plaignant du nom d'utilisateur

**Symptôme** : le processus backend s'arrete immediatement, en affichant "ORCHESTRATOR_USER n'est pas défini et le login OS n'a pas pu être déterminé...".

**Cause** : `ORCHESTRATOR_USER` n'etait pas defini (ou etait defini a un placeholder tel que `unknown`, `user` ou une chaine vide), et le nom de login du systeme n'a pas pu etre lu non plus. Le backend refuse de deviner, car un utilisateur placeholder partage ferait ecrire silencieusement deux personnes dans le meme workspace et les memes bases SQLite.

**Solution** :

1. Lancez toujours via `launcher.py --user <nom> --workspace <chemin>` (ou depuis VisionNexus, qui remplit le champ utilisateur) ; ne demarrez jamais `uvicorn backend.main:app` a la main.
2. Si vous devez definir l'environnement a la main, exportez un `ORCHESTRATOR_USER` reel et non-placeholder avant de demarrer uvicorn.

## "Lancer" est désactivé ou échoue avec "This graph is already running"

**Symptôme** : cliquer sur **Lancer** ne fait rien, ou la barre du haut affiche le compteur de temps ecoule et **Stop** alors que vous n'avez jamais clique Lancer vous-meme ; un appel API direct renvoie un HTTP 409 "This graph is already running".

**Cause** : le statut stocke du graphe est encore `running` depuis un lancement precedent, soit parce qu'un run est reellement en cours dans un autre onglet de navigateur, soit parce que le backend a redemarre pendant qu'un run etait actif et que le graphe n'a jamais ete finalise proprement.

**Solution** :

1. Rechargez la page Sandgraph ; la liste des graphes interroge regulierement `/api/graphs`, ce qui resynchronise le statut depuis l'etat reel du run (ou le marque `stopped` si le run a disparu de la memoire).
2. Si le statut semble toujours bloque, cliquez **Stop**, puis **Réinitialiser**.
3. Si aucun des deux boutons n'apparait car la page affiche un etat perime, quittez le Sandgraph et revenez-y, ou redemarrez le backend.

## Un nœud reste gris ou le graphe semble figé en cours de run

**Symptôme** : un nœud reste bloqué en `running`, ou le pipeline semble avoir arrete d'avancer ; les nœuds restent a leur derniere couleur visible, aucune nouvelle ligne de log n'apparait, mais le backend tourne toujours.

**Cause** : le frontend suit le run via un flux Server-Sent Events (SSE) sur `fetch()`, ouvert une fois quand vous cliquez **Lancer**. Si cette connexion echoue des sa toute premiere tentative (une erreur transitoire, l'onglet qui perd le focus, un accroc du proxy de dev), elle n'est pas retentee automatiquement, contrairement a un `EventSource` de navigateur. Le pipeline lui-meme continue de tourner dans le backend quoi qu'il arrive ; seule la vue en direct arrete de se mettre a jour.

**Solution** :

1. Attendez quelques secondes : `list_graphs()` et `get_graph()` resynchronisent l'etat d'execution des nœuds depuis l'etat reel du run a chaque interrogation, meme sans connexion SSE active, si bien que la page rattrape son retard en un cycle d'interrogation (environ cinq secondes) une fois que vous la rechargez ou changez d'onglet et revenez.
2. Si rien ne change apres un rechargement, verifiez le log backend pour l'etape en cours ; une etape qui attend une sous-application lente n'est pas un pipeline fige.
3. En dernier recours, **Stop** puis **Lancer** a nouveau ; les etapes deja reussies ne sont pas rejouees sauf si vous **Réinitialisez** aussi.

## "Pipeline state lost (server restarted). The graph was reset"

**Symptôme** : cliquer **Terminé -> Continuer** a un point d'arret humain renvoie cette erreur HTTP 410, et le graphe bascule sur `idle`.

**Cause** : l'etat du run vit uniquement dans la memoire du backend (`_active_runs`), jamais sur disque. Si le processus backend a redemarre (un crash, un redemarrage manuel, une mise a jour) pendant qu'un graphe attendait a un point d'arret, ce run n'existe plus nulle part a reprendre.

**Solution** : c'est un comportement attendu apres un redemarrage du backend, pas un bug a corriger. Cliquez **Lancer** a nouveau sur le graphe reinitialise ; si les etapes precedentes ont produit des sorties encore valides (un subset ou un export existant), envisagez de basculer le nœud correspondant en mode FREE plutot que de les regenerer depuis zero.

## Le bandeau "Intervention requise" revient sans cesse après avoir continué

**Symptôme** : vous cliquez **Terminé -> Continuer**, le bandeau disparait brievement, puis revient en montrant le meme point d'arret.

**Cause** : historiquement, c'etait un bug de boucle dans la logique de relecture SSE (corrige) : a la reconnexion apres une reprise, le flux d'evenements pouvait sortir sur un evenement historique "waiting" pendant que l'etat d'execution du nœud etait retrograde vers "waiting" au meme moment. Si vous voyez encore ce comportement, le backend fait probablement tourner un ancien build.

**Solution** : mettez a jour Orchestrator_App vers la version actuelle. Si cela persiste, verifiez le log backend pour des messages `event_generator` / `update_node_exec` repetes autour de l'id d'etape du point d'arret, et signalez-le avec cet extrait de log ; ne contournez pas le probleme en cliquant frenetiquement sur continuer, car chaque clic valide l'etape a nouveau.

## Une étape échoue avec "<app> not reachable after 240s"

**Symptôme** : une etape de pipeline echoue avec un message tel que "Training_App not reachable after 240s (cold start took too long).".

**Cause** : la sous-application dont cette etape a besoin n'a pas repondu a `/health` dans les quatre minutes suivant son lancement. Cela peut arriver sur une machine lente, quand plusieurs applications ont ete auto-lancees a la suite, ou quand l'application a plante pendant son propre demarrage (par exemple un checkpoint de modele manquant).

**Solution** :

1. Ouvrez la page **Applications** et verifiez le statut de l'application nommee dans l'erreur ; **Échec du démarrage** montre la raison et le chemin du log backend.
2. Corrigez le probleme sous-jacent (dependance manquante, chemin de workspace incorrect, conflit de port) et relancez l'application depuis cette page.
3. Une fois que l'application affiche **running** et repond rapidement, relancez le pipeline ; les etapes deja terminees sont sautees sauf si vous **Réinitialisez** aussi.

## Une sous-application affiche "Échec du démarrage" sur la page Applications

**Symptôme** : une carte d'application affiche un bloc rouge **Échec du démarrage** avec une raison telle que "Le backend s'est arrêté (code 1)." et un chemin de log.

**Cause** : le processus backend ou frontend de cette sous-application s'est arrete de lui-meme peu apres avoir ete lance ; `get_all_sessions()` detecte le processus mort et remonte son code de sortie et la fin de son fichier de log.

**Solution** :

1. Lisez le fichier de log au chemin indique (ou ouvrez-le directement sur disque) ; il pointe generalement vers une erreur d'import Python, un fichier de modele manquant, ou un port deja tenu par un processus perime d'un crash anterieur.
2. Corrigez la cause, puis cliquez a nouveau **Lancer** sur la carte de cette application.
3. Si le port de l'application est suspecte d'etre bloque (un processus precedent ne l'a pas libere), arretez d'abord l'application ; `stop_app()` fait aussi un effort de tuer tout ce qui tient encore son port avant de le rendre.

## Sauvegarder ou Lancer est bloqué par une erreur de validation

**Symptôme** : cliquer **Sauvegarder** ou **Lancer** affiche un toast rouge tel que "Annotation : entrée obligatoire manquante , images" ou "Pré-contrôle bloquant : ... n'utilisent pas le même moteur".

**Cause** : le graphe echoue l'une des verifications de port ou de lignee de modele : une entree obligatoire n'est pas connectee (et le nœud n'est pas en mode FREE), deux entrees mutuellement exclusives sont toutes les deux connectees, ou deux nœuds de la meme lignee de modele (Modèle, Optuna, Training, Inference / Eval) declarent des moteurs ou des tailles d'entrainement differents. Ces verifications existent pour attraper un graphe casse avant de perdre du temps a lancer des sous-applications.

**Solution** :

1. Lisez le nœud et le port exacts nommes dans le message ; ouvrez son panneau de configuration.
2. Pour une entree obligatoire manquante, connectez le bon nœud amont, ou basculez le nœud en mode FREE si vous vouliez reutiliser une sortie existante a la place.
3. Pour une incoherence de moteur ou de taille, alignez le champ **Moteur d'entraînement** (et, pour une taille figee, **Taille**) sur chaque nœud de la lignee ; un checkpoint ne se recharge qu'avec exactement le moteur et la taille qui l'ont produit.

## Optuna échoue avec "HPO FAILED - 0/N trial completed"

**Symptôme** : l'artefact Optuna du nœud DVC affiche une erreur telle que "HPO FAILED - 0/20 trial completed. No Optuna best_params produced. Training fell back to the configured/default parameters, without Optuna optimization.", ou tout le pipeline s'arrete a l'etape Optuna.

**Cause** : chaque essai de l'etude a echoue a l'interieur d'Optuna App (frequemment un probleme de chemin de dataset, un entrainement a court de memoire, ou un espace de recherche mal configure), donc aucun parametre optimal exploitable n'a ete produit.

**Solution** :

1. Ouvrez Optuna App et verifiez les logs d'essais de l'etude pour l'erreur reelle par essai.
2. Si **Arrêter le pipeline si aucun trial n'aboutit** etait coche sur le nœud Optuna, le pipeline s'arrete ici par conception ; corrigez le probleme d'entrainement sous-jacent et relancez.
3. Si c'etait decoche, le Training aval a deja tourne avec ses propres hyperparametres configures (ou par defaut) au lieu de ceux d'Optuna ; ce n'est pas un echec du pipeline global, seulement de l'etape HPO, et le panneau DVC garde l'erreur visible pour qu'elle ne soit pas confondue avec un vrai resultat d'optimisation.

## Le bouton "Créer une version" de DVC Commit reste désactivé

**Symptôme** : le nœud DVC montre des artefacts mais le bouton **Créer une version DVC (Git + cache DVC)** ne devient jamais cliquable, ou cliquer dessus renvoie "No existing artifact selected to version." ou "The run must be finished before creating a DVC version".

**Cause** : soit aucun run de ce graphe n'a encore reussi (`runCtx.run_id` est vide), soit toutes les cases de la liste d'artefacts sont decochees, soit les artefacts coches n'ont pas reellement ete produits (`exists` vaut false, affiche "pas encore produit , lancez le pipeline").

**Solution** :

1. Lancez le graphe jusqu'au bout au moins une fois ; le panneau DVC ne lit que les artefacts lies a un run precis termine, jamais une supposition basee sur le fichier le plus recent du workspace.
2. Cochez au moins un artefact dont la ligne ne dit pas "pas encore produit".
3. Si un run est termine mais que la liste d'artefacts semble vide, cliquez **rafraîchir** ; le panneau n'interroge pas tout seul.

## Un chemin Windows déposé ou tapé n'est pas trouvé par une sous-application

**Symptôme** : un champ de chemin (dataset, modele, sequence, fichier d'annotation) accepte un chemin Windows ou UNC tel que `\\serveur\partage\images`, mais l'etape de pipeline echoue avec une erreur de type "chemin introuvable" venant de Dataset_Explorer_App, Annotation_App ou Inference_App.

**Cause** : le backend Orchestrator tourne en PosixPath sur la machine ou il est deploye (typiquement une VM GPU Linux) ; un chemin Windows n'existe que sur le poste de travail Windows. Orchestrator traduit un chemin UNC en chemin POSIX une fois, au moment de la construction du graphe, en utilisant les racines de partage connues (`home`, `mnt`, `srv`, `media`, `data`) ; si le partage est monte sous une racine absente de cette liste, ou sous un nom de partage different de celui affiche par Windows, la traduction echoue et la chaine originale est transmise telle quelle.

**Solution** :

1. Verifiez ou le partage est reellement monte sur la machine backend (par exemple `ls /srv/datasets/...`) et comparez-le au chemin UNC que vous avez tape ou depose.
2. Si le montage utilise une racine hors de `home`, `mnt`, `srv`, `media`, `data`, remontez-le sous l'une d'elles, ou tapez directement le chemin POSIX au lieu du chemin Windows.
3. Rappelez-vous que cette traduction ne s'applique qu'aux quatre champs de chemin qu'Orchestrator lui-meme envoie en aval (`dataset_path`, `model_path`, `sequence_dir`, `annotation_file`) ; un chemin tape dans l'interface propre d'une sous-application suit les regles propres a cette application (voir sa page Dépannage).

## Lancer une application échoue avec "port already in use" ou les ports n'arrêtent pas de dériver

**Symptôme** : `launcher.py` (ou la page **Applications**) echoue avec un message nommant un port fixe deja utilise, ou des lancements successifs atterrissent sur des numeros de port de plus en plus hauts qu'attendu.

**Cause** : un `--backend-port` / `--frontend-port` fixe a ete demande mais est reellement tenu par un autre processus, ou une session precedente de la meme application a ete arretee salement et son entree perimee dans le registre de ports partage (`Computer_Vision_App/.run/.instances.json`) reserve encore son port. Une session arretee ne reserve pas son port pour un simple redemarrage, mais une session qui n'a jamais eu la chance de se desenregistrer (un kill brutal au lieu d'un arret propre) peut en laisser une trainer.

**Solution** :

1. Pour un echec de port fixe, liberez ce port ou retirez `--backend-port` / `--frontend-port` pour laisser le lanceur en choisir un libre automatiquement.
2. Si les ports derivent continuellement vers le haut d'un redemarrage a l'autre, verifiez `Computer_Vision_App/.run/.instances.json` pour des entrees perimees pointant vers des PID qui n'existent plus, et supprimez-les ; un **Kill All** propre depuis la page Applications avant de fermer l'application evite cela en usage normal.
