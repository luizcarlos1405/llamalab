// Drafts live in IndexedDB: a key-value store for the data and one for staged
// image blobs. Falls back to memory when IndexedDB isn't available (some
// private windows); `isPersistent()` lets the app warn the editor.

const DB_NAME = 'llamalab-admin';
const STORES = ['kv', 'images'];
let dbPromise = null;
let persistent = true;
const memory = { kv: new Map(), images: new Map() };

export function isPersistent() {
  return persistent;
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const fail = () => {
        persistent = false;
        resolve(null);
      };
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch {
        fail();
        return;
      }
      req.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = fail;
      req.onblocked = fail;
    });
  }
  return dbPromise;
}

function request(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(r ? r.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function api(store) {
  const mem = memory[store];
  return {
    async get(key) {
      const db = await open();
      return db ? request(db, store, 'readonly', (s) => s.get(key)) : mem.get(key);
    },
    async set(key, value) {
      const db = await open();
      if (db) await request(db, store, 'readwrite', (s) => s.put(value, key));
      else mem.set(key, value);
    },
    async del(key) {
      const db = await open();
      if (db) await request(db, store, 'readwrite', (s) => s.delete(key));
      else mem.delete(key);
    },
    async keys() {
      const db = await open();
      return db ? request(db, store, 'readonly', (s) => s.getAllKeys()) : [...mem.keys()];
    },
    async clear() {
      const db = await open();
      if (db) await request(db, store, 'readwrite', (s) => s.clear());
      else mem.clear();
    },
  };
}

export const kv = api('kv');
export const images = api('images');
