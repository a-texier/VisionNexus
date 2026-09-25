---
app: docs
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [passages, embeddings, recherche hybride, bm25, jumeaux de langue, indexation incrémentale, index de départ]
sources: [Docs_Assistant_App/backend/core/chunker.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/backend/core/store.py, Docs_Assistant_App/backend/core/embedder.py]
---

# Concepts

## Passages

Un passage est l'unité que le Docs Assistant cherche et renvoie : une section d'une page de documentation, ou un morceau d'une longue section. La recherche ne renvoie jamais une page entière ni une phrase isolée : chaque résultat est assez petit pour être lu d'un coup et assez complet pour être compris seul.

Les pages sont découpées à leurs titres, du niveau 1 au niveau 3. Une section de moins d'environ 60 mots est fusionnée avec la suivante, car quelques lignes répondent rarement seules à une question. Une section de plus d'environ 300 mots est coupée aux frontières de paragraphes en plusieurs passages qui se recouvrent d'environ 35 mots, afin qu'une phrase à la coupure ne soit pas perdue. Un bloc de code ou un tableau n'est jamais coupé en son milieu. Chaque passage mémorise le chemin de titres qui mène à lui et le numéro du titre où il commence, ce qui permet à la fenêtre Documentation de défiler au bon endroit. Le texte indexé d'un passage commence aussi par le nom de son app tel qu'il figure dans le titre du README de l'app, par exemple `Training App - Workflows > ...`, si bien qu'une question qui nomme une app trouve les pages de cette app.

C'est pourquoi la documentation est écrite en sections autonomes dont le titre nomme le sujet : le titre et son chemin de titres font partie de ce que la recherche lit, et une section qui a besoin de la précédente pour être comprise fait une mauvaise réponse. Une section de 150 à 600 mots donne un à trois passages.

## Embeddings et modèle d'embeddings

Un embedding est une liste de nombres qui représente le sens d'un texte, si bien que deux textes qui parlent de la même chose ont des listes proches même sans mot commun. Le Docs Assistant en calcule un pour chaque passage et un pour chaque question, avec le modèle multilingue `intfloat/multilingual-e5-small`, qui comprend ensemble le français et l'anglais. Une question française est donc proche du passage anglais qui y répond, et inversement.

Le modèle est chargé depuis des fichiers du disque, jamais téléchargé pendant que le service tourne, et il utilise le GPU quand il y en a un. Le modèle plus grand `multilingual-e5-base` peut être choisi à la place : il est plus précis sur certaines questions, demande plus de mémoire et produit des vecteurs d'une autre taille, si bien que le choisir recalcule l'index une fois. Comparer une question à chaque passage est un simple produit scalaire sur une petite matrice, exact et rapide pour une documentation de quelques milliers de passages.

Les embeddings ont des limites. Ils sont bons pour le sens et plus faibles pour les noms exacts comme le libellé d'un bouton ou la clé d'une option, ce qui explique en partie pourquoi les mots-clés leur sont combinés.

## Recherche hybride : mots-clés et sens

La recherche exécute deux classements et les fusionne. Le classement par mots-clés utilise la recherche plein texte de SQLite (BM25) : il trouve les passages qui contiennent les mots de la question, sans tenir compte des accents ni des majuscules, et compte un mot d'un titre ou des tags de la page plus qu'un mot du corps. Les mots longs correspondent aussi à leur début, si bien que `propager` atteint `propagation`. Les mots courants comme `le`, `comment` ou `how` sont ignorés. Le classement par le sens compare l'embedding de la question à celui de chaque passage.

Chaque classement donne ses 50 meilleurs passages. Ils sont fusionnés par fusion de rangs réciproques : un passage gagne des points selon sa position dans chaque liste, si bien que celui qui est haut dans les deux l'emporte, et que celui qui est premier dans une seule reste visible. Deux ajustements légers sont ensuite appliqués, puis les résultats sont filtrés et regroupés : les filtres d'app, de public et de langue s'appliquent, chaque section n'apparaît qu'une fois quand les deux langues sont cherchées, et au plus deux passages par page sont gardés.

Les deux ajustements ne font que nuancer l'ordre. D'abord, les pages de référence générées (référence API et carte du code) contiennent le nom de tout ce que contient une app, et passeraient souvent devant les pages pas à pas ; sauf si la question ressemble à une question de développeur, elles sont classées un peu plus bas, et les pages README un peu plus bas aussi. Une question est une question de développeur quand elle contient quelque chose qui ressemble à du code, comme un chemin, un nom en `snake_case`, une `VARIABLE_EN_MAJUSCULES` ou un nom de fichier, ou des mots comme endpoint, API, module, fonction, schéma, IPC, "how does" ou "where is" ; les pages de référence restent alors à leur place. Ensuite, quand la question nomme une app, par son nom tel qu'il figure dans le titre de son README ou par le mot `entrainement` pour Training, les pages de cette app sont classées un peu plus haut.

Deux chiffres accompagnent les résultats et ne sont pas le rang. La **pertinence** d'un résultat est mesurée à partir de la similarité entre l'embedding de la question et celui du passage, sur une échelle de 0 à 100 % : elle reste basse quand rien dans la documentation n'est proche de la question, même pour le premier résultat. Elle n'existe que pour le modèle par défaut, qui est calibré pour cela, et que pour les passages que le classement sémantique a notés ; sinon elle est inconnue. La **confiance** de l'ensemble de la réponse est faible quand la meilleure similarité est sous un seuil mesuré pour ce modèle, ce qui signifie qu'aucune section ne répond vraiment à la question. Une question d'un ou deux mots dont les mots exacts arrivent en tête par mots-clés n'est pas signalée, car un mot-clé court donne un embedding flou mais une correspondance fiable. Une confiance faible fait afficher à la fenêtre une note qui invite à reformuler ; elle ne retire aucun résultat.

Si le modèle est absent ou en cours de chargement, seul le classement par mots-clés s'exécute et la réponse le dit. Le service fonctionne alors quand même, moins bien sur les questions qui n'ont aucun mot en commun avec la page.

## Jumeaux de langue et filtre de langue

Chaque page de documentation existe en français et en anglais, avec la même suite de titres. Deux sections situées au même endroit dans les deux fichiers sont jumelles, et le service les relie par une clé faite de la source, de la page et du numéro de titre. C'est ce qui permet à un résultat de proposer **Meme section en francais** ou **Meme section en anglais**, et à une recherche sur les deux langues de montrer chaque section une seule fois.

Le filtre de langue choisit les fichiers cherchés, et vaut **Les deux** par défaut. Une question et une page n'ont pas besoin d'être dans la même langue, grâce au modèle multilingue : le classement sémantique trouve la bonne section quelle que soit la langue de la question. Les mots-clés ne correspondent qu'à l'intérieur d'une langue : un mot anglais correspond rarement à une page française. Chercher dans les deux langues est donc plus large, et chercher dans une seule est plus net sur les mots-clés mais ne peut pas trouver ce qui n'existe que dans l'autre langue.

Avec **Les deux**, la langue de la question décide quelle jumelle est affichée. Le service reconnaît le français ou l'anglais d'après les mots courants et les accents de la question ; quand une section existe dans les deux langues, il renvoie celle de cette langue, et il lui attribue le meilleur score de ses deux jumelles pour qu'elle ne soit pas pénalisée d'être affichée dans l'autre langue. Quand la question ne tranche pas, par exemple un mot-clé seul comme `SAM2`, c'est la langue de la fenêtre Documentation qui est utilisée. Choisir **FR** ou **EN** restreint la recherche à cette langue et impose la langue d'affichage. La reconnaissance est un simple décompte de mots courants et d'accents : une question très courte ou mélangée peut être attribuée à la mauvaise langue, et le lien vers la section jumelle ouvre alors l'autre version en un clic. Si les jumelles se décalent un jour, par exemple quand un fichier reçoit un titre en plus, les liens pointent vers la mauvaise section ; le lint de la documentation le vérifie.

## Indexation incrémentale

L'index est mis à jour, pas reconstruit, à chaque démarrage. Le service calcule une empreinte de chaque fichier de documentation et la compare à celle qui est enregistrée. Un fichier inchangé est ignoré entièrement. Un fichier modifié est redécoupé, et chacun de ses passages a sa propre empreinte : seuls les passages dont l'empreinte n'a pas encore de vecteur sont calculés. Modifier un paragraphe ne recalcule donc que les passages de sa section, et déplacer ou renommer un fichier ne recalcule rien. Les fichiers disparus sont retirés, et les vecteurs orphelins supprimés.

La recherche par mots-clés est disponible dès que les passages sont stockés, avant qu'aucun embedding ne soit calculé : la recherche fonctionne donc pendant une longue synchronisation, avec une qualité réduite. Changer de modèle d'embeddings est le seul cas qui recalcule tout, car les vecteurs de deux modèles ne sont pas comparables.

## L'index de départ (seed)

L'index de départ est un index facultatif calculé à l'avance, pour qu'une machine neuve ne démarre pas avec un index vide. Il n'est jamais publié ni livré dans les bundles de la suite : par défaut, le service construit son index au premier démarrage, à partir des pages présentes sur la machine. Quand un index de départ est fourni (un déploiement interne, par exemple), au premier démarrage, si aucun index n'existe encore dans le workspace, le service y copie l'index de départ, à condition qu'il ait été construit avec le même modèle d'embeddings et la même version de stockage. Il se synchronise ensuite comme d'habitude : l'index de départ contient déjà la plupart des passages, si bien que seules les différences sont traitées.

L'index de départ est un artefact de construction : il reflète la documentation au moment où il a été construit et doit être reconstruit après un changement notable de la documentation pour rester utile. Un index de départ construit avec une ancienne version de stockage n'est pas utilisé du tout : il faut le reconstruire après un changement de cette version. Un index de départ périmé est sans danger, puisque la synchronisation le corrige, mais il économise moins de travail. L'état de l'index indique si l'index de départ a été utilisé.

## Pourquoi le premier démarrage peut être plus long

Un premier démarrage fait plus que les suivants. Le modèle d'embeddings, environ 470 Mo, est lu depuis le disque et placé sur le GPU, ce qui prend en général dix à vingt secondes. Sans index de départ, ou avec un index de départ construit pour un autre modèle, chaque passage de la documentation est calculé : quelques secondes sur un GPU, nettement plus sur un simple processeur. Sur une VM, le lancement ouvre aussi le tunnel et peut lire le dépôt sur un disque plus lent.

Rien de tout cela ne bloque l'interface. Le service répond dès qu'il est démarré, la recherche par mots-clés fonctionne pendant que l'index se remplit, et le modèle se charge en arrière-plan. Une recherche faite trop tôt se replie sur les mots-clés et le dit, et la fenêtre la répète d'elle-même une fois le modèle prêt. Dès le deuxième démarrage, l'index est réutilisé et seules les pages modifiées sont traitées.

## Limites de la recherche

Le Docs Assistant renvoie des sections existantes ; il n'écrit pas de réponse, ne résume pas et ne combine pas plusieurs pages. Il ne connaît que la documentation présente lors de sa dernière synchronisation : les pages modifiées ensuite ne sont pas trouvées avant la synchronisation suivante. Une question de moins de deux caractères ou faite uniquement de mots courants ne renvoie rien d'utile, et une question est limitée à 500 caractères. Les résultats sont plafonnés à trente, deux par page.

L'index est stocké dans votre propre dossier de workspace et n'est pas partagé entre utilisateurs. Il ne contient que du texte de la documentation, aucune donnée de vos projets.

## Architecture du modèle d'embeddings multilingual-e5-small

Le Docs Assistant utilise un seul modèle neuronal, `intfloat/multilingual-e5-small`, pour transformer chaque passage et chaque question en un vecteur de 384 nombres. Il compte environ 118 millions de paramètres, dont la plupart sont dans son vocabulaire.

### Encodeur e5-small : un petit BERT à vocabulaire multilingue

Le modèle est un encodeur BERT : 12 couches de transformer, 12 têtes d'attention, une taille cachée de 384 et une taille de réseau feed-forward de 1536, avec une table de positions jusqu'à 512 jetons. Ce qui le rend multilingue, c'est son tokenizer : un vocabulaire SentencePiece d'environ 250 000 morceaux partagé par une centaine de langues, qui détient à lui seul environ 96 millions des paramètres. Les 12 couches elles-mêmes n'en détiennent qu'environ 21 millions, ce qui explique que le modèle soit rapide même sur un processeur. Un texte de plus de 512 jetons est tronqué ; les passages de la suite (60 à 300 mots) tiennent dans cette limite.

Le texte n'est pas encodé tel quel. Un passage est préfixé par `passage: ` et une question par `query: `, car le modèle a été entraîné avec ces deux rôles et donne de meilleures similarités quand il sait lequel est lequel. Les 384 nombres d'un texte sont la moyenne des vecteurs de tous ses jetons (moyenne pondérée par le masque, sans le bourrage), normalisée à la longueur 1. Comme tous les vecteurs ont une longueur de 1, le produit scalaire d'une question et d'un passage est leur similarité cosinus.

### Comment e5 a été entraîné et ce que signifient ses scores de similarité

Les modèles E5 partent d'un encodeur multilingue et sont entraînés avec un objectif contrastif : sur de grands ensembles de paires de textes (une question et le texte qui y répond, un titre et son article), chaque texte doit être plus proche de son partenaire que des autres textes du lot. Une dernière étape affine le modèle sur des données de recherche annotées. Comme l'entraînement a utilisé des paires dans de nombreuses langues, une question française et le passage anglais qui y répond se retrouvent proches dans le même espace, ce qui explique que la recherche fonctionne d'une langue à l'autre.

La température d'entraînement est basse, si bien que les similarités sont comprimées vers le haut : deux textes sans rapport obtiennent quand même environ 0,80, et une correspondance excellente environ 0,92. Un score de 0,85 ne veut donc pas dire « pertinent à 85 % » ; ce qui compte, c'est le classement et l'écart avec les autres passages. Le Docs Assistant n'affiche pas le cosinus brut : il le remet à l'échelle entre ces deux bornes (0,80 et 0,92 pour ce modèle) pour donner une pertinence, et il signale une confiance basse quand même le meilleur passage reste sous le seuil calibré (0,845). Les noms de boutons et d'options sont le point faible des embeddings, ce qui explique que la recherche par mots-clés leur soit combinée.
