# henws hub

One site with three things:

- **Browse**: a web proxy built on [Scramjet](https://github.com/MercuryWorkshop/scramjet) (Wisp server + epoxy transport via bare-mux).
- **Games**: the [gn-math](https://github.com/gn-math) catalog (about 850 games) plus a Classroom 6x catalog, with search, filters, favorites and recently played.
- **Media**: a Jellyfin client (libraries, continue watching, next up, series and seasons, search, HLS playback with progress sync).

## Deploy to a server

From your own computer, in this folder:

```sh
./deploy/deploy.sh root@82.29.71.45
```

This uploads the project and runs `deploy/install.sh` on the server. The installer:

1. installs Node.js 22 and Caddy,
2. copies the app to `/opt/henws-hub` and runs it as the `henws` systemd service,
3. puts Caddy in front with automatic HTTPS on `82-29-71-45.sslip.io`.

HTTPS is required because the proxy runs in a service worker. To use your own domain, point its DNS A record at the server and run `DOMAIN=hub.example.com ./deploy/deploy.sh root@82.29.71.45`.

If the code is already on the server, run `sudo bash deploy/install.sh` there instead.

## Settings

Settings live in `/etc/henws-hub.env`. After changing them, run `systemctl restart henws-hub`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JELLYFIN_URL` | `stub` | Jellyfin server, e.g. `http://192.168.1.20:8096`. While it's `stub`, the Media tab shows a "not configured" notice. |
| `CLASSROOM6X_URL` | `https://classroom6x.com/` | Site whose sitemap the Classroom 6x catalog is built from. |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | Where Node listens (Caddy proxies to it). |
| `WISP_DNS` | `1.1.1.1,1.0.0.1` | DNS servers used by the proxy backend. |

The browser never talks to Jellyfin directly. Requests go through `/jf/*`, which forwards only to `JELLYFIN_URL`, so Jellyfin can stay on a private network.

## How the game catalogs work

- **gn-math**: `zones.json`, covers and game HTML are fetched from gn-math's GitHub repos (jsDelivr first, then raw.githubusercontent.com). They're cached on disk in `data/cache` and served from this site, so games load same-origin.
- **Classroom 6x**: it has no public catalog, so the server reads the site's sitemap every 6 hours. It keeps the game-page URLs and reads cover images and embedded game URLs from each page as they're needed. Classroom 6x games play through Scramjet. If a game is missing or named oddly, add it to `data/c6x-extra.json`:

  ```json
  [{ "name": "Retro Bowl", "url": "https://classroom6x.com/retro-bowl", "cover": "https://..." }]
  ```

## Run locally

```sh
npm install
JELLYFIN_URL=http://localhost:8096 npm start   # http://localhost:8080
```

Service workers are allowed on `localhost` without HTTPS.
