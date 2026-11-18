// Browser shell for the server. The page opens a WebSocket to /shell/ws and
// sends the password; this module logs in to the machine's own sshd
// (127.0.0.1:22 by default) with it and bridges the PTY to the browser.
//
// The password is checked by sshd, never stored here, so changing the root
// password with `passwd` changes the shell login too.
//
// Settings (in /etc/eclipse.env):
//   SHELL_ENABLED=true      turn the shell on (off unless set)
//   SHELL_USER=root         account to log in as
//   SHELL_SSH_HOST=127.0.0.1
//   SHELL_SSH_PORT=22
//   SHELL_IDLE_MINUTES=30
import { WebSocketServer } from "ws";
import { Client } from "ssh2";

const ENABLED = /^(1|true|yes|on)$/i.test(process.env.SHELL_ENABLED || "");
const USER = process.env.SHELL_USER || "root";
const HOST = process.env.SHELL_SSH_HOST || "127.0.0.1";
const PORT = Number(process.env.SHELL_SSH_PORT || 22);
const IDLE_MS = Number(process.env.SHELL_IDLE_MINUTES || 30) * 60_000;

// Brute-force protection: per IP, and a global ceiling for distributed attempts.
const WINDOW_MS = 15 * 60_000;
const MAX_PER_IP = 5;
const MAX_GLOBAL = 30;
const MAX_SESSIONS_PER_IP = 3;
const failures = new Map(); // ip -> [timestamps]
let globalFailures = [];
const openSessions = new Map(); // ip -> count

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

function clientIp(req) {
  const remote = req.socket.remoteAddress || "";
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return /^(::ffff:)?127\.|^::1$/.test(remote) && fwd ? fwd : remote;
}

function recent(list) {
  const cutoff = Date.now() - WINDOW_MS;
  return list.filter((t) => t > cutoff);
}

function lockedOut(ip) {
  globalFailures = recent(globalFailures);
  const mine = recent(failures.get(ip) || []);
  failures.set(ip, mine);
  if (mine.length >= MAX_PER_IP) return "Too many failed attempts from your address. Try again in 15 minutes.";
  if (globalFailures.length >= MAX_GLOBAL) return "The shell is temporarily locked after repeated failed logins. Try again later.";
  return null;
}

function recordFailure(ip) {
  const now = Date.now();
  failures.set(ip, [...recent(failures.get(ip) || []), now]);
  globalFailures.push(now);
  console.warn(`[shell] failed login for ${USER} from ${ip}`);
}

export function shellStatus() {
  return { enabled: ENABLED, user: USER };
}

const sameOrigin = (req) => {
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
};

export function handleShellUpgrade(req, socket, head) {
  if (!ENABLED || !sameOrigin(req)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => session(ws, clientIp(req)));
}

function session(ws, ip) {
  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  let conn = null;
  let stream = null;
  let authed = false;
  let idleTimer;

  const close = (msg) => {
    if (msg) send({ t: "exit", msg });
    clearTimeout(idleTimer);
    try {
      stream?.end();
      conn?.end();
    } catch {}
    if (ws.readyState === ws.OPEN) ws.close();
  };
  const bumpIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => close("Closed after being idle."), IDLE_MS);
  };
  const authTimer = setTimeout(() => !authed && close("Login timed out."), 60_000);

  ws.on("close", () => {
    clearTimeout(authTimer);
    clearTimeout(idleTimer);
    if (authed) openSessions.set(ip, Math.max(0, (openSessions.get(ip) || 1) - 1));
    try {
      stream?.end();
      conn?.end();
    } catch {}
  });

  ws.on("message", (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === "auth" && !conn) {
      const lock = lockedOut(ip);
      if (lock) return send({ t: "denied", msg: lock });
      if ((openSessions.get(ip) || 0) >= MAX_SESSIONS_PER_IP) return send({ t: "denied", msg: "Too many open shells from your address." });
      const password = String(msg.password || "");
      const cols = Math.min(Math.max(Number(msg.cols) || 80, 20), 500);
      const rows = Math.min(Math.max(Number(msg.rows) || 24, 5), 200);
      conn = new Client();
      conn.on("ready", () => {
        authed = true;
        clearTimeout(authTimer);
        openSessions.set(ip, (openSessions.get(ip) || 0) + 1);
        console.log(`[shell] ${USER} logged in from ${ip}`);
        conn.shell({ term: "xterm-256color", cols, rows }, (err, s) => {
          if (err) return close(`Couldn't open a shell: ${err.message}`);
          stream = s;
          send({ t: "ready", user: USER });
          bumpIdle();
          s.on("data", (d) => ws.readyState === ws.OPEN && ws.send(d, { binary: true }));
          s.stderr.on("data", (d) => ws.readyState === ws.OPEN && ws.send(d, { binary: true }));
          s.on("close", () => close("Session ended."));
        });
      });
      conn.on("keyboard-interactive", (_n, _i, _l, prompts, finish) => finish(prompts.map(() => password)));
      conn.on("error", (err) => {
        if (authed) return close(`Connection lost: ${err.message}`);
        const badPassword = err.level === "client-authentication";
        if (badPassword) recordFailure(ip);
        send({
          t: "denied",
          msg: badPassword
            ? "Wrong password."
            : `Couldn't reach the SSH server on ${HOST}:${PORT} (${err.code || err.message}).`,
        });
        conn = null;
      });
      conn.connect({
        host: HOST,
        port: PORT,
        username: USER,
        password,
        tryKeyboard: true,
        readyTimeout: 15_000,
        keepaliveInterval: 20_000,
      });
      return;
    }

    if (!stream) return;
    if (msg.t === "in" && typeof msg.d === "string") {
      bumpIdle();
      stream.write(msg.d);
    } else if (msg.t === "resize") {
      const cols = Math.min(Math.max(Number(msg.cols) || 80, 20), 500);
      const rows = Math.min(Math.max(Number(msg.rows) || 24, 5), 200);
      stream.setWindow(rows, cols, 0, 0);
    }
  });
}
