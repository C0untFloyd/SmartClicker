# AGENTS.md

Notes for agents (and humans) working on **SmartClicker** — an Electron desktop app that
executes YAML "action scripts" of mouse/keyboard automation plus OpenCV template matching
against the screen. It is a JavaScript port of an earlier Python tool; the YAML format and
class names are intentionally Python-flavoured (`duration_ms`, `imagePath`, `toDict()`, …).

This file is the fast path to understanding the code. `README.md` is the user-facing feature
list and action reference; this document covers how the code actually behaves.

---

## Quick start

| Command | What it does |
|---|---|
| `npm start` | Run the app (`electron .`) |
| `npm start -- --script=<path>` | Run the app with a YAML script pre-loaded |
| `npm run dev` | Same, but with `--remote-debugging-port=9222` for DevTools/VS Code attach |
| `npm run pack` | Unpacked build to `dist/` (`electron-builder --dir`) |
| `npm run dist` | NSIS installer + portable exe in `dist/` |
| `npm test` | **Stub** — no test suite exists |

There is no linter, formatter, TypeScript, or bundler. Everything is plain JS loaded as-is
by Electron. `.vscode/launch.json` has an "Electron: All" compound config (main process
debug + renderer attach on port 9222).

> OpenCV.js is loaded from a **CDN** (`https://docs.opencv.org/4.x/opencv.js` in `index.html`),
> so the app needs internet access at startup. Offline, `cv` never becomes defined and every
> image action silently fails. `init()` waits on the global `window.onOpenCvReady` hook.

---

## Repository map

```
main.js        Electron main process: window, global hotkeys, robotjs calls,
               desktopCapturer / electron-screenshots capture, YAML + file IO, path resolution
preload.js     contextBridge → window.electronAPI (the *entire* IPC surface)
index.html     Static shell: sidebar (Actions/Record/Settings), action tree, detail panel,
               Record workspace, status bar. Loads OpenCV CDN + renderer.js as a module
renderer.js    ~all app logic: action tree editing (add/delete/reorder/nest), detail panel,
               script load/save, execution engine, OpenCV pipeline
               (screenshot → mode processing → template match → NMS)
models.js      Data model: ActionType/ScreenshotMode enums, action classes, AutomationScript,
               actionFromDict() deserializer, toDict() serializer, plugin action registry
               (ESM, renderer-only)
plugins/       Optional feature modules. Each plugin registers its own action class, editor
               fields and executor; a script opts in with a top-level `plugins: [id]` list.
               sushi/ is the Sushi Station bot (pure vision helpers + action + executor).
style.css      Dark GitHub-ish theme, CSS variables at :root (--bg-color, --accent-primary, …)
.assets/       Tracked sample script (example_idleon_gamingpalette_deposit.yaml)
recordings/    Local-only scripts (gitignored, not packaged)
detectimages/  Local-only needle PNG library (gitignored, not packaged)
dist/          Build output (gitignored)
```

`recordings/` and `detectimages/` are **local working data**, deliberately excluded from both
git and the packaged app (`.gitignore`, `package.json > build.files`). Do not invent code that
depends on them existing in a fresh clone, and do not commit them.

---

## Architecture at a glance

```
┌──────────────────────── renderer (index.html + renderer.js) ────────────────────────┐
│  AutomationScript (models.js)                                                       │
│    ├─ loadScript()  ── electronAPI.loadYaml(path) ──┐                               │
│    ├─ saveScript()  ── electronAPI.saveYaml(path) ──┤                               │
│    └─ startProcess() → executeAction(tree walk) ────┤                               │
│                                                     │                               │
│  capture/matching: takeScreenshotAsMat(mode,thr)    │                               │
│    ← electronAPI.takeScreenshot() ──────────────────┤                               │
│    → cv.cvtColor / cv.threshold → matchTemplate     │                               │
│    → minMaxLoc / multi-locate + NMS → robot clicks  │                               │
│                                                     ▼                               │
└─────────────────────────────────────── preload.js (electronAPI) ────────────────────┘
                                         │ ipcRenderer.invoke
┌──────────────────────────────────────── main.js ────────────────────────────────────┐
│  robotjs_addon: moveMouse, mouseClick/Toggle, mouseToggle, scrollMouse, keyTap,      │
│                 typeString, getMousePos                                              │
│  desktopCapturer (primary display, raw BGRA buffer) | electron-screenshots (snips)   │
│  fs + js-yaml, dialog open/save, rootPath resolution, globalShortcut Shift+F1/Esc     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Key point: **the execution engine lives in the renderer**, not the main process. Main is a
thin, mostly stateless "OS capabilities" layer. Any new capability that needs Node/OS access
must be added as an `ipcMain.handle` in `main.js`, exposed in `preload.js`, and called from
`renderer.js`.

`--script=<path>` is resolved in main (`resolveStartupScript`, relative to `rootPath`) and
fetched once by the renderer via the `get-startup-script` IPC, then loaded through the same
`loadScriptFromPath()` path as the Load button.

Hotkeys: `Shift+F1` → main sends `hotkey-start`; `Shift+Esc` → `hotkey-stop`. The renderer
subscribes via `onHotkeyStart` / `onHotkeyStop`. The app minimizes itself while running and
restores in the execution `finally` block.

---

## Script (YAML) format

Top level is an `AutomationScript`:

```yaml
scriptName: "Script for IdleOn Game"
description: "..."
loopSpecification:
  type: fixedIterations   # or infinite
  iterations: 0           # 0 (or <= 0) == run forever
  delayBetweenIterations_ms: 5000
actions: [...]
```

Every action accepts `enabled` (default `true`), optional `childActions`, and has an
`actionType` matching an `ActionType` enum value in `models.js`:

| actionType | Fields (beyond enabled/childActions) | Executor |
|---|---|---|
| `delay` | `duration_ms` | `setTimeout`, **not** interruptible |
| `movetopos` | `x`, `y`, `speed` (stored, unused) | `moveMouse` |
| `mouseclick` | `button`, `x`, `y`, `holdTime_ms` | `mouseClick` / `mouseToggle` |
| `drag` | `fromX`, `fromY`, `toX`, `toY`, `duration_ms` | `drag-mouse` IPC |
| `mousewheel` | `wheel_amount` | `scrollMouse(0, amount)` |
| `keypress` | `key`, `modifier` (`none/ctrl/shift/alt/cmd`) | `keyTap` |
| `writetext` | `text` | `typeString` |
| `waitforimage` | `imagePath[]`, `screenshotMode`, `threshold`, `timeout_ms`, `tolerance` | `waitForImage()` |
| `clickimage` | `imagePath[]`, `screenshotMode`, `threshold`, `holdTime_ms`, `button` | `clickImage()` |
| `clickimagewhilefound` | same as `clickimage` | `clickAnyImageWhileFound()` |
| `movetoimagecenter` | `imagePath[]`, `screenshotMode`, `threshold`, `offset_x`, `offset_y` | `moveToImageCenter()` |
| `numberedloop` | `iterations`, `delayBetweenIterations_ms` | `executeNumberedLoop()` |
| `whileconditionloop` | `conditionType` (`imagepresent` only), `conditionValue`, `screenshotMode`, `threshold`, `timeout_ms`, `tolerance`, `modifier` (all three largely unused) | `executeWhileConditionLoop()` |
| `group` | `groupName` | inline child walk |
| `sushistation` | `bannerImage`, `maximizeImage`, `dryRun`, `maxMerges`, `matchThreshold`, `maxFailures`, `cookEnabled`, `maxCooks`, `debugImagePath`, `sortMode`, `sortOnly`, `sortFirst`, `reSortAfterMerge`, `tierAtlasImage`, `tierRadius`, `sortMinGap`, `sortMaxDistance`, `sortMaxSwaps`, `swapVerifyThreshold`, board geometry | `playSushiStation()` (plugin) |

`sushistation` is not built into `models.js`; it is registered by the `sushi` plugin
(`plugins/sushi/index.js`) and only exists for scripts that declare `plugins: [sushi]`.

For image actions, `imagePath` is always normalized to an **array** of relative paths by
`ImageActionBase`. Relative paths are resolved against `rootPath` in `main.js`:

- dev: the repo root (`__dirname`)
- packaged: `PORTABLE_EXECUTABLE_DIR` or the exe directory, with up to two parent-directory
  fallbacks when the file is missing

Thus `detectimages/idleon/foo.png` in a YAML is relative to the app/exe root.

Screenshot modes (`ScreenshotMode`):

- `Colored` — raw BGRA frame
- `Gray` — BGRA → gray → **back to BGRA** so every mode yields 4-channel mats and matching is uniform
- `BlackWhite` — gray then `cv.threshold(..., threshold - 1, 255, THRESH_BINARY)`, back to BGRA

`threshold` is clamped to **1–254**, default **128**. It is only meaningful in `BlackWhite`
(used by the Record tab too). It is *serialized only when != 128*; `enabled` and
`screenshotMode` are always serialized. So **loading and re-saving any script rewrites it**
in canonical form (dropping comments/unknown fields). Keep that in mind when "fixing" a YAML:
the model is not lossless.

**Needle images must be captured in the same mode as the action.** A template PNG saved from
a Gray/BlackWhite snapshot is the only thing that matches a Gray/BlackWhite haystack. The
Record tab exists precisely to produce these pre-processed needles.

---

## Matching pipeline (renderer.js)

`takeScreenshotAsMat(mode, threshold)` → `cv.Mat` (CV_8UC4)
`loadImageAsMat(relPath)` → BGRA mat, cached in `bufferedImages` (never freed)
`findImageOnScreen(paths, confidence, mode, threshold)` → `{x, y}` of the **center** of the
best match, or `null`. Confidence is hard-coded `0.8` by `clickimage`/`movetoimagecenter`;
`waitforimage` uses `1.0 - tolerance` (so **lower** tolerance = stricter); `clickimagewhilefound`
uses `0.7`.

`clickimagewhilefound` uses `findAnyImageOnScreen` (async generator) → `locateImageCenterMulti`
→ a brute-force scan of `dst.data32F` over every pixel, then greedy NMS. It repeats until a
full pass finds nothing, so it will loop indefinitely if the target never disappears — that is
by design (e.g. clearing popups) but is a common source of "app is stuck" reports.

Coordinates from the match are passed straight to robotjs; the screenshot is captured at
`display.size * scaleFactor` and robotjs works in physical pixels, so this matches on Windows.
Only the **primary display** is captured (`capturePrimaryScreen()` selects the source whose
`display_id` matches the primary display, falling back to `sources[0]`), so multi-monitor
scripts don't work.

---

## Sushi Station bot (plugins/sushi + main.js)

`sushistation` automates the World 7 merge board: find two tiles with the same sushi sprite,
drag the left one onto the right one, repeat. It does **not** OCR the tier numbers; identical
sprites are matched by colour signature, so it works at any tier.

This action is provided by the **sushi plugin**. A script must declare it:

```yaml
plugins: [sushi]
...
actions:
  - actionType: sushistation
```

Board geometry is calibrated against the **maximized/fullscreen game window** (3440x1440 including
the game's custom title bar). The wordmark sits at (1166, 37) and cell (0,0) is at (754, 166);
`SUSHI_BOARD_DEFAULTS` (`plugins/sushi/sushi.js`) holds the values and `SushiStationAction`
imports them for its model defaults:

- anchor template `detectimages/sushi/station_banner.png` = the "SUSHI STATION" wordmark at
  (1166, 37), 650x70 in the fullscreen window. The TIERS toggle is deliberately **not** part of the
  template because its appearance changes when tier vision is toggled.
- maximize template `detectimages/sushi/window_maximize.png` = the maximize icon in IdleOn's
  custom title bar (28x23). If the fullscreen banner does not match on the first check,
  `ensureWindowMaximized()` finds this icon and clicks it (unless it is already at the top-right
  corner of the screen), waits 900 ms for the window to maximize, and re-locates the banner.
- cell (0,0) centre = anchor top-left + `(-412, 129)`
- 12 columns x 8 rows, centre spacing `118.48 x 118.32`, `cellRadius: 49`, `tierRadius: 56`

Pipeline (`plugins/sushi/index.js > playSushiStation`):

1. `findImageOnScreen([bannerImage])` locates the fullscreen wordmark (requires cv). If not found,
   `ensureWindowMaximized()` clicks `maximizeImage` on the title bar to bring IdleOn to fullscreen
   and retries the banner lookup.
2. Compute the grid rect, then capture only the board with `take-screenshot-region`
   (`main.js > capturePrimaryScreen()` + `NativeImage.crop`). If the crop comes back a
   different size than requested, the board is partially off-screen and the action aborts.
3. `analyzeBoard` builds a 20x20 RGB signature per cell and classifies empties by
   `brightRatio < 0.06` or luminance variance `< 2000` (an empty plate is flat).
4. `findMergePairs` finds all pairs whose RMS signature distance is `<= matchThreshold`
   (default 8; different tiers are ~80-120, same tier ~0-8) and greedily keeps disjoint pairs.
5. `chooseNextPair` orients same-row merges left -> right so the surviving tile lets
   Heat of the East Wind chain into the next column, and prefers targets with a filled right
   neighbour.
6. `drag-mouse` (robotjs `mouseToggle` + stepped `moveMouse`) performs the drag; then
   `verifySushiMerge` re-reads the board for up to ~2.7 s. Success means the source is empty
   **and** the destination is a sprite different from both old tiles (a slot move would leave
   the destination equal to the old source). The cursor is parked on the title between drags
   so hover highlights do not pollute the next scan.
7. If no pairs remain and `cookEnabled`, it clicks `bannerTL + (cookOffsetX, cookOffsetY)`
   once per `cookDelay_ms` and re-scans. Cooking is off by default because the click target
   (fuel panel/tier selector) is not confirmed on every UI layout.


`dryRun: true` makes no clicks: it analyses once, writes an annotated PNG to
`debugImagePath` (default `detectimages/sushi/debug_scan.png`) and logs the pairs. This is the
calibration path — the debug image shows whether the grid, empties and pairs line up.

`recordings/sushi_station_scan.yaml` (scan only), `sushi_station_test.yaml` (one merge) and
`sushi_station.yaml` (full run) open the station first. `sushi_station_live_scan.yaml`,
`sushi_station_live_test.yaml`, `sushi_station_live.yaml`, `sushi_station_live_sort_scan.yaml`
(no-click sort preview), `sushi_station_live_sort.yaml` (sort + cascade) and
`sushi_station_live_cascade.yaml` (cascade-only, no re-sort) skip the opening click and are
meant to be run while the station is already open. All of these are under `recordings/`, hence
gitignored.

**Run in fullscreen/maximized mode:** signatures and grid offsets use the static fullscreen
geometry. If IdleOn is in a smaller window when the action starts, `ensureWindowMaximized()` clicks
the title-bar maximize button (`detectimages/sushi/window_maximize.png`) automatically before
scanning. Also make sure the in-game **MOVE** toggle is off; if it is on, the first drags move
slots and verification aborts the action after `maxFailures`.

Dragging one sushi onto a **different** sushi swaps the two tiles; onto an **identical** tier it
merges. This is the primitive behind `sortMode`:

- `prepareSushiSort` loads `tiers_atlas.png` (an 8x8 grid of the 64 official sprites), builds a
  tier classifier (`buildTierClassifier`), classifies each cell (`classifyBoardTiers`, sampled at
  `tierRadius`) and plans a **wrap cascade** (`planWrapCascadeLayout`): a pair tier T with
  at least three copies (`T, T, T`) followed by the consecutive run `T-1, T-2, ...`, placed in
  row-major order across row boundaries. The third
  copy is required because the merged tile becomes `T+1` and the chain starts only at `T`; a
  missing tier or duplicate stops it. `planWrapCascadeLayout` is the only layout path: it scores
  every start cell by chain length versus the drags needed and arranges only the selected path,
  pulling tiles from anywhere, so a layout is a handful of ops instead of a full-board sort. The
  initial pass sorts only when the planned chain is longer than the best pair already on the
  board, so a depleted board is not repacked for a 1-2 chain. Ops carry
  `fromRow/fromCol/toRow/toCol`.
- `runSushiSortSwaps` executes the ops; `dragAndVerifySortOp` verifies a move (source empty,
  target occupied) or a swap (tier/signature swap or both cells visibly changed) by
  re-classifying the cells, with a signature fallback (`swapVerifyThreshold`). Before the first
  drag the action clicks the wordmark to activate the game, because a drag on an inactive window
  is consumed by activation.
- Only different tiers are swapped (identical tiers would merge); an empty target is a move.
  `sortFirst: false` skips the initial dedicated layout. `reSortAfterMerge` (default true)
  rebuilds the best row/sequence before a merge, but only when the board does not already offer
  a natural chain of 4+ tiles; skips avoid dozens of re-layout drags.
- `planBestCascadeMerge` makes the **later** cell of the pair the target, so the consumed source
  becomes a gap behind it. `countCascade` is **row-major and exact**: after the merge the result
  is `T+1`, so the chain requires `T`, `T-1`, `T-2`, ... walking right and wrapping into the next
  row. It stops at the board end, an empty cell, a gap, or a duplicate (`4,3,3,2,1` stops at the
  second 3). Only pair tiers up to `SUSHI_MAX_CASCADE_TIER` (54) can cascade; 55+ merges are
  plain merges. The longest exact chain wins.
  `maxMerges: 0` keeps merging until no pairs remain; `sortOnly` returns after the layout.
- The atlas is local working data (gitignored): 8x8 cells of 47x47, tier N at index N-1.
  `tierRadius` 32 was validated at ~98.6% tier accuracy on the live board; the signature radius
  28 produced off-by-one tier errors, so the two radii are intentionally separate. A live
  exact-wrap run did 19 merges in ~200 s with cascades of 5-12 tiles and 1-11-drag re-layouts; an
  earlier global-sort run reached a 9,541 current combo and a 37.07x permanent multiplier
  (best 9,654), which the exact reruns keep.
- Verification is deliberately tolerant: a move succeeds when the source is empty and the target
  is occupied; a swap succeeds on tier swap, signature swap, or both cells visibly changed. A
  failed sort op stops that sort pass (`sortingDisabled`), re-reads the board and continues with
  merges — it never aborts the run. Merge failures still count toward `maxFailures`.

---

## Plugins

Plugins are optional feature modules under `plugins/<id>/index.js`. A script opts in with a
top-level list; without it the plugin's action type is unknown:

```yaml
plugins: [sushi]
actions:
  - actionType: sushistation
```

`AutomationScript.plugins` stores the list and `toDict()` writes it back. On load,
`renderer.js > ensurePlugins()` validates each id (`[a-zA-Z0-9_-]+`), dynamically imports
`./plugins/<id>/index.js`, and expects the module to call `registerPlugin()` from `models.js`.
The registry lives in `models.js`:
- `registerPlugin(plugin)` — stores `{ id, name, actions }`; every action descriptor needs
  `actionType`, `create(data)` and `createDefault()`.
- `getPlugin(id)` / `getPluginAction(actionType)` / `listPluginActions()`.
- `actionFromDict()` and `createDefaultAction()` fall back to `getPluginAction()` for unknown
  built-in types. An unregistered plugin action makes loading fail with an error naming the
  `plugins` list.

An action descriptor may also provide:
- `label`, `description`, `group`, `icon` — used by the palette, tree and `getActionIcon()`.
- `describe(action)` — tree label; falls back to the raw action type.
- `renderFields(form, action, ui)` — detail-panel fields. `ui` exposes
  `addFormField`, `addFormSection`, `toInt`, `toFloat` and `renderTree`.
- `execute(action, host)` — called by `executeAction()`. `host` is created per run by
  `createPluginContext()` and exposes `electronAPI`, `cv`, `status`, `log`, `warn`, `sleep`,
  `stopRequested()` and `findImageOnScreen`. Plugins use those instead of importing renderer
  internals.

The sushi plugin keeps its action class, editor fields, executor and pure helpers together
(`plugins/sushi/index.js`, `plugins/sushi/sushi.js`); the core only knows the registry and the
generic actions.

---

## Action tree editing (renderer.js)

The Actions panel is a full editor, not just a viewer:

- **Add** — `＋ Add Action` in the panel header opens `buildActionPalette()` (built from
  `ACTION_LIBRARY`). The insertion point is the action *after* `selectedAction`, or the end of
  `currentScript.actions` when nothing is selected. `＋ Add Child Action` in a container's
  detail panel sets `paletteTarget` so the next pick is appended to that container's
  `childActions`.
- **Delete** — `deleteAction()` splices the owning list. A subtree prompts via `confirm()`;
  a leaf deletes immediately. `forgetExpanded()` prunes the `expandedActions` set, and
  `keepSelectionValid()` clears a selection whose action no longer exists.
- **Reorder / nest** — `moveAction(±1)`, `indentAction()` (moves into the *previous sibling*
  if it passes `canContainActions`) and `outdentAction()` (moves out of its parent, placed
  right after it). The `→`/`←` row buttons are disabled when the operation is invalid.
- **Run lock** — all structural mutations return early while `isRunning` (`canEditActions()`,
  which also shows a status hint); the Add button is disabled and the palette closed when a run
  starts.
- **Ownership lookup** — `findActionParent(action)` returns `{ list, index, parent }` by
  scanning from `currentScript.actions`. It is the basis for every mutation; actions are
  identified by object identity, and `expandedActions` / `selectedAction` also hold object
  references, so mutating arrays in place is fine but replacing action objects is not.

Container types are defined once in `models.js` via `ContainerActionTypes` /
`canContainActions()`; the executor only walks `childActions` for `group`, `numberedloop`, and
`whileconditionloop`, so keep that set in sync with `executeAction()`.

The palette lives inside `.action-list-panel` as an absolutely positioned popover. A
document-level click listener closes it, so **any button that calls `openActionPalette()` must
`stopPropagation()` in its click handler** or the same click bubbles and closes it again.
Escape closes the palette (it does not trigger the `Shift+Esc` stop hotkey).

---

## Conventions when changing things

**Adding / modifying an action** requires touching all of these:

1. `models.js` — `ActionType` entry, class with defaults, `toDict()`, `actionFromDict()` switch,
   `createDefaultAction()` (palette defaults), and `ContainerActionTypes` if it can hold children.
2. `renderer.js` — `executeAction()` case, `formatActionLabel()`, `getActionIcon()`,
   `ACTION_LIBRARY` (so it appears in the palette), and the field editors in
   `renderDetailPanel()` (that function is a hand-written if/else chain; there is no
   schema-driven form). Container types also need an `executeAction()` branch that walks
   `childActions`.
3. `README.md` — the action table.
4. Any sample scripts under `.assets/` if they should demonstrate it.

**Plugin actions** do not touch the `ActionType` enum or the core switch statements. Put the
action class, defaults, `toDict()`, editor fields and executor in `plugins/<id>/index.js`,
register it with `registerPlugin()`, and add the plugin id to the scripts that use it. The core
handles deserialization, the palette entry, tree label/icon, detail-panel hook and execution.
Keep general-purpose pointer/keyboard/vision/flow actions in the core; only game- or
feature-specific logic belongs in a plugin.

**Serialization contract:** constructor fields must round-trip through `toDict()` →
`actionFromDict()`. The detail panel renders fields with explicit `!== undefined` checks on the
instance (e.g. `timeout_ms`, `tolerance`, `button`, `wheel_amount`, `offset_x/y`,
`delayBetweenIterations_ms`), so a new property needs an editor line in `renderDetailPanel()` —
and it only survives a save if `toDict()` includes it and the constructor reads it back. Plugin
classes follow the same rule and `AutomationScript.toDict()` adds the plugin id automatically.

**Style:** match the existing renderer style — direct DOM APIs, `document.createElement`,
`textContent` for anything derived from a script (never interpolate user text into `innerHTML`),
`addFormField(...)` for detail-panel inputs, `createRowButton(...)` for tree-row controls, and
CSS variables / existing class names in `style.css`. No framework, no build step, and no `npm`
dependencies should be added casually: `package.json` lists many transitive dependencies
explicitly (artifacts of packaging), and the only real runtime deps are `robotjs_addon`,
`electron-screenshots`, `js-yaml`.

**Comments/docs:** user-facing text and status strings are English; keep the Python-era
naming (`imagePath`, `holdTime_ms`, `screenshotMode`) even where it is inconsistent with
JS camelCase, because YAML files depend on it.

---

## Known quirks, dead code, and landmines

Read this before "cleaning up" — several of these will change behaviour or break existing
user scripts.

1. **The detail panel fully covers action fields, but not script metadata.** It cannot edit
   `scriptName`, `description`, `loopSpecification` (top-level), `movetopos.speed` (cosmetic —
   `robot.speed` is never set), or `whileconditionloop.modifier` (unused). It mirrors whichever
   action properties exist on the instance, so the gaps are exactly the properties the classes
   do not define. `mouseclick`/`movetopos` coordinates are manual numbers — there is no
   click-to-pick screen coordinate tool.
2. **`waitforimage` default tolerance is 0**, i.e. required confidence `1.0`. With
   `TM_CCOEFF_NORMED` that is essentially unattainable, so scripts must set a tolerance
   (e.g. `0.1`). Also note the inverse relationship: confidence = `1 - tolerance`.
3. **`whileconditionloop` ignores `tolerance` and `timeout_ms`** and hard-codes confidence
   `0.8`; it also only supports `conditionType: imagepresent`. `modifier` is unused.
4. **`conditionValue` is not normalized to an array at runtime.** `findImageOnScreen` does
   `for (const p of imagePaths)`, so a bare YAML string iterates characters and always fails.
   Always write `conditionValue` as a list. (Selecting a loop in the editor normalizes it to an
   array in memory, but a script executed without opening that action keeps the string.)
5. **`delay` is not interruptible.** `stopRequested` is checked between actions and inside
   `waitForImage` / loops, so long delays make Stop feel unresponsive. `stopProcess()` awaits
   the execution promise before returning.
6. **A timeout in `waitforimage` throws**, which aborts the *whole* script (caught in
   `startProcess`, surfaced via `alert`, then the loop ends). It does not just skip the action.
7. **Threshold off-by-one:** capture uses `threshold - 1` with `THRESH_BINARY` (pixels `>= threshold-1`
   become white). The slider min is 1, so the effective cutoff is 0–253.
8. **Mouse click coordinates are only applied when `x > 0 && y > 0`**; `(0, y)` or `(x, 0)`
   clicks the current pointer position instead.
9. **Dead/unreachable code:** `loadImageAsMat2()` (uses `readImage2`), `saveMatAsDebugImage()`,
   and the `read-image2` IPC handler (not exposed in `preload.js`). `robot.speed` is never set
   (`speed` on `movetopos` is cosmetic). `LoopSpecification` is only used at script level.
10. **Memory:** `bufferedImages` caches `cv.Mat`s for the process lifetime and needles are
    never `.delete()`d. Haystacks and per-match `dst`/`mask` mats *are* deleted. Large image
    libraries or many distinct templates leak OpenCV heap.
11. **`models.js` is ESM inside a CommonJS package** (`"type": "commonjs"`). It works only
    because `index.html` loads `renderer.js` with `type="module"`. Do not `require()` it;
    do not add ESM imports to `main.js`/`preload.js`.
12. **Security posture:** `preload.js` exposes arbitrary-path file read/write, YAML parse, and
    path resolution to the renderer. This is a local automation tool, not a hardened app; don't
    add remote content or navigation without addressing that.
13. **No validation layer.** `actionFromDict` throws on an unknown `actionType`, and
    `loadScript` catches that and `alert()`s — a partially compatible script fails entirely.
    Similarly, a missing needle image logs and yields `null` rather than failing the action.
14. **`matchTemplate` requires the needle to be no larger than the haystack**; oversized
    templates throw the generic "Vision error" path and return `null`.
15. **`main.js` path fallbacks** exist for running the packaged exe from `dist/win-unpacked`
    or `dist/`; when debugging "image not found" in a build, check `resolve-path` before
    assuming the script is wrong.

---

## Manual test loop (there is no automated suite)

1. `npm start`, confirm status bar says `Ready` (OpenCV loaded).
2. Load a script (`Load Script`) — verify the tree renders, toggles expand, images show
   thumbnails (a ❌ means path resolution/decoding failed).
3. Open `＋ Add Action`; add a click, a delay, and a group. Verify insertion happens after the
   selection, `↑`/`↓` reorder, `→` nests into the previous group/loop, `←` moves back out, and
   `✕` deletes (subtree deletes prompt). Escape/outside-click closes the palette.
4. Select actions and confirm each field group appears and edits apply to the tree labels.
   Add/edit/remove an image path and confirm the thumbnail loads (or shows ❌ for a bad path).
5. Record tab → pick a mode → `Take Screenshot` → save a needle PNG; verify the saved image is
   gray/binarized as selected.
6. `Start` (window minimizes) → verify clicks land; `Shift+Esc` stops and restores the window.
7. `Save Script` and diff the YAML to confirm the intended fields survived serialization.
8. Sushi Station: open the station in-game with **MOVE** off and the game window at its usual
   size, run `recordings/sushi_station_live_scan.yaml`, and inspect
   `detectimages/sushi/debug_scan.png` (grid boxes + pink pair lines). Then run
   `recordings/sushi_station_live_test.yaml` (one merge) and `sushi_station_live.yaml` (merges).
9. Sort mode: run `recordings/sushi_station_live_sort_scan.yaml` (no clicks) and inspect
   `detectimages/sushi/debug_sort_plan.png` — cyan tier labels and orange swap lines. If the
   tiers match the game, run `sushi_station_live_sort.yaml` to sort and cascade, or
   `sushi_station_live_cascade.yaml` to cascade the current layout without re-sorting. With
   `maxMerges: 0` the action keeps going until no pairs remain.

Always sanity-check any change to `models.js` against a real file under `recordings/` (load →
save → load) because the serializer is lossy and the YAML shape is the app's public contract.
