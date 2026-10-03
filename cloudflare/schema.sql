-- D1 schema for the Cloudflare backend that replaces the Infomaniak PHP
-- scripts. Apply with:
--   wrangler d1 execute l-et-m --remote --file schema.sql

-- Folders are tracked explicitly rather than derived from photo paths, so
-- an empty folder created via the admin panel (create-folder) still shows
-- up, and delete-folder's two modes (move photos to parent vs. purge) have
-- something to act on even when the folder holds zero photos.
CREATE TABLE folders (
  path TEXT PRIMARY KEY,     -- e.g. "Invités/Camille"; '' (root) is never stored here
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per guest identity (their display name). No password: identity is
-- just "which name did you type", same trust model as the PHP version — the
-- guest_token_secret's job is only to make the bearer token unforgeable, not
-- to authenticate a person.
CREATE TABLE guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,       -- full object key, e.g. "Invités/Camille/IMG-01.jpg"
  folder TEXT NOT NULL DEFAULT '',   -- '' = root; otherwise matches a folders.path
  filename TEXT NOT NULL,            -- basename only, matches the client's expectations
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL, -- NULL for admin-added photos
  size_bytes INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_folder ON photos(folder);
CREATE INDEX idx_photos_guest ON photos(guest_id);

-- The admin's curated tag registry (add-tag/delete-tag) — independent of
-- which photos currently carry a given tag, same as the .tags sidecar-file
-- model described in the project README.
CREATE TABLE tags (
  name TEXT PRIMARY KEY
);

CREATE TABLE photo_tags (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL REFERENCES tags(name) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, tag_name)
);

-- Failed admin logins per client IP, for the lockout in routes/admin.js
-- login(). Added after the initial deploy — apply to an existing database
-- with: wrangler d1 execute l-et-m --remote --command "<this statement>"
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0  -- epoch ms; 0 = not locked
);

-- Site-wide switches the admin dashboard can flip (routes/settings.js).
-- Added after the initial deploy — apply the same way as login_attempts.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
