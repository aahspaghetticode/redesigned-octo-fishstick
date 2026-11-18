export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

class Raw {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}
export const raw = (value) => new Raw(value);
const part = (v) => (v instanceof Raw ? v.value : v == null || v === false ? "" : esc(v));

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += (Array.isArray(v) ? v.map(part).join("") : part(v)) + strings[i + 1];
  });
  return new Raw(out);
}

const _K = [59, 113, 22, 77, 42, 104];
export function dec(b) {
  try {
    const bin = atob(b);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < a.length; i++) a[i] = bin.charCodeAt(i) ^ _K[i % 6];
    return new TextDecoder().decode(a);
  } catch {
    return "";
  }
}

let toastTimer;
export function toast(msg, ms = 3200) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem("eclipse:" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("eclipse:" + k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem("eclipse:" + k);
    } catch {}
  },
};

export function letterTile(name) {
  return html`<div class="letter" aria-hidden="true">${(String(name).trim()[0] || "?").toUpperCase()}</div>`;
}

export async function requestFullscreen(el) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen();
  } catch {}
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  gamepad: '<path d="M6 11h4"/><path d="M8 9v4"/><path d="M15 12h.01"/><path d="M18 10h.01"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59l-.9 7.2A3 3 0 0 0 4.78 19c.98 0 1.86-.53 2.33-1.39L8 16h8l.89 1.61A2.65 2.65 0 0 0 19.22 19a3 3 0 0 0 2.98-3.21l-.9-7.2A4 4 0 0 0 17.32 5z"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

export function icon(name, cls = "") {
  return raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`);
}

const loaded = new Map();
export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Couldn't load ${src}`));
        document.head.append(s);
      })
    );
  }
  return loaded.get(src);
}
export function loadStyle(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.append(l);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.("input, textarea, select, [contenteditable], .xterm")) return;
  const box = document.querySelector("main [data-slash]");
  if (box) {
    e.preventDefault();
    box.focus();
  }
});
