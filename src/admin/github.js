// GitHub REST client for the admin. Only api.github.com is used: it allows
// browser requests (CORS) with a token, while github.com's git endpoints don't.
// GET requests that must be fresh get a ?t= cache-buster instead of
// Cache-Control headers, which the API's CORS policy doesn't allow.

import { REPO } from '../config.js';

const API = 'https://api.github.com';

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Messages for the editors, who don't need to know how the site is hosted.
export function describeError(error) {
  const status = error && error.status;
  const message = (error && error.message) || '';
  if (status !== undefined) console.warn('API error', status, message);
  if (status === 0) return 'Sem conexão. Confira a internet e tente de novo.';
  if (status === 401) return 'Esse token não funciona mais (pode ter expirado). Peça um novo a quem cuida do site.';
  if (status === 403 && /rate limit/i.test(message)) return 'Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.';
  if (status === 403 || status === 404) return 'Esse token não dá acesso para alterar o site. Confira se você colou o token inteiro ou peça um novo a quem cuida do site.';
  if (status === 409 || status === 422) return 'O site mudou enquanto você publicava. Tente publicar de novo.';
  if (status === undefined && message) return message;
  return 'Algo deu errado. Tente de novo em instantes e, se continuar, avise quem cuida do site.';
}

// `branch` is REPO.branch unless a developer overrides it for testing.
export function createClient(token, { branch: defaultBranch = REPO.branch } = {}) {
  const repo = `/repos/${REPO.owner}/${REPO.name}`;

  async function req(path, { method = 'GET', body, fresh = false } = {}) {
    let url = API + path;
    if (fresh) url += `${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError('network', 0);
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) throw new ApiError((data && data.message) || `${res.status} ${res.statusText}`, res.status, data);
    return data;
  }

  return {
    user: () => req('/user', { fresh: true }),
    repo: () => req(repo, { fresh: true }),
    branch: defaultBranch,
    async head(branch = defaultBranch) {
      const ref = await req(`${repo}/git/ref/heads/${branch}`, { fresh: true });
      return ref.object.sha;
    },
    commit: (sha) => req(`${repo}/git/commits/${sha}`),
    tree: (sha) => req(`${repo}/git/trees/${sha}?recursive=1`),
    blob: (sha) => req(`${repo}/git/blobs/${sha}`),
    createBlob: (content, encoding) => req(`${repo}/git/blobs`, { method: 'POST', body: { content, encoding } }),
    createTree: (baseTree, tree) => req(`${repo}/git/trees`, { method: 'POST', body: { base_tree: baseTree, tree } }),
    createCommit: (body) => req(`${repo}/git/commits`, { method: 'POST', body }),
    updateRef: (sha, branch = defaultBranch) => req(`${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha, force: false } }),
    commits: (count = 5) => req(`${repo}/commits?sha=${defaultBranch}&per_page=${count}`, { fresh: true }),
  };
}

export function decodeBase64Text(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

