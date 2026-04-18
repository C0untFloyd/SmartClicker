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

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
