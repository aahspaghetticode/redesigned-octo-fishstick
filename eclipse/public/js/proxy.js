// Proxy engines + the persistent Browse surface.
import { $, esc, toast, store, requestFullscreen } from "./util.js";

export const ENGINES = {
  scramjet: { name: "Scramjet", desc: "Fastest and works on the most sites, including YouTube and Discord." },
  ultraviolet: { name: "Ultraviolet", desc: "Mature service-worker proxy. A good fallback when a site breaks on Scramjet." },
  rammerhead: { name: "Rammerhead", desc: "Rewrites pages on the server. Handles some login-heavy sites well." },
  corrosion: { name: "Corrosion", desc: "Older server-side rewriter. Best for simple or older sites." },
  womginx: { name: "Womginx", desc: "Lightweight nginx-based proxy. Quick on simple pages, weak on modern apps." },
};
export const DEFAULT_ENGINE = "scramjet";

// ---------- engine status ----------

let statusPromise = null;
export function engineStatus() {
  statusPromise ||= fetch("/api/engines")
    .then((r) => r.json())
    .catch(() => ({ scramjet: { ok: true }, ultraviolet: { ok: true } }));
  return statusPromise;
}

export function currentEngine() {
  const e = store.get("proxyEngine", DEFAULT_ENGINE);
  return ENGINES[e] ? e : DEFAULT_ENGINE;
}
export function setEngine(e) {
  if (!ENGINES[e]) return;
  store.set("proxyEngine", e);
  document.querySelectorAll("select[data-engine-select]").forEach((s) => (s.value = e));
}

/** Fill a <select> with the engines and keep it in sync with the setting. */
export async function bindEngineSelect(select, onChange) {
  const st = await engineStatus();
  select.dataset.engineSelect = "";
  select.innerHTML = Object.entries(ENGINES)
    .map(([id, e]) => `<option value="${id}" ${st[id]?.ok ? "" : "disabled"}>${esc(e.name)}${st[id]?.ok ? "" : " (off)"}</option>`)
    .join("");
  select.value = currentEngine();
  select.addEventListener("change", () => {
    setEngine(select.value);
    onChange?.(select.value);
  });
}

// ---------- service worker engines (Scramjet, Ultraviolet) ----------

let swReady = null;
let scramjet = null;
const wispUrl = () => (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";

function ensureServiceWorker() {
  if (swReady) return swReady;
  swReady = (async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error(
        location.protocol !== "https:"
          ? "This engine needs HTTPS. Open Eclipse over https:// (browsers turn service workers off on plain http)."
          : "This browser doesn't support service workers."
      );
    }
    if (typeof $scramjetLoadController !== "function" || typeof BareMux === "undefined") {
      throw new Error("Proxy scripts failed to load. Reload the page.");
    }
    const { ScramjetController } = $scramjetLoadController();
    scramjet = new ScramjetController({
      prefix: "/scramjet/",
      files: { wasm: "/scram/scramjet.wasm.wasm", all: "/scram/scramjet.all.js", sync: "/scram/scramjet.sync.js" },
    });
    await scramjet.init();
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const conn = new BareMux.BareMuxConnection("/baremux/worker.js");
    if ((await conn.getTransport()) !== "/epoxy/index.mjs") {
      await conn.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl() }]);
    }
  })();
  swReady.catch(() => (swReady = null));
  return swReady;
}
export const warmUp = () => ensureServiceWorker().catch(() => {});

// ---------- per-engine URL building ----------

const xor = (s) =>
  encodeURIComponent(
    s
      .split("")
      .map((c, i) => (i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c))
      .join("")
  );
const unxor = (s) =>
  decodeURIComponent(s)
    .split("")
    .map((c, i) => (i % 2 ? String.fromCharCode(c.charCodeAt(0) ^ 2) : c))
    .join("");

async function rammerheadSession() {
  let id = store.get("rh:session");
  if (id) {
    const exists = await fetch(`/sessionexists?id=${id}`).then((r) => r.text()).catch(() => "");
    if (exists !== "exists") id = null;
  }
  if (!id) {
    const r = await fetch("/newsession");
    if (!r.ok) throw new Error("Rammerhead couldn't create a session.");
    id = (await r.text()).trim();
    store.set("rh:session", id);
  }
  // Eclipse keeps URL shuffling off so the server can vet destinations.
  await fetch(`/editsession?id=${id}&enableShuffling=0`).catch(() => {});
  return id;
}
export function resetRammerhead() {
  const id = store.get("rh:session");
  store.del("rh:session");
  if (id) fetch(`/deletesession?id=${id}`).catch(() => {});
}

/** Proxied src for iframe-based engines. */
async function proxiedSrc(engine, url) {
  const st = await engineStatus();
  if (!st[engine]?.ok) throw new Error(`${ENGINES[engine].name} is turned off on this server${st[engine]?.reason ? ` (${st[engine].reason})` : ""}.`);
  switch (engine) {
    case "ultraviolet":
      await ensureServiceWorker();
      return __uv$config.prefix + __uv$config.encodeUrl(url);
    case "rammerhead":
      return `/${await rammerheadSession()}/${url}`;
    case "corrosion":
      return `/corrosion/${xor(url)}`;
    case "womginx": {
      const base = st.womginx.url;
      return `${base}/womginxaddcookie/${Date.now()}/${base}/main/${url}`;
    }
  }
  throw new Error("Unknown engine");
}

/** Read the real URL back out of a same-origin proxied iframe. */
function decodeFrameUrl(engine, frame) {
  try {
    const loc = frame.contentWindow.location;
    const path = loc.pathname + loc.search + loc.hash;
    if (engine === "ultraviolet" && path.startsWith(__uv$config.prefix)) return __uv$config.decodeUrl(path.slice(__uv$config.prefix.length));
    if (engine === "rammerhead") return /^\/[a-z0-9]{32}[^/]*\/(.+)$/.exec(path)?.[1] || null;
    if (engine === "corrosion" && path.startsWith("/corrosion/")) return unxor(path.slice(11).replace(/^[a-z]+_\//, ""));
  } catch {}
  return null;
}

/** Turn whatever the user typed into a URL. */
export function toUrl(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(s) || /^localhost(?::\d+)?/.test(s)) return "https://" + s;
  return store.get("search", "https://duckduckgo.com/?q=%s").replace("%s", encodeURIComponent(s));
}

/**
 * A proxied iframe for the game player, using the chosen engine (Scramjet if
 * the chosen one is off).
 */
export async function createProxiedFrame(url) {
  const st = await engineStatus();
  const engine = st[currentEngine()]?.ok ? currentEngine() : DEFAULT_ENGINE;
  if (engine === "scramjet") {
    await ensureServiceWorker();
    const f = scramjet.createFrame();
    f.frame.setAttribute("allow", "fullscreen; autoplay; gamepad; clipboard-read; clipboard-write");
    f.go(url);
    return f.frame;
  }
  const iframe = document.createElement("iframe");
  iframe.setAttribute("allow", "fullscreen; autoplay; gamepad; clipboard-read; clipboard-write");
  iframe.src = await proxiedSrc(engine, url);
  return iframe;
}

// ---------- Browse surface ----------

const tab = { engine: null, sj: null, iframe: null, url: "" };
const holder = () => $("#browser-frame");

export function showBrowser(show) {
  $("#browser").hidden = !show;
}

function loading(on) {
  const bar = $("#loadbar");
  bar.classList.remove("on", "done");
  void bar.offsetWidth;
  bar.classList.add(on ? "on" : "done");
}

function showMessage(title, body, actions = "") {
  holder().innerHTML = `<div class="blank"><div><img src="/logo.svg" alt="" /><h3>${esc(title)}</h3><p>${body}</p>${actions}</div></div>`;
}

function blankState() {
  const engine = ENGINES[currentEngine()].name;
  showMessage(
    "Browse privately",
    `Type an address or a search above. Pages load through this server using <strong style="color:var(--text)">${esc(engine)}</strong>.`,
    `<div class="quick">${[
      ["YouTube", "https://www.youtube.com"],
      ["Discord", "https://discord.com/app"],
      ["Reddit", "https://www.reddit.com"],
      ["Wikipedia", "https://en.wikipedia.org"],
    ]
      .map(([n, u]) => `<button class="chip" data-open="${u}">${n}</button>`)
      .join("")}</div>`
  );
}

export async function openInBrowser(input, engine = currentEngine()) {
  const url = toUrl(input);
  if (!url) return;
  if (location.hash.split("?")[0] !== "#/browse") location.hash = "#/browse";
  showBrowser(true);
  $("#address").value = url;
  tab.url = url;
  loading(true);
  try {
    if (engine === "scramjet") {
      await ensureServiceWorker();
      if (tab.engine !== "scramjet" || !tab.sj) {
        tab.sj = scramjet.createFrame();
        tab.sj.frame.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media");
        tab.sj.addEventListener("urlchange", (e) => {
          if (e.url && document.activeElement !== $("#address")) $("#address").value = tab.url = e.url;
        });
        tab.sj.frame.addEventListener("load", () => loading(false));
      }
      tab.engine = "scramjet";
      tab.iframe = tab.sj.frame;
      holder().replaceChildren(tab.iframe);
      tab.sj.go(url);
    } else {
      const src = await proxiedSrc(engine, url);
      if (tab.engine !== engine || !tab.iframe || tab.sj?.frame === tab.iframe) {
        const f = document.createElement("iframe");
        f.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media");
        f.addEventListener("load", () => {
          loading(false);
          const real = decodeFrameUrl(engine, f);
          if (real && document.activeElement !== $("#address")) $("#address").value = tab.url = real;
        });
        tab.iframe = f;
        tab.sj = null;
      }
      tab.engine = engine;
      holder().replaceChildren(tab.iframe);
      tab.iframe.src = src;
    }
  } catch (e) {
    loading(false);
    const others = engine === DEFAULT_ENGINE ? "" : `<div class="quick"><button class="btn" data-switch="${DEFAULT_ENGINE}">Use ${ENGINES[DEFAULT_ENGINE].name} instead</button></div>`;
    showMessage(`${ENGINES[engine].name} couldn't load this page`, esc(e.message), others);
  }
}

export function initBrowser() {
  bindEngineSelect($("#browser-engine"), (e) => {
    if (tab.url) openInBrowser(tab.url, e);
    else blankState();
    toast(`Now browsing with ${ENGINES[e].name}`);
  });
  $("#address-form").addEventListener("submit", (e) => {
    e.preventDefault();
    openInBrowser($("#address").value);
    $("#address").blur();
  });
  $("#browser").addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]")?.dataset.open;
    if (open) return openInBrowser(open);
    const sw = e.target.closest("[data-switch]")?.dataset.switch;
    if (sw) {
      setEngine(sw);
      return openInBrowser(tab.url || $("#address").value, sw);
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "fullscreen") return requestFullscreen(holder());
    if (act === "close") {
      tab.iframe?.remove();
      Object.assign(tab, { engine: null, sj: null, iframe: null, url: "" });
      $("#address").value = "";
      loading(false);
      return blankState();
    }
    if (!tab.iframe) return;
    try {
      if (tab.sj) tab.sj[act]();
      else if (act === "reload") {
        loading(true);
        try {
          tab.iframe.contentWindow.location.reload();
        } catch {
          tab.iframe.src = tab.iframe.src; // cross-origin (Womginx): reload the entry page
        }
      } else tab.iframe.contentWindow.history[act]();
    } catch {
      toast(`${ENGINES[tab.engine].name} can't do that here. Use the page's own links.`);
    }
  });
  blankState();
}
