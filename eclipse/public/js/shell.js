// Server shell: xterm.js in the browser, SSH on the server (see src/shell.js).
import { $, html, toast, loadScript, loadStyle } from "./util.js";

let active = null; // { ws, term, onResize }

export function stopShell() {
  if (!active) return;
  window.removeEventListener("resize", active.onResize);
  try {
    active.ws.close();
  } catch {}
  active.term?.dispose();
  active = null;
}

export async function renderShell(view) {
  const status = await fetch("/api/shell/status")
    .then((r) => r.json())
    .catch(() => ({ enabled: false }));

  if (!status.enabled) {
    view.innerHTML = html`<div class="panel" style="max-width:520px">
      <img class="mark" src="/logo.svg" alt="" />
      <h1>Server shell is off</h1>
      <p class="muted">Set <code>SHELL_ENABLED=true</code> in <code>/etc/eclipse.env</code> and run <code>systemctl restart eclipse</code> to turn it on.</p>
    </div>`.toString();
    return;
  }

  view.innerHTML = html`
    <form class="panel" id="shell-login" autocomplete="off">
      <img class="mark" src="/logo.svg" alt="" />
      <h1>Server shell</h1>
      <p class="sub">Signs in to this server as <code>${status.user}</code>. Use that account's password.</p>
      <div class="field">
        <label for="shell-pass">Password for ${status.user}</label>
        <input class="input" id="shell-pass" type="password" autocomplete="current-password" required />
      </div>
      <div class="notice err" id="shell-err" hidden></div>
      <button class="btn" type="submit">Connect</button>
    </form>`.toString();
  $("#shell-pass", view).focus();

  $("#shell-login", view).addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("#shell-login button", view);
    const err = $("#shell-err", view);
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = "Connecting…";
    try {
      loadStyle("/vendor/xterm/css/xterm.css");
      await loadScript("/vendor/xterm/lib/xterm.js");
      await loadScript("/vendor/xterm-fit/addon-fit.js");
      await connect(view, $("#shell-pass", view).value, status.user, (msg) => {
        err.textContent = msg;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = "Connect";
      });
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = "Connect";
    }
  });
}

function connect(view, password, user, onDenied) {
  return new Promise((resolve) => {
    const ws = new WebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/shell/ws");
    ws.binaryType = "arraybuffer";
    let term = null;
    let fit = null;
    let opened = false;

    ws.onopen = () => ws.send(JSON.stringify({ t: "auth", password, cols: 120, rows: 32 }));
    ws.onerror = () => {
      if (!opened) onDenied("Couldn't reach the shell service.");
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        term?.write(new Uint8Array(ev.data));
        return;
      }
      const msg = JSON.parse(ev.data);
      if (msg.t === "denied") {
        onDenied(msg.msg);
        ws.close();
        resolve();
      } else if (msg.t === "ready") {
        opened = true;
        ({ term, fit } = mountTerminal(view, ws, user));
        active = { ws, term, onResize: () => fitAndReport(term, fit, ws) };
        window.addEventListener("resize", active.onResize);
        resolve();
      } else if (msg.t === "exit") {
        ended(view, msg.msg);
      }
    };
    ws.onclose = () => {
      if (opened) ended(view, "Disconnected.");
    };
  });
}

function fitAndReport(term, fit, ws) {
  try {
    fit.fit();
  } catch {}
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "resize", cols: term.cols, rows: term.rows }));
}

function mountTerminal(view, ws, user) {
  view.innerHTML = html`
    <section class="shell">
      <div class="shell-bar">
        <span class="dot" id="shell-dot"></span>
        <span>${user}@${location.hostname}</span>
        <span class="spacer"></span>
        <button class="btn quiet" id="shell-close">Disconnect</button>
      </div>
      <div class="shell-term" id="shell-term"></div>
    </section>`.toString();
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.15,
    scrollback: 5000,
    theme: {
      background: "#0b0b0e",
      foreground: "#ececf1",
      cursor: "#ffb454",
      cursorAccent: "#0b0b0e",
      selectionBackground: "rgba(255, 180, 84, 0.3)",
      black: "#1b1b21", red: "#f08a7e", green: "#7fd1a0", yellow: "#ffb454",
      blue: "#7aa7ff", magenta: "#d59cff", cyan: "#6fd3d8", white: "#c4c4cd",
      brightBlack: "#5a5a66", brightRed: "#ffaa9f", brightGreen: "#a3e6bd", brightYellow: "#ffd08a",
      brightBlue: "#a3c2ff", brightMagenta: "#e6bfff", brightCyan: "#9be6ea", brightWhite: "#ffffff",
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open($("#shell-term", view));
  term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "in", d })));
  requestAnimationFrame(() => fitAndReport(term, fit, ws));
  term.focus();
  $("#shell-close", view).addEventListener("click", () => {
    ws.close();
    toast("Shell disconnected.");
  });
  return { term, fit };
}

function ended(view, msg) {
  const dot = $("#shell-dot", view);
  if (!dot || view.querySelector(".shell-ended")) return;
  dot.classList.add("off");
  const box = document.createElement("div");
  box.className = "shell-ended";
  box.innerHTML = `<span></span><button class="btn">Reconnect</button>`;
  box.querySelector("span").textContent = msg;
  box.querySelector("button").addEventListener("click", () => {
    stopShell();
    renderShell(view);
  });
  view.querySelector(".shell").append(box);
}
