# Cloudflare backend (replaces the Infomaniak PHP backend)

Replaces `infomaniak/*.php` (guest upload, admin panel, photo listing) with a
Cloudflare Worker, an R2 bucket (object storage, replaces the `img/` folder),
and a D1 database (SQLite, replaces the filesystem-derived bookkeeping the
PHP scripts did). See the main project's chat history / commit message on
this branch for the reasoning; short version: PHP on shared hosting has hard
upload-size/execution-time limits that kept rejecting guests' phone photos,
and R2's egress is free, which matters for a gallery that gets *viewed* a lot
more than it gets uploaded to.

**Status: scaffolded, not deployed.** Nothing here talks to a real Cloudflare
account yet — every account-specific value is a `TODO` placeholder. This
guide is the checklist for turning that into a live backend.

## 1. Prerequisites

- A free Cloudflare account: https://dash.cloudflare.com/sign-up
- Node.js (already required for the main site)
- From this `cloudflare/` directory: `npm install`, then `npx wrangler login`
  (opens a browser to authorize the CLI — one-time)

## 2. Create the R2 bucket

```
npx wrangler r2 bucket create l-et-m-photos
```

(Pick a different name if you like — just keep `wrangler.toml`'s
`bucket_name` in sync.)

**Connect a public domain to it** so photos are servable at a URL (this
replaces `ralbasini.ch/l-et-m/img/`): in the Cloudflare dashboard, go to
R2 → your bucket → Settings → Public access → Connect Domain, and follow the
prompts (needs your domain's DNS on Cloudflare — see step 5). Note the
domain you land on; it's `PHOTOS_BASE_URL` below.

## 3. Create the D1 database

```
npx wrangler d1 create l-et-m
```

This prints a `database_id` — copy it into `wrangler.toml`'s
`[[d1_databases]]` block, replacing the `TODO-...` placeholder. Then apply
the schema:

```
npx wrangler d1 execute l-et-m --remote --file schema.sql
```

## 4. Set secrets

Three values the Worker needs that must never live in the repo:

```
npx wrangler secret put GUEST_TOKEN_SECRET   # paste output of: openssl rand -hex 32
npx wrangler secret put ADMIN_TOKEN_SECRET   # paste output of: openssl rand -hex 32 (a DIFFERENT value)
npx wrangler secret put ADMIN_PASSWORD       # pick your own admin panel password
```

For local testing before you deploy, copy `.dev.vars.example` to `.dev.vars`
(gitignored) and fill in your own values there instead — `wrangler dev`
reads that file automatically; it's never used for the deployed Worker.

## 5. (Optional but recommended) Custom domain for the API

Without this, the Worker is reachable at
`l-et-m-api.<your-subdomain>.workers.dev`, which works fine. To use your own
domain instead (e.g. `api.your-domain.example`): put that domain's DNS on
Cloudflare (free), then uncomment and fill in the `routes` block in
`wrangler.toml`.

## 6. Deploy the Worker

```
npm run deploy
```

(Or `npx wrangler deploy` directly.) Note the URL it deploys to — that's
`API_BASE_URL` below.

## 7. Point the frontend at your deployed backend

In `../src/photos.js`, replace the two placeholders:

```js
export const API_BASE_URL = 'https://l-et-m-api.<your-subdomain>.workers.dev/' // or your custom domain
export const PHOTOS_BASE_URL = 'https://<your-r2-public-domain>/'
```

Then rebuild and redeploy the static site as usual (`npm run build`, commit
`dist/` or however this project currently publishes to GitHub Pages).

## 8. Test end to end

- Load the main site, guest upload page, and admin panel against the new
  backend.
- Try a guest upload, a delete, and (as admin) a folder move and a tag edit.
- Once you're confident, Infomaniak can be decommissioned for this project
  (check first whether you use that hosting for anything else, like email).

## Local development

`npm run dev` (from this directory) runs the Worker locally via Miniflare —
fully offline, D1 and R2 both simulated on disk, no real Cloudflare account
needed for this part. Point a local build of the frontend at
`http://localhost:8787/` to test changes before deploying. This is how the
routes in `src/` were verified while building this out (see the commit
history on this branch).

## What's in here

| File | Replaces |
|---|---|
| `src/index.js` | routing (was: individual `.php` files) |
| `src/routes/guest.js` | `guest/identify.php`, `me.php`, `upload.php`, `delete.php` |
| `src/routes/admin.js` | everything under `admin/` |
| `src/routes/photosList.js` | top-level `photos-list.php` |
| `src/auth.js` | the bearer-token signing/verification both guest and admin auth used |
| `src/files.js` | filename sanitization/uniqueness, folder registration |
| `schema.sql` | the `img/` folder's directory structure (guests, photos, folders, tags now live in D1 instead of being derived from a filesystem scan) |
