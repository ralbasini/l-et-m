# L & M — Lobna & Martin

Site du mariage : diaporama plein écran + galerie photo.

## Stack

Vite + Tailwind CSS v3 + vanilla JS (même stack que `parenthese-hygieniste`). Racine app : `src/`, statiques : `public/`, build : `dist/`.

```bash
npm install
npm run dev       # serveur local
npm run build     # build de prod dans dist/
npm run start     # sert dist/ (npm run build d'abord)
```

## Ajouter des photos

Les photos ne sont pas dans ce dépôt : elles vivent dans un dossier Infomaniak séparé (`https://ralbasini.ch/l-et-m/`), organisé ainsi :

```
l-et-m/
├── .htaccess           (bloque l'exécution PHP, sauf photos-list.php)
├── photos-list.php
├── img/                (uniquement les photos + légendes .txt — jamais de code)
│   └── .htaccess       (interdit toute exécution ici, sans exception)
└── admin/
```

Séparer `img/` du reste garantit que le dossier où atterrissent les fichiers envoyés par upload ne peut jamais exécuter de code, même en cas d'erreur ou de mauvaise manip.

Ajouter/retirer des photos se fait en déposant ou supprimant des fichiers image dans `l-et-m/img/` (FTP, ou l'outil interne prévu à cet effet) — **rien à rebuilder ni redéployer** sur le site.

Optionnel : pour une légende, ajouter un fichier `nom-de-la-photo.jpg.txt` à côté de la photo (texte brut = texte alternatif). L'ordre d'affichage suit l'ordre alphabétique naturel des noms de fichiers — préfixer par `01-`, `02-`, etc. pour contrôler l'ordre.

Tant qu'aucune photo n'est présente, le site affiche un état "photos à venir" — rien n'est cassé.

`loadPhotos()` dans `src/main.js` interroge `photos-list.php` à chaque chargement de page ; c'est le seul endroit à modifier si la source de photos change un jour (S3, etc.), en renvoyant le même format (`{ src, alt }` par photo).
