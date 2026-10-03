# Moving the site to lobna-et-martin.ch

## 1. Romain — get the verification code

- GitHub **Settings → Pages → Add a domain** → `lobna-et-martin.ch`
- Send the TXT code to Martin.

## 2. Martin — Infomaniak

- Connect to [Infomaniak](login.infomaniak.com)
- Go to **Domaines → lobna-et-martin.ch → Modifier la Zone DNS**
- Click **Vue avancée**

1. Delete these lines if present (keep all others):
   - type **A** or **AAAA** with an **empty name** (first column blank)
   - any line named **www**
2. Add (replace `CODE` with the code sent by Romain):

   ```
   @                                  3600  IN A      185.199.108.153
   @                                  3600  IN A      185.199.109.153
   @                                  3600  IN A      185.199.110.153
   @                                  3600  IN A      185.199.111.153
   www                                3600  IN CNAME  ralbasini.github.io.
   _github-pages-challenge-ralbasini  3600  IN TXT    "CODE"
   ```

## 3. Romain — GitHub

1. GitHub **Settings → Pages** → `lobna-et-martin.ch` → **Verify**.
2. Repo `ralbasini/l-et-m` **Settings → Pages → Custom domain** → `lobna-et-martin.ch` → Save.
3. Right after: set `base: '/'` in `vite.config.js`, push.
4. When available: tick **Enforce HTTPS**.

## 4. Check

- `https://lobna-et-martin.ch` and `https://www.lobna-et-martin.ch` open the site.
- `https://ralbasini.github.io/l-et-m/` redirects to the new domain.
- Galerie, photo upload and admin login work.
- Email to `mariage@lobna-et-martin.ch` still arrives.
