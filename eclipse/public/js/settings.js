import { $, html, esc, store, toast, dec } from "./util.js";
import { ENGINES, DEFAULT_ENGINE, engineStatus, currentEngine, setEngine, resetRh } from "./proxy.js";

export const SEARCH_ENGINES = [
  ["DuckDuckGo", "https://duckduckgo.com/?q=%s"],
  ["Google", "https://www.google.com/search?q=%s"],
  ["Bing", "https://www.bing.com/search?q=%s"],
  ["Brave Search", "https://search.brave.com/search?q=%s"],
];

export async function renderSettings(view) {
  const st = await engineStatus();
  const search = store.get("search", SEARCH_ENGINES[0][1]);

  const engineRow = ([id, e]) => {
    const s = st[id] || { ok: false };
    const on = currentEngine() === id;
    return html`<label class="option${on ? " on" : ""}${s.ok ? "" : " off"}">
      <input type="radio" name="engine" value="${id}" ${on ? "checked" : ""} ${s.ok ? "" : "disabled"} />
      <div><strong>${e.name}</strong><span>${s.ok ? e.desc : `Turned off on this server. ${s.reason || ""}`}</span></div>
      ${id === DEFAULT_ENGINE ? html`<span class="tag accent">Default</span>` : s.ok ? "" : html`<span class="tag bad">Off</span>`}
    </label>`;
  };

  view.innerHTML = html`
    <div class="settings">
      <div class="page-head"><div><h1>Settings</h1><p class="sub">Saved in this browser only.</p></div></div>

      <section class="section">
        <h2>${dec("awN5NVNIXh9xJEQN")}</h2>
        <p class="sub">${dec("bgJzKQoOVAM2D1gHTAJzbUsGX1FwIlhIeB13PlkaVB57bRwQGxZ3IE8bFVFfKwoJGwJ/OU9IWQNzLEEbF1FiP1NIWh95OUINSVFzI00BVRQ4")}</p>
        <div class="options" id="engines">${Object.entries(ENGINES).map(engineRow)}</div>
      </section>

      <section class="section">
        <h2>Search engine</h2>
        <p class="sub">Used when you type something that isn't a web address.</p>
        <select class="select" id="search-engine" style="min-width:240px">
          ${SEARCH_ENGINES.map(([n, u]) => html`<option value="${u}" ${u === search ? "selected" : ""}>${n}</option>`)}
        </select>
      </section>

      <section class="section">
        <h2>Your data</h2>
        <p class="sub">${dec("fRBgIlgBTxRlYQoAUgJiIlgRGxB4KQocUxQ2PkseXhU2Pk8bSBh5IwobTxBvbUMGGwV+JFlIWQN5OlkNSV8=")}</p>
        <div class="inline">
          <button class="btn ghost" data-clear="recent">Clear recently played</button>
          <button class="btn ghost" data-clear="favs">Clear favorites</button>
          <button class="btn ghost" data-clear="rh">${dec("aRRlKF5ISBBgKE5ISBRlPkMHVQ==")}</button>
        </div>
      </section>

    </div>`.toString();

  $("#engines", view).addEventListener("change", (e) => {
    if (e.target.name !== "engine") return;
    setEngine(e.target.value);
    view.querySelectorAll(".option").forEach((o) => o.classList.toggle("on", o.querySelector("input").checked));
    toast(`${ENGINES[e.target.value].name}${dec("GxhlbUQHTFFvIl8aGxR4KkMGXl8=")}`);
  });
  $("#search-engine", view).addEventListener("change", (e) => {
    store.set("search", e.target.value);
    toast("Search engine saved.");
  });
  view.addEventListener("click", (e) => {
    const what = e.target.closest("[data-clear]")?.dataset.clear;
    if (!what) return;
    if (what === "rh") resetRh();
    else store.del(what);
    toast({ recent: "History cleared.", favs: "Favorites cleared.", rh: dec("aBBgKE5ISBRlPkMHVVFkKFkNT18=") }[what]);
  });
}

export { esc };
