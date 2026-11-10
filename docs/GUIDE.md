# Guide complet — tsukiboshi 月星 (v5.11)

Plateformes : Netflix, Crunchyroll, ADN, Disney+, Prime Video.
Fonctionne avec n'importe quel compte : l'extension utilise le compte connecté dans Chrome.

## Installation
Navigateurs pris en charge : Chrome, Edge, Opera (et Opera GX), Brave, Vivaldi. Pas Firefox ni Safari pour l'instant.
1. Décompresser le zip dans un dossier à garder
2. Ouvrir la page des extensions : `chrome://extensions`, `edge://extensions`, `opera://extensions`, `brave://extensions` ou `vivaldi://extensions`
3. Activer le **Mode développeur** → **Charger l'extension non empaquetée** (Edge : « décompressée ») → choisir ce dossier
4. Dans les réglages des téléchargements (`chrome://settings/downloads`, `edge://settings/downloads`, `opera://settings/downloads`…),
   désactiver la demande d'emplacement à chaque téléchargement

## 1re utilisation (une seule fois)
Popup de l'extension → **Importer** à côté de chaque plateforme → **Lancer l'import**. La page Historique s'ouvre, l'import démarre seul
et récupère **tout** l'historique depuis la création du compte. Avec des milliers d'épisodes, ça peut prendre plusieurs minutes
(10 000 épisodes ≈ 1 minute pour Crunchyroll, fichier Excel ≈ 2 Mo).
Netflix : refaire l'import pour chaque profil (choisir le profil, puis retourner sur la page Historique).

## Ensuite, tout est automatique et discret
- **Suivi en direct** : chaque vidéo regardée plus d'1 minute sur ce navigateur est ajoutée (date, heure, temps regardé, durée).
- **Synchro toutes les 6 h** : l'extension relit l'historique de chaque plateforme importée dans une fenêtre réduite,
  puis la ferme → récupère aussi ce que tu regardes sur la TV / le téléphone.
- Le fichier est réécrit sans bulle de téléchargement :
  `Téléchargements/Tsukiboshi/Tsukiboshi - historique.xlsx`

## Ma liste
Popup → **Ma liste** : une page avec toutes tes séries et tous tes films en vignettes.
- Filtres par statut (**En cours**, **Vu**, **Ajouté à la liste**) et par plateforme, recherche (touche `/`), tri.
- Chaque vignette montre où tu en es (dernier épisode vu) et quand.
- Clic sur une vignette : statut modifiable, statistiques, bouton pour rouvrir le dernier épisode, liste de tous les épisodes vus.
- Affiches automatiques (comme Plex), recherchées selon le type du titre (film, série, animé, spectacle) :
  TMDB (facultatif, clé gratuite à coller dans les réglages), Allociné, IMDb, AniList (animés), iTunes / Apple TV (films), TVmaze (séries).
  « Affiches : x / y — voir les sources » (sous les filtres) montre quelle source répond ou bloque.
  Un indicateur en haut de « Ma liste » montre la progression.
- **Changer l'image** (dans la fiche) : choisir parmi les affiches proposées, ou coller le lien de n'importe quelle image.
- **+ Ajouter** : met un titre de côté avec le statut « Ajouté à la liste ».
- Crunchyroll : vraie affiche, nombre d'épisodes vus / total, prochain épisode, progression par saison
  (infos récupérées après chaque import et rafraîchies à chaque synchro).
- Statut automatique : tous les épisodes vus = Vu (série en cours de diffusion = En cours « À jour »), sinon En cours ; film = Vu. Un statut choisi à la main est gardé (et repris dans l'onglet *Séries* de l'Excel).

### Ce soir
Bouton **Ce soir** en haut de Ma liste : choisis le temps dont tu disposes (20 min, 1 heure, toute la soirée) et ton envie (genre).
Tsukiboshi propose 3 idées concrètes avec un bouton ▶ : nouvel épisode sorti, épisode à reprendre, prochain épisode, suite à voir, titre de ta liste, ou série mise de côté depuis plus de 2 mois (« On reprend ? », avec un bouton **Abandonner**).
« Autres idées » fait défiler les propositions suivantes.

### Suites à voir
Pour chaque animé que tu as terminé, Tsukiboshi cherche sur AniList la suite (nouvelle saison, film, OAV) que tu n'as pas encore vue.
- Rangée **Suites à voir** sous « À suivre », avec les plateformes où la regarder.
- Les suites annoncées apparaissent avec leur date de sortie prévue.
- **+ Ajouter à ma liste** la met de côté ; la croix ne la propose plus.

### Calendrier des sorties
Onglet **Calendrier** : la semaine jour par jour, avec l'heure de sortie de chaque épisode des séries que tu suis.
- **VO** : diffusion au Japon (AniList) ou diffusion d'origine pour les séries (TVmaze).
- **VOSTFR** et **VF** : dates réelles du catalogue Crunchyroll (lues pendant la synchro).
- **≈** : date estimée d'après les épisodes précédents (ex. VF environ 3 semaines après la VOSTFR).
- ✓ : épisode déjà vu. Flèches pour changer de semaine.
- Réglage **Je regarde en** (popup ou calendrier) : VOSTFR, VF ou les deux. En VF, l'alerte arrive quand l'épisode sort en VF.
- Netflix / Prime : la VF sort en général le même jour que la VO, sans date annoncée à l'avance.

### Rechercher un animé
Onglet **Rechercher** : tape le nom de n'importe quel animé (même si tu ne l'as jamais vu).
- Fiche complète : résumé, studio, épisodes, note, genres, et toutes ses saisons, films et OAV dans l'ordre.
- **Où le regarder** : liens directs vers les plateformes qui le proposent (Crunchyroll, ADN, Netflix, Prime Video, Disney+…).
- Sans recherche, la page montre les **animés du moment**. Ceux déjà dans ta liste sont signalés.

### Tournoi
Onglet **Tournoi** : tes titres de la semaine, du mois ou de l'année s'affrontent en duels (4, 8 ou 16 participants, ceux où tu as passé le plus de temps).
- Clique sur ton préféré, ou utilise les flèches ← / →. Le tableau se remplit au fil des tours.
- Le champion : couronne, parcours (« a battu… »), **Télécharger l'image** (carte 1080 × 1350 à partager) et **Lui mettre 5 ★**.
- Le **palmarès** garde un champion par période ; celui de l'année apparaît aussi dans le Bilan.

### Nouvelle version disponible
Une fois par jour, Tsukiboshi regarde la dernière version publiée sur GitHub. Si elle est plus récente que la tienne, un bandeau apparaît en haut du popup avec le lien de téléchargement.

### Statut Abandonné
En plus de En cours / Vu / Ajouté à la liste : une série abandonnée n'apparaît plus dans « À suivre » ni « Ce soir ». Repris dans l'Excel.

### Ma note, favoris, avis
- Dans la fiche d'un titre : 1 à 5 étoiles (re-cliquer la même étoile efface la note), ♥ Favori et un avis libre.
- Les étoiles et le ♥ apparaissent sur la vignette ; filtre **Favoris** et tri **Ma note**.
- Repris dans l'Excel (feuille « Séries » : Ma note, Favori, Mon avis) et dans la sauvegarde.

### Genres et époque
- Trouvés automatiquement en tâche de fond : AniList (animés), page Netflix du titre, TVmaze (séries), iTunes (films), ramenés à une liste française (Action, Comédie, Tranche de vie…).
- Listes **Genre** et **Époque** (années de sortie) à côté du tri ; dans la fiche, un clic sur un genre filtre la liste.
- Repris dans l'Excel (feuille « Séries » : Genres, Sortie) et dans le Bilan (« Tes genres »).

### À suivre
En haut de Ma liste : les séries en cours, la plus récente d'abord.
- **Reprendre** : l'épisode a été arrêté en cours de route, le bouton ▶ le rouvre directement.
- **Prochain** : l'épisode suivant (Crunchyroll), le bouton ▶ ouvre la page de la série sur la plateforme.
- La croix retire une série de la rangée jusqu'au prochain épisode regardé.

### Nouveaux épisodes (Crunchyroll)
- Pour les séries en cours de diffusion que tu suis (regardées ces 4 derniers mois) : vérification toutes les 3 h pendant la synchro discrète.
- Quand un épisode sort et que tu étais à jour : notification, compteur orange sur l'icône, et la série passe en tête de « À suivre » avec le badge **Nouveau**.
- Tout disparaît dès que l'épisode est regardé. Réglages → « Alertes nouveaux épisodes » pour couper les notifications.

## Bilan
Onglet **Bilan** en haut de Ma liste : par année ou depuis le début.
- Heures regardées, épisodes, séries, films, nombre de soirées.
- Calendrier (une case par soirée), heures par mois, part de chaque plateforme.
- Top 10 des séries au temps passé, tes jours et heures préférés, records.
- Durées : temps réellement regardé quand la plateforme le donne, sinon estimation (23 min par épisode d'animé, 42 min par épisode de série, 1 h 45 par film). Une journée est plafonnée à 14 h.

## Sauvegarde (changer de PC)
- Une copie automatique est faite chaque jour : Téléchargements / Tsukiboshi / Tsukiboshi - sauvegarde automatique.json.
- Réglages du popup → **Sauvegarder maintenant** pour une copie datée.
- Sur le nouveau PC : installer l'extension, puis Réglages → **Restaurer…** et choisir le fichier. Tout est fusionné, rien n'est effacé ni dupliqué.

## Le fichier Excel
- **Par série** : chaque série / anime avec ses épisodes en dessous (date, heure, temps regardé, progression).
  Les boutons **1 / 2** et **+ / −** à gauche d'Excel replient ou déplient les séries.
- **Séries** : une ligne par série (épisodes vus, premier et dernier visionnage, temps total).
- **Tout** et un onglet par plateforme : liste chronologique complète, avec filtres.
- **Résumé** : totaux par plateforme.

Les doublons (même épisode vu en direct puis retrouvé dans l'historique) sont fusionnés automatiquement.

## Nouveautés 5.11
- **Calendrier des sorties** VO, VOSTFR et VF, alerte quand un épisode sort en VF, réglage « Je regarde en » dans le popup.
- **Import Netflix** : ne tourne plus sans fin quand « Voir plus » ne charge plus rien ; fichier CSV reconnu dans toutes les langues ; nouvelle mise en page de l'historique prise en charge ; bouton « Arrêter et garder ce qui est trouvé ».
- **Synchro** : le popup affiche la plateforme en cours (3 min au plus par plateforme).

## Nouveautés 5.8 (fiabilité)
- Un site d'affiches qui ne répond pas ne bloque plus la recherche (délai maximal de 15 s par demande).
- Plus de recherche en boucle quand un site sature.
- Pendant la lecture, la base n'est plus réécrite toutes les 5 s (toutes les 30 s, et à la fin de l'épisode).
- Recherche dans Ma liste corrigée avec beaucoup de titres ; « / » s'écrit normalement dans l'avis et le lien d'image.
- Liens dangereux (javascript:, data:) refusés ; plus d'erreurs dans chrome://extensions après une mise à jour.
- Clavier : focus qui suit la fiche, « À suivre » accessible, Échap partout. Bouton Bilan dans le popup.

## Limites
- L'heure exacte n'est connue que pour Netflix et les visionnages suivis en direct ; les autres historiques donnent seulement le jour.
- Les dates VOSTFR et VF ne sont connues que pour Crunchyroll (après une synchro) ; ailleurs, seule la VO est affichée.
- Disney+ n'a pas de page d'historique : seuls les visionnages faits sur ce navigateur sont enregistrés.
- La synchro ne fonctionne que si Chrome est ouvert et que tu es connecté aux sites.
- Fermer le fichier dans Excel pour qu'il puisse être remplacé.
- Si un site change son code et qu'un import ne trouve plus rien, l'extension devra être adaptée.
