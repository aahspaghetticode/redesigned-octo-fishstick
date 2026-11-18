import { $, html, raw, icon, store } from "./util.js";
import { initBrowser, showBrowser, openInBrowser, warmUp, bindEngineSelect } from "./proxy.js";
import { renderGames, loadCatalog, gameCard, bindCardClicks, initPlayer, skeletonCards } from "./games.js";
import { renderMedia, stopPlayback } from "./media.js";
import { renderSettings } from "./settings.js";
import { renderShell, stopShell } from "./shell.js";

const SHORTCUTS = [
  ["YouTube", "https://www.youtube.com"],
  ["Discord", "https://discord.com/app"],
  ["Reddit", "https://www.reddit.com"],
  ["Wikipedia", "https://en.wikipedia.org"],
  ["Spotify", "https://open.spotify.com"],
  ["GitHub", "https://github.com"],
];

/** Each render gets a fresh <main> so listeners from old views are dropped. */
function freshView() {
  const old = $("#view");
  const view = old.cloneNode(false);
  old.replaceWith(view);
  return view;
}

async function renderHome(view) {
  view.innerHTML = html`
    <section class="hero">
      <img class="hero-mark" src="/logo.svg" alt="" width="72" height="72" />
      <h1>Eclipse</h1>
      <p class="sub">Browse the web, play games and watch your library, all from one place.</p>
      <form class="omnibox" id="home-search" autocomplete="off">
        <select class="select engine-pill" id="home-engine" aria-label="Proxy engine"></select>
        <input name="q" placeholder="Search the web or type an address" aria-label="Search or address" data-slash />
        <button class="btn" type="submit">Go</button>
      </form>
      <div class="quick">${SHORTCUTS.map(([n, u]) => html`<button class="chip" data-open="${u}">${n}</button>`)}</div>
    </section>
    <div class="tiles">
      <a class="tile" href="#/browse">${icon("globe")}<strong>Browse</strong><span>Open any site through five proxy engines.</span></a>
      <a class="tile" href="#/games">${icon("gamepad")}<strong>Games</strong><span id="tile-games">Hundreds of games from gn-math and Classroom 6x.</span></a>
      <a class="tile" href="#/media">${icon("film")}<strong>Media</strong><span>Movies and shows from your Jellyfin server.</span></a>
    </div>
    <div id="home-recent"></div>
    <div id="home-featured"><h2>Featured games</h2><div class="row">${raw(skeletonCards(8))}</div></div>
  `.toString();

  bindEngineSelect($("#home-engine", view));
  $("#home-search", view).addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q");
    if (q) openInBrowser(q);
  });
  view.addEventListener("click", (e) => {
    const u = e.target.closest("[data-open]")?.dataset.open;
    if (u) openInBrowser(u);
  });

  const cat = await loadCatalog();
  if (!view.isConnected) return;
  $("#tile-games", view).textContent = `${cat.games.length.toLocaleString()} games from gn-math and Classroom 6x.`;
  const recent = store.get("recent", [])
    .map((id) => cat.byId.get(id))
    .filter(Boolean)
    .slice(0, 12);
  if (recent.length) {
    $("#home-recent", view).innerHTML = html`<h2>Jump back in <a href="#/games?source=recent">See all</a></h2><div class="row">${recent.map(gameCard)}</div>`.toString();
  }
  const featured = cat.games.filter((g) => g.featured).slice(0, 18);
  $("#home-featured", view).innerHTML = featured.length
    ? html`<h2>Featured games <a href="#/games">Browse all</a></h2><div class="row">${featured.map(gameCard)}</div>`.toString()
    : "";
  bindCardClicks(view);
}

const TITLES = { home: "Eclipse", browse: "Browse", games: "Games", media: "Media", settings: "Settings", shell: "Shell" };

async function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [pathPart, query = ""] = hash.split("?");
  const path = pathPart.split("/").filter(Boolean);
  const name = path[0] || "home";
  const params = new URLSearchParams(query);

  document.querySelectorAll("[data-route]").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  document.title = name === "home" ? "Eclipse" : `${TITLES[name] || "Eclipse"} · Eclipse`;
  stopPlayback();
  stopShell();

  const isBrowse = name === "browse";
  showBrowser(isBrowse);
  const view = freshView();
  view.classList.toggle("flush", isBrowse);
  if (isBrowse) {
    if (params.get("url")) openInBrowser(params.get("url"));
    else if (!$("#browser-frame iframe")) $("#address").focus();
    return;
  }
  window.scrollTo(0, 0);
  if (name === "games") return renderGames(view, params);
  if (name === "media") return renderMedia(view, path);
  if (name === "settings") return renderSettings(view);
  if (name === "shell") return renderShell(view);
  return renderHome(view);
}

initBrowser();
initPlayer();
window.addEventListener("hashchange", route);
// Warm up the service worker and transport so the first page loads fast.
window.addEventListener("load", () => setTimeout(warmUp, 300));
route();
