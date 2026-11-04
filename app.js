/* FitLog, Phase 0: foundation and setup check.
   Nutrition and Gym screens arrive in later phases; this phase proves that the app
   installs, opens offline, keeps data, backs up, restores and updates safely. */

import { $, $$, h, setStatus, toast, confirmDialog, formatBytes, formatDate, formatDateTime } from './ui.js';
import * as db from './db.js';
import * as diag from './diagnostics.js';
import * as backup from './backup.js';

const VERSION = self.APP_VERSION || 'unknown';
const STORE_NAMES = { testNotes: 'Test notes' };
const friendlyStore = (name) => STORE_NAMES[name] || name;

const state = {
  view: 'settings',
  lastMainTab: 'nutrition',
  launch: null,
  dbOk: false,
  dbError: null,
  registration: null,
  swError: null,
  hadController: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
  pendingWorker: null,
  built: null,
  inspected: null,
  cacheComplete: false,
  lastUpdateCheck: 0,
};

/* ------------------------------------------------------------------ views */

const TITLES = { nutrition: 'Nutrition', gym: 'Gym', settings: 'Setup check' };

function showView(name) {
  state.view = name;
  if (name !== 'settings') state.lastMainTab = name;
  for (const view of Object.keys(TITLES)) $(`#view-${view}`).hidden = view !== name;
  $('#topbar-title').textContent = TITLES[name];
  $('#btn-settings').hidden = name === 'settings';
  $('#btn-done').hidden = name !== 'settings';
  for (const tab of $$('.tab')) {
    tab.setAttribute('aria-current', tab.dataset.tab === name ? 'page' : 'false');
  }
  window.scrollTo(0, 0);
}

/* --------------------------------------------------------------- database */

async function initDatabase() {
  try {
    state.launch = await db.recordLaunch();
    const probe = { key: 'selftest', value: db.newId() };
    await db.put('device', probe);
    const readBack = await db.get('device', 'selftest');
    if (!readBack || readBack.value !== probe.value) {
      throw new Error('A test value was saved but a different one came back.');
    }
    state.dbOk = true;
  } catch (error) {
    state.dbOk = false;
    state.dbError = error;
  }
}

/* ---------------------------------------------------------- service worker */

async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('sw.js', {
      scope: './',
      updateViaCache: 'none',
    });
    watchRegistration(registration);
    return registration;
  } catch (error) {
    state.swError = error;
    return null;
  }
}

function watchRegistration(registration) {
  if (registration.waiting && navigator.serviceWorker.controller) showUpdateReady(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateReady(worker);
      scheduleRefresh();
    });
  });
}

let reloading = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  /* The first install also changes the controller; only reload for real updates. */
  if (!state.hadController || reloading) { scheduleRefresh(); return; }
  reloading = true;
  window.location.reload();
});

async function showUpdateReady(worker) {
  state.pendingWorker = worker;
  const info = await diag.askWorker(worker, 'GET_STATUS');
  $('#update-banner-text').textContent = info && info.version
    ? `Version ${info.version} is ready. Apply it when you are not in the middle of logging.`
    : 'A new version is ready. Apply it when you are not in the middle of logging.';
  $('#update-banner').hidden = false;
}

function applyUpdate() {
  const worker = state.pendingWorker || (state.registration && state.registration.waiting);
  if (!worker) return;
  const button = $('#btn-apply-update');
  button.disabled = true;
  button.textContent = 'Applying…';
  worker.postMessage({ type: 'SKIP_WAITING' });
}

async function checkForUpdates() {
  const status = $('#update-status');
  const registration = state.registration;
  if (!registration) {
    status.textContent = 'The service worker is not running, so there is nothing to update.';
    return;
  }
  status.textContent = 'Checking…';
  try {
    state.lastUpdateCheck = Date.now();
    await registration.update();
    if (registration.waiting) {
      showUpdateReady(registration.waiting);
      status.textContent = 'A new version is ready. Tap Apply update at the top.';
    } else if (registration.installing) {
      status.textContent = 'A new version is downloading. A banner appears at the top when it is ready.';
    } else {
      status.textContent = `You have the latest version (${VERSION}).`;
    }
  } catch (error) {
    status.textContent = navigator.onLine
      ? `Could not check for updates: ${error.message}`
      : 'You are offline. FitLog checks again when you are back online.';
  }
}

/* ------------------------------------------------------------- the checks */

let refreshQueue = Promise.resolve();
function scheduleRefresh() {
  refreshQueue = refreshQueue.then(refreshAll).catch((error) => console.error(error));
  return refreshQueue;
}

async function refreshAll() {
  const checks = [];

  /* Install and offline */
  const installed = diag.displayMode() === 'standalone';
  setStatus('v-display', installed ? 'ok' : 'warn', installed ? 'Home Screen app' : 'Browser tab');
  checks.push({ label: 'Home Screen', state: installed ? 'ok' : 'warn', required: true });

  const sw = await diag.serviceWorkerInfo(state.registration);
  let swState; let swText;
  if (!sw.supported) { swState = 'bad'; swText = 'Not supported here'; }
  else if (state.swError) { swState = 'bad'; swText = `Failed: ${state.swError.message}`; }
  else if (!sw.registered) { swState = 'idle'; swText = 'Starting…'; }
  else if (!sw.activeState) { swState = 'idle'; swText = 'Installing…'; }
  else if (!sw.controlled) { swState = 'idle'; swText = 'Active, reopen FitLog once to finish'; }
  else { swState = 'ok'; swText = 'Active'; }
  setStatus('v-sw', swState, swText);
  checks.push({ label: 'Service worker', state: swState, required: true });

  let cacheState; let cacheText;
  const status = sw.status;
  if (!status) { cacheState = swState === 'bad' ? 'bad' : 'idle'; cacheText = 'Waiting for the service worker'; }
  else if (status.cached >= status.expected) { cacheState = 'ok'; cacheText = `All ${status.expected} files stored`; }
  else { cacheState = 'bad'; cacheText = `${status.cached} of ${status.expected} files stored`; }
  state.cacheComplete = cacheState === 'ok';
  setStatus('v-cache', cacheState, cacheText);
  checks.push({ label: 'Offline files', state: cacheState, required: true });

  setStatus('v-online', 'idle', navigator.onLine ? 'Online' : 'Offline');

  /* Storage */
  if (state.dbOk) setStatus('v-db', 'ok', 'Working');
  else setStatus('v-db', 'bad', `Failed: ${state.dbError ? state.dbError.message : 'unknown error'}`);
  checks.push({ label: 'Database', state: state.dbOk ? 'ok' : 'bad', required: true });

  const launch = state.launch;
  if (launch && launch.isRepeat) {
    setStatus('v-kept', 'ok', `Yes, since ${formatDate(launch.firstOpenedAt)}`);
    checks.push({ label: 'Data kept', state: 'ok', required: false });
  } else {
    setStatus('v-kept', 'idle', 'Open FitLog again to confirm');
    checks.push({ label: 'Data kept', state: 'idle', required: false });
  }

  const storage = await diag.storageInfo();
  let persistState; let persistText;
  if (storage.persisted === true) { persistState = 'ok'; persistText = 'Granted'; }
  else if (storage.persisted === false) { persistState = 'warn'; persistText = 'Not granted'; }
  else { persistState = 'warn'; persistText = 'Not supported'; }
  setStatus('v-persist', persistState, persistText);
  $('#btn-persist').hidden = storage.persisted !== false;
  checks.push({ label: 'Persistent storage', state: persistState, required: false });

  $('#v-space').textContent = storage.usage != null
    ? `${formatBytes(storage.usage)} of about ${formatBytes(storage.quota)}`
    : 'Unknown';
  $('#v-first').textContent = launch ? formatDateTime(launch.firstOpenedAt) : 'Unknown';
  $('#v-count').textContent = launch ? String(launch.openCount) : 'Unknown';

  /* Updates */
  if (status && status.version !== VERSION) setStatus('v-version', 'warn', `Files ${VERSION}, worker ${status.version}`);
  else setStatus('v-version', 'ok', VERSION);

  /* This phone */
  const system = diag.systemSummary();
  const insets = diag.safeAreaInsets();
  const share = diag.shareSupport();
  $('#v-system').textContent = system.label;
  $('#v-screen').textContent = system.screen;
  $('#v-insets').textContent = `top ${Math.round(insets.top)}, bottom ${Math.round(insets.bottom)}`;
  const canShareFile = share.json || share.text;
  setStatus('v-share', canShareFile ? 'ok' : 'warn',
    canShareFile ? (share.json ? 'Available' : 'As text file') : 'Not available');
  setStatus('v-clipboard', system.clipboard ? 'ok' : 'warn', system.clipboard ? 'Available' : 'Not available');
  setStatus('v-wake', system.wakeLock ? 'ok' : 'warn', system.wakeLock ? 'Available' : 'Not available');
  checks.push({ label: 'File sharing', state: canShareFile ? 'ok' : 'warn', required: false });

  renderVerdict(checks, installed);
}

function renderVerdict(checks, installed) {
  $('#check-strip').replaceChildren(...checks.map((check) =>
    h('li', { class: 'chip' }, h('span', { class: `dot ${check.state}`, 'aria-hidden': 'true' }), check.label)));

  const names = (list) => list.map((c) => c.label.toLowerCase()).join(', ');
  const failing = checks.filter((c) => c.required && c.state === 'bad');
  const pending = checks.filter((c) => c.required && c.state === 'idle');
  const optional = checks.filter((c) => !c.required && c.state === 'warn');

  let level; let title; let text;
  if (failing.length) {
    level = 'bad';
    title = 'Needs attention';
    text = `Not working yet: ${names(failing)}. The details are below. Copy all results at the bottom and send them to me.`;
  } else if (!installed) {
    level = 'warn';
    title = 'Not installed yet';
    text = 'You are looking at FitLog in a browser tab. In Safari, tap Share, then Add to Home Screen, and open FitLog from its icon to run the install checks.';
  } else if (pending.length) {
    level = 'idle';
    title = 'Getting ready…';
    text = `Still preparing: ${names(pending)}.`;
  } else {
    level = 'ok';
    title = 'Ready for offline use';
    text = 'Installed, files stored, database working. Next: close FitLog, switch on airplane mode and open it again.';
    if (optional.length) text += ` ${optional.length} optional ${optional.length === 1 ? 'check needs' : 'checks need'} a look.`;
  }
  $('#verdict').dataset.state = level;
  $('#verdict-title').textContent = title;
  $('#verdict-text').textContent = text;
}

function startSetupPolling() {
  let polls = 0;
  const timer = setInterval(async () => {
    polls += 1;
    await scheduleRefresh();
    if (state.cacheComplete || polls >= 15) clearInterval(timer);
  }, 1000);
}

/* ------------------------------------------------------------- test notes */

async function renderNotes() {
  const list = $('#notes-list');
  $$('.note-row, .notes-empty', list).forEach((node) => node.remove());
  const notes = (await db.getAll('testNotes')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const form = $('#note-form');
  if (!notes.length) {
    form.after(h('div', { class: 'row row-empty notes-empty' }, 'No notes yet. Add one, then close and reopen FitLog.'));
    return;
  }
  form.after(...notes.map((note) => h('div', { class: 'row note-row' },
    h('span', { class: 'row-label' },
      h('span', { class: 'note-text' }, note.text),
      h('span', { class: 'note-time' }, formatDateTime(note.createdAt))),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete note', onclick: () => deleteNote(note.id) }, '×'))));
}

async function addNote(event) {
  event.preventDefault();
  const input = $('#note-input');
  const text = input.value.trim();
  if (!text) { toast('Write something first.'); return; }
  try {
    await db.put('testNotes', { id: db.newId(), text, createdAt: new Date().toISOString() });
    input.value = '';
    await renderNotes();
  } catch (error) {
    toast(`Could not save the note: ${error.message}`);
  }
}

async function deleteNote(id) {
  try {
    await db.remove('testNotes', id);
    await renderNotes();
  } catch (error) {
    toast(`Could not delete the note: ${error.message}`);
  }
}

/* ----------------------------------------------------------------- backup */

function showManualCopy(textareaId, text) {
  const box = $(`#${textareaId}`);
  box.value = text;
  box.hidden = false;
  box.focus();
  box.select();
}

async function createBackup() {
  const status = $('#backup-status');
  const button = $('#btn-create-backup');
  button.disabled = true;
  try {
    const built = await backup.buildBackup();
    state.built = built;
    $('#backup-summary').hidden = false;
    $('#backup-summary-text').textContent = `${built.total} ${built.total === 1 ? 'record' : 'records'}, ${formatBytes(built.bytes)}`;
    const share = diag.shareSupport();
    $('#btn-share-backup').hidden = !(share.json || share.text);
    $('#btn-copy-backup').hidden = false;
    $('#btn-download-backup').hidden = false;
    $('#backup-fallback').hidden = true;
    status.textContent = built.total === 0
      ? 'The backup is empty because there are no test notes yet. Add a note first so the restore test has something to check.'
      : `Ready as ${built.filename}. Save it to Files or iCloud Drive, then check it arrived.`;
  } catch (error) {
    status.textContent = `Could not create the backup: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function shareBackup() {
  if (!state.built) return;
  const result = await backup.shareBackupFile(state.built);
  if (result.ok) toast('Shared. Check that the file arrived in Files.');
  else if (result.cancelled) toast('Sharing cancelled.');
  else if (result.unsupported) $('#backup-status').textContent = 'This browser cannot share files. Use Copy as text instead.';
  else $('#backup-status').textContent = `Sharing failed: ${result.error ? result.error.message : 'unknown error'}. Use Copy as text instead.`;
}

async function copyBackup() {
  if (!state.built) return;
  const copied = await backup.copyText(state.built.text);
  if (copied) {
    toast('Backup copied. Paste it into Notes or Files to keep it.');
  } else {
    showManualCopy('backup-fallback', state.built.text);
    $('#backup-status').textContent = 'Copying was blocked. The backup text is selected below: copy it by hand.';
  }
}

function downloadBackup() {
  if (!state.built) return;
  backup.downloadFile(state.built);
  toast('If nothing was saved, use Save to Files or Copy as text. Downloads can behave differently in the installed app.');
}

/* ---------------------------------------------------------------- restore */

const detailRow = (label, value) => h('div', { class: 'row' },
  h('span', { class: 'row-label' }, label),
  h('span', { class: 'row-value' }, value));

function renderInspection(result) {
  const box = $('#restore-result');
  const restoreButton = $('#btn-restore');
  const status = $('#restore-status');
  if (!result.ok) {
    state.inspected = null;
    box.hidden = true;
    restoreButton.hidden = true;
    status.textContent = result.reason;
    return;
  }
  state.inspected = result;
  box.replaceChildren(
    detailRow('Made on', formatDateTime(result.exportedAt)),
    detailRow('App version', result.appVersion || 'unknown'),
    detailRow('Integrity check', 'Passed'),
    ...Object.entries(result.counts).map(([name, count]) => detailRow(friendlyStore(name), String(count))),
  );
  box.hidden = false;
  restoreButton.hidden = false;
  status.textContent = 'This backup is valid. Nothing has changed yet. Tap the red button to replace your data with it.';
}

async function inspectText(text) {
  try {
    renderInspection(await backup.inspectBackup(text));
  } catch (error) {
    renderInspection({ ok: false, reason: `Could not check the backup: ${error.message}` });
  }
}

async function onFileChosen(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    await inspectText(await file.text());
  } catch (error) {
    renderInspection({ ok: false, reason: `Could not read that file: ${error.message}` });
  }
  input.value = '';
}

async function restoreNow() {
  const inspected = state.inspected;
  if (!inspected) return;
  const current = await backup.currentCounts();
  const confirmed = await confirmDialog({
    title: 'Replace your data?',
    message: `This replaces the ${current.total} ${current.total === 1 ? 'record' : 'records'} on this phone with ${inspected.total} from the backup made on ${formatDateTime(inspected.exportedAt)}. FitLog keeps a safety copy so you can undo once.`,
    confirmLabel: 'Replace data',
    danger: true,
  });
  if (!confirmed) return;
  const status = $('#restore-status');
  try {
    await backup.restoreBackup(inspected.parsed);
    state.inspected = null;
    $('#restore-result').hidden = true;
    $('#btn-restore').hidden = true;
    await renderNotes();
    await refreshUndo();
    status.textContent = `Restored ${inspected.total} ${inspected.total === 1 ? 'record' : 'records'}.`;
    toast('Backup restored.');
  } catch (error) {
    status.textContent = `The restore failed and your existing data was not changed: ${error.message}`;
  }
}

async function undoRestore() {
  const info = await backup.safetyCopyInfo();
  if (!info) return;
  const confirmed = await confirmDialog({
    title: 'Undo the last restore?',
    message: `This puts back the ${info.total} ${info.total === 1 ? 'record' : 'records'} you had before the restore on ${formatDateTime(info.createdAt)}.`,
    confirmLabel: 'Undo restore',
  });
  if (!confirmed) return;
  try {
    await backup.undoRestore();
    await renderNotes();
    await refreshUndo();
    $('#restore-status').textContent = 'Your previous data is back.';
    toast('Restore undone.');
  } catch (error) {
    $('#restore-status').textContent = `Could not undo: ${error.message}`;
  }
}

async function refreshUndo() {
  const info = await backup.safetyCopyInfo();
  const button = $('#btn-undo-restore');
  button.hidden = !info;
  if (info) button.textContent = `Undo last restore (${formatDateTime(info.createdAt)})`;
}

/* ------------------------------------------------------- results to share */

async function copyReport() {
  const lines = [
    `FitLog setup check, version ${VERSION}`,
    `Taken ${new Date().toISOString()}`,
    `Verdict: ${$('#verdict-title').textContent}`,
    '',
  ];
  for (const row of $$('#view-settings .row')) {
    const label = row.querySelector('.row-label');
    const value = row.querySelector('.row-value');
    if (label && value) lines.push(`${label.textContent}: ${value.textContent}`);
  }
  const text = lines.join('\n');
  if (await backup.copyText(text)) toast('Results copied. Paste them into the chat.');
  else showManualCopy('report-fallback', text);
}

async function requestPersistence() {
  const result = await diag.requestPersistence();
  if (!result.supported) toast('This browser does not offer persistent storage.');
  else toast(result.granted ? 'Persistent storage granted.' : 'Not granted. Regular backups matter more.');
  scheduleRefresh();
}

/* ----------------------------------------------------------------- wiring */

function wireUi() {
  $('#btn-settings').addEventListener('click', () => showView('settings'));
  $('#btn-done').addEventListener('click', () => showView(state.lastMainTab));
  for (const tab of $$('.tab')) tab.addEventListener('click', () => showView(tab.dataset.tab));
  for (const button of $$('[data-open-settings]')) button.addEventListener('click', () => showView('settings'));

  $('#note-form').addEventListener('submit', addNote);
  $('#btn-persist').addEventListener('click', requestPersistence);

  $('#btn-create-backup').addEventListener('click', createBackup);
  $('#btn-share-backup').addEventListener('click', shareBackup);
  $('#btn-copy-backup').addEventListener('click', copyBackup);
  $('#btn-download-backup').addEventListener('click', downloadBackup);

  $('#restore-file').addEventListener('change', onFileChosen);
  $('#btn-check-pasted').addEventListener('click', () => inspectText($('#restore-text').value.trim()));
  $('#btn-restore').addEventListener('click', restoreNow);
  $('#btn-undo-restore').addEventListener('click', undoRestore);

  $('#btn-check-update').addEventListener('click', checkForUpdates);
  $('#btn-apply-update').addEventListener('click', applyUpdate);
  $('#btn-copy-report').addEventListener('click', copyReport);

  window.addEventListener('online', scheduleRefresh);
  window.addEventListener('offline', scheduleRefresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    scheduleRefresh();
    /* An installed app can stay open for days, so look for updates when you come back to it. */
    if (state.registration && Date.now() - state.lastUpdateCheck > 10 * 60 * 1000) {
      state.lastUpdateCheck = Date.now();
      state.registration.update().catch(() => {});
    }
  });
}

async function main() {
  wireUi();
  showView('settings');
  await initDatabase();
  state.registration = await registerWorker();
  await renderNotes();
  await refreshUndo();
  await scheduleRefresh();
  startSetupPolling();
}

main().catch((error) => {
  console.error(error);
  $('#verdict').dataset.state = 'bad';
  $('#verdict-title').textContent = 'FitLog could not start';
  $('#verdict-text').textContent = String(error && error.message ? error.message : error);
});
