import { $, html, store } from "./util.js";
import { initBrowser, showBrowser, openInBrowser, ensureProxy } from "./proxy.js";
import { renderGames, loadCatalog, gameCard, bindCardClicks, initPlayer } from "./games.js";
import { renderMedia, stopPlayback } from "./media.js";

const ENGINES = [
  ["DuckDuckGo", "https://duckduckgo.com/?q=%s"],
  ["Google", "https://www.google.com/search?q=%s"],
  ["Bing", "https://www.bing.com/search?q=%s"],
  ["Brave", "https://search.brave.com/search?q=%s"],
];
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
  const engine = store.get("engine", ENGINES[0][1]);
  view.innerHTML = html`
    <section class="hero">
      <h1>henws hub</h1>
      <p class="sub" style="margin:0">Browse the web, play games and watch your media library, all from one place.</p>
      <form class="search-big" id="home-search" autocomplete="off">
        <input class="input" name="q" placeholder="Search the web or type a URL" aria-label="Search or URL" autofocus />
        <button class="btn" type="submit">Go</button>
      </form>
      <div class="quick">
        ${SHORTCUTS.map(([n, u]) => html`<button class="chip" data-open="${u}">${n}</button>`)}
      </div>
      <div class="quick" style="margin-top:10px">
        <label class="muted" for="engine" style="font-size:13px;align-self:center">Search with</label>
        <select class="select" id="engine" style="height:32px">
          ${ENGINES.map(([n, u]) => html`<option value="${u}" ${u === engine ? "selected" : ""}>${n}</option>`)}
        </select>
      </div>
    </section>
    <div class="tiles">
      <a class="tile" href="#/browse"><strong>Browse</strong><span>Open any site through the Scramjet proxy.</span></a>
      <a class="tile" href="#/games"><strong>Games</strong><span id="tile-games">gn-math and Classroom 6x catalogs.</span></a>
      <a class="tile" href="#/media"><strong>Media</strong><span>Your Jellyfin movies and shows.</span></a>
    </div>
    <div id="home-recent"></div>
    <div id="home-featured"></div>
  `.toString();

  view.querySelector("#home-search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get("q");
    if (q) openInBrowser(q);
  });
  view.addEventListener("click", (e) => {
    const u = e.target.closest("[data-open]")?.dataset.open;
    if (u) openInBrowser(u);
  });
  view.querySelector("#engine").addEventListener("change", (e) => store.set("engine", e.target.value));

  const cat = await loadCatalog();
  if (!view.isConnected) return;
  $("#tile-games", view).textContent = `${cat.games.length.toLocaleString()} games from gn-math and Classroom 6x.`;
  const recent = store.get("recent", []).map((id) => cat.byId.get(id)).filter(Boolean).slice(0, 12);
  if (recent.length) {
    $("#home-recent", view).innerHTML = html`<h2>Jump back in</h2><div class="row">${recent.map(gameCard)}</div>`.toString();
  }
  const featured = cat.games.filter((g) => g.featured).slice(0, 18);
  if (featured.length) {
    $("#home-featured", view).innerHTML = html`<h2>Featured games</h2><div class="row">${featured.map(gameCard)}</div>`.toString();
  }
  bindCardClicks(view);
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [pathPart, query = ""] = hash.split("?");
  const path = pathPart.split("/").filter(Boolean);
  const name = path[0] || "home";
  const params = new URLSearchParams(query);

  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  stopPlayback();

  const isBrowse = name === "browse";
  showBrowser(isBrowse);
  const view = freshView();
  view.classList.toggle("flush", isBrowse);
  if (isBrowse) {
    if (params.get("url")) openInBrowser(params.get("url"));
    return;
  }
  window.scrollTo(0, 0);
  if (name === "games") return renderGames(view, params);
  if (name === "media") return renderMedia(view, path);
  return renderHome(view);
}

initBrowser();
initPlayer();
window.addEventListener("hashchange", route);
// Warm up the proxy (service worker + transport) so the first page loads fast.
window.addEventListener("load", () => ensureProxy().catch(() => {}));
route();
