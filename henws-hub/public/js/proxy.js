// Scramjet bootstrap + the persistent "Browse" surface.
import { $, toast, store, requestFullscreen } from "./util.js";

let scramjet = null;
let connection = null;
let readyPromise = null;
let mainFrame = null;

const wispUrl = () => (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";

/** Initialise Scramjet, the service worker and the Wisp transport. Idempotent. */
export function ensureProxy() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error(
        location.protocol !== "https:"
          ? "The proxy needs HTTPS. Open this site over https:// (service workers are disabled on plain http)."
          : "This browser doesn't support service workers."
      );
    }
    if (typeof $scramjetLoadController !== "function" || typeof BareMux === "undefined") {
      throw new Error("Proxy scripts failed to load.");
    }
    const { ScramjetController } = $scramjetLoadController();
    scramjet = new ScramjetController({
      prefix: "/scramjet/",
      files: { wasm: "/scram/scramjet.wasm.wasm", all: "/scram/scramjet.all.js", sync: "/scram/scramjet.sync.js" },
    });
    await scramjet.init();
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    connection = new BareMux.BareMuxConnection("/baremux/worker.js");
    if ((await connection.getTransport()) !== "/epoxy/index.mjs") {
      await connection.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl() }]);
    }
    return scramjet;
  })();
  readyPromise.catch(() => (readyPromise = null));
  return readyPromise;
}

/** Turn whatever the user typed into a URL. */
export function toUrl(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(s) || /^localhost(?::\d+)?/.test(s)) return "https://" + s;
  const engine = store.get("engine", "https://duckduckgo.com/?q=%s");
  return engine.replace("%s", encodeURIComponent(s));
}

/** Create a standalone proxied iframe (used by the game player). */
export async function createProxiedFrame(url) {
  const sj = await ensureProxy();
  const f = sj.createFrame();
  f.frame.setAttribute("allow", "fullscreen; autoplay; gamepad; clipboard-read; clipboard-write");
  f.go(url);
  return f;
}

const browser = () => $("#browser");

export function showBrowser(show) {
  browser().hidden = !show;
}

export async function openInBrowser(input) {
  const url = toUrl(input);
  if (!url) return;
  location.hash = "#/browse";
  showBrowser(true);
  $("#address").value = url;
  const holder = $("#browser-frame");
  try {
    const sj = await ensureProxy();
    if (!mainFrame) {
      mainFrame = sj.createFrame();
      mainFrame.frame.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media");
      mainFrame.addEventListener("urlchange", (e) => {
        if (e.url && document.activeElement !== $("#address")) $("#address").value = e.url;
      });
    }
    holder.replaceChildren(mainFrame.frame);
    mainFrame.go(url);
  } catch (e) {
    holder.innerHTML = "";
    const div = document.createElement("div");
    div.className = "blank";
    div.textContent = e.message;
    holder.append(div);
  }
}

function blankState() {
  const holder = $("#browser-frame");
  if (holder.querySelector("iframe")) return;
  holder.innerHTML = `<div class="blank"><div><p style="font-size:18px;color:var(--text);margin:0 0 6px">Browse privately</p><p style="margin:0">Type a URL or a search above. Pages load through this server.</p></div></div>`;
}

export function initBrowser() {
  $("#address-form").addEventListener("submit", (e) => {
    e.preventDefault();
    openInBrowser($("#address").value);
    $("#address").blur();
  });
  browser().addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "fullscreen") return requestFullscreen($("#browser-frame"));
    if (act === "close") {
      mainFrame?.frame.remove();
      $("#address").value = "";
      return blankState();
    }
    if (!mainFrame) return;
    try {
      mainFrame[act]();
    } catch {
      toast("That page can't be navigated right now.");
    }
  });
  blankState();
}
