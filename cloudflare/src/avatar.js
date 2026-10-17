// Shared by the guest routes and the quiz room. Avatar = [animal, fur colour,
// accessory]; the limits must match the lists in src/quiz/avatar.js.
export const AVATAR_LIMITS = [8, 13, 9]
const NAME_MAX = 20

export function parseAvatar (v) {
  if (!Array.isArray(v) || v.length !== 3) return null
  return v.every((n, i) => Number.isInteger(n) && n >= 0 && n < AVATAR_LIMITS[i]) ? v : null
}

// Stored in D1 as "animal.colour.accessory".
export const avatarKey = (v) => v.join('.')
export const avatarFromKey = (key) => (key ? parseAvatar(String(key).split('.').map(Number)) : null)

// Names also become folder names (Invités/<name>), so no slashes or control characters.
const FORBIDDEN = /[\u0000-\u001f\u007f/\\]/g
export function cleanName (raw) {
  return String(raw ?? '').replace(FORBIDDEN, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
}
