import { ActionBase, ScreenshotMode, registerPlugin } from '../../models.js';
import {
    analyzeBoard, findMergePairs, chooseNextPair, countFilled, signatureDistance,
    buildTierClassifier, classifyBoardTiers,
    planWrapCascadeLayout, planBestCascadeMerge,
    SUSHI_BOARD_DEFAULTS, TIER_ATLAS_DEFAULTS
} from './sushi.js';

const ACTION_TYPE = 'sushistation';

function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

class SushiStationAction extends ActionBase {
    constructor(data = {}) {
        super(ACTION_TYPE, data);
        const defaults = SUSHI_BOARD_DEFAULTS;

        this.bannerImage = data.bannerImage || defaults.bannerImage;
        this.maximizeImage = data.maximizeImage || defaults.maximizeImage;
        this.bannerConfidence = numberOr(data.bannerConfidence, defaults.bannerConfidence);
        this.bannerOffsetX = numberOr(data.bannerOffsetX, defaults.bannerOffsetX);
        this.bannerOffsetY = numberOr(data.bannerOffsetY, defaults.bannerOffsetY);
        this.columns = numberOr(data.columns, defaults.columns);
        this.rows = numberOr(data.rows, defaults.rows);
        this.cellSpacingX = numberOr(data.cellSpacingX, defaults.cellSpacingX);
        this.cellSpacingY = numberOr(data.cellSpacingY, defaults.cellSpacingY);
        this.cellRadius = numberOr(data.cellRadius, defaults.cellRadius);
        this.matchThreshold = numberOr(data.matchThreshold, defaults.matchThreshold);
        this.maxMerges = numberOr(data.maxMerges, 25);
        this.maxFailures = numberOr(data.maxFailures, 3);
        this.dragDuration_ms = numberOr(data.dragDuration_ms, 350);
        this.settle_ms = numberOr(data.settle_ms, 500);
        this.dryRun = data.dryRun === true;
        this.cookEnabled = data.cookEnabled === true;
        this.maxCooks = numberOr(data.maxCooks, 10);
        this.cookOffsetX = numberOr(data.cookOffsetX, 1000);
        this.cookOffsetY = numberOr(data.cookOffsetY, 245);
        this.cookDelay_ms = numberOr(data.cookDelay_ms, 1200);
        this.debugImagePath = data.debugImagePath || "detectimages/sushi/debug_scan.png";

        this.sortMode = data.sortMode === true;
        this.sortOnly = data.sortOnly === true;
        this.sortFirst = data.sortFirst !== false;
        this.reSortAfterMerge = data.reSortAfterMerge !== false;
        this.tierAtlasImage = data.tierAtlasImage || TIER_ATLAS_DEFAULTS.image;
        this.tierRadius = numberOr(data.tierRadius, TIER_ATLAS_DEFAULTS.tierRadius);
        this.sortMinGap = numberOr(data.sortMinGap, TIER_ATLAS_DEFAULTS.minGap);
        this.sortMaxDistance = numberOr(data.sortMaxDistance, TIER_ATLAS_DEFAULTS.maxDistance);
        this.sortMaxSwaps = numberOr(data.sortMaxSwaps, TIER_ATLAS_DEFAULTS.maxSwaps);
        this.swapVerifyThreshold = numberOr(data.swapVerifyThreshold, TIER_ATLAS_DEFAULTS.verifyThreshold);
    }

    toDict() {
        return {
            ...super.toDict(),
            bannerImage: this.bannerImage,
            maximizeImage: this.maximizeImage,
            bannerConfidence: this.bannerConfidence,
            bannerOffsetX: this.bannerOffsetX,
            bannerOffsetY: this.bannerOffsetY,
            columns: this.columns,
            rows: this.rows,
            cellSpacingX: this.cellSpacingX,
            cellSpacingY: this.cellSpacingY,
            cellRadius: this.cellRadius,
            matchThreshold: this.matchThreshold,
            maxMerges: this.maxMerges,
            maxFailures: this.maxFailures,
            dragDuration_ms: this.dragDuration_ms,
            settle_ms: this.settle_ms,
            dryRun: this.dryRun,
            cookEnabled: this.cookEnabled,
            maxCooks: this.maxCooks,
            cookOffsetX: this.cookOffsetX,
            cookOffsetY: this.cookOffsetY,
            cookDelay_ms: this.cookDelay_ms,
            debugImagePath: this.debugImagePath,
            sortMode: this.sortMode,
            sortOnly: this.sortOnly,
            sortFirst: this.sortFirst,
            reSortAfterMerge: this.reSortAfterMerge,
            tierAtlasImage: this.tierAtlasImage,
            tierRadius: this.tierRadius,
            sortMinGap: this.sortMinGap,
            sortMaxDistance: this.sortMaxDistance,
            sortMaxSwaps: this.sortMaxSwaps,
            swapVerifyThreshold: this.swapVerifyThreshold
        };
    }
}

function describeSushi(action) {
    return action.dryRun
        ? 'Sushi Station: scan only'
        : `Sushi Station: merge ${action.maxMerges > 0 ? `up to ${action.maxMerges}` : 'until no pairs'}`;
}

function addSushiStationFields(form, action, ui) {
    const { addFormField, addFormSection, toInt, toFloat, renderTree } = ui;

    addFormSection(form, 'Sushi Station / Detection');
    addFormField(form, 'Banner Image', action.bannerImage, 'text', false, (v) => action.bannerImage = v.trim());
    addFormField(form, 'Maximize Icon Image', action.maximizeImage, 'text', false, (v) => action.maximizeImage = v.trim());
    addFormField(form, 'Banner Confidence', action.bannerConfidence, 'number', false, (v) => {
        action.bannerConfidence = Math.max(0.1, Math.min(1, toFloat(v, 0.8)));
    });
    addFormField(form, 'Match Threshold', action.matchThreshold, 'number', false, (v) => {
        action.matchThreshold = Math.max(1, toFloat(v, 8));
    });
    addFormField(form, 'Debug Image Path', action.debugImagePath, 'text', false, (v) => action.debugImagePath = v.trim());

    addFormSection(form, 'Sushi Station / Behaviour');
    addFormField(form, 'Dry Run (scan only)', action.dryRun, 'checkbox', false, (v) => {
        action.dryRun = v;
        renderTree();
    });
    addFormField(form, 'Max Merges (0 = all)', action.maxMerges, 'number', false, (v) => {
        action.maxMerges = Math.max(0, toInt(v, 25));
        renderTree();
    });
    addFormField(form, 'Max Failures', action.maxFailures, 'number', false, (v) => action.maxFailures = Math.max(1, toInt(v, 3)));
    addFormField(form, 'Drag Duration (ms)', action.dragDuration_ms, 'number', false, (v) => action.dragDuration_ms = toInt(v, 350));
    addFormField(form, 'Settle (ms)', action.settle_ms, 'number', false, (v) => action.settle_ms = toInt(v, 500));

    addFormSection(form, 'Sushi Station / Row Sorting');
    addFormField(form, 'Sort Mode', action.sortMode, 'checkbox', false, (v) => action.sortMode = v);
    addFormField(form, 'Sort Only (no merges)', action.sortOnly, 'checkbox', false, (v) => action.sortOnly = v);
    addFormField(form, 'Sort Rows First', action.sortFirst, 'checkbox', false, (v) => action.sortFirst = v);
    addFormField(form, 'Re-sort After Merge', action.reSortAfterMerge, 'checkbox', false, (v) => action.reSortAfterMerge = v);
    addFormField(form, 'Tier Atlas Image', action.tierAtlasImage, 'text', false, (v) => action.tierAtlasImage = v.trim());
    addFormField(form, 'Tier Sample Radius', action.tierRadius, 'number', false, (v) => action.tierRadius = Math.max(8, toInt(v, 56)));
    addFormField(form, 'Sort Min Gap', action.sortMinGap, 'number', false, (v) => action.sortMinGap = Math.max(0, toFloat(v, 5)));
    addFormField(form, 'Sort Max Distance', action.sortMaxDistance, 'number', false, (v) => action.sortMaxDistance = Math.max(1, toFloat(v, 60)));
    addFormField(form, 'Max Swaps', action.sortMaxSwaps, 'number', false, (v) => action.sortMaxSwaps = Math.max(0, toInt(v, 40)));
    addFormField(form, 'Swap Verify Threshold', action.swapVerifyThreshold, 'number', false, (v) => action.swapVerifyThreshold = Math.max(1, toFloat(v, 30)));

    addFormSection(form, 'Sushi Station / Cooking (optional)');
    addFormField(form, 'Cook Enabled', action.cookEnabled, 'checkbox', false, (v) => action.cookEnabled = v);
    addFormField(form, 'Max Cooks', action.maxCooks, 'number', false, (v) => action.maxCooks = Math.max(0, toInt(v, 10)));
    addFormField(form, 'Cook Delay (ms)', action.cookDelay_ms, 'number', false, (v) => action.cookDelay_ms = toInt(v, 1200));
    addFormField(form, 'Cook Offset X', action.cookOffsetX, 'number', false, (v) => action.cookOffsetX = toFloat(v));
    addFormField(form, 'Cook Offset Y', action.cookOffsetY, 'number', false, (v) => action.cookOffsetY = toFloat(v));

    addFormSection(form, 'Sushi Station / Board Geometry (fullscreen)');
    addFormField(form, 'Columns', action.columns, 'number', false, (v) => action.columns = Math.max(1, toInt(v, 12)));
    addFormField(form, 'Rows', action.rows, 'number', false, (v) => action.rows = Math.max(1, toInt(v, 8)));
    addFormField(form, 'Banner Offset X', action.bannerOffsetX, 'number', false, (v) => action.bannerOffsetX = toFloat(v));
    addFormField(form, 'Banner Offset Y', action.bannerOffsetY, 'number', false, (v) => action.bannerOffsetY = toFloat(v));
    addFormField(form, 'Cell Spacing X', action.cellSpacingX, 'number', false, (v) => action.cellSpacingX = toFloat(v, 118.48));
    addFormField(form, 'Cell Spacing Y', action.cellSpacingY, 'number', false, (v) => action.cellSpacingY = toFloat(v, 118.32));
    addFormField(form, 'Cell Radius', action.cellRadius, 'number', false, (v) => action.cellRadius = Math.max(8, toInt(v, 49)));
}

export default registerPlugin({
    id: 'sushi',
    name: 'Sushi Station',
    actions: [{
        actionType: ACTION_TYPE,
        label: 'Sushi Station',
        description: 'Merge identical sushi on the station board',
        group: 'Games',
        icon: '🍣',
        create: (data) => new SushiStationAction(data),
        createDefault: () => new SushiStationAction({}),
        describe: describeSushi,
        renderFields: (form, action, ui) => addSushiStationFields(form, action, ui),
        execute: (action, host) => playSushiStation(action, host)
    }]
});

async function playSushiStation(action, host) {
    if (!host.cv) {
        throw new Error('OpenCV.js is not ready - cannot locate the Sushi Station UI');
    }

    const bannerPath = (action.bannerImage || '').trim();
    if (!bannerPath) {
        throw new Error('Sushi Station: no banner template configured');
    }

    let bannerSize;
    try {
        const absPath = await host.electronAPI.resolvePath(bannerPath);
        const image = await host.electronAPI.readImage(absPath);
        bannerSize = { width: image.width, height: image.height };
    } catch (err) {
        throw new Error(`Sushi Station: could not load the banner template (${bannerPath})`);
    }

    let bannerMatch = await host.findImageOnScreen(
        [bannerPath],
        action.bannerConfidence,
        ScreenshotMode.Colored,
        128
    );

    if (!bannerMatch) {
        const maximized = await ensureWindowMaximized(action, host);
        if (maximized) {
            bannerMatch = await host.findImageOnScreen(
                [bannerPath],
                action.bannerConfidence,
                ScreenshotMode.Colored,
                128
            );
        }
    }

    if (!bannerMatch) {
        throw new Error('Sushi Station UI not found on screen. Open the station and keep the game window visible.');
    }

    const banner = {
        left: bannerMatch.x - bannerSize.width / 2,
        top: bannerMatch.y - bannerSize.height / 2,
        width: bannerSize.width,
        height: bannerSize.height,
        centerX: bannerMatch.x,
        centerY: bannerMatch.y
    };

    // A click on an inactive game window can be consumed by activation, which
    // would swallow the first synthetic drag. Focus it on the title once.
    if (!action.dryRun) {
        await host.electronAPI.mouseClick(
            'left',
            Math.round(banner.centerX),
            Math.round(banner.centerY),
            60
        );
        await host.sleep(250);
    }

    const board = createBoardGeometry(action, banner);
    const { regionX, regionY, regionW, regionH } = board;

    if (regionX < 0 || regionY < 0) {
        throw new Error('Sushi Station board is partially off-screen');
    }

    const readBoard = async () => {
        const shot = await host.electronAPI.takeScreenshotRegion(regionX, regionY, regionW, regionH);
        if (shot.width !== regionW || shot.height !== regionH) {
            throw new Error('Sushi Station board is partially off-screen');
        }
        const cells = analyzeBoard(new Uint8Array(shot.data), shot.width, shot.height, board.geometry);
        return { cells, shot };
    };

    let { cells, shot } = await readBoard();
    const filled = countFilled(cells);
    if (filled < 2) {
        throw new Error('Sushi Station: no sushi found on the board. Check the banner offsets / board geometry.');
    }

    // Optional row-sort pass. In dry-run mode this only previews the plan.
    let sortPlan = null;
    let sortClassifier = null;
    let sortingDisabled = false;
    if (action.sortMode) {
        const prepared = await prepareSushiSort(action, board, cells, shot, host);
        sortPlan = prepared.plan;
        sortClassifier = prepared.classifier;

        const summary = prepared.layout
            ? `Sushi layout: tier ${prepared.layout.pairTier}, ${prepared.layout.chainCount} chain; ${sortPlan.swaps.length} op(s)`
            : `Sushi layout: none; ${sortPlan.swaps.length} op(s)`;
        host.status(summary);
        console.log('[Sushi] layout plan', {
            layout: prepared.layout ? {
                pairTier: prepared.layout.pairTier,
                chainCount: prepared.layout.chainCount,
                seq: prepared.layout.seq,
                row: prepared.layout.source.row,
                sourceCol: prepared.layout.source.col,
                targetCol: prepared.layout.target.col
            } : null,
            ops: sortPlan.swaps
        });

        if (action.dryRun) {
            const pairs = findMergePairs(cells, action.matchThreshold);
            await saveSushiDebugImage(
                shot, cells, pairs, action.debugImagePath, board.cellRadius,
                prepared.tiers, sortPlan.swaps, host
            );
            return;
        }

        if (action.sortFirst === false) {
            host.status('Sushi sort skipped (cascade-only mode)');
        } else if (sortPlan.swaps.length > 0) {
            const maxSwaps = Math.max(0, Math.round(action.sortMaxSwaps));
            const swaps = maxSwaps > 0 ? sortPlan.swaps.slice(0, maxSwaps) : sortPlan.swaps;
            if (swaps.length < sortPlan.swaps.length) {
                console.warn(`[Sushi] sort plan truncated to ${swaps.length}/${sortPlan.swaps.length} ops`);
            }
            try {
                cells = await runSushiSortSwaps(
                    action, board, swaps, cells, readBoard, prepared.classifier, host
                );
                host.status(`Sushi sort done: ${swaps.length} op(s)`);
            } catch (err) {
                console.warn('[Sushi] sort pass stopped early:', err);
                host.status('Sushi sort stopped early; continuing with merges');
                sortingDisabled = true;
                const read = await readBoard();
                cells = read.cells;
                shot = read.shot;
            }
        } else {
            host.status('Sushi sort: rows already sorted');
        }

        if (action.sortOnly) return;

        // Sorting changed positions; refresh before the merge phase.
        const read = await readBoard();
        cells = read.cells;
        shot = read.shot;
    }

    if (action.dryRun) {
        const pairs = findMergePairs(cells, action.matchThreshold);
        await saveSushiDebugImage(shot, cells, pairs, action.debugImagePath, board.cellRadius, null, null, host);
        host.status(`Sushi scan: ${filled} sushi, ${pairs.length} merge pair(s)`);
        console.log('[Sushi] scan result', {
            filled,
            pairs: pairs.map(p => ({
                a: [p.a.row, p.a.col],
                b: [p.b.row, p.b.col],
                distance: Number(p.distance.toFixed(2))
            }))
        });
        return;
    }

    let merges = 0;
    let failures = 0;
    let cooks = 0;
    let lastCells = cells;
    const blocked = new Set();

    while (!host.stopRequested()) {
        if (action.maxMerges > 0 && merges >= action.maxMerges) break;

        let chosen = null;

        if (action.sortMode && sortClassifier) {
            // Refresh tiers each iteration so cascade choices follow cascades.
            const read = await readBoard();
            lastCells = read.cells;

            let tiers = classifyBoardTiers(
                new Uint8Array(read.shot.data),
                read.shot.width,
                read.shot.height,
                lastCells,
                board.tierRadius,
                sortClassifier
            );

            // Cascades only upgrade the tiles in their row, so the board often
            // still offers a usable chain. Rebuild the layout only when the
            // natural chain is short; a full re-layout costs many drags.
            const natural = planBestCascadeMerge(lastCells, tiers, {
                columns: action.columns,
                rows: action.rows,
                minGap: action.sortMinGap,
                maxDistance: action.sortMaxDistance,
                blocked
            });

            if (action.reSortAfterMerge !== false && !sortingDisabled &&
                (!natural || natural.cascadeCount < 4)) {
                const planned = planWrapCascadeLayout(lastCells, tiers, {
                    columns: action.columns,
                    rows: action.rows
                });

                const naturalCount = natural ? natural.cascadeCount : 0;
                if (planned && planned.ops.length > 0 &&
                    planned.layout.chainCount > naturalCount) {
                    console.log('[Sushi] row re-layout', {
                        tier: planned.layout.pairTier,
                        chainCount: planned.layout.chainCount,
                        row: planned.layout.row + 1,
                        startCol: planned.layout.startCol + 1,
                        ops: planned.ops.length
                    });
                    host.status(
                        `Sushi re-layout: tier ${planned.layout.pairTier}, ` +
                        `${planned.layout.chainCount} chain; ${planned.ops.length} op(s)`
                    );
                    try {
                        lastCells = await runSushiSortSwaps(
                            action, board, planned.ops, lastCells, readBoard, sortClassifier, host
                        );

                        const readAfterSort = await readBoard();
                        lastCells = readAfterSort.cells;
                        tiers = classifyBoardTiers(
                            new Uint8Array(readAfterSort.shot.data),
                            readAfterSort.shot.width,
                            readAfterSort.shot.height,
                            lastCells,
                            board.tierRadius,
                            sortClassifier
                        );
                    } catch (err) {
                        console.warn('[Sushi] re-sort stopped early:', err);
                        host.status('Sushi re-sort stopped; merging on current board');
                        sortingDisabled = true;
                        const readNoSort = await readBoard();
                        lastCells = readNoSort.cells;
                        tiers = classifyBoardTiers(
                            new Uint8Array(readNoSort.shot.data),
                            readNoSort.shot.width,
                            readNoSort.shot.height,
                            lastCells,
                            board.tierRadius,
                            sortClassifier
                        );
                    }
                }
            }

            if (natural && natural.cascadeCount >= 4) {
                console.log('[Sushi] keeping natural cascade', {
                    tier: natural.tier,
                    source: [natural.source.row + 1, natural.source.col + 1],
                    target: [natural.target.row + 1, natural.target.col + 1],
                    cascadeCount: natural.cascadeCount
                });
            }

            chosen = planBestCascadeMerge(lastCells, tiers, {
                columns: action.columns,
                rows: action.rows,
                minGap: action.sortMinGap,
                maxDistance: action.sortMaxDistance,
                blocked
            });

            if (chosen) {
                host.status(`Sushi cascade: tier ${chosen.tier}, ${chosen.cascadeCount} upgrade(s)`);
                console.log('[Sushi] cascade choice', {
                    tier: chosen.tier,
                    source: [chosen.source.row + 1, chosen.source.col + 1],
                    target: [chosen.target.row + 1, chosen.target.col + 1],
                    cascadeCount: chosen.cascadeCount
                });
            }
        }

        if (!chosen) {
            const pairs = findMergePairs(lastCells, action.matchThreshold, blocked);

            if (pairs.length === 0) {
                if (action.cookEnabled && cooks < action.maxCooks) {
                    const before = countFilled(lastCells);
                    host.status('Sushi: cooking...');

                    await host.electronAPI.mouseClick(
                        'left',
                        Math.round(board.cookX),
                        Math.round(board.cookY),
                        50
                    );
                    await host.sleep(Math.max(200, action.cookDelay_ms));

                    const read = await readBoard();
                    if (countFilled(read.cells) <= before) {
                        host.status('Sushi: cook click did not add a sushi - stopping');
                        break;
                    }

                    cooks++;
                    lastCells = read.cells;
                    continue;
                }
                break;
            }

            chosen = chooseNextPair(pairs, lastCells, action.columns);
        }

        const fromX = regionX + chosen.source.centerX;
        const fromY = regionY + chosen.source.centerY;
        const toX = regionX + chosen.target.centerX;
        const toY = regionY + chosen.target.centerY;

        host.status(
            `Sushi merge ${merges + 1}: (${chosen.source.row + 1},${chosen.source.col + 1}) -> ` +
            `(${chosen.target.row + 1},${chosen.target.col + 1})`
        );

        await host.electronAPI.dragMouse(
            fromX, fromY, toX, toY,
            action.dragDuration_ms
        );

        // Park the cursor on the title so hover highlights do not pollute the
        // signatures we read back from the board.
        await host.electronAPI.moveMouse(
            Math.round(board.parkX),
            Math.round(board.parkY)
        );
        await host.sleep(Math.max(120, action.settle_ms));

        const result = await verifySushiMerge(chosen, readBoard, action, host);

        if (result.ok) {
            merges++;
            failures = 0;
            lastCells = result.cells;
            host.status(`Sushi merges: ${merges}`);
        } else {
            failures++;
            blocked.add(chosen.key);
            lastCells = result.cells;
            host.status(`Sushi merge failed (${failures}/${action.maxFailures})`);

            if (failures >= Math.max(1, action.maxFailures)) {
                throw new Error(
                    'Sushi Station merge was not confirmed. Make sure the MOVE button is off, ' +
                    'the game window is unchanged, and run the scan script first.'
                );
            }
        }
    }

    host.status(`Sushi done: ${merges} merge(s)${cooks ? `, ${cooks} cook(s)` : ''}`);
}

/**
 * If the fullscreen banner is not found, check whether the IdleOn window is
 * currently un-maximized and click its title-bar maximize button to bring it to
 * full screen. When already maximized, the title bar sits at the top of the
 * screen (y <= 35) and the maximize icon is near the right edge of the primary
 * display; clicking it again there would restore the window instead.
 */
async function ensureWindowMaximized(action, host) {
    const maximizePath = (action.maximizeImage || '').trim();
    if (!maximizePath) return false;

    const match = await host.findImageOnScreen(
        [maximizePath],
        0.85,
        ScreenshotMode.Colored,
        128
    );
    if (!match) return false;

    const screenWidth = Math.round((window.screen?.width || 0) * (window.devicePixelRatio || 1));
    const alreadyAtTopRight = match.y <= 35 && screenWidth > 0 && match.x >= screenWidth - 120;
    if (alreadyAtTopRight) {
        return false;
    }

    host.status('Sushi: maximizing IdleOn window...');
    await host.electronAPI.mouseClick('left', Math.round(match.x), Math.round(match.y), 60);
    await host.sleep(900);
    return true;
}

function createBoardGeometry(action, banner) {
    const cellSpacingX = action.cellSpacingX;
    const cellSpacingY = action.cellSpacingY;
    const cellRadius = action.cellRadius;

    const originX = banner.left + action.bannerOffsetX;
    const originY = banner.top + action.bannerOffsetY;

    const pad = Math.ceil(cellRadius) + 6;
    const regionX = Math.floor(originX - pad);
    const regionY = Math.floor(originY - pad);
    const regionW = Math.ceil((action.columns - 1) * cellSpacingX + cellRadius * 2 + pad * 2);
    const regionH = Math.ceil((action.rows - 1) * cellSpacingY + cellRadius * 2 + pad * 2);

    return {
        cellSpacingX,
        cellSpacingY,
        cellRadius,
        tierRadius: action.tierRadius,
        regionX,
        regionY,
        regionW,
        regionH,
        cookX: banner.left + action.cookOffsetX,
        cookY: banner.top + action.cookOffsetY,
        parkX: banner.centerX,
        parkY: banner.centerY,
        geometry: {
            columns: action.columns,
            rows: action.rows,
            originX: originX - regionX,
            originY: originY - regionY,
            cellSpacingX,
            cellSpacingY,
            cellRadius
        }
    };
}

async function prepareSushiSort(action, board, cells, shot, host) {
    const atlasPath = (action.tierAtlasImage || '').trim();
    if (!atlasPath) {
        throw new Error('Sushi Station: no tier atlas configured');
    }

    let atlas;
    try {
        const absPath = await host.electronAPI.resolvePath(atlasPath);
        atlas = await host.electronAPI.readImage(absPath);
    } catch (err) {
        throw new Error(`Sushi Station: could not load the tier atlas (${atlasPath})`);
    }

    if (atlas.width < 8 * 47 || atlas.height < 8 * 47) {
        throw new Error('Sushi Station: tier atlas is too small (expected an 8x8 sprite atlas)');
    }

    const classifier = buildTierClassifier(
        new Uint8Array(atlas.data),
        atlas.width,
        atlas.height
    );

    const tiers = classifyBoardTiers(
        new Uint8Array(shot.data),
        shot.width,
        shot.height,
        cells,
        board.tierRadius,
        classifier
    );

    // Build the first cascade with a handful of drags. Only sort when the
    // planned chain is actually better than the best pair already on the
    // board; repacking for a 1-2 chain just wastes drags.
    const rowPlan = planWrapCascadeLayout(cells, tiers, {
        columns: action.columns,
        rows: action.rows
    });
    const natural = planBestCascadeMerge(cells, tiers, {
        columns: action.columns,
        rows: action.rows,
        minGap: action.sortMinGap,
        maxDistance: action.sortMaxDistance
    });
    const naturalCount = natural ? natural.cascadeCount : 0;

    if (rowPlan && rowPlan.layout.chainCount > naturalCount) {
        return {
            tiers,
            classifier,
            layout: rowPlan.layout,
            plan: { swaps: rowPlan.ops, skipped: [], expected: rowPlan.expected }
        };
    }

    return {
        tiers,
        classifier,
        layout: null,
        plan: { swaps: [], skipped: [], expected: [] }
    };
}

async function runSushiSortSwaps(action, board, ops, cells, readBoard, classifier, host) {
    let current = cells;

    for (let index = 0; index < ops.length; index++) {
        if (host.stopRequested()) break;

        const op = ops[index];
        const source = current.find(cell => cell.row === op.fromRow && cell.col === op.fromCol);
        const target = current.find(cell => cell.row === op.toRow && cell.col === op.toCol);

        if (!source || !target || source.empty) {
            throw new Error(`Sushi sort: op ${index + 1} has no source sushi`);
        }
        if (op.type === 'swap' && target.empty) {
            throw new Error(`Sushi sort: swap ${index + 1} target is empty`);
        }
        if (op.type === 'move' && !target.empty) {
            throw new Error(`Sushi sort: move ${index + 1} target is not empty`);
        }

        const fromX = board.regionX + source.centerX;
        const fromY = board.regionY + source.centerY;
        const toX = board.regionX + target.centerX;
        const toY = board.regionY + target.centerY;
        const label = op.type === 'move' ? 'move' : 'swap';

        host.status(
            `Sushi sort ${label} ${index + 1}/${ops.length}: ` +
            `(${op.fromRow + 1},${op.fromCol + 1}) -> (${op.toRow + 1},${op.toCol + 1})`
        );

        let result = await dragAndVerifySortOp(
            op, source, target, action, board, readBoard,
            fromX, fromY, toX, toY, classifier, host
        );

        if (!result.ok) {
            result = await dragAndVerifySortOp(
                op, source, target, action, board, readBoard,
                fromX, fromY, toX, toY, classifier, host,
                Math.round(action.dragDuration_ms * 1.6)
            );
        }

        if (!result.ok) {
            throw new Error(
                `Sushi sort: ${label} ${index + 1}/${ops.length} was not confirmed. ` +
                'Make sure the MOVE button is off and the game window is unchanged.'
            );
        }

        current = result.cells;
    }

    return current;
}

async function dragAndVerifySortOp(op, source, target, action, board, readBoard, fromX, fromY, toX, toY, classifier, host, durationOverride) {
    const isMove = op.type === 'move';
    const oldSourceSignature = source.signature;
    const oldTargetSignature = target.signature;
    const threshold = Math.max(1, action.swapVerifyThreshold);
    const duration = durationOverride || action.dragDuration_ms;
    const expectedSourceTier = isMove ? null : op.toTier;
    const expectedTargetTier = op.fromTier;

    await host.electronAPI.dragMouse(fromX, fromY, toX, toY, duration);
    await host.electronAPI.moveMouse(
        Math.round(board.parkX),
        Math.round(board.parkY)
    );
    // Sort drags settle quickly; the verification loop below polls until the
    // board updates, so a long pre-read wait only slows the pass down.
    await host.sleep(Math.max(80, Math.min(250, action.settle_ms)));

    const deadline = Date.now() + Math.max(800, action.settle_ms + 2000);
    let lastCells = null;

    while (!host.stopRequested()) {
        const read = await readBoard();
        lastCells = read.cells;

        const currentSource = lastCells.find(cell => cell.row === source.row && cell.col === source.col);
        const currentTarget = lastCells.find(cell => cell.row === target.row && cell.col === target.col);

        if (isMove) {
            // A move is proven by the source becoming empty and the target
            // becoming occupied. Tier/signature details are only corroborating
            // because slot backgrounds can differ.
            if (currentSource && currentSource.empty && currentTarget && !currentTarget.empty) {
                return { ok: true, cells: lastCells };
            }
        } else if (currentSource && currentTarget && !currentSource.empty && !currentTarget.empty) {
            // A swap exchanges the two tiles; tier checks are background
            // independent, with signature fallbacks.
            const classified = classifyBoardTiers(
                new Uint8Array(read.shot.data),
                read.shot.width,
                read.shot.height,
                [currentSource, currentTarget],
                board.tierRadius,
                classifier
            );
            const sourceTier = classified[0] ? classified[0].tier : null;
            const targetTier = classified[1] ? classified[1].tier : null;

            if (sourceTier === expectedSourceTier && targetTier === expectedTargetTier) {
                return { ok: true, cells: lastCells };
            }

            const sourceDistance = signatureDistance(currentSource.signature, oldTargetSignature);
            const targetDistance = signatureDistance(currentTarget.signature, oldSourceSignature);
            if (sourceDistance <= threshold && targetDistance <= threshold) {
                return { ok: true, cells: lastCells };
            }

            // If both cells visibly changed, the swap happened even if a tier
            // read is off by one or the plate backgrounds differ.
            const sourceChanged = signatureDistance(currentSource.signature, oldSourceSignature);
            const targetChanged = signatureDistance(currentTarget.signature, oldTargetSignature);
            if (sourceChanged > threshold && targetChanged > threshold) {
                return { ok: true, cells: lastCells };
            }
        }

        if (Date.now() >= deadline) break;
        await host.sleep(220);
    }

    if (!lastCells) {
        lastCells = (await readBoard()).cells;
    }
    return { ok: false, cells: lastCells };
}

async function verifySushiMerge(chosen, readBoard, action, host) {
    const oldSource = chosen.source;
    const oldTarget = chosen.target;
    const requiredChange = Math.max(20, action.matchThreshold * 2);
    const deadline = Date.now() + Math.max(800, action.settle_ms + 2200);
    let cells = null;

    while (!host.stopRequested()) {
        const read = await readBoard();
        cells = read.cells;

        const source = cells.find(cell => cell.row === oldSource.row && cell.col === oldSource.col);
        const target = cells.find(cell => cell.row === oldTarget.row && cell.col === oldTarget.col);

        if (source && source.empty && target && target.signature) {
            const fromSource = signatureDistance(target.signature, oldSource.signature);
            const fromTarget = signatureDistance(target.signature, oldTarget.signature);

            // A real merge produces a new tier at the destination. A slot move
            // keeps the destination identical to one of the old cells instead.
            if (fromSource > requiredChange && fromTarget > requiredChange) {
                return { ok: true, cells };
            }
        }

        if (Date.now() >= deadline) break;
        await host.sleep(250);
    }

    if (!cells) {
        cells = (await readBoard()).cells;
    }
    return { ok: false, cells };
}

async function saveSushiDebugImage(shot, cells, pairs, debugPath, cellRadius, tiers = null, swaps = null, host) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = shot.width;
        canvas.height = shot.height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(shot.width, shot.height);
        const bgra = new Uint8Array(shot.data);

        for (let i = 0; i < bgra.length; i += 4) {
            imageData.data[i] = bgra[i + 2];     // R
            imageData.data[i + 1] = bgra[i + 1]; // G
            imageData.data[i + 2] = bgra[i];     // B
            imageData.data[i + 3] = bgra[i + 3]; // A
        }
        ctx.putImageData(imageData, 0, 0);

        const radius = Math.max(8, cellRadius);
        ctx.lineWidth = 1;
        ctx.font = '10px monospace';

        cells.forEach((cell, index) => {
            ctx.strokeStyle = cell.empty ? 'rgba(160,160,160,0.8)' : 'rgba(0,255,128,0.9)';
            ctx.strokeRect(cell.centerX - radius, cell.centerY - radius, radius * 2, radius * 2);
            if (!cell.empty) {
                ctx.fillStyle = 'rgba(255,255,0,0.95)';
                ctx.fillText(`${cell.row + 1},${cell.col + 1}`, cell.centerX - radius + 2, cell.centerY - radius + 11);

                if (tiers && tiers[index]) {
                    ctx.fillStyle = 'rgba(0,240,255,0.95)';
                    ctx.fillText(String(tiers[index].tier), cell.centerX + 2, cell.centerY - radius + 11);
                }
            }
        });

        pairs.forEach((pair, index) => {
            ctx.strokeStyle = 'rgba(255,0,128,0.95)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pair.a.centerX, pair.a.centerY);
            ctx.lineTo(pair.b.centerX, pair.b.centerY);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.fillText(
                `#${index + 1} ${pair.distance.toFixed(1)}`,
                (pair.a.centerX + pair.b.centerX) / 2,
                (pair.a.centerY + pair.b.centerY) / 2 - 4
            );
        });

        if (swaps) {
            swaps.forEach((swap, index) => {
                const source = cells.find(cell => cell.row === swap.fromRow && cell.col === swap.fromCol);
                const target = cells.find(cell => cell.row === swap.toRow && cell.col === swap.toCol);
                if (!source || !target) return;

                ctx.strokeStyle = 'rgba(255,160,0,0.95)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(source.centerX, source.centerY);
                ctx.lineTo(target.centerX, target.centerY);
                ctx.stroke();

                ctx.fillStyle = 'rgba(255,220,120,1)';
                ctx.fillText(
                    `S${index + 1}`,
                    (source.centerX + target.centerX) / 2,
                    (source.centerY + target.centerY) / 2 + 12
                );
            });
        }

        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, 380, 22);
        ctx.fillStyle = 'rgba(255,255,255,1)';
        const header = `Sushi scan: ${countFilled(cells)} sushi, ${pairs.length} pairs` +
            (swaps ? `, ${swaps.length} swaps` : '');
        ctx.fillText(header, 8, 15);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const buffer = await blob.arrayBuffer();
        const absPath = await host.electronAPI.resolvePath(debugPath);
        await host.electronAPI.saveFile(absPath, buffer);
        console.log(`[Sushi] debug scan saved to ${absPath}`);
    } catch (err) {
        console.error('[Sushi] failed to save debug image:', err);
    }
}

