# Studio

The studio's second engine. Skyrise stays on plain HTML and canvas; new games
start from `godot-starter/`, a Godot 4.7 project that runs headless in cloud
sessions and exports to the phone browser.

## Why Godot, and what it replaces from the Unity video

The video that started this (five free tools for building Unity games with
Claude Code) assumes the Unity Editor is running on your own computer. Unity
can't be licensed or used interactively in a cloud session. Godot is free,
needs no account, and runs headless on Linux, so Claude can build, test and
export in the same session.

| Video (Unity) | Here (Godot) |
|---|---|
| Unity Agent Plugin, Unity-MCP: Claude edits scenes and code, runs tests, takes screenshots | Claude edits `.gd`/`.tscn` files directly, runs `tests/run_tests.gd` headless, exports to web and screenshots it with Playwright. Godot-MCP exists for a desktop editor session; not set up here |
| Blockbench (low-poly models, pixel-art textures) | Same tool. Export glTF; Godot imports it natively |
| Yarn Spinner (dialogue) | Yarn Spinner for Godot needs Godot's C# build, which this setup doesn't use. Pick a dialogue tool when a game needs one |
| Mirror (multiplayer) | Godot's built-in multiplayer. Web builds must use WebSocket or WebRTC |

## Setup (each fresh cloud session)

```sh
bash studio/setup-godot.sh   # about 4 minutes; skips if already installed
```

Godot's own download site and GitHub release files are blocked in this
environment, so the script copies Godot 4.7.2 and its Linux and Web export
templates out of the `barichello/godot-ci` Docker image without running it.
On your own computer, install Godot from godotengine.org instead.

## Starter project

`godot-starter/` is a 30-second round: tap (or use the arrow keys) to steer the
orb onto sparks. It exists to prove the loop, not as a game. The round rules
sit in `scripts/rules.gd` with no nodes, so they test headless, the same split
as Skyrise's `src/sim.js`.

From `studio/godot-starter`:

```sh
godot --headless --path . --import                              # first run only
godot --headless --path . --script res://tests/run_tests.gd     # rules + smoke test
godot --headless --path . --export-release "Web" build/web/index.html
python3 -m http.server 8766 --directory build/web &
STARTER_URL=http://localhost:8766/index.html node tests/web_check.js   # 360x740 phone check
```

The web export uses the single-threaded template, so any static host works
(GitHub Pages included) without special headers. The engine download is about
40 MB uncompressed (`index.wasm`); serve it gzip- or brotli-compressed.

To start a new game, copy `godot-starter/` to a new folder or repository and
rename `config/name` in `project.godot`.
