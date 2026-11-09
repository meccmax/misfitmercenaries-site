# Misfit Mercenaries — website

The Misfit Mercenaries community site: a static site hosted free on GitHub Pages, with a live DayZ stats page (server status, population graphs, leaderboards, player lookup).

Nothing to install, no build step. Edit a file, commit, and the site updates itself within a couple of minutes.

---

## What's where

| You want to change… | Edit this |
|---|---|
| Header menu, footer, Discord link | `site/assets/js/site.js` (top of the file) |
| Colours, fonts, spacing | `site/assets/css/mm.css` (the `:root` block at the top) |
| DayZ server cards (name, ports, slots, description, mods) | `site/data/servers.json` |
| Mod list on the Modding page | `site/data/mods.json` |
| Page text | the matching `.html` file in `site/` (`index.html` is the home page) |
| Server rules | `site/join.html` (look for "Edit the rules here") |
| Monthly costs panel | `site/join.html` (look for "Costs:") |
| Media screenshots and videos | see **Adding screenshots and videos** below |
| Media albums (add or rename a game) | `site/data/albums.json` |

Every JSON file has a `_comment` field explaining what each setting does.

---

## One-time setup

### 1. Turn on GitHub Pages
Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Then go to the **Actions** tab, open "Build site and update stats" and click **Run workflow**. When it goes green, the site is live at `https://meccmax.github.io/misfitmercenaries-site/`.

### 2. Fill in the server details
Open `site/data/servers.json` and, for each DayZ server, fill in:
- `game_port`: the port players connect to (shows a Copy button on the Servers page)
- `query_port`: the `steamQueryPort` from that server's `serverDZ.cfg` (powers the live status and population graph)
- `slots`, `style` (e.g. "PvE" or "PvP"): shown on the card
- `restart_hours_utc`: the UTC hours the server restarts, e.g. `[2, 6, 10, 14, 18, 22]` (optional; draws restart markers and the "next restart" time)

With just `query_port` filled in, status and population graphs start working on the next run. The game's query port must be reachable from the internet over UDP (it already is if your server shows in the DayZ server browser).

### 3. Connect CFTools (leaderboards and player lookup)
1. In the CFTools Developer Portal (developer.cftools.cloud), create an **Application**. Note its **Application ID** and **Secret**.
2. Use the application's **grant link** to give it access to each MM server in your CFTools Cloud account.
3. For each server, copy its **Server API ID** (from the server's API/integration settings in CFTools Cloud) into `cftools_server_api_id` in `site/data/servers.json`.
4. In this repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:
   - `CFTOOLS_APP_ID` = the Application ID
   - `CFTOOLS_SECRET` = the Secret

   Secrets never appear on the website or in the code.

5. Run the workflow again from the Actions tab. Leaderboards appear within a minute or two.

### 4. Point misfitmercenaries.com at the new site (when you're ready)
1. In Google Sites, remove the custom domain from the old site (Settings → Custom domains).
2. At your domain registrar, set DNS:
   - `www` → **CNAME** → `meccmax.github.io`
   - root domain (`@`) → **A** records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. Here: **Settings → Pages → Custom domain** → `www.misfitmercenaries.com` → Save. Tick **Enforce HTTPS** once it's offered (can take up to a day).

Until you do this, the old Google Site stays live and nothing changes for players.

---

## Adding screenshots and videos

Each game has its own folder under `site/media/` (for example `site/media/dayz/`). The Media page builds itself from those folders on every deploy, including small preview images, so you never edit any page code.

**Screenshots**
1. On GitHub, open `site` → `media` → the game's folder.
2. Click **Add file → Upload files**, drag in your screenshots (JPG, PNG or WebP) and click **Commit changes**.
3. In a couple of minutes they appear on the Media page, in file-name order (numbers count properly, so `2` comes before `10`; date-named files show oldest first).
- Want a specific album cover? Name one image `cover.jpg` (or `.png`).
- To remove one, open the file on GitHub, click the **…** menu → **Delete file** → **Commit changes**.

**Videos**
- **Best:** upload to YouTube (public or unlisted). Then on GitHub open that game's `videos.txt`, click the pencil, paste the link on a new line and commit. Add a title after a `|` if you like:
  `https://www.youtube.com/watch?v=abc123 | Convoy ambush at the docks`
- **Short clips:** an `.mp4` under 25 MB can be uploaded straight into the folder like a screenshot. Anything bigger has to go on YouTube (GitHub's limit).

## How the stats work
- The workflow in `.github/workflows/site.yml` runs on every push and every 30 minutes (GitHub sometimes runs scheduled jobs a few minutes late).
- `scripts/update-stats.mjs` queries each server, pulls CFTools leaderboards (top 100 per stat), and writes JSON files that the Stats page reads.
- Those files are kept on a separate branch called `stats-data`, so the `main` history stays clean. Don't edit that branch by hand.
- Population history is kept for 35 days.
- **Hiding a player:** add their Steam64 ID to `hidden_players.steam_ids` (or CFTools ID to `cftools_ids`) in `site/data/servers.json`. They drop off the boards and lookup on the next run.
- GitHub pauses scheduled workflows in a repo with no activity for 60 days. The stats updates count as activity, but if it ever stops, just click **Run workflow** once.

## MM BlackBox player stats (AI kills, travel, longest shot …)
- Each DayZ server's MM BlackBox writes `profiles\MM_BlackBox\Stats\public_stats.json` every 5 minutes. Every 30 minutes, `scripts/blackbox.mjs` downloads all three, checks them and builds the boards.
- **Where the files come from:** the MM Server Agent on the server machine (v0.16+) shares them at `https://game.misfitmercenaries.com:2999/mm-agent/v1/blackbox-stats/<game port>/public_stats.json` (`blackbox.url` in `site/data/servers.json`). The feed checks the agent's key against `blackbox.agent_fingerprint` before it sends the password.
- **To switch it on:** on the server, run `update-agent.bat` and then `stats-token.bat` (both as administrator), and copy the password it shows into a repository secret called `BLACKBOX_TOKEN`. Until then the Stats page keeps showing the CFTools boards.
- Once data arrives, the Stats page switches to the BlackBox boards (Survival, Combat, Travel, Building, Deaths). They come as All-time, This season and past seasons, for All servers or one map. The page also gets a causes-of-death chart, hall-of-fame records and a fuller player lookup.
- **All servers** adds players' stats from every map together (matched by their anonymous id). Longest/best stats take the highest, and "current life" stays per map.
- If a download fails or a file is half-written, the last good copy is used. When a server's `season_id` changes (a wipe), the old season's final file is saved and shown under its season name.
- Players under 10 minutes and staff are left out by BlackBox itself, so there's nothing to set here. The files never contain Steam IDs or IPs.
