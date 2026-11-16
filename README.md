# zenread

A calm reader for Markdown notes, with reading aids. One code base, three ways to run it:

- a **PWA**: static files, installable on desktop and Android, works offline, nothing uploaded;
- a **[zenbot](https://github.com/Zegoverno/zenbot) plugin**: "Read" for `.md` files in Files,
  and a `/read <path>` command;
- an **MCP App**: the reader as an inline widget in Claude, ChatGPT and any host that supports
  [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps), with tools the agent can call.

MIT licensed. No account, no telemetry, no network calls. It reads Markdown only and never writes to your files.

## Read

Open a folder (or some `.md` files) from the start page, or try the aids on the built-in sample.
The page shows the note's properties (front matter), its text, and the minutes left to read.
Keyboard:

| Key | Does |
|---|---|
| ↑ ↓, PgUp PgDn, Space, Home, End | scroll |
| `<` `>` | narrower, wider text column (60, 72, 90 characters, full width) |
| `:` | spaced lines and letters |
| `b` | bionic reading (the first letters of each word in bold) |
| `f`, `d` | focus (off, paragraph, line) and how strongly the rest is dimmed |
| `p` | play the note word by word; Space pauses, ↑ ↓ step, `+` `-` speed, `.` pauses at punctuation |
| `[` `]` | previous, next heading |
| `l` `L`, Enter | select a link, follow it (wiki links `[[Note]]`, relative `.md` links, web links) |
| `←`, Backspace | back to the note you came from |
| `n` `N` | next, previous note in the folder |
| `i`, `h` | the note's properties; the history of notes read |
| Alt+O | open another folder |

The settings (width, spacing, bionic, focus, dim) are remembered: in the browser's local storage in
the PWA, in the plugin's data folder when run as a plugin.

## Run it standalone (PWA)

```sh
npm ci
npm run build          # the PWA is in shells/web/dist: serve that folder with any static server
npm run dev            # development server
```

`shells/web/dist` is plain static files (relative URLs), so GitHub Pages, Cloudflare Pages or any file
server hosts it. Open it in a browser and use *Install* (desktop Chrome/Edge, Android) to keep it as an app;
after the first visit it works offline. Folders open with the File System Access API where the browser has
it, and an `<input type=file>` fallback everywhere else. Your notes stay in the browser: nothing is sent
anywhere.

## Install it in zenbot

```sh
zen plugins add zenread
```

or open **Settings → Marketplace** in zenbot's web app and install it there. To try a build first:
`zen plugins add ./zenread-0.1.1.tgz`. zenbot shows the permission below and asks you to approve it.

It lives in **Files**, not a separate Reading tab. It adds an opener for `*.md` files in read mode (set it as the default in
**Settings → Plugins**; until then the built-in reader stays the default), and the `/read <path>`
command. zenbot passes the file's path in its host context (`zen.path`, `zen.pane`, `zen.slot`); a link to
another note is handed back to zenbot with `zen://open?path=…`, which opens it with the right opener.
Changes to a note on disk show up in the reader within a couple of seconds.

**Permission: `files:read`.** The server reads notes under the folder zenbot gives it
(`ZEN_PLUGIN_FILES`) and keeps the reading settings in its own data folder (`ZEN_PLUGIN_DATA`). It has no
network and cannot write your files.

## Use it in Claude, ChatGPT or another MCP Apps host

Download `zenread-<version>.tgz` from the [releases](https://github.com/Zegoverno/zenread/releases) and
unpack it (it needs only Node 22 or newer, no `npm install`), or build it yourself (see Develop). Then add a
stdio server whose command is `node` and whose argument is the absolute path of `mcp/dist/server.js`, with
the environment variable `ZEN_PLUGIN_FILES` set to the absolute path of your notes folder (and, if you
like, `ZEN_PLUGIN_DATA` to a folder for the settings). Without `ZEN_PLUGIN_FILES` the file tools say so and
refuse; the reader still opens. In a host there is no zenbot, so links to other notes open inside the reader.

| Tool | Does |
|---|---|
| `zenread_open` | shows a note in the reader |
| `zenread_read` | the note's text, properties, web link, the notes before and after it, and where its links point |
| `zenread_list` | the folders and notes in a folder |
| `zenread_settings` | app only: loads and saves the reading aids' settings |

Every path is relative to the notes folder. `..`, absolute paths, symlinks that leave the folder, dot files
and dot folders, and anything that is not `.md` are refused. The view is `ui://zenread/app`. Hosts that only
speak remote (HTTP) MCP need a bridge: the server speaks stdio only.

## Roadmap

- PDF and EPUB
- web pages saved as readable text
- highlights and notes in the margin (the first write permission)
- AI help (summarize, ask) through MCP sampling in hosts and through ACP in the desktop app
- desktop (Tauri) and mobile (Capacitor) shells

## Develop

```sh
npm ci
npm run build    # the PWA, the app (ui/dist/index.html) and the server (mcp/dist/server.js)
npm run check    # types, unit tests, build, MCP smoke test, browser test, release archive
```

The browser test needs Playwright's Chromium (`npx playwright install chromium`). It loads the built PWA
with a neutral fixture note, changes the width, follows a link and goes back, and runs the MCP App page
against a fake host (with and without zenbot's host context). `SHOTS=<folder> npm run test:e2e` also writes
screenshots there; keep them out of the repository.

## Releasing

1. Set the same version in `package.json` and `plugin.json`, and commit.
2. `npm run pack` builds everything and writes `dist/zenread-<version>.tgz` (the manifest, the one-file
   server, the built UI, skills, README, LICENSE: no links, dot files or `node_modules`) and prints its sha256.
   `npm run test:pack` unpacks it into an empty folder and runs the MCP smoke test against that server.
3. Tag `v<version>` and push the tag. The release workflow checks that the tag, `package.json` and
   `plugin.json` agree, runs the checks, and publishes a GitHub release with the archive and its sha256.
4. List or upgrade the plugin in the zenbot marketplace with that archive URL and sha256
   (see zenbot's `PLUGINS.md`).

## Layout

```
plugin.json  the zenbot manifest: openers, commands, permissions
core/        settings, text and link rules: pure TypeScript, tested with vitest
ui/          the Svelte 5 app; host.ts is the MCP App entry, adapters.ts the storage seam
mcp/         the MCP server and its confined file access (built to mcp/dist/server.js)
shells/web/  the PWA: manifest, icons, service worker, entry
skills/      reading-notes: how an agent should use the tools
scripts/     pack.mjs: the release archive
tests/       MCP smoke test, browser test, release-archive test
```
