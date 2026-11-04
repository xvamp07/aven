/* Backup and restore.
   A backup is one JSON file holding every exportable store, plus a checksum
   so a damaged or edited file is caught before it can replace your data. */

import {
  DB_VERSION,
  readAllExportable,
  replaceAllExportable,
  exportableStoreNames,
  putSafetyCopy,
  getSafetyCopy,
  clearSafetyCopy,
} from './db.js';

export const BACKUP_APP = 'fitlog';
export const BACKUP_FORMAT = 1;

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function countsOf(data) {
  const counts = {};
  for (const [name, records] of Object.entries(data)) counts[name] = records.length;
  return counts;
}

const totalOf = (counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

function filenameNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `fitlog-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export async function currentCounts() {
  const counts = countsOf(await readAllExportable());
  return { counts, total: totalOf(counts) };
}

export async function buildBackup() {
  const data = await readAllExportable();
  const counts = countsOf(data);
  const backup = {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT,
    dbVersion: DB_VERSION,
    appVersion: self.APP_VERSION || 'unknown',
    exportedAt: new Date().toISOString(),
    counts,
    checksum: await sha256Hex(JSON.stringify(data)),
    data,
  };
  const text = JSON.stringify(backup);
  return {
    text,
    filename: filenameNow(),
    bytes: new Blob([text]).size,
    counts,
    total: totalOf(counts),
  };
}

const fail = (reason) => ({ ok: false, reason });

/* Checks a backup WITHOUT changing anything. */
export async function inspectBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return fail('This is not readable backup text. The file may be cut off or edited.');
  }
  if (!parsed || parsed.app !== BACKUP_APP) return fail('This is not a FitLog backup.');
  if (parsed.formatVersion !== BACKUP_FORMAT) {
    return fail('This backup uses a different file format. Update FitLog and try again.');
  }
  if (typeof parsed.dbVersion !== 'number' || parsed.dbVersion > DB_VERSION) {
    return fail('This backup was made by a newer version of FitLog. Update the app first, then restore.');
  }
  const data = parsed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('The backup has no data section.');
  for (const [name, records] of Object.entries(data)) {
    if (!Array.isArray(records)) return fail(`The "${name}" section is damaged.`);
  }
  const known = await exportableStoreNames();
  const unknown = Object.keys(data).filter((name) => !known.includes(name));
  if (unknown.length) {
    return fail(`The backup contains data this version cannot store (${unknown.join(', ')}). Update FitLog first.`);
  }
  const checksum = await sha256Hex(JSON.stringify(data));
  if (checksum !== parsed.checksum) {
    return fail('The integrity check failed. The backup is damaged or was edited, so it was not used.');
  }
  const counts = countsOf(data);
  return {
    ok: true,
    parsed,
    counts,
    total: totalOf(counts),
    exportedAt: parsed.exportedAt,
    appVersion: parsed.appVersion,
    dbVersion: parsed.dbVersion,
  };
}

/* Replaces all data with the backup. A safety copy of the current data is kept first. */
export async function restoreBackup(parsed) {
  const before = await buildBackup();
  await putSafetyCopy({ createdAt: new Date().toISOString(), text: before.text, total: before.total });
  await replaceAllExportable(parsed.data);
}

export async function safetyCopyInfo() {
  const copy = await getSafetyCopy();
  return copy ? { createdAt: copy.createdAt, total: copy.total } : null;
}

export async function undoRestore() {
  const copy = await getSafetyCopy();
  if (!copy) throw new Error('There is no safety copy to go back to.');
  const inspected = await inspectBackup(copy.text);
  if (!inspected.ok) throw new Error(inspected.reason);
  await replaceAllExportable(inspected.parsed.data);
  await clearSafetyCopy();
}

/* ---- Getting the backup out of the app ---- */

/* Opens the iPhone share sheet so you can save the file to Files or iCloud Drive.
   Must be called straight from a tap, with the file already prepared. */
export async function shareBackupFile(built) {
  for (const type of ['application/json', 'text/plain']) {
    const file = new File([built.text], built.filename, { type });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'FitLog backup' });
        return { ok: true };
      } catch (error) {
        if (error && error.name === 'AbortError') return { ok: false, cancelled: true };
        return { ok: false, error };
      }
    }
  }
  return { ok: false, unsupported: true };
}

export async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) { /* blocked: caller shows a manual-copy box */ }
  }
  return false;
}

export function downloadFile(built) {
  const blob = new Blob([built.text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = built.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
