# Cloudflare backend

Worker + D1 (données) + R2 (photos). Déployé, API : `https://l-et-m-api.romain-albasini.workers.dev/`.

## Commandes

```bash
cd cloudflare
npm install
npm run dev       # Worker local (D1 + R2 simulés), http://localhost:8787/
npm run deploy    # mise en ligne (manuelle)
```

Mise en ligne automatique : push sur `main` touchant `cloudflare/` → `.github/workflows/deploy.yml` (job `worker`, avant le site).

## Config

| Quoi | Où |
|---|---|
| Bucket R2 (`PHOTOS_BUCKET`), base D1 (`DB`), limite d'affichage du stockage | `wrangler.toml` |
| Schéma de la base | `schema.sql` |
| Secrets en local | `.dev.vars` (copie de `.dev.vars.example`) |
| Adresse de l'API côté site | `../src/photos.js` |

## Secrets GitHub (une seule fois)

Repo → Settings → Secrets and variables → Actions → New repository secret :

| Secret | Valeur |
|---|---|
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com/profile/api-tokens → Create Token → modèle **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard Cloudflare → Workers & Pages → Account ID |

Le schéma D1 (`schema.sql`) n'est pas appliqué par la CI.

## Secrets du Worker

```bash
npx wrangler secret put GUEST_TOKEN_SECRET   # openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN_SECRET   # openssl rand -hex 32, valeur différente
npx wrangler secret put ADMIN_PASSWORD
```

## Base de données

```bash
npx wrangler d1 execute lobna-et-martin --remote --file schema.sql
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/index.js` | table des routes (`adminOnly` / `guestOnly` = contrôle d'accès) |
| `src/routes/guest.js` | identification, upload, suppression invités |
| `src/routes/admin.js` | login, état, upload, dossiers, tags, déplacer, supprimer |
| `src/routes/settings.js` | réglages du site (menu public) |
| `src/routes/photosList.js` | liste publique des photos |
| `src/routes/img.js` | photos servies depuis R2 (`/img/...`) |
| `src/auth.js` | tokens signés, `adminOnly`, `guestOnly` |
| `src/files.js` | noms de fichiers, stockage / déplacement / suppression de photos |
| `src/cors.js` | en-têtes CORS |

## Live quiz (Kahoot-style)

A real-time quiz for the reception: guests answer on their phones, the host
runs it from a big screen. No new secret, no new service.

- **Where**: `/quiz/` (players — put this address or a QR code on the tables)
  and `/quiz/host/` (the projector; it needs you to be logged in at `/admin/`
  in the same browser — that login is what makes you the host).
- **Players** are the guest accounts (name + avatar, in D1, same as the photo page):
  they log in once, the quiz reads the account on join. The admin opens the quiz from
  the dashboard ("Quiz" switch), which also adds "Quiz" to the menu. **Existing database:**
  `wrangler d1 execute lobna-et-martin --remote --command "ALTER TABLE guests ADD COLUMN avatar TEXT"`
  and `... "ALTER TABLE guests ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"` (admin rights), and, if the earlier unique index exists, `... "DROP INDEX IF EXISTS idx_guests_avatar"` (never applied by CI).
- **How it runs**: one Durable Object per room (`src/quiz/room.js`), reached
  over a WebSocket at `/quiz/ws` on the Worker. The server owns the clock and
  the scoring. Scores survive restarts. `?room=name` on the pages (and the
  WebSocket URL) picks another room, handy for rehearsals; default is `main`.
- **Questions**: `src/quiz/questions.json` — `text`, `options` (2 to 4),
  `correct` (index of the right option), optional `seconds` (default 20).
  The file ships with sample questions marked TODO. Edit, then `npm run deploy`.
- **Deploying**: the first `npm run deploy` after this lands also runs the
  `[[migrations]]` entry in `wrangler.toml` that creates the `QuizRoom` class
  (SQLite-backed, which is what the Workers Free plan supports). Nothing else
  to set up.
- **Scoring**: 1000 points for an instant right answer, down to 500 at the
  buzzer; wrong or missing answers score 0.
- **Host buttons**: *Démarrer* → *Afficher la réponse* (also happens by itself
  when the timer ends or everyone connected has answered) → *Question
  suivante* → final ranking. *Recommencer* zeroes the scores and drops players
  who have left (so rehearsal names don't stay taken).

**Rehearse before the day** — simulates N phones playing a full game and checks
scoring, reconnection and the leaderboard (use a throw-away room):

```
QUIZ_WS_URL='wss://<your-worker>.workers.dev/quiz/ws?room=test' PLAYERS=100 \
ADMIN_TOKEN_SECRET=<your ADMIN_TOKEN_SECRET> node scripts/quiz-load-test.mjs
```

Free-plan budget (Workers Free: 100,000 Durable Object requests/day, incoming
WebSocket messages count 20:1, outgoing ones are free): 100 players × 20
questions is a few hundred billed requests. Test it anyway on the real network.
