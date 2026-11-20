// Turns an uploaded photo into a small WebP sized for where it's shown:
// the slot's display box (src/config.js IMAGE_SLOTS) times IMAGE_DPR, never
// upscaled. "cover" slots are cropped to the box's shape first; the editor can
// move and zoom the crop. Browsers that can't encode WebP (older Safari) get a
// JPEG instead.

import { IMAGE_SLOTS, IMAGE_DPR, WEBP_QUALITY, targetSize } from '../config.js';
import { slugify } from '../util.js';
import { h, dialog, formatBytes } from './dom.js';

const MAX_INPUT = 40 * 1024 * 1024;
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif';

export function slotInfo(slotName) {
  const slot = IMAGE_SLOTS[slotName];
  const w = slot.w * IMAGE_DPR;
  const h2 = slot.h * IMAGE_DPR;
  return slot.fit === 'cover'
    ? `Recortada em ${slot.w}:${slot.h} e salva com até ${w}×${h2} px, em WebP.`
    : `Salva inteira, com até ${w}×${h2} px, em WebP.`;
}

async function decode(file) {
  if (file.size > MAX_INPUT) throw new Error('Essa imagem passa de 40 MB. Escolha uma menor.');
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('Não consegui abrir essa imagem. Use JPG, PNG ou WebP.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeOf = (bmp) => ({ w: bmp.naturalWidth || bmp.width, h: bmp.naturalHeight || bmp.height });

// Halves the image until it's close to the target, then draws the final size:
// a single big downscale in canvas looks jagged.
function draw(source, sx, sy, sw, sh, w, h2) {
  let canvas = document.createElement('canvas');
  let cw = sw;
  let ch = sh;
  canvas.width = cw;
  canvas.height = ch;
  let ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch);
  while (cw / 2 > w && ch / 2 > h2) {
    const next = document.createElement('canvas');
    next.width = Math.round(cw / 2);
    next.height = Math.round(ch / 2);
    const nctx = next.getContext('2d');
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
    cw = next.width;
    ch = next.height;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h2;
  ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, cw, ch, 0, 0, w, h2);
  return out;
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// crop: { x, y, w, h } in source pixels (cover slots); null = automatic.
export async function processImage(file, slotName, crop = null, source = null) {
  const slot = IMAGE_SLOTS[slotName];
  const bmp = source || await decode(file);
  const { w: iw, h: ih } = sizeOf(bmp);
  let region = { x: 0, y: 0, w: iw, h: ih };
  if (slot.fit === 'cover') region = crop || autoCrop(iw, ih, slot.w / slot.h);
  const size = targetSize(slot, region.w, region.h);
  const canvas = draw(bmp, region.x, region.y, region.w, region.h, size.w, size.h);
  let blob = await toBlob(canvas, 'image/webp', WEBP_QUALITY);
  let type = 'image/webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob(canvas, 'image/jpeg', 0.82);
    type = 'image/jpeg';
  }
  return { blob, type, w: size.w, h: size.h, bytes: blob.size, originalBytes: file.size, crop: region };
}

// Default crop: centered across, and nearer the top on tall photos, where
// faces usually are.
export function autoCrop(iw, ih, aspect) {
  if (iw / ih > aspect) {
    const w = Math.round(ih * aspect);
    return { x: Math.round((iw - w) / 2), y: 0, w, h: ih };
  }
  const h2 = Math.round(iw / aspect);
  return { x: 0, y: Math.round((ih - h2) * 0.2), w: iw, h: h2 };
}

export function imagePath(dir, base) {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${dir}/${slugify(base, 50)}-${rand}.webp`;
}

export function extFor(type) {
  return type === 'image/jpeg' ? 'jpg' : 'webp';
}

// Crop dialog: drag to move, slider or wheel to zoom. Resolves to a crop
// region in source pixels, or null when cancelled.
export async function cropDialog(file, slotName, initial = null) {
  const slot = IMAGE_SLOTS[slotName];
  const bmp = await decode(file);
  const { w: iw, h: ih } = sizeOf(bmp);
  const aspect = slot.w / slot.h;
  const frameW = Math.min(520, window.innerWidth - 80);
  const frameH = Math.round(frameW / aspect);
  const baseScale = Math.max(frameW / iw, frameH / ih);
  const preview = document.createElement('canvas');
  const ratio = Math.min(1, 1600 / Math.max(iw, ih));
  preview.width = Math.round(iw * ratio);
  preview.height = Math.round(ih * ratio);
  preview.getContext('2d').drawImage(bmp, 0, 0, preview.width, preview.height);
  const img = h('img', { src: preview.toDataURL('image/jpeg', 0.85), alt: '', draggable: 'false' });
  const frame = h('div', { class: 'crop-frame', style: { width: `${frameW}px`, height: `${frameH}px` } }, img, h('div', { class: 'crop-grid' }));
  const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom' });
  let z = 1;
  let ox = 0;
  let oy = 0;
  const clamp = () => {
    const s = baseScale * z;
    ox = Math.min(0, Math.max(frameW - iw * s, ox));
    oy = Math.min(0, Math.max(frameH - ih * s, oy));
  };
  const paint = () => {
    const s = baseScale * z;
    img.style.width = `${iw * s}px`;
    img.style.height = `${ih * s}px`;
    img.style.transform = `translate(${ox}px, ${oy}px)`;
  };
  const start = initial || autoCrop(iw, ih, aspect);
  z = Math.min(4, Math.max(1, frameW / (start.w * baseScale)));
  zoom.value = String(z);
  const s0 = baseScale * z;
  ox = -start.x * s0;
  oy = -start.y * s0;
  clamp();
  paint();
  const zoomTo = (nz, cx = frameW / 2, cy = frameH / 2) => {
    const s = baseScale * z;
    const ns = baseScale * nz;
    ox = cx - ((cx - ox) / s) * ns;
    oy = cy - ((cy - oy) / s) * ns;
    z = nz;
    clamp();
    paint();
  };
  zoom.addEventListener('input', () => zoomTo(Number(zoom.value)));
  frame.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = frame.getBoundingClientRect();
    const nz = Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    zoom.value = String(nz);
    zoomTo(nz, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  frame.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox, oy };
    frame.setPointerCapture(e.pointerId);
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    ox = drag.ox + e.clientX - drag.x;
    oy = drag.oy + e.clientY - drag.y;
    clamp();
    paint();
  });
  frame.addEventListener('pointerup', () => {
    drag = null;
  });
  return new Promise((resolve) => {
    dialog({
      title: 'Ajustar o enquadramento',
      wide: true,
      body: h('div', { class: 'crop' },
        frame,
        h('label', { class: 'crop-zoom' }, h('span', null, 'Zoom'), zoom),
        h('p', { class: 'hint' }, `Arraste a foto para enquadrar. ${slotInfo(slotName)} Original: ${iw}×${ih} px, ${formatBytes(file.size)}.`)),
      onClose: (value) => resolve(value || null),
      actions: (close) => [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Cancelar'),
        h('button', {
          class: 'btn btn-red',
          type: 'button',
          onclick: () => {
            const s = baseScale * z;
            const region = {
              x: Math.max(0, Math.round(-ox / s)),
              y: Math.max(0, Math.round(-oy / s)),
              w: Math.min(iw, Math.round(frameW / s)),
              h: Math.min(ih, Math.round(frameH / s)),
            };
            close({ region, source: bmp });
          },
        }, 'Usar este recorte'),
      ],
    });
  });
}
