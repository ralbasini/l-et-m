# L & M — Lobna & Martin

Site du mariage : infos, galerie photo, upload des invités, diaporama.

# Infrastructure

## Architecture

```
                 ┌──────────────────────────┐
  git push ────▶ │ GitHub Actions           │ ──build──▶ GitHub Pages
  (main)         └──────────────────────────┘            (site statique)
                                                              │
                                                              ▼
                                                        ┌───────────┐
                                                        │ Navigateur│
                                                        └─────┬─────┘
                                                              │ API (JSON) + photos
                                                              ▼
  wrangler deploy ──────────────────────────────────▶ Cloudflare Worker
  (dossier cloudflare/)                                 │            │
                                                        ▼            ▼
                                                   D1 (données)  R2 (photos)
```

## Stack

- **Front** : Vite + vanilla JS, Tailwind (galerie), thème HTML5 UP (page Mariage)
- **Hébergement** : GitHub Pages — déploiement auto à chaque push sur `main`
- **API** : Cloudflare Worker (`cloudflare/`) — déploiement manuel : `npm run deploy`
- **Base de données** : Cloudflare D1 (invités, photos, dossiers, tags, réglages)
- **Photos** : Cloudflare R2, servies par le Worker (`/img/...`)

## Routing

Pages (`src/`) :

- `/` — Mariage, avec panneaux qui glissent : `#mariage`, `#galerie`, `#photos`
- `/galerie/` — galerie (affichée dans le panneau `#galerie`)
- `/photos/` — upload invités (affichée dans le panneau `#photos`)
- `/diaporama/` — diaporama projecteur
- `/admin/` — administration
- Redirections : `/guest/` → `/photos/`, `/mariage/` → `/`, `/slideshow/` → `/diaporama/`

API (Worker) :

- Public : `/photos-list`, `/settings`, `/img/...`
- Invités : `/guest/identify`, `/guest/me`, `/guest/upload`, `/guest/delete`
- Admin : `/admin/login`, `/admin/state`, `/admin/upload`, `/admin/move`, `/admin/delete`, `/admin/tag`, dossiers, tags, `/admin/settings`

## Fonctionnalités

- **Mariage** : infos (lieu, programme, contact)
- **Galerie** : photos en polaroïd, nom de l'invité, filtre par tags, plein écran
- **Photos** : upload invités par QR code — juste un prénom, 15 photos max, qualité d'origine, reprise auto si le réseau coupe
- **Diaporama** : défilement auto, nouvelles photos ajoutées toutes les 60 s, plein écran
- **Admin** : mot de passe, upload, dossiers, tags (plusieurs photos à la fois), déplacer / supprimer
- **Visibilité** : Galerie et Photos privées (admin) ou publiques (tous) — interrupteur dans l'admin ; le menu Admin n'est visible qu'une fois connecté

# Développement

## Site

```bash
npm install
npm run dev       # serveur local
npm run build     # build dans dist/
npm run preview   # sert dist/ → http://localhost:4173/l-et-m/
```

- Mise en ligne : push sur `main`
- Menu + footer : une seule source — `vite.config.js` (plugin `site-chrome`) + `src/site-chrome.css`
- Look commun Photos / Admin : `src/ui.css`
- Adresse de l'API : `src/photos.js`

## API (`cloudflare/`)

```bash
cd cloudflare
npm install
npm run dev       # Worker en local (D1 + R2 simulés)
npm run deploy    # mise en ligne du Worker
```

- Schéma de la base : `cloudflare/schema.sql`
- Secrets : `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, `GUEST_TOKEN_SECRET`
- Changer le mot de passe admin : `npx wrangler secret put ADMIN_PASSWORD`

# Utilisation

## Photos

- Ajout : page **Photos** (invités) ou **Admin**
- Toujours dans un dossier (pas à la racine)
- Dossiers = rangement uniquement, la galerie affiche tout
- Tags : créés dans l'admin, plusieurs par photo, filtres dans la galerie
- Rien à redéployer : une photo ajoutée apparaît au prochain chargement (liste mise en cache ~10 s)
- Une miniature (480 px) est créée à l'envoi pour les grilles ; l'original reste intact

## Invités (QR code)

- QR code vers `https://ralbasini.github.io/l-et-m/photos/`
- L'invité donne son prénom → ses photos vont dans `Invités/<prénom>/`
- 15 photos max par personne, 15 Mo max par photo, qualité d'origine
- Il voit et peut supprimer ses propres photos
- Publiées tout de suite, sans validation

## Diaporama (jour J)

- `/diaporama/` sur le vidéoprojecteur
- Photos mélangées, nouvelles photos ajoutées toutes les 60 s
- Réglages (roue dentée) : style polaroïd ou standard, durée par photo (7 s par défaut), plein écran

## Admin

- `/admin/`, ou lien **login** dans le footer
- **Visibilité du site** : Privée / Publique
- Taguer : sélectionner des photos → cliquer un tag
- Déplacer / supprimer : sélectionner des photos

## Changement de domaine

Voir `SITE_MIGRATION.md`.
