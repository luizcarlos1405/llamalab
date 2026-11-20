// The content model. One JSON file per content type in data/.
//
// Collections are arrays of items; every item has a unique, URL-safe `id`
// (slug) that never changes after it's published. Singletons are one object.
// The admin builds its forms from these definitions, and the build and the
// admin both validate against them.
//
// Field types:
//   text, textarea, markdown, date (YYYY-MM-DD), time (HH:MM), url, email,
//   boolean, image, strings (array of short texts), group (object with
//   `fields`), repeater (array of objects with `fields`, at most `max`).
// Text and url fields can also require a `pattern` (a RegExp), explained to the
// editor by `patternMessage`.
//
// Image fields hold null or { src, alt, w, h, credit?, focus? }, where `src` is
// a repository path such as "images/agenda/noite-do-rock.webp", w/h are the
// stored pixel size and `focus` is a CSS object-position such as "50% 30%".
// Markdown fields use the subset in src/markdown.js and may embed images as
// ![texto alternativo](images/noticias/foo.webp "legenda").

import { SPOTIFY_PLAYLIST } from './util.js';

const EVENT_TYPES = ['Show', 'Festa', 'Festival', 'Teatro', 'Sarau', 'Exposição', 'Feira', 'Oficina', 'Cinema', 'Dança', 'Circo', 'Literatura', 'Encontro'];
const NEWS_KICKERS = ['Cena', 'Editais', 'Festivais', 'Formação', 'Música', 'Teatro', 'Artes visuais', 'Literatura', 'Cinema', 'Políticas culturais'];
const AREAS = ['Música', 'Teatro', 'Artes visuais', 'Artes cênicas', 'Circo', 'Cinema', 'Dança', 'Literatura', 'Rap', 'Produção cultural', 'Fotografia'];

export const COLLECTIONS = {
  agenda: {
    name: 'agenda',
    file: 'data/agenda.json',
    label: 'Agenda',
    singular: 'evento',
    newLabel: 'Novo evento',
    route: 'agenda',
    imageDir: 'images/agenda',
    titleKey: 'title',
    idFrom: (item) => [item.title, item.date].filter(Boolean).join(' '),
    // Upcoming first in the admin is handled by the views; the file is kept
    // sorted by date so diffs stay small and predictable.
    sort: (a, b) => cmp(a.date, b.date) || cmp(a.time, b.time) || cmp(a.title, b.title),
    fields: [
      { key: 'title', label: 'Nome do evento', type: 'text', required: true, maxLength: 90, placeholder: 'Noite do Rock Autoral' },
      { key: 'category', label: 'Tipo', type: 'text', suggestions: EVENT_TYPES, maxLength: 24, placeholder: 'Show, teatro, feira…' },
      { key: 'date', label: 'Data', type: 'date', required: true, group: 'Quando' },
      { key: 'time', label: 'Horário', type: 'time', group: 'Quando' },
      { key: 'endDate', label: 'Termina em', type: 'date', group: 'Quando', hint: 'Só para eventos de mais de um dia, como festivais e exposições.' },
      { key: 'venue', label: 'Local', type: 'text', maxLength: 60, placeholder: 'Galpão 7', group: 'Onde' },
      { key: 'address', label: 'Endereço', type: 'text', maxLength: 120, placeholder: 'Rua, número, bairro', group: 'Onde' },
      { key: 'city', label: 'Cidade', type: 'text', default: 'Dourados', maxLength: 40, group: 'Onde' },
      { key: 'price', label: 'Entrada', type: 'text', maxLength: 30, placeholder: 'Grátis, R$ 20…' },
      { key: 'lineup', label: 'Atrações', type: 'text', maxLength: 140, hint: 'Separe com vírgulas. Aparece no cartaz.', placeholder: 'Ferrugem Elétrica, Os Tereré' },
      { key: 'description', label: 'Descrição', type: 'markdown' },
      { key: 'image', label: 'Flyer', type: 'image', slot: 'flyer', hint: 'O flyer aparece inteiro, sem corte.' },
      { key: 'link', label: 'Link de ingressos ou informações', type: 'url', placeholder: 'https://…' },
      { key: 'linkLabel', label: 'Texto do botão do link', type: 'text', maxLength: 30, placeholder: 'Comprar ingresso' },
      { key: 'featured', label: 'Destacar na capa', type: 'boolean', hint: 'O próximo evento destacado vira o "Próximo rolê" no topo da capa.' },
    ],
  },

  noticias: {
    name: 'noticias',
    file: 'data/noticias.json',
    label: 'Notícias',
    singular: 'notícia',
    newLabel: 'Nova notícia',
    route: 'noticias',
    imageDir: 'images/noticias',
    titleKey: 'title',
    idFrom: (item) => item.title,
    sort: (a, b) => cmp(b.date, a.date) || cmp(a.title, b.title),
    fields: [
      { key: 'title', label: 'Título', type: 'text', required: true, maxLength: 120 },
      { key: 'kicker', label: 'Editoria', type: 'text', suggestions: NEWS_KICKERS, maxLength: 24, placeholder: 'Cena, Editais…' },
      { key: 'date', label: 'Data', type: 'date', required: true, default: 'today' },
      { key: 'summary', label: 'Resumo', type: 'textarea', maxLength: 300, hint: 'Uma ou duas frases. Aparece na capa e nas prévias de link.' },
      { key: 'image', label: 'Foto', type: 'image', slot: 'noticia' },
      { key: 'body', label: 'Texto', type: 'markdown', required: true },
      { key: 'author', label: 'Autoria', type: 'text', maxLength: 60 },
      { key: 'featured', label: 'Manchete da capa', type: 'boolean', hint: 'A notícia destacada mais recente abre o Plantão.' },
    ],
  },

  entrevistas: {
    name: 'entrevistas',
    file: 'data/entrevistas.json',
    label: 'Entrevistas',
    singular: 'entrevista',
    newLabel: 'Nova entrevista',
    route: 'entrevistas',
    imageDir: 'images/entrevistas',
    titleKey: 'title',
    idFrom: (item) => item.title || item.name,
    sort: (a, b) => cmp(b.date, a.date) || cmp(a.title, b.title),
    fields: [
      { key: 'title', label: 'Título', type: 'text', required: true, maxLength: 120, placeholder: 'Raique Moura, o menino que nunca parou de inventar mundos' },
      { key: 'name', label: 'Quem', type: 'text', required: true, maxLength: 60, hint: 'Pessoa, banda ou coletivo.' },
      { key: 'role', label: 'O que faz', type: 'text', maxLength: 160, placeholder: 'Cantora e compositora' },
      { key: 'area', label: 'Área', type: 'text', suggestions: AREAS, maxLength: 24 },
      { key: 'date', label: 'Data', type: 'date', required: true, default: 'today' },
      { key: 'photo', label: 'Retrato', type: 'image', slot: 'retrato' },
      { key: 'quote', label: 'Frase em destaque', type: 'textarea', maxLength: 160, hint: 'Aparece grande, entre aspas.' },
      { key: 'highlight', label: 'Palavra marcada na frase', type: 'text', maxLength: 30, hint: 'Opcional. Uma palavra da frase, pintada de vermelho.' },
      { key: 'summary', label: 'Resumo', type: 'textarea', maxLength: 300, hint: 'Aparece nas listas e nas prévias de link.' },
      { key: 'body', label: 'Texto', type: 'markdown' },
      {
        key: 'qa', label: 'Perguntas e respostas', type: 'repeater', itemLabel: 'Pergunta',
        fields: [
          { key: 'q', label: 'Pergunta', type: 'textarea', required: true },
          { key: 'a', label: 'Resposta', type: 'textarea', required: true },
        ],
      },
      { key: 'video', label: 'Vídeo (YouTube)', type: 'url', placeholder: 'https://youtu.be/…' },
      {
        key: 'links', label: 'Links', type: 'repeater', itemLabel: 'Link',
        fields: [
          { key: 'label', label: 'Texto', type: 'text', required: true, maxLength: 40, placeholder: 'Instagram' },
          { key: 'url', label: 'Endereço', type: 'url', required: true },
        ],
      },
      { key: 'author', label: 'Autoria', type: 'text', maxLength: 60 },
      { key: 'featured', label: 'Destaque da capa', type: 'boolean', hint: 'A entrevista destacada mais recente abre o Papo reto.' },
    ],
  },
};

export const SINGLETONS = {
  site: {
    name: 'site',
    file: 'data/site.json',
    label: 'Capa e contatos',
    fields: [
      {
        key: 'hero', label: 'Abertura da capa', type: 'group',
        fields: [
          { key: 'eyebrow', label: 'Linha de cima', type: 'text', maxLength: 50, placeholder: 'Agenda cultural · Dourados–MS' },
          { key: 'title', label: 'Título', type: 'text', maxLength: 40, placeholder: 'Cultura que faz' },
          { key: 'highlight', label: 'Final do título, em vermelho', type: 'text', maxLength: 24, placeholder: 'barulho.' },
          { key: 'text', label: 'Texto de apoio', type: 'textarea', maxLength: 220 },
        ],
      },
      {
        key: 'ribbons', label: 'Faixas que passam na capa', type: 'group',
        hint: 'Palavras curtas. Elas se repetem pela faixa, separadas por ✺.',
        fields: [
          { key: 'top', label: 'Faixa branca', type: 'strings', itemLabel: 'Palavra', maxLength: 30 },
          { key: 'bottom', label: 'Faixa escura', type: 'strings', itemLabel: 'Palavra', maxLength: 30 },
        ],
      },
      {
        key: 'cta', label: 'Chamada do rodapé', type: 'group',
        fields: [
          { key: 'line1', label: 'Linha 1', type: 'text', maxLength: 24, placeholder: 'Tem um rolê' },
          { key: 'line2', label: 'Linha 2', type: 'text', maxLength: 24, placeholder: 'rolando?' },
          { key: 'highlight', label: 'Linha 3, em vermelho', type: 'text', maxLength: 24, placeholder: 'A gente espalha.' },
          { key: 'text', label: 'Texto', type: 'textarea', maxLength: 260 },
          { key: 'eventLabel', label: 'Botão redondo', type: 'text', maxLength: 26, placeholder: 'Divulgue seu evento' },
          { key: 'eventMessage', label: 'Mensagem pronta do WhatsApp (evento)', type: 'textarea', maxLength: 200 },
          { key: 'interviewLabel', label: 'Link de entrevista', type: 'text', maxLength: 30, placeholder: 'Quero dar entrevista' },
          { key: 'interviewMessage', label: 'Mensagem pronta do WhatsApp (entrevista)', type: 'textarea', maxLength: 200 },
        ],
      },
      {
        key: 'contact', label: 'Contatos e redes', type: 'group',
        fields: [
          { key: 'whatsapp', label: 'WhatsApp', type: 'text', maxLength: 20, hint: 'Só números, com DDI e DDD: 5567999999999.' },
          { key: 'email', label: 'E-mail', type: 'email' },
          { key: 'instagram', label: 'Instagram', type: 'text', maxLength: 40, hint: 'Só o usuário, sem @.' },
          { key: 'tiktok', label: 'TikTok', type: 'text', maxLength: 40, hint: 'Só o usuário, sem @.' },
          { key: 'youtube', label: 'YouTube', type: 'url' },
          { key: 'spotify', label: 'Spotify', type: 'url' },
          { key: 'cnpj', label: 'CNPJ', type: 'text', maxLength: 20, hint: 'Aparece no rodapé.' },
        ],
      },
      {
        key: 'radio', label: 'Rádio', type: 'group',
        hint: 'O rádio fica embaixo de todas as páginas: cada playlist do Spotify vira uma estação do dial, na ordem daqui. Sem estações, o rádio sai do site.',
        fields: [
          {
            key: 'stations', label: 'Estações', type: 'repeater', itemLabel: 'Estação', max: 12,
            fields: [
              { key: 'name', label: 'Nome no dial', type: 'text', required: true, maxLength: 18, placeholder: 'Indie' },
              {
                key: 'url', label: 'Link da playlist no Spotify', type: 'url', required: true, placeholder: 'https://open.spotify.com/playlist/…',
                hint: 'No Spotify: ⋯ na playlist → Compartilhar → Copiar link da playlist. A playlist precisa ser pública.',
                pattern: SPOTIFY_PLAYLIST, patternMessage: 'cole o link de uma playlist do Spotify (open.spotify.com/playlist/…).',
              },
            ],
          },
        ],
      },
      {
        key: 'seo', label: 'Busca e prévias de link', type: 'group',
        fields: [
          { key: 'title', label: 'Título do site', type: 'text', maxLength: 70 },
          { key: 'description', label: 'Descrição', type: 'textarea', maxLength: 200 },
        ],
      },
    ],
  },

  sobre: {
    name: 'sobre',
    file: 'data/sobre.json',
    label: 'Sobre',
    route: 'sobre',
    imageDir: 'images/paginas',
    fields: [
      { key: 'title', label: 'Título', type: 'text', required: true, maxLength: 40 },
      { key: 'lead', label: 'Abertura', type: 'textarea', maxLength: 300 },
      { key: 'image', label: 'Foto', type: 'image', slot: 'pagina' },
      { key: 'body', label: 'Texto', type: 'markdown' },
    ],
  },

  contrate: {
    name: 'contrate',
    file: 'data/contrate.json',
    label: 'Contrate',
    route: 'contrate',
    imageDir: 'images/paginas',
    fields: [
      { key: 'title', label: 'Título', type: 'text', required: true, maxLength: 40 },
      { key: 'lead', label: 'Abertura', type: 'textarea', maxLength: 300 },
      {
        key: 'services', label: 'Serviços', type: 'repeater', itemLabel: 'Serviço',
        fields: [
          { key: 'title', label: 'Nome', type: 'text', required: true, maxLength: 50 },
          { key: 'text', label: 'Descrição', type: 'textarea', maxLength: 400 },
        ],
      },
      { key: 'body', label: 'Texto extra', type: 'markdown' },
      { key: 'ctaText', label: 'Chamada final', type: 'textarea', maxLength: 200 },
      { key: 'ctaLabel', label: 'Botão', type: 'text', maxLength: 30 },
      { key: 'ctaMessage', label: 'Mensagem pronta do WhatsApp', type: 'textarea', maxLength: 200 },
    ],
  },
};

export const ALL_TYPES = { ...COLLECTIONS, ...SINGLETONS };

function cmp(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

// An empty value for a field, used for new items and for missing keys.
export function emptyValue(field) {
  switch (field.type) {
    case 'boolean': return false;
    case 'image': return null;
    case 'strings':
    case 'repeater': return [];
    case 'group': return emptyItem(field.fields);
    default: return '';
  }
}

export function emptyItem(fields, today = '') {
  const item = {};
  for (const field of fields) {
    if (field.default === 'today') item[field.key] = today;
    else if (field.default !== undefined) item[field.key] = field.default;
    else item[field.key] = emptyValue(field);
  }
  return item;
}

// Fill missing keys and drop unknown ones so items always have the same shape
// and the same key order (keeps the JSON diffs clean).
export function normalize(fields, value) {
  const src = value && typeof value === 'object' ? value : {};
  const out = {};
  if ('id' in src) out.id = String(src.id);
  for (const field of fields) {
    const v = src[field.key];
    out[field.key] = normalizeValue(field, v);
  }
  return out;
}

function normalizeValue(field, v) {
  switch (field.type) {
    case 'boolean': return v === true;
    case 'image': {
      if (!v || typeof v !== 'object' || !v.src) return null;
      const img = { src: String(v.src), alt: String(v.alt || ''), w: Number(v.w) || 0, h: Number(v.h) || 0 };
      if (v.credit) img.credit = String(v.credit);
      if (v.focus) img.focus = String(v.focus);
      return img;
    }
    case 'strings': return Array.isArray(v) ? v.map((s) => String(s ?? '')) : [];
    case 'repeater': return Array.isArray(v) ? v.map((row) => normalize(field.fields, row)) : [];
    case 'group': return normalize(field.fields, v);
    default: return v === undefined || v === null ? '' : String(v);
  }
}

// Returns a list of { path, message } problems; empty when valid.
export function validate(fields, value, path = '') {
  const problems = [];
  for (const field of fields) {
    const v = value ? value[field.key] : undefined;
    const p = path ? `${path}.${field.key}` : field.key;
    if (field.required && isBlank(field, v)) {
      problems.push({ path: p, field, message: `${field.label}: obrigatório.` });
      continue;
    }
    if (isBlank(field, v)) continue;
    if ((field.type === 'text' || field.type === 'textarea') && field.maxLength && String(v).length > field.maxLength) {
      problems.push({ path: p, field, message: `${field.label}: no máximo ${field.maxLength} caracteres.` });
    }
    if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) problems.push({ path: p, field, message: `${field.label}: data inválida.` });
    if (field.type === 'time' && !/^\d{2}:\d{2}$/.test(v)) problems.push({ path: p, field, message: `${field.label}: horário inválido.` });
    if (field.type === 'url' && !/^https?:\/\/\S+$/i.test(v)) problems.push({ path: p, field, message: `${field.label}: use um endereço completo, começando com https://` });
    else if (field.pattern && !field.pattern.test(String(v).trim())) problems.push({ path: p, field, message: `${field.label}: ${field.patternMessage || 'formato inválido.'}` });
    if (field.type === 'repeater' && field.max && v.length > field.max) problems.push({ path: p, field, message: `${field.label}: no máximo ${field.max}.` });
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) problems.push({ path: p, field, message: `${field.label}: e-mail inválido.` });
    if (field.type === 'strings' && field.maxLength) {
      v.forEach((s, i) => {
        if (String(s).length > field.maxLength) problems.push({ path: `${p}.${i}`, field, message: `${field.itemLabel || field.label} ${i + 1}: no máximo ${field.maxLength} caracteres.` });
      });
    }
    if (field.type === 'group') problems.push(...validate(field.fields, v, p));
    if (field.type === 'repeater') v.forEach((row, i) => problems.push(...validate(field.fields, row, `${p}.${i}`)));
  }
  return problems;
}

function isBlank(field, v) {
  if (v === undefined || v === null) return true;
  if (field.type === 'image') return !v.src;
  if (field.type === 'strings' || field.type === 'repeater') return v.length === 0;
  if (field.type === 'boolean' || field.type === 'group') return false;
  return String(v).trim() === '';
}
