<!-- agents-md ceiling: 52 lines -->
# AGENTS.md — ha-claude-code

A Home Assistant **add-on** that puts a Claude Code chat interface in the HA sidebar and
Companion App. One add-on (`claude-code/`) inside an add-on **repository** — that is what
`repository.yaml` at the root makes this. [`README.md`](README.md) is the install path for
users; `claude-code/DOCS.md` is what HA renders on the add-on's own page.

## There is nothing to build or test on this machine

`claude-code/package.json` declares **no scripts** — no build, no test, no typecheck — and
there is no CI (`.github/` does not exist). The artifact is a Docker image built by Home
Assistant's own supervisor from `claude-code/Dockerfile` and `build.yaml`, for `aarch64`
and `amd64`. The only honest verification is installing the add-on on a real HA instance
and using it; nothing here can be run to that effect on a Mac.

So: read, reason, and say in the PR what you exercised on an HA box. Do not claim a change
works because it typechecks — nothing typechecks it.

## Layout

| path | what it is |
|---|---|
| `repository.yaml` | makes this an add-on *repository* HA can be pointed at |
| `claude-code/config.yaml` | the add-on manifest — **`version` here is what triggers an update for users** |
| `claude-code/build.yaml`, `Dockerfile` | how the supervisor builds the image |
| `claude-code/rootfs/etc/s6-overlay/**` | the s6 service definition; `claude-launcher.sh` is what actually starts Claude |
| `claude-code/src/server.ts` | the HTTP/stream server behind ingress |
| `claude-code/src/claude.ts`, `usage.ts`, `ha-mcp.ts`, `types.ts` | the Claude session driver, the usage meter, the Home Assistant MCP bridge |
| `claude-code/public/` | the chat UI — plain `index.html`, `app.js`, `styles.css`, no framework |
| `claude-code/CHANGELOG.md` | what HA shows a user before they update |

## Conventions that differ from the defaults

- **Ingress, not a published port.** `ingress: true` with `ingress_port: 5100` and
  `ingress_stream: true` means HA proxies the UI and handles auth; the server must keep
  working under a path prefix it does not choose, and must not assume it owns the origin.
  An earlier version ran a proxy layer in front — it was removed on purpose.
- **`version` in `config.yaml` is the release mechanism.** Bump it with the change, and
  add the matching `CHANGELOG.md` entry, or nobody is offered the update.
- **The config map is `config` read-only and `share` writable.** Anything the add-on needs
  to persist goes to `share`; writing elsewhere is lost on restart.
- **Authentication is `claude login` in the add-on terminal**, not a key in the add-on
  options. `credentials_json` exists in the schema but the documented path is the login.
- **The UI is dependency-free by choice** — three files under `public/`. Adding a framework
  means adding a build step this repo currently does not have at all.

**Nothing about who may merge, how agents are spawned, or how the maintainer's
machine handles secrets belongs in this file, and none of it is stated here.**
Those are properties of a working environment, not of this project; if you are
contributing, your own conventions apply and nothing in this repo depends on
the maintainer's.
