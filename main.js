const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, dialog, screen, nativeImage } = require('electron');

const path = require('path');
const robot = require("robotjs_addon");

const fs = require('fs');
const yaml = require('js-yaml');
const Screenshots = require('electron-screenshots');

// Root path for external assets (clickimages, csv files)
const rootPath = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false
        },
        title: "SmartClicker JS"
    });

    mainWindow.loadFile('index.html');

    globalShortcut.register('Shift+F1', () => {
        mainWindow.webContents.send('hotkey-start');
    });

    globalShortcut.register('Shift+Escape', () => {
        mainWindow.webContents.send('hotkey-stop');
    });
}

app.whenReady().then(() => {
    createWindow();

    global.screenshots = new Screenshots();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// IPC handlers for automation
ipcMain.handle('minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.handle('restore-window', () => {
    mainWindow.restore();
    mainWindow.focus();
});

ipcMain.handle('get-mouse-pos', async () => {
    const pos = robot.getMousePos();
    return { x: pos.x, y: pos.y };
});

ipcMain.handle('move-mouse', async (event, x, y) => {
    robot.moveMouse(Math.round(x), Math.round(y));
});

ipcMain.handle('mouse-click', async (event, button, x, y, holdTime) => {
    try {
        if (x !== undefined && x !== null && y !== undefined && y !== null) {
            if (isNaN(x) || isNaN(y)) {
                console.error(`Invalid coordinates for mouse-click: x=${x}, y=${y}`);
                return; // Prevent crash
            }
            else if (x > 0 && y > 0) {
                robot.moveMouse(Math.round(x), Math.round(y));
            }
        }
        const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
        const hTime = Math.round(holdTime || 0);

        if (hTime > 0) {
            robot.mouseToggle(true, btn);
            await new Promise(resolve => setTimeout(resolve, hTime));
            robot.mouseToggle(false, btn);
        } else {
            robot.mouseClick(btn);
        }
    } catch (err) {
        console.error("Error in mouse-click handler:", err);
    }
});

ipcMain.handle('mouse-wheel', async (event, amount) => {
    // robotjs scrollMouse(x, y) where y is vertical
    robot.scrollMouse(0, Math.round(amount));
});

ipcMain.handle('keypress', async (event, key, modifier) => {
    // Robotjs keyTap(key, [modifier])
    if (modifier) {
        robot.keyTap(key, modifier);
    } else {
        robot.keyTap(key);
    }
});

ipcMain.handle('write-text', async (event, text) => {
    robot.typeString(String(text ?? ""));
});


ipcMain.handle('read-image', async (event, filePath) => {
    // 1. Load the image from disk using Electron's native decoder
    const image = nativeImage.createFromPath(filePath);

    if (image.isEmpty()) {
        throw new Error(`Image at ${filePath} could not be loaded.`);
    }

    // 2. Get the raw size and pixels
    const size = image.getSize();

    // 3. Return raw buffer (BGRA format)
    return {
        width: size.width,
        height: size.height,
        data: image.toBitmap()
    };
});


ipcMain.handle('take-screenshot', async () => {
    // 1. Get the primary display size to ensure we capture the full resolution
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const { scaleFactor } = primaryDisplay;

    // 2. Capture the screen
    // We set thumbnailSize to the full screen dimensions. 
    // If we don't, Electron defaults to a small icon size.
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
            width: width * scaleFactor,
            height: height * scaleFactor
        }
    });

    // 3. Select the primary screen (usually the first one)
    // In a multi-monitor setup, you might need to filter by display_id
    const screenSource = sources[0];

    if (!screenSource) {
        throw new Error('No screen source found');
    }

    // 4. Get the NativeImage
    const image = screenSource.thumbnail;

    // 5. Return Raw Data (Fastest)
    // Instead of PNG (compressed), we send the raw pixel buffer (BGRA).
    // This matches the optimized renderer code from the previous step.
    return {
        width: image.getSize().width,
        height: image.getSize().height,
        data: image.toBitmap() // Returns a Buffer of raw pixels
    };
});

ipcMain.handle('take-snip', async (event, mode) => {
    return new Promise((resolve, reject) => {
        if (!global.screenshots) {
            reject(new Error("Screenshots not initialized"));
            return;
        }
        
        global.screenshots.startCapture();
        
        // Listeners
        const onOk = (e, buffer, bounds) => {
            cleanup();
            resolve({ success: true, mode, buffer });
        };
        
        const onCancel = () => {
            cleanup();
            resolve({ success: false });
        };
        
        const cleanup = () => {
            global.screenshots.removeListener('ok', onOk);
            global.screenshots.removeListener('cancel', onCancel);
        };
        
        global.screenshots.once('ok', onOk);
        global.screenshots.once('cancel', onCancel);
    });
});



ipcMain.handle('load-yaml', async (event, filePath) => {
    const fileContents = fs.readFileSync(filePath, 'utf8');
    return yaml.load(fileContents);
});

ipcMain.handle('save-yaml', async (event, filePath, data) => {
    const yamlStr = yaml.dump(data);
    fs.writeFileSync(filePath, yamlStr, 'utf8');
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    return await dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('show-save-dialog', async (event, options) => {
    return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('resolve-path', (event, relativePath) => {
    if (path.isAbsolute(relativePath)) return relativePath;

    let targetPath = path.resolve(rootPath, relativePath);
    if (!fs.existsSync(targetPath) && app.isPackaged) {
        // Fallback for development/testing where the exe is in dist/win-unpacked or dist/
        const fallback1 = path.resolve(rootPath, '..', relativePath);
        const fallback2 = path.resolve(rootPath, '..', '..', relativePath);
        if (fs.existsSync(fallback1)) return fallback1;
        if (fs.existsSync(fallback2)) return fallback2;
    }
    return targetPath;
});

ipcMain.handle('read-image2', async (event, filePath) => {
    // Return the image as a buffer
    return fs.readFileSync(filePath);
});

ipcMain.handle('get-app-path', () => app.getAppPath());

ipcMain.handle('save-file', async (event, filePath, buffer) => {
    fs.writeFileSync(filePath, Buffer.from(buffer));
});

