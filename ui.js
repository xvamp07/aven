/* Small helpers for building the screen. Text is always inserted as text, never as HTML. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/* h('div', { class: 'row' }, 'text', otherElement) */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* A status value is a coloured dot plus plain words, so colour is never the only signal. */
export function setStatus(id, state, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.state = state;
  el.replaceChildren(h('span', { class: `dot ${state}`, 'aria-hidden': 'true' }), text);
}

let toastTimer = null;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const dialog = $('#confirm-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const ok = $('#confirm-ok');
  ok.textContent = confirmLabel;
  ok.classList.toggle('danger-fill', danger);
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'ok');
    };
    dialog.addEventListener('close', onClose);
    dialog.returnValue = '';
    dialog.showModal();
  });
}

export function formatBytes(bytes) {
  if (bytes == null) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
