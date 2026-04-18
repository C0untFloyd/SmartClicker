import {
    AutomationScript, ActionType, ScreenshotMode, actionFromDict, LoopType
} from './models.js';

let currentScript = new AutomationScript();
let isRunning = false;
let stopRequested = false;
let selectedAction = null;
let bufferedImages = new Map();
let expandedActions = new Set(); // Track which actions are expanded
let executionPromise = null; // Track the running execution promise

// UI Elements
const actionTree = document.getElementById('action-tree');
const detailContent = document.getElementById('detail-content');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnLoad = document.getElementById('btn-load');
const btnSave = document.getElementById('btn-save');
const mousePosEl = document.getElementById('mouse-pos');
const statusMessageEl = document.getElementById('status-message');
const scriptNameEl = document.getElementById('script-name');
const scriptDescEl = document.getElementById('script-description');

// Nav & Workspaces
const navActions = document.getElementById('nav-actions');
const navRecord = document.getElementById('nav-record');
const navSettings = document.getElementById('nav-settings');
const actionsWorkspace = document.getElementById('actions-workspace');
const recordWorkspace = document.getElementById('record-workspace');

// Record Tools
const btnTakeScreenshot = document.getElementById('btn-take-screenshot');
const recordScreenshotMode = document.getElementById('record-screenshot-mode');

// Initialize
async function init() {
    updateStatus("Waiting for OpenCV.js...");
    if (typeof cv !== 'undefined') {
        onOpenCvReady();
    } else {
        window.onOpenCvReady = onOpenCvReady;
    }

    // Mouse position tracker
    setInterval(async () => {
        if (!isRunning) {
            const pos = await window.electronAPI.getMousePos();
            mousePosEl.textContent = `Position: (${pos.x}, ${pos.y})`;
        }
    }, 100);

    btnStart.addEventListener('click', startProcess);
    btnStop.addEventListener('click', stopProcess);
    btnLoad.addEventListener('click', loadScript);
    btnSave.addEventListener('click', saveScript);

    // Nav Event Listeners
    if (navActions) {
        navActions.addEventListener('click', () => {
            navActions.classList.add('active');
            if (navRecord) navRecord.classList.remove('active');
            if (navSettings) navSettings.classList.remove('active');
            if (actionsWorkspace) actionsWorkspace.style.display = 'flex';
            if (recordWorkspace) recordWorkspace.style.display = 'none';
        });
    }

    if (navRecord) {
        navRecord.addEventListener('click', () => {
            navRecord.classList.add('active');
            if (navActions) navActions.classList.remove('active');
            if (navSettings) navSettings.classList.remove('active');
            if (actionsWorkspace) actionsWorkspace.style.display = 'none';
            if (recordWorkspace) recordWorkspace.style.display = 'flex';
        });
    }

    // Record Event Listeners
    if (btnTakeScreenshot) {
        btnTakeScreenshot.addEventListener('click', async () => {
            const mode = recordScreenshotMode ? recordScreenshotMode.value : 'Colored';
            try {
                // Hide main window so snip tool has clear screen
                window.electronAPI.minimize();
                await new Promise(r => setTimeout(r, 200));

                // Call the main process to open the snip tool
                const result = await window.electronAPI.takeSnip(mode);
                
                window.electronAPI.restore();

                if (result && result.success && result.buffer) {
                    // Create a blob from the UInt8Array
                    const blob = new Blob([result.buffer], { type: 'image/png' });
                    const img = await createImageBitmap(blob);
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    let mat = cv.imread(canvas);

                    // Apply the selected mode processing
                    if (mode === ScreenshotMode.Gray) {
                        const gray = new cv.Mat();
                        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY); // canvas is RGBA
                        mat.delete();
                        mat = gray;
                    } else if (mode === ScreenshotMode.BlackWhite) {
                        const gray = new cv.Mat();
                        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
                        const bw = new cv.Mat();
                        cv.threshold(gray, bw, 127, 255, cv.THRESH_BINARY);
                        mat.delete();
                        gray.delete();
                        mat = bw;
                    }

                    const saveResult = await window.electronAPI.showSaveDialog({
                        title: 'Save Screenshot',
                        filters: [{ name: 'Images', extensions: ['png'] }],
                        defaultPath: `screenshot.png`
                    });
                    
                    if (!saveResult.canceled && saveResult.filePath) {
                        const outCanvas = document.createElement('canvas');
                        cv.imshow(outCanvas, mat);
                        const outBlob = await new Promise(resolve => outCanvas.toBlob(resolve, 'image/png'));
                        const outBuffer = await outBlob.arrayBuffer();
                        await window.electronAPI.saveFile(saveResult.filePath, outBuffer);
                        console.log(`Saved screenshot to ${saveResult.filePath}`);
                    }

                    mat.delete();
                }
            } catch(err) {
                console.error("Screenshot error:", err);
                window.electronAPI.restore();
            }
        });
    }

    window.electronAPI.onHotkeyStart(() => startProcess());
    window.electronAPI.onHotkeyStop(() => stopProcess());

    renderActionTree();
}

function onOpenCvReady() {
    updateStatus("Ready");
}

function updateStatus(msg) {
    statusMessageEl.textContent = msg;
}

// UI Rendering
function renderActionTree() {
    actionTree.innerHTML = '';
    currentScript.actions.forEach((action, index) => {
        const item = createTreeItem(action, index);
        actionTree.appendChild(item);
    });

    scriptNameEl.textContent = currentScript.scriptName || "New Script";
    scriptDescEl.textContent = currentScript.description || "No description provided.";
}

function createTreeItem(action, index, parentList = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-item-wrapper';

    const div = document.createElement('div');
    div.className = `treeview-item ${!action.enabled ? 'disabled' : ''} ${selectedAction === action ? 'selected' : ''}`;

    const hasChildren = action.childActions && action.childActions.length > 0;

    // Formatting label similar to Python version
    let label = formatActionLabel(action);

    let toggleBtn = '';
    if (hasChildren) {
        toggleBtn = `<span class="tree-toggle">▶</span>`;
    } else {
        toggleBtn = `<span class="tree-toggle" style="visibility: hidden;">▶</span>`;
    }

    div.innerHTML = `
        ${toggleBtn}
        <span class="action-icon">${getActionIcon(action.actionType)}</span>
        <span class="action-label">${label}</span>
    `;

    div.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAction(action);
    });

    wrapper.appendChild(div);

    if (hasChildren) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        childrenContainer.style.paddingLeft = '20px';

        // Check if this action was previously expanded
        const isExpanded = expandedActions.has(action);
        childrenContainer.style.display = isExpanded ? 'block' : 'none';

        action.childActions.forEach((child, cIdx) => {
            childrenContainer.appendChild(createTreeItem(child, cIdx, action.childActions));
        });

        wrapper.appendChild(childrenContainer);

        const toggleEl = div.querySelector('.tree-toggle');
        // Set initial toggle state
        if (isExpanded) {
            toggleEl.textContent = '▼';
            toggleEl.classList.remove('collapsed');
        }

        toggleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = childrenContainer.style.display === 'none';
            if (isHidden) {
                childrenContainer.style.display = 'block';
                toggleEl.textContent = '▼';
                toggleEl.classList.remove('collapsed');
                expandedActions.add(action); // Track expanded state
            } else {
                childrenContainer.style.display = 'none';
                toggleEl.textContent = '▶';
                toggleEl.classList.add('collapsed');
                expandedActions.delete(action); // Remove from expanded set
            }
        });
    }

    return wrapper;
}

function formatActionLabel(action) {
    switch (action.actionType) {
        case ActionType.DELAY: return `Delay: ${action.duration_ms} ms`;
        case ActionType.MOVE_TO_POS: return `Move To: (${action.x}, ${action.y}) @ ${action.speed}`;
        case ActionType.MOUSE_CLICK: return `Click: ${action.button} @ (${action.x}, ${action.y})`;
        case ActionType.MOUSE_WHEEL: return `Scroll: ${action.wheel_amount}`;
        case ActionType.KEYPRESS: return `Keypress: ${action.key} ${action.modifier !== 'none' ? '+ ' + action.modifier : ''}`;
        case ActionType.WAIT_FOR_IMAGE: return `Wait Image: ${action.imagePath[0] || '...'}`;
        case ActionType.CLICKIMAGE: return `Click Image: ${action.imagePath[0] || '...'}`;
        case ActionType.GROUP: return `Group: ${action.groupName}`;
        case ActionType.NUMBERED_LOOP: return `Loop for ${action.iterations} times`;
        case ActionType.WHILE_CONDITION_LOOP: return `Loop while ${action.conditionType} ${action.conditionValue}`;
        default: return action.actionType;
    }
}

function getActionIcon(type) {
    const icons = {
        [ActionType.DELAY]: '⏱️',
        [ActionType.MOVE_TO_POS]: '🖱️',
        [ActionType.MOUSE_CLICK]: '👆',
        [ActionType.MOUSE_WHEEL]: '🖱️',
        [ActionType.KEYPRESS]: '⌨️',
        [ActionType.WAIT_FOR_IMAGE]: '🔍',
        [ActionType.CLICKIMAGE]: '🎯',
        [ActionType.GROUP]: '📁',
        [ActionType.NUMBERED_LOOP]: '🔄',
        [ActionType.WHILE_CONDITION_LOOP]: '🔄'
    };
    return icons[type] || '❓';
}

function selectAction(action) {
    selectedAction = action;
    // Re-render tree to update selection highlighting, but preserve expanded state
    renderActionTree();
    renderDetailPanel(action);
}

function renderDetailPanel(action) {
    detailContent.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'action-form';

    // Type (Read-only)
    addFormField(form, 'Action Type', action.actionType, 'text', true);

    // Generic attributes
    addFormField(form, 'Enabled', action.enabled, 'checkbox', false, (v) => {
        action.enabled = v;
        renderActionTree();
    });

    if (action.actionType === ActionType.DELAY) {
        addFormField(form, 'Duration (ms)', action.duration_ms, 'number', false, (v) => action.duration_ms = parseInt(v));
    } else if (action.actionType === ActionType.MOVE_TO_POS || action.actionType === ActionType.MOUSE_CLICK) {
        addFormField(form, 'X', action.x, 'number', false, (v) => action.x = parseInt(v));
        addFormField(form, 'Y', action.y, 'number', false, (v) => action.y = parseInt(v));
        if (action.actionType === ActionType.MOUSE_CLICK) {
            addFormField(form, 'Button', action.button, 'select', false, (v) => action.button = v, ['left', 'right', 'middle']);
            addFormField(form, 'Hold Time (ms)', action.holdTime_ms, 'number', false, (v) => action.holdTime_ms = parseInt(v));
        }
    } else if (action.actionType === ActionType.KEYPRESS) {
        addFormField(form, 'Key', action.key, 'text', false, (v) => action.key = v);
        addFormField(form, 'Modifier', action.modifier, 'select', false, (v) => action.modifier = v, ['none', 'ctrl', 'shift', 'alt', 'cmd']);
    } else if (action.actionType === ActionType.NUMBERED_LOOP) {
        addFormField(form, 'Iterations', action.iterations, 'number', false, (v) => action.iterations = parseInt(v));
    } else if (action.imagePath !== undefined) {
        addImagePathTable(form, 'Image Paths', action.imagePath, (v) => action.imagePath = v);
    }
    if (action.screenshotMode !== undefined) {
        addFormField(form, 'Screenshot Mode', action.screenshotMode, 'select', false, (v) => action.screenshotMode = v, Object.values(ScreenshotMode));
    }

    detailContent.appendChild(form);
}

function addFormField(container, labelText, value, type, readonly = false, onChange = null, options = []) {
    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.textContent = labelText;
    group.appendChild(label);

    let input;
    if (type === 'select') {
        input = document.createElement('select');
        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (opt === value) o.selected = true;
            input.appendChild(o);
        });
    } else if (type === 'textarea') {
        input = document.createElement('textarea');
        input.value = value;
        input.rows = 3;
    } else if (type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = value;
    } else {
        input = document.createElement('input');
        input.type = type;
        input.value = value;
    }

    if (readonly) input.disabled = true;
    if (onChange) {
        input.addEventListener('change', (e) => {
            const val = type === 'checkbox' ? e.target.checked : e.target.value;
            onChange(val);
        });
    }

    group.appendChild(input);
    container.appendChild(group);
}

async function addImagePathTable(container, labelText, imagePaths, onChange) {
    const group = document.createElement('div');
    group.className = 'form-group';

    const label = document.createElement('label');
    label.textContent = labelText;
    group.appendChild(label);

    // Create table
    const table = document.createElement('table');
    table.className = 'image-path-table';

    // Create table header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const pathHeader = document.createElement('th');
    pathHeader.textContent = 'Image Path';
    const thumbnailHeader = document.createElement('th');
    thumbnailHeader.textContent = 'Thumbnail';
    thumbnailHeader.style.width = '80px';
    headerRow.appendChild(pathHeader);
    headerRow.appendChild(thumbnailHeader);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');

    for (const imagePath of imagePaths) {
        if (!imagePath.trim()) continue;

        const row = document.createElement('tr');

        // Path cell
        const pathCell = document.createElement('td');
        pathCell.textContent = imagePath;
        pathCell.className = 'image-path-cell';
        row.appendChild(pathCell);

        // Thumbnail cell
        const thumbnailCell = document.createElement('td');
        thumbnailCell.className = 'image-thumbnail-cell';

        try {
            // Resolve the relative path to absolute path
            const absPath = await window.electronAPI.resolvePath(imagePath);

            // Read the raw BGRA bitmap data
            const { width, height, data } = await window.electronAPI.readImage(absPath);

            // Create a canvas to convert BGRA to displayable image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Create ImageData from the raw BGRA buffer
            const imageData = ctx.createImageData(width, height);
            const uint8Array = new Uint8Array(data);

            // Copy BGRA data to ImageData (which expects RGBA)
            // Note: Electron's toBitmap() returns BGRA, but canvas expects RGBA
            for (let i = 0; i < uint8Array.length; i += 4) {
                imageData.data[i] = uint8Array[i + 2];     // R
                imageData.data[i + 1] = uint8Array[i + 1]; // G
                imageData.data[i + 2] = uint8Array[i];     // B
                imageData.data[i + 3] = uint8Array[i + 3]; // A
            }

            ctx.putImageData(imageData, 0, 0);

            // Create thumbnail image element
            const img = document.createElement('img');
            img.src = canvas.toDataURL();
            img.className = 'image-thumbnail';
            img.width = 64;
            img.height = 64;
            img.style.objectFit = 'contain';
            thumbnailCell.appendChild(img);
        } catch (err) {
            console.error(`Failed to load thumbnail for ${imagePath}:`, err);
            thumbnailCell.textContent = '❌';
            thumbnailCell.style.textAlign = 'center';
        }

        row.appendChild(thumbnailCell);
        tbody.appendChild(row);
    }

    table.appendChild(tbody);
    group.appendChild(table);
    container.appendChild(group);
}

// Script Management
async function loadScript() {
    try {
        const result = await window.electronAPI.showOpenDialog({
            title: 'Load Automation Script',
            filters: [{ name: 'YAML Scripts', extensions: ['yaml', 'yml'] }],
            properties: ['openFile']
        });

        if (result.canceled || result.filePaths.length === 0) return;

        const path = result.filePaths[0];
        const data = await window.electronAPI.loadYaml(path);
        currentScript = new AutomationScript(data);
        renderActionTree();
        updateStatus(`Loaded ${currentScript.scriptName}`);
    } catch (err) {
        alert("Failed to load: " + err);
    }
}

async function saveScript() {
    try {
        const result = await window.electronAPI.showSaveDialog({
            title: 'Save Automation Script',
            filters: [{ name: 'YAML Scripts', extensions: ['yaml', 'yml'] }],
            defaultPath: currentScript.scriptName ? `${currentScript.scriptName}.yaml` : 'script.yaml'
        });

        if (result.canceled || !result.filePath) return;

        const path = result.filePath;
        await window.electronAPI.saveYaml(path, currentScript.toDict());
        updateStatus(`Saved to ${path}`);
    } catch (err) {
        alert("Failed to save: " + err);
    }
}

// Execution Engine
async function startProcess() {
    if (isRunning) return;
    isRunning = true;
    stopRequested = false;
    btnStart.disabled = true;
    btnStop.disabled = false;
    updateStatus("Running...");

    window.electronAPI.minimize();

    // Create and track the execution promise
    executionPromise = (async () => {
        try {
            let iterations = 0;
            while (true) {
                for (const action of currentScript.actions) {
                    if (stopRequested) break;
                    await executeAction(action);
                }
                iterations++;

                if (currentScript.loopSpecification.type === LoopType.FIXED_ITERATIONS) {
                    if (currentScript.loopSpecification.iterations > 0 && iterations >= currentScript.loopSpecification.iterations) {
                        break;
                    }
                    const delay = currentScript.loopSpecification.delayBetweenIterations_ms;
                    if (delay > 0) await new Promise(r => setTimeout(r, delay));
                } else if (currentScript.loopSpecification.type === LoopType.INFINITE) {
                    // Keep going
                } else {
                    break;
                }
                if (stopRequested) break;
            }
        } catch (err) {
            console.error(err);
            alert("Error during execution: " + err.message);
        } finally {
            // Clean up execution state
            isRunning = false;
            stopRequested = false;
            btnStart.disabled = false;
            btnStop.disabled = true;
            window.electronAPI.restore();
            updateStatus("Stopped");
            executionPromise = null;
        }
    })();
}

async function stopProcess() {
    if (!isRunning) return;

    // Signal the execution to stop
    stopRequested = true;

    // Wait for the execution promise to complete
    if (executionPromise) {
        await executionPromise;
    }
}

async function executeAction(action) {
    if (!action.enabled || stopRequested) return;

    switch (action.actionType) {
        case ActionType.DELAY:
            await new Promise(r => setTimeout(r, action.duration_ms));
            break;
        case ActionType.MOVE_TO_POS:
            await window.electronAPI.moveMouse(action.x, action.y);
            break;
        case ActionType.MOUSE_CLICK:
            await window.electronAPI.mouseClick(action.button, action.x, action.y, action.holdTime_ms);
            break;
        case ActionType.MOUSE_WHEEL:
            await window.electronAPI.mouseWheel(action.wheel_amount);
            break;
        case ActionType.KEYPRESS:
            await window.electronAPI.keypress(action.key, action.modifier);
            break;
        case ActionType.CLICKIMAGE:
            await clickImage(action);
            break;
        case ActionType.CLICKIMAGE_WHILE_FOUND:
            await clickAnyImageWhileFound(action);
            break;

        case ActionType.WAIT_FOR_IMAGE:
            await waitForImage(action);
            break;
        case ActionType.MOVE_TO_IMAGE_CENTER:
            await moveToImageCenter(action);
            break;
        case ActionType.GROUP:
            if (action.childActions) {
                for (const child of action.childActions) {
                    await executeAction(child);
                }
            }
            break;
        case ActionType.NUMBERED_LOOP:
            await executeNumberedLoop(action);
            break;
        case ActionType.WHILE_CONDITION_LOOP:
            await executeWhileConditionLoop(action);
            break;

        default:
            console.warn(`Unknown action type: ${action.actionType}`);
            break;
    }
}

async function executeNumberedLoop(action) {
    for (let i = 0; i < action.iterations; i++) {
        if (stopRequested) return;

        console.log(`Numbered loop iteration ${i + 1}/${action.iterations}`);

        // Execute child actions
        if (action.childActions) {
            for (const child of action.childActions) {
                if (stopRequested) return;
                await executeAction(child);
            }
        }

        // Delay between iterations (except for the last one)
        if (i < action.iterations - 1 && action.delayBetweenIterations_ms > 0) {
            await new Promise(r => setTimeout(r, action.delayBetweenIterations_ms));
        }
    }
}

async function executeWhileConditionLoop(action) {
    let iteration = 0;
    while (true) {
        if (stopRequested) return;

        iteration++;
        console.log(`While condition loop iteration ${iteration}`);

        // Check condition
        let conditionMet = false;
        if (action.conditionType === "imagepresent") {
            const pos = await findImageOnScreen(action.conditionValue, 0.8, action.screenshotMode);
            conditionMet = !!pos;
        }

        if (!conditionMet) {
            console.log(`Condition not met, exiting while loop after ${iteration - 1} iterations`);
            return;
        }

        // Execute child actions
        if (action.childActions) {
            for (const child of action.childActions) {
                if (stopRequested) return;
                await executeAction(child);
            }
        }

        // Brief delay to prevent CPU spinning
        await new Promise(r => setTimeout(r, 100));
    }
}


async function takeScreenshotAsMat(mode = ScreenshotMode.Colored, threshold = 128) {
    // 1. Receive raw pixel data (BGRA) directly
    const { width, height, data } = await window.electronAPI.takeScreenshot();

    // 2. Create a Mat with the correct dimensions and type (8-bit, 4 channels)
    const mat = new cv.Mat(height, width, cv.CV_8UC4);

    // 3. Direct memory copy: Copy the raw buffer into the Mat's heap
    mat.data.set(new Uint8Array(data));

    // 4. Post-process based on the requested mode
    if (mode === ScreenshotMode.Gray) {
        // Convert to single-channel grayscale
        const gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_BGRA2GRAY);
        mat.delete();

        // Convert back to BGRA format to match Colored mode
        const grayBgra = new cv.Mat();
        cv.cvtColor(gray, grayBgra, cv.COLOR_GRAY2BGRA);
        gray.delete();
        return grayBgra;
    } else if (mode === ScreenshotMode.BlackWhite) {
        // Convert to grayscale, then apply a hard cut-off threshold:
        // pixels with intensity strictly below `threshold` -> 0 (black)
        // pixels with intensity >= `threshold`             -> 255 (white)
        const gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_BGRA2GRAY);
        mat.delete();
        const bw = new cv.Mat();
        cv.threshold(gray, bw, threshold - 1, 255, cv.THRESH_BINARY);
        gray.delete();

        // Convert back to BGRA format to match Colored mode
        const bwBgra = new cv.Mat();
        cv.cvtColor(bw, bwBgra, cv.COLOR_GRAY2BGRA);
        bw.delete();
        return bwBgra;
    }

    // Default: return the original colored (BGRA) Mat
    //await saveMatAsDebugImage(mat, 'debug_screenshot_colored.png');
    return mat;
}

/**
 * Encodes a cv.Mat as PNG and writes it next to the app executable for debugging.
 * @param {cv.Mat} mat   - The OpenCV Mat to save (any channel count supported by cv.imshow).
 * @param {string} filename - Filename without path (e.g. 'debug_bw.png').
 */
async function saveMatAsDebugImage(mat, filename = 'debug_screenshot.png') {
    try {
        const canvas = document.createElement('canvas');
        cv.imshow(canvas, mat);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const buffer = await blob.arrayBuffer();
        const appPath = await window.electronAPI.getAppPath();
        const filePath = `${appPath}/${filename}`;
        await window.electronAPI.saveFile(filePath, buffer);
        console.log(`[Debug] Saved screenshot to: ${filePath}`);
    } catch (err) {
        console.error('[Debug] Failed to save debug image:', err);
    }
}


async function loadImageAsMat2(relPath) {
    if (bufferedImages.has(relPath)) return bufferedImages.get(relPath);

    try {
        const absPath = await window.electronAPI.resolvePath(relPath);
        const buffer = await window.electronAPI.readImage(absPath);

        const blob = new Blob([buffer], { type: 'image/png' });
        const img = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const mat = cv.imread(canvas);
        bufferedImages.set(relPath, mat);
        return mat;
    } catch (err) {
        console.error(`Failed to load image at ${relPath}:`, err);
        return null;
    }
}

async function loadImageAsMat(relPath) {
    if (bufferedImages.has(relPath)) return bufferedImages.get(relPath);

    try {
        const absPath = await window.electronAPI.resolvePath(relPath);

        // 1. Get raw pixels (BGRA) instead of a file buffer
        const { width, height, data } = await window.electronAPI.readImage(absPath);

        // 2. Create Mat with correct size and type (8-bit, 4 channel)
        const mat = new cv.Mat(height, width, cv.CV_8UC4);

        // 3. Direct memory copy
        mat.data.set(new Uint8Array(data));

        // Optional: Convert BGRA to RGBA if colors look wrong
        // cv.cvtColor(mat, mat, cv.COLOR_BGRA2RGBA);

        bufferedImages.set(relPath, mat);
        return mat;

    } catch (err) {
        console.error(`Failed to load image at ${relPath}:`, err);
        return null;
    }
}

async function findImageOnScreen(imagePaths, confidence = 0.8, mode = ScreenshotMode.Colored) {
    const haystack = await takeScreenshotAsMat(mode);
    try {
        for (const relPath of imagePaths) {
            const needle = await loadImageAsMat(relPath);
            if (!needle) continue;

            let dst = new cv.Mat();
            let mask = new cv.Mat();
            try {
                cv.matchTemplate(haystack, needle, dst, cv.TM_CCOEFF_NORMED, mask);
                let result = cv.minMaxLoc(dst, mask);
                if (result.maxVal >= confidence) {
                    const centerX = result.maxLoc.x + needle.cols / 2;
                    const centerY = result.maxLoc.y + needle.rows / 2;
                    return { x: centerX, y: centerY };
                }
            } finally {
                dst.delete();
                mask.delete();
            }
        }
    } catch (err) {
        console.error("Vision error:", String(err));
    } finally {
        if (haystack) haystack.delete();
    }
    return null;
}



async function clickImage(action) {
    const pos = await findImageOnScreen(action.imagePath, 0.8, action.screenshotMode);
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && !isNaN(pos.x) && !isNaN(pos.y)) {
        await window.electronAPI.mouseClick(action.button || 'left', pos.x, pos.y, action.holdTime_ms);
    } else {
        console.warn("Skipping clickImage: Invalid position found", pos);
    }
}




async function clickAnyImageWhileFound(action) {
    let inum = 1;
    while (inum > 0 && !stopRequested) {
        inum = 0;
        for await (const pos of findAnyImageOnScreen(action.imagePath, 0.7, action.screenshotMode)) {
            inum += 1;
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && !isNaN(pos.x) && !isNaN(pos.y)) {
                await window.electronAPI.mouseClick(action.button || 'left', pos.x, pos.y, action.holdTime_ms);
            } else {
                console.warn("Skipping clickAnyImageWhileFound: Invalid position found", pos);
            }
        }
    }
}

async function moveToImageCenter(action) {
    const pos = await findImageOnScreen(action.imagePath, 0.8, action.screenshotMode);
    if (pos) {
        await window.electronAPI.moveMouse(pos.x + (action.offset_x || 0), pos.y + (action.offset_y || 0));
    }
}

async function waitForImage(action) {
    const start = Date.now();
    while (true) {
        if (stopRequested) return;
        const pos = await findImageOnScreen(action.imagePath, 1.0 - action.tolerance, action.screenshotMode);
        if (pos) return pos;
        if (action.timeout_ms > 0 && (Date.now() - start) > action.timeout_ms) {
            throw new Error("Timeout waiting for image");
        }
        await new Promise(r => setTimeout(r, 200));
    }
}


async function* findAnyImageOnScreen(imagePaths, confidence = 0.7, mode = ScreenshotMode.Colored) {
    const haystack = await takeScreenshotAsMat(mode);
    try {
        const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
        for (const relPath of paths) {
            const needle = await loadImageAsMat(relPath);
            if (!needle) continue;

            try {
                const rects = locateImageCenterMulti(needle, haystack, confidence);
                for (const [x1, y1, x2, y2] of rects) {
                    yield { x: x1 + (x2 - x1) / 2, y: y1 + (y2 - y1) / 2 };
                }
            } catch (err) {
                console.error(`Error finding patterns for ${relPath}:`, err);
            }
        }
    } finally {
        if (haystack) haystack.delete();
    }
}


function locateImageCenterMulti(imageToMatch, haystackImage, confidence = 0.999) {
    confidence = parseFloat(confidence);
    let result = new cv.Mat();
    cv.matchTemplate(haystackImage, imageToMatch, result, cv.TM_CCOEFF_NORMED);

    let rects = [];
    let tW = imageToMatch.cols;
    let tH = imageToMatch.rows;

    let data = result.data32F;
    for (let y = 0; y < result.rows; y++) {
        for (let x = 0; x < result.cols; x++) {
            let val = data[y * result.cols + x];
            if (val >= confidence) {
                rects.push([x, y, x + tW, y + tH]);
            }
        }
    }
    result.delete();

    if (rects.length < 1) return [];

    // apply non-maxima suppression to the rectangles
    return nonMaxSuppressionFast(rects, 0.5);
}

// Malisiewicz et al.
function nonMaxSuppressionFast(boxes, overlapThresh) {
    // if there are no boxes, return an empty list
    if (boxes.length === 0) {
        return [];
    }

    // initialize the list of picked indexes	
    let pick = [];

    // grab the coordinates of the bounding boxes
    let x1 = boxes.map(b => b[0]);
    let y1 = boxes.map(b => b[1]);
    let x2 = boxes.map(b => b[2]);
    let y2 = boxes.map(b => b[3]);

    // compute the area of the bounding boxes and sort the bounding
    // boxes by the bottom-right y-coordinate of the bounding box
    let area = boxes.map((b, i) => (x2[i] - x1[i] + 1) * (y2[i] - y1[i] + 1));
    let idxs = Array.from({ length: boxes.length }, (_, i) => i);

    idxs.sort((a, b) => y2[a] - y2[b]);

    // keep looping while some indexes still remain in the indexes list
    while (idxs.length > 0) {
        // grab the last index in the indexes list and add the
        // index value to the list of picked indexes
        let last = idxs.length - 1;
        let i = idxs[last];
        pick.push(i);

        // find the largest (x, y) coordinates for the start of
        // the bounding box and the smallest (x, y) coordinates
        // for the end of the bounding box
        let suppress = [last];
        for (let pos = 0; pos < last; pos++) {
            let j = idxs[pos];

            let xx1 = Math.max(x1[i], x1[j]);
            let yy1 = Math.max(y1[i], y1[j]);
            let xx2 = Math.min(x2[i], x2[j]);
            let yy2 = Math.min(y2[i], y2[j]);

            // compute the width and height of the bounding box
            let w = Math.max(0, xx2 - xx1 + 1);
            let h = Math.max(0, yy2 - yy1 + 1);

            // compute the ratio of overlap
            let overlap = (w * h) / area[j];

            // if the overlap is greater than the threshold, mark it for suppression
            if (overlap > overlapThresh) {
                suppress.push(pos);
            }
        }

        // delete all indexes from the index list that have been suppressed
        idxs = idxs.filter((_, index) => !suppress.includes(index));
    }

    // return only the bounding boxes that were picked
    return pick.map(i => boxes[i]);
}

// Start the app
init();
