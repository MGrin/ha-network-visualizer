<!-- agents-md ceiling: 56 lines -->
# AGENTS.md — ha-network-visualizer

A Home Assistant custom integration (Python) plus a Lit + three.js Lovelace card that draws
the home network as a force-directed graph. Installed through HACS.
[`README.md`](README.md) is the user-facing document: what it shows, how to configure it,
and the card options.

## The build, run 2026-09-09

```sh
cd frontend
bun install                                                              # rc=0
bun build src/network-visualizer-card.ts --outdir ../dist --minify --target=browser   # rc=0, 22.0 KB
cp ../dist/network-visualizer-card.js ../custom_components/network_visualizer/dist/
```

**`frontend/package.json` declares no scripts** — that command line *is* the build, and the
`cp` is part of it, not an afterthought. There is no test suite, no linter and no CI
(`.github/` does not exist), so a change is verified by loading the card in a real Home
Assistant and by exercising the integration there.

**The bundle is committed TWICE and both copies must move together**:
`dist/network-visualizer-card.js` and
`custom_components/network_visualizer/dist/network-visualizer-card.js`. HACS serves the
second; the first is the release artifact. Rebuilding one and committing only it ships a
card whose behaviour does not match its source, and nothing anywhere will say so.

## Layout

| path | what it is |
|---|---|
| `custom_components/network_visualizer/__init__.py` | integration setup and the static-file route that serves the card |
| `config_flow.py` | the UI configuration flow — where known MACs are entered |
| `coordinator.py` | the polling coordinator; `sensor.py` and `binary_sensor.py` are its entities |
| `manifest.json`, `strings.json`, `const.py` | HA integration metadata and the translated strings |
| `frontend/src/network-visualizer-card.ts` | the Lit card; `constants.ts` and `types.ts` beside it |
| `dist/`, `custom_components/.../dist/` | **generated** — the two committed copies of the bundle |
| `hacs.json` | what makes HACS able to install this |

## Conventions that differ from the defaults

- **Known device MACs live in the card's config, never in source.** They were moved out
  deliberately, to keep personal identifiers out of a public repo. A hardcoded MAC,
  hostname or vendor string in `frontend/src` or `custom_components/` is a privacy
  regression, not a convenience.
- **Two languages, one release.** A Python change and a card change ship together; there is
  no version negotiation between the integration and the bundle it serves.
- **`manifest.json`'s version is what HACS reads.** Bump it in the same commit as a change
  users are meant to receive, or the update never offers itself.

**Nothing about who may merge, how agents are spawned, or how the maintainer's
machine handles secrets belongs in this file, and none of it is stated here.**
Those are properties of a working environment, not of this project; if you are
contributing, your own conventions apply and nothing in this repo depends on
the maintainer's.
