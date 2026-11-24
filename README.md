# SmartClicker

SmartClicker is an advanced, automated clicking and screen-interaction application built with Electron. It allows users to create, load, and execute custom action scripts with complex capabilities including screen capture, image recognition processing with OpenCV, and automated mouse interactions.

## Features

- **Action Sequence Scripting**: Build sequences of automated actions, load existing scripts, or save them for later use.
- **Inline Action Editor**: Add actions from a categorised palette, configure them in the details panel, reorder with `↑`/`↓`, nest into groups or loops with `→`/`←`, and delete them with `✕`.
- **Advanced Screen Capturing**: Integrated screen capture tools with multiple processing modes:
  - **Colored**: Standard screenshot capturing.
  - **Grayscale**: Process screenshots via OpenCV into grayscale for easier template matching.
  - **Black & White**: Configurable cut-off thresholds for high-contrast binary processing.
- **Mouse Automation**: Fast and precise mouse click automation via `robotjs_addon` (supports customizable hold times and toggles), including press-drag-release gestures.
- **Vision & Image Processing**: Leverages OpenCV to analyze the screen, track pixels, or assist auto-clicking tasks dynamically.
- **Sushi Station Auto-Merge**: Reads the World 7 Sushi Station board, matches identical sushi tiles and drags them together, with a scan-only calibration mode and optional cooking.
- **Global Hotkeys**: 
  - Start Script: `Shift + F1`
  - Stop Script: `Shift + Esc`

## Tech Stack

- **[Electron](https://www.electronjs.org/)**: Desktop application framework.
- **[OpenCV (opencv.js)](https://docs.opencv.org/4.x/opencv.js)**: Image processing for advanced screenshot handling.
- **[RobotJS Addon](https://github.com/octalmage/robotjs)**: Hardware-level mouse and keyboard automation.
- **[Electron Screenshots](https://www.npmjs.com/package/electron-screenshots)**: Capturing the screen and active windows cleanly.

## Installation

### Prerequisites

- Node.js (v18+ recommended)
- Depending on your OS, you might need build tools (like `windows-build-tools` or `build-essential` on Linux) to compile native C++ add-ons used by `robotjs_addon`.

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd SmartClicker
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the application:**
   ```bash
   npm start
   ```
   *(For development mode with remote debugging enabled, use `npm run dev`)*

   To launch with a script already loaded, pass its path:
   ```bash
   npm start -- --script=recordings/sushi_station_live.yaml
   ```

## Building for Production

To package the application into a standalone portable or installer executable for Windows:

```bash
npm run dist
```
The output files will be created in the `dist` directory.

## Usage

1. Launch SmartClicker.
2. Under the **Actions** tab, define your sequence of events (clicks, wait times, image checks, etc.).
   - `＋ Add Action` opens the action palette. A new action is inserted after the currently
     selected action (or appended when nothing is selected).
   - Hover a row to reveal its controls: `↑`/`↓` reorder it, `→` nests it inside the previous
     group/loop, `←` moves it back out, and `✕` deletes it.
   - Select a group or loop and use **Add Child Action** in the details panel to fill it.
   - Image paths can be added, edited, re-imported and removed directly in the details panel.
3. Under the **Record** tab, you can take test screenshots to calibrate your image detection settings (Colored, Gray, or Black & White mode).
4. Save your constructed scripts locally.
5. Hit `Shift + F1` to start execution, and `Shift + Esc` to abort execution at any time.

## Sushi Station automation

The `sushistation` action is provided by the **sushi plugin**. A script that uses it must declare
the plugin at the top level:

```yaml
plugins: [sushi]
```

The app loads `plugins/sushi/index.js` when the script is opened; without the reference,
`actionType: sushistation` is an unknown action and the script fails to load. The plugin keeps
the board analysis, tier planner, editor fields and executor together.

The action automates the Sushi Station merge board (World 7). It locates the
station using the `detectimages/sushi/station_banner.png` template, splits the board into its
12 x 8 cell grid, groups tiles whose sushi sprites match, and drags one tile onto the other to
merge them. It uses sprite similarity rather than OCR, so two copies of the same tier always
match.

Requirements and calibration:

- Keep the game **windowed at 2000 x 809 including the game's custom title bar**, fully visible
  on the **primary** monitor. Moving the window is fine (the wordmark anchor is found every
  run); hiding the title bar, going fullscreen, or resizing changes the UI scale and needs
  re-measuring.
- Turn **MOVE** off before running. MOVE drags slots instead of sushi.
- The bot does **not** cook by default (`cookEnabled: false`), so fuel is left untouched.
- Open the Sushi Station yourself, then run `recordings/sushi_station_live_scan.yaml` first. It
  clicks nothing and writes `detectimages/sushi/debug_scan.png` with the detected grid and pair
  lines. Every sushi tile should have a green box and every pair a pink line.
- Run `recordings/sushi_station_live_test.yaml` to perform exactly one merge and confirm the
  drag works.
- Run `recordings/sushi_station_live.yaml` for a full session (up to 40 merges; leaves the
  station open). Verified live runs merged 27 and 19 pairs; sort mode performed 11 verified
  swaps and then 13 merges, reaching a 1,392-hit combo.

The `sushi_station_scan.yaml`, `sushi_station_test.yaml` and `sushi_station.yaml` variants also
try to open the station first by clicking `(1825,190)`. That coordinate depends on the world
camera/window layout and was not valid in the current setup, so prefer the live variants unless
that click still opens the station.

A merge is verified by re-reading the source and destination cells: the source must become empty
and the destination must become a new tier. Three unconfirmed merges abort the action without
hammering the board. Duplicates at the current maximum tier cannot merge and count as failures.

Dragging a sushi onto a **different** sushi swaps the two tiles; dragging onto an **identical**
tier merges them. Sort mode uses this to reorder rows without empty buffer slots.

### Sorting rows into cascades

Set `sortMode: true` to make the action:
1. Classify every tile's tier against the official 64-sprite atlas
   (`detectimages/sushi/tiers_atlas.png`, an 8x8 grid of tiers 1..64) sampled at `tierRadius`.
2. Build a **wrap cascade** (`planWrapCascadeLayout`): pick a pair tier `T` that has at least three
   copies and a consecutive descending run `T-1, T-2, ...`, then lay out
   `T, T, T, T-1, T-2, ...` in row-major order, continuing across row boundaries. The merge
   consumes two copies; the third `T` is what starts the chain. Tiers must be consecutive — a
   missing tier or duplicate stops the chain. The planner scores every start cell by chain length
   versus the drags it needs, so it reuses a part of the board that is already close to the
   sequence. The initial pass sorts only when that plan beats the best pair already on the board.
3. Merge the pair (source earlier, target later). The merged tile is `T+1`, and Heat of the East
   Wind chains to the right and **wraps into the next row**, requiring each next tile to be
   **exactly one tier lower**: `4,3,2,1` chains, but `4,3,3,2,1` stops at the second `3` (and the
   pair needs a third copy of its own tier). Heat of the East Wind only applies to pair tiers up
   to **54** (`SUSHI_MAX_CASCADE_TIER`); merging 55+ still works but never cascades. After every
   merge the best sequence is rebuilt (`reSortAfterMerge`) unless the board already offers a 4+
   chain. `maxMerges: 0` keeps merging until no pairs remain.

`sortFirst: false` skips the initial layout (the merge loop still re-lays out unless
`reSortAfterMerge: false`). `sortOnly: true` sorts without merging. Hot/Cold slot bonuses are
ignored. Relevant options: `sortMode`, `sortOnly`, `sortFirst`, `reSortAfterMerge`,
`tierAtlasImage`, `tierRadius` (default 32), `sortMinGap`, `sortMaxDistance`, `sortMaxSwaps`,
`maxMerges`, `swapVerifyThreshold`.

Each move/swap is verified by re-classifying the cells to the expected tiers (so different slot
plate backgrounds don't break verification), and the action clicks the station title once to
activate the game before the first drag. A live exact-wrap run passed 19 merges in about 200
seconds with cascades of 5-12 tiles; the initial layout needed 1 drag and re-layouts 1-11 drags.
The earlier global-sort run raised the permanent multiplier to 37.07x (best 9,654, 9.22e31/hour),
and the exact-wrap reruns keep that best. If a sort move/swap cannot be confirmed (for example a
popup covers a slot), the action stops sorting that pass, re-reads the board and continues
merging instead of aborting.

Preview the plan without moving anything with
`recordings/sushi_station_live_sort_scan.yaml` (writes `detectimages/sushi/debug_sort_plan.png`
with cyan tiers and orange swap lines). Then run `recordings/sushi_station_live_sort.yaml` to
sort and cascade, or `recordings/sushi_station_live_cascade.yaml` to cascade the current layout
without re-sorting.

The tier atlas is local working data; if it is missing, recreate it from the 64 wiki
`Sushi_Station_Sushi_N.png` sprites in an 8x8 grid (tier N at index N-1).

Cooking is optional via `cookEnabled`. Once no pairs remain, the action clicks the cook/fuel
panel (default offset `1000, 245` from the banner) and keeps merging. Cooking ends the combo
meter, so it is only done after all available pairs are cleared. The cooked tier is whatever is
selected on the game's cook bar; verify the click target manually before enabling it. Set
`dryRun: true` to scan and save the debug image without dragging.


## Available Actions

| Action (`actionType`) | Parameters | Example YAML entry |
|---|---|---|
| `delay` | `duration_ms` (number), `enabled` (bool, optional) | `- actionType: delay`<br>`  duration_ms: 500` |
| `movetopos` | `x` (number), `y` (number), `speed` (string, optional), `enabled` (bool, optional) | `- actionType: movetopos`<br>`  x: 960`<br>`  y: 540`<br>`  speed: medium` |
| `mouseclick` | `button` (`left/right/middle`), `x` (number), `y` (number), `holdTime_ms` (number, optional), `enabled` (bool, optional) | `- actionType: mouseclick`<br>`  button: left`<br>`  x: 960`<br>`  y: 540`<br>`  holdTime_ms: 50` |
| `drag` | `fromX`, `fromY`, `toX`, `toY` (numbers), `duration_ms` (optional; default 350), `enabled` (bool, optional) | `- actionType: drag`<br>`  fromX: 960`<br>`  fromY: 540`<br>`  toX: 1020`<br>`  toY: 540` |
| `mousewheel` | `wheel_amount` (number), `enabled` (bool, optional) | `- actionType: mousewheel`<br>`  wheel_amount: -200` |
| `keypress` | `key` (string), `modifier` (`none/ctrl/shift/alt/cmd`, optional), `enabled` (bool, optional) | `- actionType: keypress`<br>`  key: v`<br>`  modifier: ctrl` |
| `writetext` | `text` (string), `enabled` (bool, optional) | `- actionType: writetext`<br>`  text: "Hello from SmartClicker"` |
| `waitforimage` | `imagePath` (string or string[]), `screenshotMode` (`Colored/Gray/BlackWhite`, optional), `threshold` (1-254, optional; default `128`), `tolerance` (number), `timeout_ms` (number), `enabled` (bool, optional) | `- actionType: waitforimage`<br>`  imagePath: [".assets/needle.png"]`<br>`  screenshotMode: BlackWhite`<br>`  threshold: 140`<br>`  tolerance: 0.1`<br>`  timeout_ms: 5000` |
| `clickimage` | `imagePath` (string or string[]), `screenshotMode` (`Colored/Gray/BlackWhite`, optional), `threshold` (1-254, optional; default `128`), `holdTime_ms` (number, optional), `button` (optional), `enabled` (bool, optional) | `- actionType: clickimage`<br>`  imagePath: [".assets/button.png"]`<br>`  screenshotMode: Gray`<br>`  holdTime_ms: 0` |
| `clickimagewhilefound` | `imagePath` (string or string[]), `screenshotMode` (`Colored/Gray/BlackWhite`, optional), `threshold` (1-254, optional; default `128`), `holdTime_ms` (number, optional), `button` (optional), `enabled` (bool, optional) | `- actionType: clickimagewhilefound`<br>`  imagePath: [".assets/popups/close.png"]`<br>`  screenshotMode: Colored` |
| `movetoimagecenter` | `imagePath` (string or string[]), `screenshotMode` (`Colored/Gray/BlackWhite`, optional), `threshold` (1-254, optional; default `128`), `offset_x` (number, optional), `offset_y` (number, optional), `enabled` (bool, optional) | `- actionType: movetoimagecenter`<br>`  imagePath: [".assets/target.png"]`<br>`  offset_x: 5`<br>`  offset_y: -2` |
| `numberedloop` | `iterations` (number), `delayBetweenIterations_ms` (number, optional), `childActions` (action[], optional), `enabled` (bool, optional) | `- actionType: numberedloop`<br>`  iterations: 3`<br>`  delayBetweenIterations_ms: 250`<br>`  childActions:`<br>`    - actionType: delay`<br>`      duration_ms: 100` |
| `whileconditionloop` | `conditionType` (string), `conditionValue` (usually image path/list), `screenshotMode` (`Colored/Gray/BlackWhite`, optional), `threshold` (1-254, optional; default `128`), `tolerance` (number, optional), `timeout_ms` (number, optional), `modifier` (string, optional), `childActions` (action[], optional), `enabled` (bool, optional) | `- actionType: whileconditionloop`<br>`  conditionType: imagepresent`<br>`  conditionValue: [".assets/enemy.png"]`<br>`  screenshotMode: BlackWhite`<br>`  threshold: 120`<br>`  childActions:`<br>`    - actionType: mouseclick`<br>`      button: left` |
| `group` | `groupName` (string), `childActions` (action[], optional), `enabled` (bool, optional) | `- actionType: group`<br>`  groupName: "Deposit Flow"`<br>`  childActions:`<br>`    - actionType: writetext`<br>`      text: "42"` |
| `sushistation` | `bannerImage`, `maximizeImage`, `dryRun`, `maxMerges`, `matchThreshold`, `bannerConfidence`, `maxFailures`, `dragDuration_ms`, `settle_ms`, `cookEnabled`, `maxCooks`, `cookOffsetX/Y`, `cookDelay_ms`, `debugImagePath`, `sortMode`, `sortOnly`, `sortFirst`, `reSortAfterMerge`, `tierAtlasImage`, `tierRadius`, `sortMinGap`, `sortMaxDistance`, `sortMaxSwaps`, `swapVerifyThreshold`, plus board geometry (`columns`, `rows`, `bannerOffsetX/Y`, `cellSpacingX/Y`, `cellRadius`) | `- actionType: sushistation`<br>`  sortMode: true`<br>`  maxMerges: 0` |

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
