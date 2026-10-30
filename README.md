# HEXFRONT — prototype en ligne (règles v0.1)

Jeu de stratégie tour par tour à 2 joueurs sur un plateau hexagonal de 127 cases. On crée une partie, on envoie le lien à un ami, chacun déploie ses 13 pièces en secret, puis on joue.

| Dossier   | Rôle                                                                 |
|-----------|----------------------------------------------------------------------|
| `shared/` | Règles en TypeScript pur + contrat Socket.IO (`protocol.ts`), testés  |
| `server/` | Node.js + Express + Socket.IO, état en mémoire, serveur autoritaire   |
| `client/` | React + TypeScript + Vite, plateau en SVG                             |

## Prérequis

- Node.js ≥ 20 (testé avec Node 22)
- npm ≥ 10

## Installation

```bash
npm install
```

## Jouer en local

Mode développement (serveur sur le port 3000 + front Vite avec rechargement à chaud) :

```bash
npm run dev
```

Ouvrez `http://localhost:5173`, cliquez sur **Créer une partie**, puis ouvrez le lien d'invitation dans un **autre onglet** ou un autre navigateur. Chaque onglet garde sa propre place, on peut donc jouer les deux camps sur la même machine.

Mode production, identique à l'hébergement :

```bash
npm run build
```

```bash
npm start
```

Le jeu est alors servi sur `http://localhost:3000`.

## Inviter un ami

1. Déployez le jeu (voir ci-dessous), ou exposez votre machine locale.
2. Cliquez sur **Créer une partie** : un code de 6 caractères et un lien `https://votre-domaine/?game=CODE` s'affichent.
3. Cliquez sur **Copier le lien** et envoyez-le. Votre ami peut aussi saisir le code sur l'accueil.
4. Dès qu'il arrive, la phase de déploiement commence pour vous deux.

En cas de rechargement de la page ou de coupure réseau, la partie reprend automatiquement. Depuis l'accueil, le bouton **Reprendre la partie CODE** permet aussi de revenir à la dernière partie.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` lance les tests des règles et du serveur, dont un parcours complet avec deux vrais clients Socket.IO.

## Déploiement (un seul service)

`npm run build` compile `shared`, `client` et `server`. `npm start` sert ensuite le front et Socket.IO sur le port `PORT`.

**Render** (New → Web Service) :
- Build command : `npm ci && npm run build`
- Start command : `npm start`
- Health check path : `/healthz`

**Railway** : mêmes commandes de build et de démarrage, dans les paramètres du service.

**Fly.io** : `fly launch` détecte le projet Node. Gardez **une seule machine**, avec `min_machines_running = 1`.

Contraintes communes :
- **Une seule instance :** l'état des parties est en mémoire, deux instances ne les partageraient pas.
- **Ne pas définir `NODE_ENV=production` pendant le build :** TypeScript et Vite sont des dépendances de développement.
- **Mise en veille :** une offre gratuite qui endort le service efface les parties en cours.

Variables d'environnement :

| Variable      | Défaut        | Rôle                                         |
|---------------|---------------|----------------------------------------------|
| `PORT`        | `3000`        | Port HTTP (fourni par l'hébergeur)           |
| `CLIENT_DIST` | `client/dist` | Dossier du front buildé servi en production  |

## Fonctionnement

- **Serveur autoritaire :** le client n'envoie que des intentions (« déplacer telle pièce vers telle case »). Le serveur vérifie la forme du message, applique les règles de `shared/` et renvoie à chaque joueur sa propre vue. L'armée adverse reste cachée tant que le déploiement n'est pas terminé.
- **Couleurs :** le créateur reçoit une couleur tirée au sort ; Bleu joue toujours en premier. La revanche inverse les couleurs.
- **Mémoire :** une partie sans joueur connecté depuis 2 h est supprimée (500 parties maximum). Un redémarrage du serveur efface les parties en cours.
