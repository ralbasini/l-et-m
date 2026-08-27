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
├── admin/              panneau protégé par mot de passe (vous deux)
└── guest/              page d'upload ouverte aux invités, voir plus bas
```

Séparer `img/` du reste garantit que le dossier où atterrissent les fichiers envoyés par upload ne peut jamais exécuter de code, même en cas d'erreur ou de mauvaise manip.

Ajouter/retirer des photos se fait en déposant ou supprimant des fichiers image dans `l-et-m/img/` (FTP, ou l'outil interne prévu à cet effet) — **rien à rebuilder ni redéployer** sur le site.

`img/` peut contenir des sous-dossiers pour s'organiser (ex. `img/Cérémonie/`, `img/Soirée/`) — c'est purement pour le rangement, ça n'a aucun effet sur le site public. Le site, lui, affiche toujours toutes les photos de `img/` (et sous-dossiers) mélangées dans une seule galerie.

Optionnel, pour chaque photo :
- une légende : fichier `nom-de-la-photo.jpg.txt` à côté (texte brut = texte alternatif) ;
- des tags : fichier `nom-de-la-photo.jpg.tags` à côté (texte brut, séparés par des virgules, ex. `cérémonie, extérieur`). Contrairement aux dossiers, les tags sont indépendants du rangement en sous-dossiers et une photo peut en avoir plusieurs. Dès qu'au moins une photo a un tag, le site affiche des filtres permettant aux visiteurs de n'afficher que les photos d'un ou plusieurs tags.

L'ordre d'affichage suit l'ordre alphabétique naturel des noms de fichiers — préfixer par `01-`, `02-`, etc. pour contrôler l'ordre.

Tant qu'aucune photo n'est présente, le site affiche un état "photos à venir" — rien n'est cassé.

`loadPhotos()` (dans `src/photos.js`, partagé par le site et le diaporama projecteur ci-dessous) interroge `photos-list.php` à chaque chargement de page ; c'est le seul endroit à modifier si la source de photos change un jour (S3, etc.), en renvoyant le même format (`{ src, alt }` par photo).

## Diaporama pour le jour J (`/slideshow/`)

`https://ralbasini.github.io/l-et-m/slideshow/` est une page à part, pensée pour tourner sur un vidéoprojecteur pendant la réception : les photos défilent en fondu (7s chacune, jamais recadrées), et la page revérifie `photos-list.php` toutes les 60s — les photos envoyées par les invités via le QR code rejoignent donc le diaporama toutes seules, sans y toucher. Un premier clic passe en plein écran.

## Upload par les invités (QR code)

`infomaniak/guest/` est une page publique, sans mot de passe. À la première visite, l'invité indique juste son prénom (jamais redemandé ensuite, retenu via un cookie signé) — ses photos vont dans `img/Invités/<son prénom>/` et apparaissent sur le site **immédiatement**, sans validation de votre part au préalable. La page lui montre aussi ses propres photos déjà envoyées, avec un bouton pour en supprimer une (ce qui lui redonne de la place : la limite de 15 par personne se recalcule à chaque fois sur ce qu'il reste réellement dans son dossier, pas sur un compteur séparé). Un invité ne voit et ne peut supprimer que ses propres photos.

Un QR code pointant vers `https://ralbasini.ch/l-et-m/guest/` peut être imprimé sur les tables/invitations. Pour le régénérer ou changer l'URL, n'importe quel générateur de QR code en ligne fonctionne.

À déployer comme le reste : dossier `infomaniak/guest/` (avec son `.htaccess` et `.user.ini`) et `infomaniak/shared.php` dans `l-et-m/`. Deux réglages dans `config.php` (partagé avec l'admin) contrôlent ce comportement :
```php
'guest_upload_secret' => '...',           // génère le tien : openssl rand -hex 32
'guest_upload_max_per_person' => 15,
```
