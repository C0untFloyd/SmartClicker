const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    minimize: () => ipcRenderer.invoke('minimize-window'),
    restore: () => ipcRenderer.invoke('restore-window'),
    getMousePos: () => ipcRenderer.invoke('get-mouse-pos'),
    moveMouse: (x, y) => ipcRenderer.invoke('move-mouse', x, y),
    mouseClick: (button, x, y, holdTime) => ipcRenderer.invoke('mouse-click', button, x, y, holdTime),
    mouseWheel: (amount) => ipcRenderer.invoke('mouse-wheel', amount),
    keypress: (key, modifier) => ipcRenderer.invoke('keypress', key, modifier),
    takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
    takeSnip: (mode) => ipcRenderer.invoke('take-snip', mode),
    loadYaml: (filePath) => ipcRenderer.invoke('load-yaml', filePath),
    saveYaml: (filePath, data) => ipcRenderer.invoke('save-yaml', filePath, data),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    resolvePath: (relativePath) => ipcRenderer.invoke('resolve-path', relativePath),
    readImage: (filePath) => ipcRenderer.invoke('read-image', filePath),
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    saveFile: (filePath, buffer) => ipcRenderer.invoke('save-file', filePath, buffer),
    onHotkeyStart: (callback) => ipcRenderer.on('hotkey-start', (event, ...args) => callback(...args)),
    onHotkeyStop: (callback) => ipcRenderer.on('hotkey-stop', (event, ...args) => callback(...args))
});

// Since we are porting a tool that needs to read/write local files (YAML scripts),
// and we might want to use Node-specific libraries in the renderer for easier porting
// (or keep them in main and use IPC), I'll expose some basic fs-like functionality if needed.
// But for now, let's keep it minimal and use renderer-side logic where possible.
