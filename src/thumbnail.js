// A small JPEG copy of a photo, for the grids (the original is uploaded
// untouched alongside it and still used for the lightbox, hero and
// slideshow). Returns null if the browser can't decode the file — the Worker
// then simply has no thumbnail and the grids fall back to the original.
const MAX_SIDE = 480

export async function makeThumbnail (file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  } catch {
    return null
  }
}
