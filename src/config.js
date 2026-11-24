// Site-wide settings shared by the build, the public pages and the admin.

export const SITE = {
  name: 'LLama Lab',
  fullName: 'LLama Lab — Laboratório Criativo',
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

// The content's images live in Cloudflare R2 (the bucket llamalab-fotos, in the team's
// Cloudflare account), not in this repository. The data keeps repository-style paths
// ("images/agenda/foo.webp"): the same path is the object's key in the bucket, and the
// pages show it from `base`. Only an image still in the repository (one committed by an
// outdated admin) is served from GitHub Pages instead (scripts/build.mjs).
//   base      the bucket's public address. r2.dev until fotos.llamalab.com.br is set up in
//             Cloudflare (the domain's DNS has to move there first); then change it here and
//             in admin.html's Content-Security-Policy (the build checks they agree).
//   endpoint  the S3 address the admin uploads to. It signs each upload in the browser with
//             the key it reads from the private repository `keys` (src/admin/r2.js).
export const MEDIA = {
  base: 'https://pub-4dac19a09b3e4a169bebbed813693cc7.r2.dev',
  endpoint: 'https://4e487ff700ae0feb41a870029eb76a9d.r2.cloudflarestorage.com',
  bucket: 'llamalab-fotos',
  keys: { owner: 'luizcarlos1405', repo: 'llamalab-keys', file: 'r2.json' },
};

// The public address of an image path ("images/agenda/foo.webp").
export function mediaUrl(path) {
  return `${MEDIA.base}/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

// The albums (Fotos). `max` photos per album; `mark`: the JPEG a visitor saves gets the
// LLama Lab mark and the photographer's credit in a corner (assets/site.js), or not.
export const PHOTOS = { max: 80, mark: false };

// Images are resized to the largest box they're shown in on the site, times
// IMAGE_DPR, and saved as WebP. `cover` slots are cropped to the box's aspect
// ratio; `contain` slots keep the whole image and only shrink it. `kb` is each
// slot's budget: a photo that comes out heavier (a painting, a noisy night shot)
// is saved again at lower quality, then a little smaller (src/admin/images.js).
export const IMAGE_DPR = 2;
export const WEBP_QUALITY = 0.8;
export const IMAGE_SLOTS = {
  flyer: { w: 560, h: 700, fit: 'contain', label: 'flyer', kb: 350 },
  noticia: { w: 880, h: 587, fit: 'cover', label: 'foto da notícia (3:2)', kb: 300 },
  // Interview cards show the portrait in wider boxes, cropped around its `focus` point
  // (chosen in the admin; `focus` here when there's none: the upper part, where faces
  // usually are). `cards` are the boxes the admin previews, as width / height.
  retrato: {
    w: 480, h: 600, fit: 'cover', label: 'retrato (4:5)', kb: 250, focus: '50% 25%',
    cards: [{ label: 'Card na capa', ratio: 16 / 9 }, { label: 'Lista (Entrevistas e Artistas)', ratio: 4 / 4.2 }],
  },
  pagina: { w: 880, h: 587, fit: 'cover', label: 'foto da página (3:2)', kb: 300 },
  inline: { w: 720, h: 960, fit: 'contain', label: 'imagem no texto', kb: 450 },
  // An album's photo: 1080 px wide at most, what Instagram shows (a 2:3 portrait goes up to
  // 1620 px tall), for visitors to save and post. Its small copy fills the album's rows
  // (about 214 px tall on computers), times 2.
  foto: { w: 540, h: 810, fit: 'contain', label: 'foto do álbum', kb: 320 },
  fotoMini: { w: 330, h: 220, fit: 'contain', label: 'miniatura', kb: 70 },
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
