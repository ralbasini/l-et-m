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
