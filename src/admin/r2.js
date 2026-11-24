// Cloudflare R2, where the site's images live (src/config.js MEDIA). There is no server:
// the admin signs each request in the browser (AWS Signature V4, as a presigned URL, with
// WebCrypto) and sends it straight to the bucket's S3 address, whose CORS policy lets the
// site's origins upload and delete. Cloudflare's own API (api.cloudflare.com) can't be
// called from a browser, and isn't needed.
//
// The key: an R2 token with "Object Read & Write" on this bucket only. It lives in a private
// repository (MEDIA.keys), which each editor's GitHub token reaches too. The admin reads it
// after signing in and keeps it in memory only. Works in Node as well (scripts/r2.mjs).

import { MEDIA } from '../config.js';

const REGION = 'auto';
const SERVICE = 's3';
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
// RFC 3986, as S3 wants it: everything but A-Z a-z 0-9 - _ . ~ is percent-encoded
const uri = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(text));
}

let current = null; // { accessKeyId, secretAccessKey }
let denied = false; // the editor's token doesn't reach the key's repository

export const hasKey = () => Boolean(current);
export const keyDenied = () => denied;
export function setKey(key) {
  current = key && key.accessKeyId && key.secretAccessKey ? { accessKeyId: String(key.accessKeyId), secretAccessKey: String(key.secretAccessKey) } : null;
}

export class MediaError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// Reads the key with the editor's GitHub token. A token without access to the key's
// repository gets 404 (GitHub doesn't say whether it exists): uploads can't work then.
export async function loadKey(token) {
  const { owner, repo, file } = MEDIA.keys;
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file}?t=${Date.now()}`, {
      headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch {
    throw new MediaError('network', 0);
  }
  if (!res.ok) {
    denied = res.status === 401 || res.status === 403 || res.status === 404;
    throw new MediaError(`key ${res.status}`, res.status);
  }
  denied = false;
  let key = null;
  try {
    key = JSON.parse(await res.text());
  } catch {
    key = null;
  }
  setKey(key);
  if (!current) throw new MediaError('key unreadable', 500);
  return true;
}

// A presigned address for one request on an object (or on the bucket, with key ''), valid
// for `expires` seconds. Only the host header is signed; Content-Type and Cache-Control go
// along unsigned, which R2 accepts.
export async function presign(method, key, { expires = 900, query = {}, now = new Date() } = {}) {
  if (!current) throw new MediaError('no key', 401);
  const endpoint = new URL(MEDIA.endpoint);
  const host = endpoint.host;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const path = `/${MEDIA.bucket}${key ? `/${String(key).split('/').map(uri).join('/')}` : ''}`;
  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${current.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = Object.keys(params).sort().map((k) => `${uri(k)}=${uri(params[k])}`).join('&');
  const canonical = [method, path, qs, `host:${host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(await crypto.subtle.digest('SHA-256', enc.encode(canonical)))].join('\n');
  let k = await hmac(`AWS4${current.secretAccessKey}`, day);
  k = await hmac(k, REGION);
  k = await hmac(k, SERVICE);
  k = await hmac(k, 'aws4_request');
  return `${endpoint.origin}${path}?${qs}&X-Amz-Signature=${hex(await hmac(k, toSign))}`;
}

// Every key is used once: an image that changes gets a new name. So browsers and the
// service worker may keep each one for good.
export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Uploads a blob. onProgress(fraction) while it goes (XMLHttpRequest reports upload
// progress; fetch doesn't). `signal` aborts it.
export async function put(key, blob, { type = blob.type || 'application/octet-stream', onProgress = null, signal = null } = {}) {
  const url = await presign('PUT', key);
  if (typeof XMLHttpRequest !== 'function') {
    let res;
    try {
      res = await fetch(url, { method: 'PUT', body: blob, headers: { 'content-type': type, 'cache-control': CACHE_CONTROL }, signal });
    } catch (error) {
      throw new MediaError(error.name === 'AbortError' ? 'aborted' : 'network', 0);
    }
    if (!res.ok) throw new MediaError(`PUT ${res.status}`, res.status);
    return true;
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', type);
    xhr.setRequestHeader('cache-control', CACHE_CONTROL);
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(true) : reject(new MediaError(`PUT ${xhr.status}`, xhr.status)));
    xhr.onerror = () => reject(new MediaError('network', 0));
    xhr.onabort = () => reject(new MediaError('aborted', 0));
    // a photo that hasn't gone in 3 minutes is stuck (a weak signal): try it again
    xhr.timeout = 180000;
    xhr.ontimeout = () => reject(new MediaError('network', 0));
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

// Deletes an object. R2 answers 204 whether or not it existed. A failure is tried once more
// (R2 once answered a 400 that didn't come back).
export async function del(key) {
  let status = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(await presign('DELETE', key), { method: 'DELETE' });
      if (res.ok || res.status === 404) return true;
      status = res.status;
    } catch {
      status = 0;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new MediaError(`DELETE ${status}`, status);
}

// The keys under a prefix, with their sizes (ListObjectsV2, a page of up to 1000 at a time).
export async function list(prefix = '') {
  const out = [];
  let token = '';
  do {
    const query = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
    const res = await fetch(await presign('GET', '', { query }));
    if (!res.ok) throw new MediaError(`LIST ${res.status}`, res.status);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]);
      const size = /<Size>(\d+)<\/Size>/.exec(m[1]);
      const at = /<LastModified>([^<]+)<\/LastModified>/.exec(m[1]);
      if (key) out.push({ key: unxml(key[1]), size: size ? Number(size[1]) : 0, modified: at ? at[1] : '' });
    }
    const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? unxml(next[1]) : '';
  } while (token);
  return out;
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
