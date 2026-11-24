// The images on their way to the bucket (src/admin/r2.js). Each image the editor adds goes up
// as soon as it's ready, while they go on editing: an album's 40 photos are up by the time
// they press Publicar, which then only commits the data. Three at a time; a failure is tried
// again twice, and then waits for the editor ("Tentar de novo"). Without internet, or before
// the key has loaded, they wait.
//
// A job: { path, state: 'wait' | 'up' | 'done' | 'err', progress (0–1), error }.

import * as r2 from './r2.js';
import { net, onNet } from './net.js';

const MAX = 3;
const TRIES = 3;
const jobs = new Map();
const listeners = new Set();
let running = 0;
let paused = false;

// The editor can hold the uploads (on a phone's data plan, say): the ones going finish.
export const isPaused = () => paused;
export function setPaused(value) {
  paused = Boolean(value);
  emit({ path: '', state: paused ? 'paused' : 'resumed' });
  pump();
}

export function onUploads(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(job) {
  for (const fn of listeners) fn(job);
}

export const status = (path) => jobs.get(path) || null;

// done: it's already in the bucket (a staged image uploaded before a reload).
export function enqueue(path, blob, { type = blob.type, done = false, onDone = null } = {}) {
  const old = jobs.get(path);
  if (old && old.ctrl) old.ctrl.abort();
  const job = { path, blob, type, state: done ? 'done' : 'wait', progress: done ? 1 : 0, error: '', tries: 0, onDone, ctrl: null };
  jobs.set(path, job);
  emit(job);
  pump();
  return job;
}

// An image the editor dropped before it was published.
export function forget(path) {
  const job = jobs.get(path);
  if (!job) return;
  jobs.delete(path);
  if (job.ctrl) job.ctrl.abort();
  emit({ path, state: 'gone' });
}

export function retry(paths = [...jobs.keys()]) {
  for (const path of paths) {
    const job = jobs.get(path);
    if (job && job.state === 'err') {
      job.state = 'wait';
      job.tries = 0;
      job.error = '';
      emit(job);
    }
  }
  pump();
}

// The jobs among `paths` that aren't up yet.
export const pending = (paths) => paths.map((p) => jobs.get(p)).filter((j) => j && j.state !== 'done');

export function pump() {
  if (!net.online || !r2.hasKey() || paused) return;
  for (const job of jobs.values()) {
    if (running >= MAX) break;
    if (job.state === 'wait') run(job);
  }
}

async function run(job) {
  running += 1;
  job.state = 'up';
  job.progress = 0;
  job.ctrl = new AbortController();
  emit(job);
  try {
    await r2.put(job.path, job.blob, { type: job.type, signal: job.ctrl.signal, onProgress: (f) => { job.progress = f; emit(job); } });
    job.ctrl = null;
    if (jobs.get(job.path) !== job) return;
    job.state = 'done';
    job.progress = 1;
    emit(job);
    if (job.onDone) await job.onDone(job.path).catch(() => {});
  } catch (error) {
    job.ctrl = null;
    if (jobs.get(job.path) !== job) return; // forgotten, or replaced by a new version
    job.tries += 1;
    if (error.status === 0 && !navigator.onLine) {
      job.state = 'wait'; // offline: it goes when the connection is back
    } else if (job.tries < TRIES && error.status !== 401 && error.status !== 403) {
      await new Promise((r) => setTimeout(r, 1500 * job.tries));
      job.state = 'wait';
    } else {
      job.state = 'err';
      job.error = error.status === 401 || error.status === 403 ? 'access' : 'failed';
    }
    emit(job);
  } finally {
    running -= 1;
    pump();
  }
}

// Resolves once every one of `paths` is in the bucket; rejects as soon as one fails for good,
// or when they can't go (no internet, no key). onProgress(done, total).
export function flush(paths, onProgress = () => {}) {
  const list = [...new Set(paths)];
  return new Promise((resolve, reject) => {
    let settled = false;
    const check = () => {
      if (settled) return null;
      if (!r2.hasKey()) return finish(new r2.MediaError('no key', r2.keyDenied() ? 401 : 0));
      const states = list.map((p) => (jobs.get(p) || { state: 'missing' }).state);
      if (states.includes('missing')) return finish(new r2.MediaError('an image to publish is missing from this device', 404));
      if (states.includes('err')) return finish(new r2.MediaError('upload failed', 500));
      const done = states.filter((s) => s === 'done').length;
      onProgress(done, list.length);
      if (done === list.length) return finish(null);
      if (!net.online) return finish(new r2.MediaError('network', 0));
      return null;
    };
    const off = onUploads(check);
    const offNet = onNet(check);
    function finish(error) {
      settled = true;
      off();
      offNet();
      if (error) reject(error);
      else resolve();
    }
    // publishing sends what's left even if the editor held the uploads
    paused = false;
    pump();
    check();
  });
}

onNet(() => pump());
