# Moteur Ultralytics (plugin)

Cette page decrit ce que le plugin Ultralytics change dans les graphes. Sans lui, les noeuds
n'affichent aucun choix de moteur et tout se comporte comme avant (YOLOX).

## Ou le moteur se choisit

| Noeud | Ce qui s'ajoute |
|---|---|
| **Modele** (entree) | choix du moteur qui a produit les poids, tailles du moteur, extension attendue verifiee (`.pt` ici, `.pth` pour YOLOX) |
| **Training** | choix du moteur, tailles et formulaire d'hyperparametres du moteur choisi |
| **Optuna** | choix du moteur entraine par les trials, espace de recherche du moteur |

Les listes et les libelles viennent de `GET /api/engines`, qui interroge Training_App (repli sur
le registre local du depot si l'app n'est pas lancee). Un moteur dont la bibliotheque n'est pas
installee est affiche indisponible, avec la raison.

## Regles de coherence, verifiees avant le lancement

Un graphe incoherent est refuse a la construction du pipeline (message explicite, rien n'est
lance) plutot qu'en plein run :

- un noeud **Modele** branche sur un Training **fige** le moteur et la taille de ce Training : ses
  poids ne se rechargent qu'avec eux ;
- une etude **Optuna** et le **Training** qu'elle alimente doivent utiliser le meme moteur ;
- une **Inference / Eval** alimentee par des poids Ultralytics est refusee : Inference_App ne sait
  pour l'instant charger que des poids YOLOX. Un graphe Annotation -> Training (Ultralytics) ->
  Inference n'est donc pas encore possible ; utilisez YOLOX pour ces chaines, ou arretez la chaine
  au Training.

## Ce que les autres noeuds recoivent

- Le Training renvoie `engine` et `model_size` avec le chemin des poids : le moteur voyage avec le
  modele (reponse orchestrateur, base Training, tags MLflow, registre de modeles).
- Les **Insights** rapatrient les plots declares par le moteur du run : pour Ultralytics, la
  synthese `results.png`, la matrice de confusion normalisee, les courbes `BoxPR`/`BoxF1`, les
  labels et les echantillons de validation.
- Le **DVC** versionne les poids tels quels, quelle que soit leur extension.
