# Eclipse: hosting setup brief

You are an AI agent with SSH access to a Debian VPS. Your job is to get **Eclipse** fully running there over HTTPS, verify every part of it, build the Classroom 6x catalog scraper, and report back. Everything you need is in this file and in the `eclipse/` folder of the repository.

The person who owns the server ("the owner") is your user. Do what this brief asks. For anything it doesn't cover that is hard to undo, ask the owner first.

---

## 0. Ground rules

- **Credentials.** The owner gives you the SSH login directly. Never write a password or token into a file, commit, script, log, or this repository. If you use `sshpass`, pass the password through the `SSHPASS` environment variable with `sshpass -e`, never with `-p`. Prefer installing an SSH key for yourself if the owner agrees.
- **Don't lock anyone out.** Before changing anything in `/etc/ssh/`, open a second SSH session and keep it open until you've confirmed a fresh login still works. Never enable a firewall without allowing port 22 first.
- **Ask the owner before you:** change sshd settings, change the root password, delete data that isn't Eclipse's, stop services that aren't Eclipse's (for example Apache on port 80), or open ports other than 80 and 443.
- **Keep internal ports private.** Node listens on `127.0.0.1:8080` and Womginx on `127.0.0.1:8090`. Only Caddy faces the internet, on ports 80 and 443.
- **Never disable TLS verification** to make a test pass.
- **Make changes in the repository, not only on the server.** `/opt/eclipse` is overwritten on every deploy, so a fix made only there is lost on the next one.

## 1. Target

| | |
|---|---|
| Host | `82.29.71.45`, SSH port 22, user `root` |
| OS | Debian. Confirm with `cat /etc/os-release`. |
| Repository | `github.com/aahspaghetticode/redesigned-octo-fishstick`, branch `claude/henws-hub-website-890ej6`, folder `eclipse/` |
| Default public URL | `https://82-29-71-45.sslip.io` (sslip.io resolves to the IP in the name, so Let's Encrypt works with no DNS setup) |
| Womginx URL | `https://wg.82-29-71-45.sslip.io` |

First, take stock. Run `nproc; free -h; df -h /; ss -ltnp`. Eclipse needs about 1 GB of RAM, and building Womginx's client needs more. If the server has under 2 GB of RAM and no swap, add a 2 GB swapfile before installing. Note anything already listening on ports 80 or 443.

## 2. What Eclipse is

One Node.js app (Express) behind Caddy:

| Part | Where it runs | Paths |
|---|---|---|
| Site (home, games, media, settings, shell UI) | Node, `public/` | `/` |
| **Scramjet** proxy, the default engine | browser service worker + Wisp | `/scramjet/`, `/scram/`, `/wisp/` |
| **Ultraviolet** proxy | same service worker + Wisp | `/uv/` |
| **Rammerhead** proxy | inside Node (`@rubynetwork/rammerhead`) | `/newsession`, `/<32-char session id>/<url>`, `/rammerhead.js`, … |
| **Corrosion** proxy | inside Node | `/corrosion/` |
| **Womginx** proxy | separate nginx instance on `127.0.0.1:8090`, its own subdomain | `https://wg.<domain>/main/<url>` |
| gn-math games | Node mirrors and caches gn-math's GitHub repos | `/api/games/gn` |
| Classroom 6x games | Node scraper (section 6) | `/api/games/c6x` |
| Jellyfin client | Node reverse-proxies to `JELLYFIN_URL` | `/jf/*` |
| Server shell | Node logs in to `127.0.0.1:22` over SSH | `/#/shell`, WebSocket `/shell/ws` |

Files on the server:

- `/opt/eclipse`: the app
- `/etc/eclipse.env`: settings
- `/etc/systemd/system/eclipse.service`
- `/opt/womginx`, plus `/etc/systemd/system/eclipse-womginx.service`
- `/etc/caddy/Caddyfile`

Rammerhead and Corrosion fetch pages from the server, so Eclipse checks every destination in `src/netguard.js`. Anything on loopback, private or link-local addresses gets a 403. Wisp has the same rule built in, and Womginx's nginx config gets a matching rule from `deploy/womginx/setup.sh`. Keep these protections in place.

## 3. Install

Pick one way to get the code onto the server.

**A. From a machine that has the repository** (the simplest):

```sh
cd eclipse
./deploy/deploy.sh root@82.29.71.45
```

**B. On the server.** The repository may be private. If it is, ask the owner for a short-lived, read-only token, use it once and don't store it.

```sh
git clone --depth 1 --branch claude/henws-hub-website-890ej6 https://github.com/aahspaghetticode/redesigned-octo-fishstick /root/eclipse-src
cd /root/eclipse-src/eclipse && bash deploy/install.sh
```

`deploy/install.sh` is safe to run again. It does this:

1. Installs base packages, Node.js 22 (NodeSource) and Caddy (official apt repository).
2. Removes an older "henws-hub" install if one exists, keeping its settings.
3. Copies the app to `/opt/eclipse`, runs `npm ci --omit=dev`, and runs it as the system user `eclipse`.
4. **Womginx:** installs nginx without starting the stock service (Caddy owns ports 80 and 443), clones Womginx, builds wombat at the commit upstream pins (`78813ad`), and writes `/opt/womginx/nginx.eclipse.conf`. It only does this if `wg.<domain>` resolves to this server. If the build fails, the installer warns and carries on without Womginx.
5. Writes any missing keys to `/etc/eclipse.env`, with `SHELL_ENABLED=true` and `WOMGINX_URL` set.
6. Starts `eclipse`, then writes the Caddyfile for `<domain>` and `wg.<domain>`.
7. Checks whether sshd will accept the web shell's login, and warns if it won't (section 5).

Options, set as environment variables:

- `DOMAIN=hub.example.com`: use the owner's domain. Its A record must point at the server first, and so must `wg.hub.example.com` if Womginx is wanted.
- `WOMGINX=0`: skip Womginx.
- `WOMGINX_DOMAIN=...`: use a different hostname for Womginx.

The VPS provider may have its own firewall in front of the server. If Caddy can't get a certificate, check that ports 80 and 443 are open there too.

## 4. Verify everything

Run these on the server. Set `D=82-29-71-45.sslip.io`, or the owner's domain. Every item should pass. If one doesn't, fix it or report it.

```sh
D=82-29-71-45.sslip.io

# services
systemctl is-active eclipse caddy eclipse-womginx
journalctl -u eclipse -n 30 --no-pager      # expect "Eclipse listening ... [scramjet:on ultraviolet:on rammerhead:on corrosion:on womginx:on] shell:on"

# HTTPS with a real certificate (no -k)
curl -fsS https://$D/api/health                          # {"ok":true}
curl -fsS https://$D/api/engines                         # every engine "ok":true
curl -fsS https://$D/api/games/gn | head -c 200          # count over 800
curl -fsS https://$D/api/shell/status                    # {"enabled":true,"user":"root"}

# Wisp WebSocket (Scramjet + Ultraviolet need this): expect "101"
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" https://$D/wisp/

# Rammerhead: public site 200, private address 403
ID=$(curl -fsS https://$D/newsession); curl -fsS "https://$D/editsession?id=$ID&enableShuffling=0"; echo
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/$ID/https://example.com/"
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/$ID/http://127.0.0.1:8080/api/health"

# Corrosion: public 200, private 403
x() { node -e 'const s=process.argv[1];console.log(encodeURIComponent([...s].map((c,i)=>i%2?String.fromCharCode(c.charCodeAt(0)^2):c).join("")))' "$1"; }
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/corrosion/$(x https://example.com/)"
curl -s -o /dev/null -w '%{http_code}\n' "https://$D/corrosion/$(x http://127.0.0.1:8080/)"

# Womginx: public 200, private 403
curl -s -o /dev/null -w '%{http_code}\n' -b 'womginx_are_you_a_bot=no' "https://wg.$D/main/https://example.com/"
curl -s -o /dev/null -w '%{http_code}\n' -b 'womginx_are_you_a_bot=no' "https://wg.$D/main/http://127.0.0.1:8080/"
```

**Check in a real browser if you can.** If you have a browser tool, open `https://$D`. Then go to **Settings → Proxy engine**, select each engine in turn, and in **Browse** load `https://example.com` and `https://en.wikipedia.org`. Every engine should render the page, and the address bar should show the real URL. Also open **Games**, check that covers load, and play one gn-math game. If you have no browser tool, say so in your report instead of claiming this passed.

**Shell login test.** It uses the root password and counts toward the lockout of 5 failures in 15 minutes, so type carefully. The password is read without echoing and never touches disk:

```sh
read -rs ECLIPSE_PW && export ECLIPSE_PW
cd /opt/eclipse && D=$D node --input-type=module -e '
import WebSocket from "ws";
const ws = new WebSocket(`wss://${process.env.D}/shell/ws`, { headers: { Origin: `https://${process.env.D}` } });
ws.on("open", () => ws.send(JSON.stringify({ t: "auth", password: process.env.ECLIPSE_PW, cols: 100, rows: 30 })));
ws.on("message", (d, bin) => bin ? process.stdout.write(d) : console.log("[ctl]", d.toString()));
setTimeout(() => ws.send(JSON.stringify({ t: "in", d: "echo ECLIPSE_SHELL_OK; exit\r" })), 2000);
setTimeout(() => process.exit(0), 5000);'
unset ECLIPSE_PW
```

Expect `[ctl] {"t":"ready",...}` and then `ECLIPSE_SHELL_OK` in the output.

## 5. Server shell

The shell at `https://<domain>/#/shell` (linked from Settings) is a browser terminal. When someone connects, Node opens an SSH session to `127.0.0.1:22` as `SHELL_USER` (default `root`) with the password they typed. **sshd checks the password; Eclipse never stores it.** So changing the password with `passwd` changes the shell login too.

Protections already in `src/shell.js`:

- WebSocket connections from another origin are refused.
- 5 failed logins per IP in 15 minutes locks that IP out, and 30 failures in total locks the shell for everyone.
- At most 3 open shells per IP.
- Idle sessions close after 30 minutes (`SHELL_IDLE_MINUTES`).
- Each attempt is logged: `journalctl -u eclipse | grep '\[shell\]'`

**sshd must accept a password for root from 127.0.0.1.** Check it:

```sh
sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication)'
```

You need `permitrootlogin yes`, plus `passwordauthentication yes` or `kbdinteractiveauthentication yes`. The owner logs in as root with a password today, so this probably already passes. If it doesn't, **ask the owner**, and then add this, which only affects connections from the server itself:

```sh
cat > /etc/ssh/sshd_config.d/10-eclipse-shell.conf <<'CONF'
Match Address 127.0.0.1,::1
    PermitRootLogin yes
    PasswordAuthentication yes
CONF
sshd -t && systemctl reload ssh
```

Optional hardening to suggest to the owner, and do only with their go-ahead:

- Once the owner has an SSH key installed, set `PermitRootLogin prohibit-password` globally. Keep the `Match Address 127.0.0.1` block above so the web shell still works.
- Add a fail2ban jail for the web shell. The filter regex is `\[shell\] failed login for \S+ from <HOST>$`, with `journalmatch = _SYSTEMD_UNIT=eclipse.service`. Caddy passes the real client IP, so `<HOST>` is the attacker's address.

To turn the shell off: set `SHELL_ENABLED=false` in `/etc/eclipse.env`, then run `systemctl restart eclipse`.

## 6. Task: build the Classroom 6x scraper

The person who built Eclipse couldn't reach classroom6x.com, so `src/games-c6x.js` is an untested first draft. It reads the site's sitemap, guesses game names from URL slugs, and reads `og:image` and the first `<iframe>` from each game page. **Your job is to make it return the real Classroom 6x catalog**, working from the actual site as seen from the VPS.

### The contract (don't change it; the frontend depends on it)

- `GET /api/games/c6x` returns:

  ```json
  { "source": "classroom-6x", "count": 123,
    "games": [{ "id": "c6x-<stable id>", "name": "Retro Bowl", "source": "classroom-6x", "tags": [],
                "cover": "<image URL, or /api/games/c6x/cover?u=<page>>",
                "play": { "type": "proxy", "url": "<page or embed URL>", "resolve": "/api/games/c6x/resolve?u=<page>" } }] }
  ```

  On failure it returns HTTP 502 with `{ "error": "...", "games": [] }`. The Games page shows that error and keeps working.
- `GET /api/games/c6x/resolve?u=<page URL>` returns `{ "url": "<best URL to play>", "page": "<page URL>" }`. The player loads `url` through the user's chosen proxy engine.
- `GET /api/games/c6x/cover?u=<page URL>` returns image bytes, or 404.
- Keep the `cached()` helper from `src/cache.js`: catalog for 6 hours, page info for 24 hours, images for 30 days.
- Keep the `sameSite()` check. The server may only fetch the Classroom 6x host, plus image or embed hosts you **explicitly** allowlist in a constant after seeing them. Never fetch arbitrary user-supplied hosts.
- Ids come from the page slug (`c6x-retro-bowl`) so favorites survive catalog changes. Keep it that way.

### How to investigate (run from the VPS)

1. **Find the real site.** Run `curl -sIL https://classroom6x.com/ | grep -iE '^(HTTP|location)'`. Classroom 6x has moved between domains and has had a Google Sites version (`sites.google.com/view/classroom6x`). Many copycat sites use the name too. If it's unclear which one is the real site, show the owner the candidates and let them choose. Put the result in `CLASSROOM6X_URL`.
2. **Find the cheapest complete list of games**, checking sources in this order:
   - A JSON API. For a WordPress site, try `/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,link,title,featured_media,categories`, plus `/wp-json/wp/v2/media/<id>` for covers or `?_embed`. For other CMSs, look for any `*.json` the homepage fetches (check the HTML's `<script>` tags).
   - Sitemaps: `robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`, `/post-sitemap.xml`, `/game-sitemap.xml`. Check which ones contain only games.
   - HTML listing pages: the homepage, `/games`, category pages and pagination. Find the repeated card element (usually a link wrapping an `<img>` and a title) and collect name, link and image from each.
3. **Open 3 to 5 game pages** and work out where the playable game lives:
   - an `<iframe src>` or `data-src`
   - a "Play" button that opens a URL (`href`, `onclick`, `data-url`)
   - a URL inside an inline `<script>`
   - a Google Sites embed (`*.googleusercontent.com` "embeds" iframe, where the real game URL is often in the embed's `srcdoc` or inner frame)

   Note the host the game files come from. If it's a CDN or `*.github.io`, add that exact host to the allowlist.
4. **Covers:** take them from the listing (best, since it costs no extra requests), then `og:image`, then the first large `<img>` on the page.

### How to implement it

- Edit `eclipse/src/games-c6x.js` in the repository. For anything beyond simple markup, add `node-html-parser` (`npm i node-html-parser`; pure JS, no native code) and commit both `package.json` and `package-lock.json`.
- If the list already includes covers and play URLs, put them straight into the catalog and skip per-page fetches. If you do need to fetch pages, limit concurrency to 4, send a normal browser User-Agent, respect `robots.txt`, and use timeouts.
- Clean up names: decode HTML entities, strip suffixes like "Unblocked", "Classroom 6x" and "- Play Online", collapse whitespace, and skip non-game pages (about, privacy, DMCA, contact, categories, tags, search).
- Remove duplicates by slug.
- Games the scraper misses can be added by hand in `data/c6x-extra.json` (see the README). The installer copies that file into place.

### Acceptance criteria

- [ ] The catalog has at least 50 games, or within 5% of the site's own count, with clean names and no non-game pages.
- [ ] At least 90% of covers return an image.
- [ ] For 10 games picked at random, `resolve` returns a URL that answers 200, and the game actually starts when played in Eclipse with Scramjet. Use a browser if you have one; otherwise say it's untested.
- [ ] With a cold cache the catalog builds in under 60 seconds. With a warm cache it answers in under 200 ms.
- [ ] Private-address URLs passed to `?u=` are refused.
- [ ] Changes are committed to the branch and pushed (if you have push access), then redeployed. Otherwise, hand the owner a patch.

Clear the cache to force a rebuild with `rm -rf /opt/eclipse/data/cache/*`, then `systemctl restart eclipse`.

## 7. Jellyfin

The Media tab talks to Jellyfin only through `/jf/*`, which Eclipse forwards to `JELLYFIN_URL`. It's a stub until set. When the owner tells you where their Jellyfin server is, set `JELLYFIN_URL=http://host:8096` in `/etc/eclipse.env` and restart Eclipse. Then check: `curl -fsS http://127.0.0.1:8080/jf/System/Info/Public` should return JSON with `ServerName`. Don't install Jellyfin unless the owner asks.

## 8. Operating it

- **Update:** run `deploy/deploy.sh` again, or pull and run `bash deploy/install.sh`. Settings in `/etc/eclipse.env` are kept.
- **Logs:**
  - Eclipse: `journalctl -u eclipse -f`
  - Caddy: `journalctl -u caddy -f`
  - Womginx: `journalctl -u eclipse-womginx` and `/var/log/eclipse-womginx.log`
- **Settings:** `/etc/eclipse.env`. Keys include `JELLYFIN_URL`, `CLASSROOM6X_URL`, `SHELL_ENABLED`, `SHELL_USER`, `WOMGINX_URL`, `ENGINE_RAMMERHEAD=false` and `ENGINE_CORROSION=false` (to turn an engine off), and `WISP_DNS`.

| Symptom | Likely cause and fix |
|---|---|
| No certificate, Caddy logs ACME errors | Ports 80/443 closed at the provider, another service on port 80 (`ss -ltnp`), or the sslip.io rate limit. Use the owner's own domain if needed. |
| "This engine needs HTTPS" in Browse | The site was opened over `http://`. Use the `https://` URL. |
| Scramjet/Ultraviolet: blank page or WebSocket errors | `/wisp/` isn't returning 101 (check Caddy), or there's an old service worker. Hard-reload, or clear site data. |
| Womginx shows "Turned off" in Settings | `WOMGINX_URL` is empty because DNS for `wg.<domain>` doesn't point here, or the build failed. Re-run the installer and read the Womginx step. |
| Womginx build fails | Old wombat dependencies on Node 22. Try `npx -y node@16 $(which npm) run build-prod` inside the wombat checkout, or install with `WOMGINX=0` and report it. |
| Womginx returns 403 "you are not allowed" | Its bot blocklist matched the User-Agent (curl, wget, Python…). Test with a browser User-Agent. |
| Rammerhead "session not found" | Settings → Reset Rammerhead session. |
| Shell says "Wrong password" for the right password | sshd refuses root password logins from localhost (section 5), or the IP is locked out (wait 15 minutes). |
| High memory use | Rammerhead is the heaviest engine. Set `ENGINE_RAMMERHEAD=false` if the server is small. |

## 9. Security

- The root password was pasted into an AI chat when this project started. **Recommend that the owner change it** with `passwd` once everything works; the web shell follows automatically. Let the owner do it themselves, or do it only with their go-ahead and never write the new one anywhere.
- Suggest `apt-get install -y unattended-upgrades` so security updates install automatically, and ask before enabling it.
- Don't expose ports 8080 or 8090. Don't remove the private-network guards (`src/netguard.js`, Wisp's `allow_private_ips: false`, the `eclipse_private_target` rule in the Womginx config).

## 10. Report back

Finish with a short report to the owner:

1. The live URLs (main site and Womginx).
2. Each check from section 4: **passed**, **failed** (with the error), or **not tested** (with the reason).
3. The Classroom 6x result: which site you used, the game count, how covers and play URLs are found, the acceptance checklist, and where the change was committed.
4. Anything you changed outside `/opt/eclipse` (sshd, firewall, swap, packages).
5. Open issues and anything the owner needs to do, such as a DNS record for a custom domain or changing the root password.
