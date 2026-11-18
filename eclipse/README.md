# Eclipse

<img src="public/icon.svg" width="72" alt="" align="right" />

One site for browsing, games and media:

- **Browse**: five proxy engines, picked per browser in Settings. **Scramjet** is the default; **Ultraviolet**, **Rammerhead**, **Corrosion** and **Womginx** are the alternatives.
- **Games**: the gn-math catalog (about 850 games) plus a Classroom 6x catalog. Includes search, filters, favorites and recently played.
- **Media**: a Jellyfin client with libraries, continue watching, next up, series and seasons, search, and HLS playback with progress sync.
- **Server shell**: a hidden browser terminal on the VPS, reached by triple-clicking the invisible top-right corner of the page (route `/#/x`), signed in with the root password. sshd checks the password; Eclipse never stores it.

First-party UI text and several API responses are served lightly obfuscated (`src/obf.js`) so network content filters can't classify the site by its visible text; the browser decodes them at runtime. This is obfuscation, not encryption, and does not hide the proxy data-path routes. See `prompt.md`.

## Hosting it

**`prompt.md` is the full setup brief**, written for an AI agent with SSH access to the server. It covers install, verification, the shell's sshd requirements, building the Classroom 6x scraper, troubleshooting and security.

The short version, from your own computer in this folder:

```sh
./deploy/deploy.sh root@82.29.71.45
```

This installs Node 22, Caddy (automatic HTTPS on `82-29-71-45.sslip.io`), the `eclipse` service, and Womginx on `wg.82-29-71-45.sslip.io`. HTTPS is required, because Scramjet and Ultraviolet run in a service worker. To use your own domain, point `domain` and `wg.domain` at the server and pass `DOMAIN=yourdomain.com`.

## Settings

Settings live in `/etc/eclipse.env`. After changing them, run `systemctl restart eclipse`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JELLYFIN_URL` | `stub` | Jellyfin server, e.g. `http://192.168.1.20:8096`. |
| `CLASSROOM6X_URL` | `https://classroom6x.com/` | Site the Classroom 6x catalog is scraped from. |
| `SHELL_ENABLED` | `true` (set by the installer) | Turns the server shell on or off. |
| `SHELL_USER` | `root` | Account the shell signs in as, through `127.0.0.1:22`. |
| `WOMGINX_URL` | `https://wg.<domain>` | Public URL of the Womginx engine. Leave it empty to turn Womginx off. |
| `ENGINE_RAMMERHEAD`, `ENGINE_CORROSION` | on | Set to `false` to turn either engine off. |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | Where Node listens. Caddy proxies to it. |
| `WISP_DNS` | `1.1.1.1,1.0.0.1` | DNS servers for Scramjet and Ultraviolet traffic. |

## How it's put together

- `src/server.js`: Express app, the Wisp socket, and request routing for the engines and the shell.
- `src/engines.js`: Rammerhead and Corrosion running in-process, plus engine status.
- `src/netguard.js`: stops the server-side engines from reaching loopback or private addresses.
- `src/shell.js`: WebSocket-to-SSH bridge with origin checks, rate limits and idle timeout.
- `src/games-gn.js`, `src/games-c6x.js`: game catalog adapters, with a disk cache in `data/cache`.
- `src/jellyfin.js`: same-origin reverse proxy to `JELLYFIN_URL`.
- `public/`: the frontend (no build step) and a single service worker for Scramjet and Ultraviolet.
- `deploy/`: the installer, systemd units, and Womginx setup on a private nginx instance.

Games the Classroom 6x scraper misses can be added to `data/c6x-extra.json`:

```json
[{ "name": "Retro Bowl", "url": "https://classroom6x.com/retro-bowl", "cover": "https://..." }]
```

## Run locally

```sh
npm install
SHELL_ENABLED=true npm start    # http://localhost:8080
```

Browsers allow service workers on `localhost` without HTTPS. Womginx needs nginx and isn't available locally unless `WOMGINX_URL` points at a running instance.
