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

/** Tagged template that escapes interpolations; nest html`` results freely. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += (Array.isArray(v) ? v.map(part).join("") : part(v)) + strings[i + 1];
  });
  return new Raw(out);
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
      const v = localStorage.getItem("henws:" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("henws:" + k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem("henws:" + k);
    } catch {}
  },
};

/** Deterministic muted colour for cards without artwork. */
export function tint(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 28% 26%)`;
}

export function letterTile(name) {
  return html`<div class="letter" style="background:${tint(name)}">${(String(name).trim()[0] || "?").toUpperCase()}</div>`;
}

export async function requestFullscreen(el) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.requestFullscreen();
  } catch {}
}
