/* Local database (IndexedDB). All your data lives here, on this phone only. */

export const DB_NAME = 'fitlog';
export const DB_VERSION = 1;

/* Data-structure changes are added here as NEW numbered steps only.
   Never delete or rename an existing store or field, so old backups always stay importable. */
const MIGRATIONS = {
  1(db) {
    db.createObjectStore('device', { keyPath: 'key' });     // this phone's own bookkeeping (never in backups)
    db.createObjectStore('safety', { keyPath: 'key' });     // safety copy made before a restore (never in backups)
    db.createObjectStore('testNotes', { keyPath: 'id' });   // Phase 0 test data (included in backups)
  },
};

/* Stores that stay on this phone and are left out of backup files. */
export const LOCAL_ONLY_STORES = ['device', 'safety', 'secrets'];

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        for (let version = event.oldVersion + 1; version <= DB_VERSION; version++) {
          MIGRATIONS[version](db, request.transaction);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { dbPromise = null; reject(request.error); };
      request.onblocked = () => console.warn('Database upgrade is waiting for another open copy of FitLog to close.');
    });
  }
  return dbPromise;
}

const promisify = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('The database operation was cancelled.'));
});

export function newId() {
  if (self.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export async function get(storeName, key) {
  const db = await openDB();
  return promisify(db.transaction(storeName).objectStore(storeName).get(key));
}

export async function getAll(storeName) {
  const db = await openDB();
  return promisify(db.transaction(storeName).objectStore(storeName).getAll());
}

export async function put(storeName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  return value;
}

export async function remove(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}

/* Counts how many times this phone has opened FitLog, and since when.
   Used to prove that data really survives between launches. */
export async function recordLaunch() {
  const now = new Date().toISOString();
  const previous = await get('device', 'launch');
  const record = previous
    ? { ...previous, lastOpenedAt: now, openCount: (previous.openCount || 0) + 1 }
    : { key: 'launch', firstOpenedAt: now, lastOpenedAt: now, openCount: 1 };
  await put('device', record);
  return { ...record, isRepeat: Boolean(previous) };
}

/* ---- Backup support ---- */

export async function exportableStoreNames() {
  const db = await openDB();
  return Array.from(db.objectStoreNames)
    .filter((name) => !LOCAL_ONLY_STORES.includes(name))
    .sort();
}

/* Reads every exportable store in ONE transaction, so the snapshot is consistent. */
export async function readAllExportable() {
  const db = await openDB();
  const names = await exportableStoreNames();
  if (names.length === 0) return {};
  const tx = db.transaction(names, 'readonly');
  const lists = await Promise.all(names.map((name) => promisify(tx.objectStore(name).getAll())));
  const data = {};
  names.forEach((name, index) => { data[name] = lists[index]; });
  return data;
}

/* Replaces ALL exportable data in one all-or-nothing transaction.
   If anything fails, the database is left exactly as it was. */
export async function replaceAllExportable(stores) {
  const db = await openDB();
  const names = await exportableStoreNames();
  const tx = db.transaction(names, 'readwrite');
  const done = transactionDone(tx);
  try {
    for (const name of names) {
      const store = tx.objectStore(name);
      store.clear();
      for (const record of stores[name] || []) store.put(record);
    }
  } catch (error) {
    try { tx.abort(); } catch (_) { /* already finished */ }
    await done.catch(() => {});
    throw error;
  }
  await done;
}

export async function putSafetyCopy(copy) {
  return put('safety', { key: 'last', ...copy });
}

export async function getSafetyCopy() {
  return get('safety', 'last');
}

export async function clearSafetyCopy() {
  return remove('safety', 'last');
}
