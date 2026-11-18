import { ENGINES, DEFAULT_ENGINE, engineStatus, currentEngine, setEngine, bindEngineSelect } from "./engine.js";
import { $, esc, toast, store, requestFullscreen, dec, loadScript } from "./util.js";

let swReady = null;
let scramjet = null;
const wispUrl = () => (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/svc/w/";

export function boot() {
  if (swReady) return swReady;
  swReady = (async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error(
        location.protocol !== "https:"
          ? dec("bxl/PgoNVRZ/I09IVRRzKVlIcyVCHXlGGz5mKERIfhJ6JFobXlF5O08aGxliOVobAV45bQIKSR5hPk8aSFFiOFgGGwJzP1wBWBQ2OkUaUBRkPgoHXRc2IkRISx13JERIUwViPQNG")
          : dec("bxl/PgoKSR5hPk8aGxV5KFkGHAU2Pl8YSx5kOQobXgNgJEkNGwZ5P0ENSQI4")
      );
    }
    await loadScript("/assets/mx.js");
    await loadScript("/assets/rt.js");
    await loadScript("/assets/vb.js");
    await loadScript("/assets/vc.js");
    if (typeof $scramjetLoadController !== "function" || typeof BareMux === "undefined") {
      throw new Error(dec("awN5NVNISBJkJFocSFFwLEMEXhU2OUVIVx53KQRIaRR6IksMGwV+KAoYWhZzYw=="));
    }
    const { ScramjetController } = $scramjetLoadController();
    scramjet = new ScramjetController({
      prefix: "/svc/a/",
      files: { wasm: "/assets/rt.wasm", all: "/assets/rt.js", sync: "/assets/rs.js" },
    });
    await scramjet.init();
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const conn = new BareMux.BareMuxConnection("/assets/mw.js");
    if ((await conn.getTransport()) !== "/assets/tp.mjs") {
      await conn.setTransport("/assets/tp.mjs", [{ wisp: wispUrl() }]);
    }
  })();
  swReady.catch(() => (swReady = null));
  return swReady;
}

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

async function proxiedSrc(engine, url) {
  const st = await engineStatus();
  if (!st[engine]?.ok) throw new Error(`${ENGINES[engine].name} is turned off on this server${st[engine]?.reason ? ` (${st[engine].reason})` : ""}.`);
  switch (engine) {
    case "e2":
      await boot();
      return __uv$config.prefix + __uv$config.encodeUrl(url);
    case "e4":
      return `/svc/c/${xor(url)}`;
  }
  throw new Error("Unknown engine");
}

function decodeFrameUrl(engine, frame) {
  try {
    const loc = frame.contentWindow.location;
    const path = loc.pathname + loc.search + loc.hash;
    if (engine === "e2" && path.startsWith(__uv$config.prefix)) return __uv$config.decodeUrl(path.slice(__uv$config.prefix.length));
    if (engine === "e4" && path.startsWith("/svc/c/")) return unxor(path.slice(7).replace(/^[a-z]+_\//, ""));
  } catch {}
  return null;
}

function toUrl(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(s) || /^localhost(?::\d+)?/.test(s)) return "https://" + s;
  return store.get("search", "https://duckduckgo.com/?q=%s").replace("%s", encodeURIComponent(s));
}

export async function makeFrame(url) {
  const st = await engineStatus();
  const engine = st[currentEngine()]?.ok ? currentEngine() : DEFAULT_ENGINE;
  if (engine === "e1") {
    await boot();
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

const tab = { engine: null, sj: null, iframe: null, url: "" };
const holder = () => $("#browser-frame");

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
    dec("eQN5OlkNGwFkJFwJTxR6NA=="),
    `${dec("bwhmKAoJVVF3KU4aXgJlbUUaGxA2Pk8JSRJ+bUsKVAdzYwo4WhZzPgoEVBBybV4ASR5jKkJITxl/PgobXgNgKFhITgJ/I01I")}<strong style="color:var(--text)">${esc(engine)}</strong>.`,
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
  $("#browser").hidden = false;
  $("#address").value = url;
  tab.url = url;
  loading(true);
  try {
    if (engine === "e1") {
      await boot();
      if (tab.engine !== "e1" || !tab.sj) {
        tab.sj = scramjet.createFrame();
        tab.sj.frame.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media");
        tab.sj.addEventListener("urlchange", (e) => {
          if (e.url && document.activeElement !== $("#address")) $("#address").value = tab.url = e.url;
        });
        tab.sj.frame.addEventListener("load", () => loading(false));
      }
      tab.engine = "e1";
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
          tab.iframe.src = tab.iframe.src;
        }
      } else tab.iframe.contentWindow.history[act]();
    } catch {
      toast(`${ENGINES[tab.engine].name} can't do that here. Use the page's own links.`);
    }
  });
  if (!holder().querySelector("iframe")) blankState();
}
