# SmartClicker

SmartClicker is an advanced, automated clicking and screen-interaction application built with Electron. It allows users to create, load, and execute custom action scripts with complex capabilities including screen capture, image recognition processing with OpenCV, and automated mouse interactions.

## Features

- **Action Sequence Scripting**: Build sequences of automated actions, load existing scripts, or save them for later use.
- **Advanced Screen Capturing**: Integrated screen capture tools with multiple processing modes:
  - **Colored**: Standard screenshot capturing.
  - **Grayscale**: Process screenshots via OpenCV into grayscale for easier template matching.
  - **Black & White**: Configurable cut-off thresholds for high-contrast binary processing.
- **Mouse Automation**: Fast and precise mouse click automation via `robotjs_addon` (supports customizable hold times and toggles).
- **Vision & Image Processing**: Leverages OpenCV to analyze the screen, track pixels, or assist auto-clicking tasks dynamically.
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

## Building for Production

To package the application into a standalone portable or installer executable for Windows:

```bash
npm run dist
```
The output files will be created in the `dist` directory.

## Usage

1. Launch SmartClicker.
2. Under the **Actions** tab, define your sequence of events (clicks, wait times, image checks, etc.).
3. Under the **Record** tab, you can take test screenshots to calibrate your image detection settings (Colored, Gray, or Black & White mode).
4. Save your constructed scripts locally.
5. Hit `Shift + F1` to start execution, and `Shift + Esc` to abort execution at any time.

## Available Actions

| Action (`actionType`) | Parameters | Example YAML entry |
|---|---|---|
| `delay` | `duration_ms` (number), `enabled` (bool, optional) | `- actionType: delay`<br>`  duration_ms: 500` |
| `movetopos` | `x` (number), `y` (number), `speed` (string, optional), `enabled` (bool, optional) | `- actionType: movetopos`<br>`  x: 960`<br>`  y: 540`<br>`  speed: medium` |
| `mouseclick` | `button` (`left/right/middle`), `x` (number), `y` (number), `holdTime_ms` (number, optional), `enabled` (bool, optional) | `- actionType: mouseclick`<br>`  button: left`<br>`  x: 960`<br>`  y: 540`<br>`  holdTime_ms: 50` |
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

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
