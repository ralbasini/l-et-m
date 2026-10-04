# Moving the site to lobna-et-martin.ch

## 1. Romain — get the verification code

- GitHub **profile picture → Settings → Pages** (account settings, not the repo) → **Add a domain** → `lobna-et-martin.ch`
- Leave the repo's Custom domain empty for now (it errors until DNS is set).
- Send the TXT code to Martin.

## 2. Martin — Infomaniak

- Connect to [Infomaniak](login.infomaniak.com)
- Go to **Domaines → lobna-et-martin.ch → Modifier la Zone DNS**
- Click **Vue avancée**

1. Delete these lines if present (keep all others):
   - type **A** or **AAAA** with an **empty name** (first column blank)
   - any line named **www**
2. Replace content with:

   ```
   ; Domain: lobna-et-martin.ch
   $TTL 3600
   @                                  IN SOA   ns11.infomaniak.ch. hostmaster.infomaniak.ch. (2026012861 10800 3600 605800 3600)
   @                             3600 IN A     185.199.108.153
   @                             3600 IN A     185.199.109.153
   @                             3600 IN A     185.199.110.153
   @                             3600 IN A     185.199.111.153
   @                             3600 IN MX 5  mta-gw.infomaniak.ch.
   @                             3600 IN NS    ns11.infomaniak.ch.
   @                             3600 IN NS    ns12.infomaniak.ch.
   @                             3600 IN TXT   "v=spf1 include:spf.infomaniak.ch -all"
   autoconfig                    3600 IN CNAME infomaniak.com.
   autodiscover                  3600 IN CNAME infomaniak.com.
   www                           3600 IN CNAME ralbasini.github.io.
   _dmarc                        3600 IN TXT   "v=DMARC1; p=reject;"
   _domainkey                    300  IN NS    ns11.infomaniak.ch.
   _domainkey                    300  IN NS    ns12.infomaniak.ch.
   _github-pages-challenge-ralbasini 3600 IN TXT "b3c5b1e23854885399f36206fb6cc6"
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
