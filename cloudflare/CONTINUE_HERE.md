# Continue here

Where this was left off: the Worker/R2/D1 backend is fully written and
tested locally (see the commit history on this branch), but nothing is
deployed yet — that needs to happen from a machine that can reach
`api.cloudflare.com` and open a browser for login, which a cloud sandbox
can't do. Your Cloudflare account is already created.

**First, housekeeping**: if you pasted a Cloudflare API token into a chat
session earlier, revoke it now (it was never successfully used, but no
reason to leave it live) — https://dash.cloudflare.com/profile/api-tokens →
delete it.

## Checklist

```
git clone https://github.com/ralbasini/l-et-m.git
cd l-et-m
git checkout cloudflare-migration
cd cloudflare
npm install
npx wrangler login              # opens a browser to authorize
```

- [ ] `npx wrangler r2 bucket create l-et-m-photos`
- [ ] Connect a public domain to that bucket (R2 → bucket → Settings →
      Public access → Connect Domain, in the dashboard) — note the domain,
      it's `PHOTOS_BASE_URL` in step 7.
- [ ] `npx wrangler d1 create l-et-m` — copy the `database_id` it prints into
      `wrangler.toml`'s `[[d1_databases]]` block (replaces the `TODO-...`
      placeholder)
- [ ] `npx wrangler d1 execute l-et-m --remote --file schema.sql`
- [ ] Set the three secrets (generate the two `*_SECRET` values with
      `openssl rand -hex 32`, pick your own admin password):
  ```
  npx wrangler secret put GUEST_TOKEN_SECRET
  npx wrangler secret put ADMIN_TOKEN_SECRET
  npx wrangler secret put ADMIN_PASSWORD
  ```
- [ ] `npm run deploy` (or `npx wrangler deploy`) — note the URL it prints,
      it's `API_BASE_URL` in step 7
- [ ] In `../src/photos.js`, replace the two placeholder constants with the
      real `API_BASE_URL` and `PHOTOS_BASE_URL` from above
- [ ] From the repo root: `npm run build`, then redeploy the static site the
      way this project normally publishes to GitHub Pages
- [ ] Test: load the main site, the guest upload page, and the admin panel
      against the new backend — try a guest upload, a delete, and (as admin)
      a folder move and a tag edit

Full detail and context for every step above (why each one, what the custom
domain step is for, local dev instructions) is in `README.md` right next to
this file — this is just the condensed version to work through top to
bottom.
