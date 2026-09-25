---
app: docs
doc_type: readme
audience: both
lang: fr
title: Docs Assistant
order: 0
tags: [recherche dans la documentation, passages, embeddings, recherche hybride, ressource de calcul, demander à la doc]
sources: [Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/sync.py, desktop/ui/ask.js, desktop/src/services.ts]
---

# Docs Assistant

## Ce que fait le Docs Assistant

Le Docs Assistant est la recherche dans la documentation de la suite. Vous saisissez une question en français ou en anglais, et il renvoie les passages de la documentation produit qui y répondent le mieux. Il n'écrit jamais de réponse de lui-même : chaque résultat est une section existante d'une page de documentation, affichée avec son fil d'Ariane, un court extrait et un lien vers la même section dans l'autre langue.

- **Il cherche dans toutes les sources documentées** : les pages de toutes les apps, de VisionNexus lui-même et du Docs Assistant, dans les deux langues.
- **Il combine deux façons de chercher** : les mots exacts (mots-clés) et le sens (un modèle d'embeddings), si bien qu'une question formulée autrement que la page la trouve quand même.
- **Il tourne comme une ressource de calcul** : un backend sans interface, allumé depuis la section **Ressources de calcul** de VisionNexus, en local ou sur une VM Linux GPU.
- **Il se tient à jour tout seul** : à chaque démarrage, il relit la documentation et ne retraite que les pages modifiées.

Vous l'utilisez depuis l'onglet **Demander a la doc** de la fenêtre **Documentation**. Le service peut aussi être appelé en HTTP, ce qui est décrit dans la [référence API](api-reference.fr.md).

## Place du Docs Assistant dans la suite

Le Docs Assistant n'est pas l'une des applications du schéma : il n'a ni tuile, ni onglet, ni écran de workspace. C'est une ressource de calcul que la fenêtre **Documentation** utilise pour répondre aux questions. VisionNexus le démarre avec le même lanceur que les apps (`python launcher.py --app docs --backend-only`), redirige son port par le tunnel SSH quand une VM est sélectionnée, et lui relaie les recherches de la fenêtre ; la fenêtre ne parle jamais directement au service.

Le service lit la documentation du dépôt depuis lequel il tourne : sur une VM, il cherche donc dans les pages déployées là-bas. Ses données, l'index, vivent dans le dossier de workspace `docs_<utilisateur>/`, à côté des workspaces des applications. Le lien avec les autres pages de la suite est décrit dans [Concepts](concepts.fr.md).

## Démarrage rapide en cinq étapes

Ce démarrage rapide suppose que les réglages de VisionNexus sont complets. Les prérequis sont détaillés dans [Configuration](configuration.fr.md).

1. Une fois par machine qui exécute le service, téléchargez le modèle d'embeddings : depuis `Docs_Assistant_App/`, exécutez `python scripts/download_model.py`. Sans lui, la recherche fonctionne encore avec les mots-clés seulement.
2. Dans la section **Ressources de calcul** de VisionNexus, cliquez sur l'interrupteur de **Docs Assistant**. L'état passe de **Demarrage...** à **Pret**, puis affiche le nombre de passages indexés.
3. Cliquez sur **Documentation**, puis sur l'onglet **Demander a la doc**.
4. Saisissez une question, par exemple `comment exporter en YOLO ?`, et cliquez sur **Chercher**.
5. Cliquez sur un résultat pour ouvrir la section dans l'onglet **Docs par app**.

## Pages de documentation du Docs Assistant

La documentation du Docs Assistant est répartie en neuf pages. Les pages utilisateur viennent d'abord, les pages développeur en dernier.

- [Guide utilisateur](user-guide.fr.md) : la carte du catalogue et l'onglet **Demander a la doc**, les filtres, les cartes de résultat, le mode mots-clés seuls.
- [Procédures](workflows.fr.md) : allumer le service en local ou sur une VM, poser une question, rafraîchir ou reconstruire l'index, changer la langue de recherche.
- [Concepts](concepts.fr.md) : passages, embeddings, recherche hybride, jumeaux de langue, indexation incrémentale, index de départ et premier démarrage plus lent.
- [Configuration](configuration.fr.md) : variables d'environnement, poids de modèle, fonctionnement hors ligne, périphérique de calcul, workspace, port et index de départ.
- [Dépannage](troubleshooting.fr.md) : modèle absent, index vide, service injoignable, première requête lente.
- [Architecture](architecture.fr.md) : le chunker, le schéma du stockage, la synchronisation, la recherche, l'intégration au lanceur et le pont avec l'app de bureau.
- [Référence API](api-reference.fr.md) : les endpoints HTTP, avec les champs de requête et de réponse.
- [Carte du code](code-map.fr.md) : où vit chaque fonctionnalité dans le code et où la modifier.
