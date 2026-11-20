// Site-wide settings shared by the build, the public pages and the admin.

export const SITE = {
  name: 'LlamaLab',
  fullName: 'LlamaLab — Laboratório Criativo',
  // Used for canonical URLs, link previews, the sitemap and the feed when the
  // build doesn't get SITE_URL from the environment (GitHub Actions sets it).
  defaultUrl: 'https://luizcarlos1405.github.io/llamalab',
  locale: 'pt-BR',
  timezone: 'America/Campo_Grande',
};

// The repository the admin reads from and commits to.
export const REPO = {
  owner: 'luizcarlos1405',
  name: 'llamalab',
  branch: 'main',
};

// Images are resized to the largest box they're shown in on the site, times
// IMAGE_DPR, and saved as WebP. `cover` slots are cropped to the box's aspect
// ratio; `contain` slots keep the whole image and only shrink it.
export const IMAGE_DPR = 2;
export const WEBP_QUALITY = 0.8;
export const IMAGE_SLOTS = {
  flyer: { w: 560, h: 700, fit: 'contain', label: 'flyer' },
  noticia: { w: 880, h: 587, fit: 'cover', label: 'foto da notícia (3:2)' },
  retrato: { w: 480, h: 600, fit: 'cover', label: 'retrato (4:5)' },
  pagina: { w: 880, h: 587, fit: 'cover', label: 'foto da página (3:2)' },
  inline: { w: 720, h: 960, fit: 'contain', label: 'imagem no texto' },
};

// Pixel size an image should be stored at for a slot, given its source size.
// Never upscales.
export function targetSize(slot, srcW, srcH) {
  const box = { w: slot.w * IMAGE_DPR, h: slot.h * IMAGE_DPR };
  if (slot.fit === 'cover') {
    const scale = Math.min(1, srcW / box.w, srcH / box.h);
    return { w: Math.round(box.w * scale), h: Math.round(box.h * scale), crop: true };
  }
  const scale = Math.min(1, box.w / srcW, box.h / srcH);
  return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)), crop: false };
}
