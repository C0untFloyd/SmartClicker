/**
 * Pure helpers for the IdleOn Sushi Station merge board.
 *
 * The board is a fixed lattice of sushi tiles. Two tiles showing the same
 * sushi sprite can be merged by dragging one onto the other. This module
 * turns a raw BGRA screenshot of the board into per-cell signatures, groups
 * identical tiles and picks the next pair to merge.
 *
 * Geometry defaults were measured from the live 2000x809 game window
 * (windowed, including the game's custom title bar):
 *   - "SUSHI STATION" wordmark template at (700, 35), size 355x40
 *   - first cell centre at (447, 108.4)
 *   - 12 columns x 8 rows, centre spacing 67.73 x 67.64 px
 *
 * The original borderless 2000x809 screenshot had the same board at
 * (439, 97.5) with spacing 68.8 x 68.4; the title bar shifts/scales the UI
 * slightly. Banner offsets below are relative to the template, so recalibrate
 * them if the window chrome changes.
 *
 * All coordinates in this module are relative to the captured board region
 * unless the field name says otherwise.
 */

export const SUSHI_BOARD_DEFAULTS = Object.freeze({
    bannerImage: 'detectimages/sushi/station_banner.png',
    bannerConfidence: 0.8,
    // Cell (0,0) centre relative to the banner template's top-left corner.
    bannerOffsetX: -253,
    bannerOffsetY: 73.4,
    columns: 12,
    rows: 8,
    cellSpacingX: 67.73,
    cellSpacingY: 67.64,
    // Half-size of the square sampled around each cell centre.
    cellRadius: 28,
    // Signature resolution (sampleSize x sampleSize pixels).
    sampleSize: 20,
    // Maximum RMS colour distance for two cells to be considered identical.
    matchThreshold: 8
});

export const TIER_ATLAS_DEFAULTS = Object.freeze({
    image: 'detectimages/sushi/tiers_atlas.png',
    // The atlas is an 8x8 grid of official tier sprites, tiers 1..64.
    columns: 8,
    rows: 8,
    cellSize: 47,
    // Tier matching samples almost the full cell; 32 was validated at 98%+
    // accuracy on the live 2000x809 board.
    tierRadius: 32,
    // A run is only sorted when every tile is classified with this much
    // margin over the runner-up and no worse than maxDistance.
    minGap: 5,
    maxDistance: 60,
    maxSwaps: 40,
    // Swapping across different slot backgrounds changes the 20x20 signature
    // by more than a plain same-slot copy, but different tiers are ~80+.
    verifyThreshold: 30
});

// Heat of the East Wind only chains when the combined pair is tier 54 or
// lower. Merges above that still happen, they just never cascade.
export const SUSHI_MAX_CASCADE_TIER = 54;

const SAMPLE_SIZE = 20;
const EMPTY_BRIGHT_RATIO = 0.06;
const EMPTY_VARIANCE = 2000;

/**
 * Extracts a compact colour signature for one board cell.
 *
 * @param {Uint8Array|Buffer} bgra raw BGRA pixels of the board region
 * @param {number} width region width in pixels
 * @param {number} height region height in pixels
 * @param {number} centerX cell centre X inside the region
 * @param {number} centerY cell centre Y inside the region
 * @param {number} radius half-size of the sampled square
 * @param {number} sampleSize signature grid size
 */
export function analyzeCell(bgra, width, height, centerX, centerY, radius = 30, sampleSize = SAMPLE_SIZE) {
    const x0 = Math.max(0, Math.round(centerX - radius));
    const y0 = Math.max(0, Math.round(centerY - radius));
    const x1 = Math.min(width, Math.round(centerX + radius));
    const y1 = Math.min(height, Math.round(centerY + radius));
    const cropW = x1 - x0;
    const cropH = y1 - y0;

    const cell = {
        centerX,
        centerY,
        empty: true,
        brightRatio: 0,
        variance: 0,
        signature: null
    };

    if (cropW < 2 || cropH < 2) return cell;

    const bins = Math.max(2, Math.round(sampleSize));
    const binCount = bins * bins;
    const sums = new Uint32Array(binCount * 3);
    const counts = new Uint32Array(binCount);

    let brightPixels = 0;
    let totalPixels = 0;
    let lumaSum = 0;
    let lumaSqSum = 0;

    for (let y = y0; y < y1; y++) {
        const binY = Math.min(bins - 1, Math.floor(((y - y0) * bins) / cropH));
        const rowBase = y * width;
        for (let x = x0; x < x1; x++) {
            const p = (rowBase + x) * 4;
            const b = bgra[p];
            const g = bgra[p + 1];
            const r = bgra[p + 2];

            if (r + g + b > 330) brightPixels++;
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            lumaSum += luma;
            lumaSqSum += luma * luma;

            const binX = Math.min(bins - 1, Math.floor(((x - x0) * bins) / cropW));
            const index = binY * bins + binX;
            sums[index * 3] += r;
            sums[index * 3 + 1] += g;
            sums[index * 3 + 2] += b;
            counts[index] += 1;
            totalPixels += 1;
        }
    }

    if (totalPixels === 0) return cell;

    const brightRatio = brightPixels / totalPixels;
    const lumaMean = lumaSum / totalPixels;
    const variance = lumaSqSum / totalPixels - lumaMean * lumaMean;

    cell.brightRatio = brightRatio;
    cell.variance = variance;

    // Empty slots are either plain board (no bright pixels) or a plain plate
    // (bright but extremely low contrast). Sushi sprites always have both
    // bright pixels and a lot of internal contrast.
    if (brightRatio < EMPTY_BRIGHT_RATIO || variance < EMPTY_VARIANCE) {
        return cell;
    }

    const signature = new Uint8Array(binCount * 3);
    for (let i = 0; i < binCount; i++) {
        const n = counts[i] || 1;
        signature[i * 3] = Math.round(sums[i * 3] / n);
        signature[i * 3 + 1] = Math.round(sums[i * 3 + 1] / n);
        signature[i * 3 + 2] = Math.round(sums[i * 3 + 2] / n);
    }

    cell.signature = signature;
    cell.empty = false;
    return cell;
}

/**
 * Analyses every cell of the board region.
 *
 * @param {Uint8Array|Buffer} bgra
 * @param {number} width
 * @param {number} height
 * @param {object} geometry { columns, rows, originX, originY, cellSpacingX, cellSpacingY, cellRadius, sampleSize }
 * @returns {Array<{row:number,col:number,centerX:number,centerY:number,empty:boolean,signature:Uint8Array|null,brightRatio:number,variance:number}>}
 */
export function analyzeBoard(bgra, width, height, geometry) {
    const {
        columns = SUSHI_BOARD_DEFAULTS.columns,
        rows = SUSHI_BOARD_DEFAULTS.rows,
        originX,
        originY,
        cellSpacingX = SUSHI_BOARD_DEFAULTS.cellSpacingX,
        cellSpacingY = SUSHI_BOARD_DEFAULTS.cellSpacingY,
        cellRadius = SUSHI_BOARD_DEFAULTS.cellRadius,
        sampleSize = SUSHI_BOARD_DEFAULTS.sampleSize
    } = geometry;

    const cells = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
            const centerX = originX + col * cellSpacingX;
            const centerY = originY + row * cellSpacingY;
            const cell = analyzeCell(bgra, width, height, centerX, centerY, cellRadius, sampleSize);
            cells.push({ row, col, ...cell });
        }
    }
    return cells;
}

/** Root-mean-square RGB distance between two signatures (0 = identical). */
export function signatureDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum / a.length);
}

/** Stable key for a cell pair, used to blacklist failed merges. */
export function pairKey(a, b) {
    const ka = `${a.row}:${a.col}`;
    const kb = `${b.row}:${b.col}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export function countFilled(cells) {
    let filled = 0;
    for (const cell of cells) {
        if (!cell.empty && cell.signature) filled++;
    }
    return filled;
}

/**
 * Finds disjoint pairs of visually identical sushi tiles.
 *
 * @param {Array} cells
 * @param {number} threshold maximum signature distance
 * @param {Set<string>} blocked pair keys that previously failed to merge
 * @returns {Array<{a:object,b:object,distance:number,key:string}>}
 */
export function findMergePairs(cells, threshold = SUSHI_BOARD_DEFAULTS.matchThreshold, blocked = new Set()) {
    const usable = cells.filter(cell => !cell.empty && cell.signature);
    const candidates = [];

    for (let i = 0; i < usable.length; i++) {
        for (let j = i + 1; j < usable.length; j++) {
            const distance = signatureDistance(usable[i].signature, usable[j].signature);
            if (distance <= threshold) {
                candidates.push({
                    a: usable[i],
                    b: usable[j],
                    distance,
                    key: pairKey(usable[i], usable[j])
                });
            }
        }
    }

    candidates.sort((x, y) => x.distance - y.distance);

    const used = new Set();
    const pairs = [];
    for (const pair of candidates) {
        if (blocked.has(pair.key) || used.has(pair.a) || used.has(pair.b)) continue;
        used.add(pair.a);
        used.add(pair.b);
        pairs.push(pair);
    }
    return pairs;
}

/**
 * Picks which pair to merge next and which tile should be dragged onto which.
 *
 * Dragging left -> right makes the surviving sushi the right-hand one, which
 * lets Heat of the East Wind chain into the tile to its right. Same-row pairs
 * are therefore oriented left -> right, and targets with a filled right
 * neighbour are preferred.
 */
export function chooseNextPair(pairs, cells, columns = SUSHI_BOARD_DEFAULTS.columns) {
    if (!pairs.length) return null;

    const byPosition = new Map(cells.map(cell => [`${cell.row}:${cell.col}`, cell]));

    const scored = pairs.map(pair => {
        let source = pair.a;
        let target = pair.b;

        if (pair.a.row === pair.b.row) {
            if (pair.a.col > pair.b.col) {
                source = pair.b;
                target = pair.a;
            }
        } else {
            const aRight = byPosition.get(`${pair.a.row}:${pair.a.col + 1}`);
            const bRight = byPosition.get(`${pair.b.row}:${pair.b.col + 1}`);
            const aCanChain = pair.a.col + 1 < columns && aRight && !aRight.empty;
            const bCanChain = pair.b.col + 1 < columns && bRight && !bRight.empty;
            if (bCanChain && !aCanChain) {
                source = pair.a;
                target = pair.b;
            } else if (aCanChain && !bCanChain) {
                source = pair.b;
                target = pair.a;
            }
        }

        const right = byPosition.get(`${target.row}:${target.col + 1}`);
        const canChain = target.col + 1 < columns && right && !right.empty;

        return { ...pair, source, target, canChain };
    });

    scored.sort((x, y) => {
        const chainDiff = Number(y.canChain) - Number(x.canChain);
        if (chainDiff !== 0) return chainDiff;
        return x.distance - y.distance;
    });

    return scored[0];
}

/**
 * Box-averaged NxN RGB grid for one board cell. Used for tier matching
 * against the official sprite atlas.
 *
 * @returns {Float32Array} size*size*3 RGB values
 */
export function cellColorGrid(bgra, width, height, centerX, centerY, radius = 30, size = 47) {
    const grid = new Float32Array(size * size * 3);
    const x0 = Math.max(0, Math.round(centerX - radius));
    const y0 = Math.max(0, Math.round(centerY - radius));
    const x1 = Math.min(width, Math.round(centerX + radius));
    const y1 = Math.min(height, Math.round(centerY + radius));
    const cropW = x1 - x0;
    const cropH = y1 - y0;
    if (cropW < 2 || cropH < 2) return grid;

    const binCount = size * size;
    const sums = new Uint32Array(binCount * 3);
    const counts = new Uint32Array(binCount);

    for (let y = y0; y < y1; y++) {
        const by = Math.min(size - 1, Math.floor(((y - y0) * size) / cropH));
        const rowBase = y * width;
        for (let x = x0; x < x1; x++) {
            const p = (rowBase + x) * 4;
            const bx = Math.min(size - 1, Math.floor(((x - x0) * size) / cropW));
            const index = by * size + bx;
            sums[index * 3] += bgra[p + 2];     // R
            sums[index * 3 + 1] += bgra[p + 1]; // G
            sums[index * 3 + 2] += bgra[p];     // B
            counts[index] += 1;
        }
    }

    for (let i = 0; i < binCount; i++) {
        const n = counts[i] || 1;
        grid[i * 3] = sums[i * 3] / n;
        grid[i * 3 + 1] = sums[i * 3 + 1] / n;
        grid[i * 3 + 2] = sums[i * 3 + 2] / n;
    }
    return grid;
}

/**
 * Builds a tier classifier from the 8x8 sprite atlas (tiers 1..64).
 * The mask drops the tier-number overlay and the bottom rice band; pixels
 * are weighted by how much they vary between tiers so toppings matter more
 * than the shared rice base.
 */
export function buildTierClassifier(atlasBgra, atlasWidth, atlasHeight, options = {}) {
    const cellSize = options.cellSize || TIER_ATLAS_DEFAULTS.cellSize;
    const columns = options.columns || TIER_ATLAS_DEFAULTS.columns;
    const rows = options.rows || TIER_ATLAS_DEFAULTS.rows;
    const spriteCount = columns * rows;
    const pixelCount = cellSize * cellSize;
    const sprites = [];
    const alphaUnion = new Uint8Array(pixelCount);

    for (let index = 0; index < spriteCount; index++) {
        const spriteCol = index % columns;
        const spriteRow = Math.floor(index / columns);
        const rgb = new Float32Array(pixelCount * 3);
        const alpha = new Uint8Array(pixelCount);

        for (let y = 0; y < cellSize; y++) {
            for (let x = 0; x < cellSize; x++) {
                const i = y * cellSize + x;
                const sx = spriteCol * cellSize + x;
                const sy = spriteRow * cellSize + y;
                if (sx >= atlasWidth || sy >= atlasHeight) continue;
                const p = (sy * atlasWidth + sx) * 4;
                rgb[i * 3] = atlasBgra[p + 2];
                rgb[i * 3 + 1] = atlasBgra[p + 1];
                rgb[i * 3 + 2] = atlasBgra[p];
                alpha[i] = atlasBgra[p + 3];
                if (alpha[i] > alphaUnion[i]) alphaUnion[i] = alpha[i];
            }
        }

        sprites.push({ tier: index + 1, rgb, alpha });
    }

    const mask = new Uint8Array(pixelCount);
    for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
            const i = y * cellSize + x;
            if (alphaUnion[i] <= 200) continue;
            // Ignore the tier number overlay (bottom-right) and rice band.
            if (x >= cellSize * 0.55 && y >= cellSize * 0.5) continue;
            if (y >= cellSize * 0.82) continue;
            mask[i] = 1;
        }
    }

    const weights = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
        let sum = 0;
        let sumSq = 0;
        let n = 0;
        for (const sprite of sprites) {
            if (sprite.alpha[i] <= 200) continue;
            const mean = (sprite.rgb[i * 3] + sprite.rgb[i * 3 + 1] + sprite.rgb[i * 3 + 2]) / 3;
            sum += mean;
            sumSq += mean * mean;
            n++;
        }
        if (n < 2) continue;
        const mean = sum / n;
        const variance = Math.max(0, sumSq / n - mean * mean);
        weights[i] = Math.sqrt(variance);
    }

    let maxWeight = 0;
    for (let i = 0; i < pixelCount; i++) {
        if (weights[i] > maxWeight) maxWeight = weights[i];
    }
    if (maxWeight > 0) {
        for (let i = 0; i < pixelCount; i++) weights[i] /= maxWeight;
    }

    return { cellSize, columns, rows, sprites, mask, weights };
}

/** Classifies one cell grid against the atlas. Returns {tier, distance, gap}. */
export function classifyTier(classifier, grid) {
    const { sprites, mask, weights, cellSize } = classifier;
    const pixelCount = cellSize * cellSize;
    let best = null;
    let second = null;

    for (const sprite of sprites) {
        let total = 0;
        let weightSum = 0;
        const { rgb, alpha } = sprite;

        for (let i = 0; i < pixelCount; i++) {
            if (!mask[i] || alpha[i] <= 200) continue;
            const weight = weights[i];
            if (weight <= 0) continue;

            const diff = (
                Math.abs(grid[i * 3] - rgb[i * 3]) +
                Math.abs(grid[i * 3 + 1] - rgb[i * 3 + 1]) +
                Math.abs(grid[i * 3 + 2] - rgb[i * 3 + 2])
            ) / 3;

            total += diff * weight;
            weightSum += weight;
        }

        if (weightSum <= 0) continue;
        const distance = total / weightSum;

        if (!best || distance < best.distance) {
            second = best;
            best = { tier: sprite.tier, distance };
        } else if (!second || distance < second.distance) {
            second = { tier: sprite.tier, distance };
        }
    }

    if (!best) return null;
    return {
        tier: best.tier,
        distance: best.distance,
        gap: second ? second.distance - best.distance : 99
    };
}

/** Classifies every non-empty cell of a board region. */
export function classifyBoardTiers(bgra, width, height, cells, cellRadius, classifier) {
    return cells.map(cell => {
        if (cell.empty) return null;
        const grid = cellColorGrid(
            bgra, width, height,
            cell.centerX, cell.centerY,
            cellRadius, classifier.cellSize
        );
        return classifyTier(classifier, grid);
    });
}

/**
 * Plans a descending left-to-right sort for every contiguous, high-confidence
 * row segment. Returns swaps in execution order and the segments it skipped.
 *
 * Swaps are only between different tiers (identical swaps would merge).
 */
export function planRowSortSwaps(cells, tierResults, options = {}) {
    const compact = options.compact !== false;

    const positions = cells.map((cell, index) => {
        const result = !cell.empty ? tierResults[index] : null;
        return { cell, tier: result ? result.tier : null };
    });
    const filledCount = positions.filter(p => p.tier !== null).length;
    if (filledCount < 2) {
        return { swaps: [], skipped: [], expected: [] };
    }

    const ops = [];

    if (compact) {
        // Whole-board row-major sort: pack every tile into the first N cells
        // (row 0 left-to-right, then row 1, ...) and order them descending.
        for (let i = 0; i < filledCount; i++) {
            let best = -1;
            for (let j = i; j < positions.length; j++) {
                if (positions[j].tier === null) continue;
                if (best < 0 || positions[j].tier > positions[best].tier) best = j;
            }
            if (best < 0) break;
            if (best === i) continue;

            const target = positions[i];
            const source = positions[best];
            if (target.tier === source.tier) continue;

            if (target.tier === null) {
                ops.push({
                    type: 'move',
                    fromRow: source.cell.row,
                    fromCol: source.cell.col,
                    toRow: target.cell.row,
                    toCol: target.cell.col,
                    fromTier: source.tier,
                    toTier: null
                });
                target.tier = source.tier;
                source.tier = null;
            } else {
                ops.push({
                    type: 'swap',
                    fromRow: source.cell.row,
                    fromCol: source.cell.col,
                    toRow: target.cell.row,
                    toCol: target.cell.col,
                    fromTier: source.tier,
                    toTier: target.tier
                });
                const tmp = target.tier;
                target.tier = source.tier;
                source.tier = tmp;
            }
        }
    } else {
        // Re-sort only the currently occupied cells, keeping their positions
        // (no compaction). All ops are swaps between different tiers.
        const slots = positions.filter(p => p.tier !== null);
        for (let i = 0; i < slots.length; i++) {
            let best = i;
            for (let j = i + 1; j < slots.length; j++) {
                if (slots[j].tier > slots[best].tier) best = j;
            }
            if (best === i) continue;
            if (slots[best].tier === slots[i].tier) continue;

            const target = slots[i];
            const source = slots[best];
            ops.push({
                type: 'swap',
                fromRow: source.cell.row,
                fromCol: source.cell.col,
                toRow: target.cell.row,
                toCol: target.cell.col,
                fromTier: source.tier,
                toTier: target.tier
            });
            const tmp = target.tier;
            target.tier = source.tier;
            source.tier = tmp;
        }
    }

    const expected = positions
        .filter(p => p.tier !== null)
        .map(p => ({ row: p.cell.row, col: p.cell.col, tier: p.tier }));

    return { swaps: ops, skipped: [], expected };
}

/**
 * Builds a one-row cascade layout: a pair (source,target) followed by an
 * exact one-tier-at-a-time descending run. The merged sushi is tier+1, so the
 * chain starts with a third copy of the pair tier, then pairTier-1,
 * pairTier-2, ... A missing tier or an equal neighbour stops the game's chain.
 * The target is the second cell of the pair; the source becomes a gap behind it.
 *
 * `compact: true` packs the layout into the first N cells (row 0 first).
 * `compact: false` lays it into the longest contiguous filled run on the board.
 *
 * Returns {positions,targetTiers,segmentStartIndex,segmentLength,pairTier,seq,
 * chainCount,source,target} or null.
 */
export function planCascadeLayout(cells, tierResults, options = {}) {
    const columns = options.columns || SUSHI_BOARD_DEFAULTS.columns;
    const rows = options.rows || SUSHI_BOARD_DEFAULTS.rows;
    const compact = options.compact !== false;

    const filledCells = cells.filter((cell, index) => !cell.empty && tierResults[index]);
    const n = filledCells.length;
    if (n < 3) return null;

    const tierLists = new Map();
    cells.forEach((cell, index) => {
        if (cell.empty) return;
        const result = tierResults[index];
        if (!result) return;
        if (!tierLists.has(result.tier)) tierLists.set(result.tier, []);
        tierLists.get(result.tier).push(cell);
    });

    const positions = compact ? cells.slice(0, n) : filledCells.slice();

    let segmentStartIndex = 0;
    let segmentLength = 0;

    if (compact) {
        segmentLength = Math.min(columns, positions.length);
    } else {
        const cellAt = new Map(cells.map(cell => [`${cell.row}:${cell.col}`, cell]));
        const filledIndex = new Map(positions.map((cell, index) => [`${cell.row}:${cell.col}`, index]));

        for (let row = 0; row < rows; row++) {
            let col = 0;
            while (col < columns) {
                const first = cellAt.get(`${row}:${col}`);
                if (!first || first.empty) {
                    col++;
                    continue;
                }

                const startCol = col;
                while (col < columns) {
                    const cell = cellAt.get(`${row}:${col}`);
                    if (!cell || cell.empty) break;
                    col++;
                }

                const length = col - startCol;
                if (length > segmentLength) {
                    const index = filledIndex.get(`${row}:${startCol}`);
                    if (index !== undefined) {
                        segmentLength = length;
                        segmentStartIndex = index;
                    }
                }
            }
        }
    }

    if (segmentLength < 3) return null;

    let best = null;
    for (const [tier, group] of tierLists) {
        if (tier > SUSHI_MAX_CASCADE_TIER) continue;
        // The merge consumes two copies, and the chain can only start with a
        // third copy of the same tier: the result is tier+1, so the sushi to
        // its right must be exactly `tier`.
        if (group.length < 3) continue;

        const seq = [tier];
        let next = tier - 1;
        while (seq.length < segmentLength - 2 && tierLists.has(next)) {
            seq.push(next);
            next--;
        }

        const seqLength = seq.length;
        if (!best ||
            seqLength > best.seqLength ||
            (seqLength === best.seqLength && tier > best.tier)) {
            best = { tier, seq, seqLength };
        }
    }

    if (!best) return null;

    const counts = new Map();
    for (const [tier, list] of tierLists) counts.set(tier, list.length);
    counts.set(best.tier, counts.get(best.tier) - 2);
    for (const tier of best.seq) counts.set(tier, counts.get(tier) - 1);

    const remaining = [];
    for (const [tier, count] of counts) {
        for (let i = 0; i < count; i++) remaining.push(tier);
    }
    remaining.sort((a, b) => b - a);

    const targetTiers = new Array(positions.length);
    let remainingIndex = 0;
    for (let i = 0; i < positions.length; i++) {
        if (i >= segmentStartIndex && i < segmentStartIndex + segmentLength) {
            const offset = i - segmentStartIndex;
            if (offset < 2) {
                targetTiers[i] = best.tier;
            } else if (offset < 2 + best.seqLength) {
                targetTiers[i] = best.seq[offset - 2];
            } else {
                targetTiers[i] = remaining[remainingIndex++];
            }
        } else {
            targetTiers[i] = remaining[remainingIndex++];
        }
    }

    return {
        positions,
        targetTiers,
        segmentStartIndex,
        segmentLength,
        pairTier: best.tier,
        seq: best.seq,
        chainCount: best.seqLength,
        source: positions[segmentStartIndex],
        target: positions[segmentStartIndex + 1]
    };
}

/**
 * Plans the moves/swaps that assign the desired tiers to the layout's target
 * cells. With compact layouts the source pool is the whole board; with
 * non-compact layouts it is the occupied-cell list.
 */
export function planAssignmentSort(cells, tierResults, layout, options = {}) {
    const columns = options.columns || SUSHI_BOARD_DEFAULTS.columns;
    const compact = options.compact !== false;
    const positions = layout.positions;
    const targetTiers = layout.targetTiers;
    const sourceCells = compact ? cells : positions;

    const current = sourceCells.map(cell => {
        if (cell.empty) return null;
        const result = tierResults[cell.row * columns + cell.col];
        return result ? result.tier : null;
    });

    const ops = [];
    for (let i = 0; i < positions.length; i++) {
        const desired = targetTiers[i];
        if (current[i] === desired) continue;

        let sourceIndex = -1;
        for (let j = i; j < current.length; j++) {
            if (current[j] === desired) {
                sourceIndex = j;
                break;
            }
        }
        if (sourceIndex < 0) {
            // The layout targets are a permutation of the current tiers, so a
            // match should always exist. If it does not, leave the cell alone
            // instead of emitting a self-swap.
            break;
        }

        const targetCell = positions[i];
        const sourceCell = sourceCells[sourceIndex];

        if (current[i] === null) {
            ops.push({
                type: 'move',
                fromRow: sourceCell.row,
                fromCol: sourceCell.col,
                toRow: targetCell.row,
                toCol: targetCell.col,
                fromTier: current[sourceIndex],
                toTier: null
            });
            current[i] = current[sourceIndex];
            current[sourceIndex] = null;
        } else {
            ops.push({
                type: 'swap',
                fromRow: sourceCell.row,
                fromCol: sourceCell.col,
                toRow: targetCell.row,
                toCol: targetCell.col,
                fromTier: current[sourceIndex],
                toTier: current[i]
            });
            const tmp = current[i];
            current[i] = current[sourceIndex];
            current[sourceIndex] = tmp;
        }
    }

    return {
        swaps: ops,
        skipped: [],
        expected: positions.map((cell, index) => ({
            row: cell.row,
            col: cell.col,
            tier: targetTiers[index]
        }))
    };
}

/**
 * Plans a minimal-change wrap cascade: arranges `T, T, T, T-1, T-2, ...`
 * starting at any filled cell and continuing in row-major order across row
 * boundaries, so Heat of the East Wind can keep chaining into the next row.
 *
 * Every start cell and pair tier is scored by chain length versus required
 * drags, so the planner reuses a part of the board that already matches most
 * of the sequence. Only the path and source cells are touched.
 *
 * Returns {layout, ops, expected} or null when no exact chain can be built.
 */
export function planWrapCascadeLayout(cells, tierResults, options = {}) {
    const columns = options.columns || SUSHI_BOARD_DEFAULTS.columns;
    const rows = options.rows || SUSHI_BOARD_DEFAULTS.rows;
    const maxChain = options.maxChain || 30;

    const byPosition = new Map(cells.map(cell => [`${cell.row}:${cell.col}`, cell]));
    const tierByKey = new Map();
    cells.forEach((cell, index) => {
        const result = tierResults[index];
        tierByKey.set(`${cell.row}:${cell.col}`,
            cell.empty || !result ? null : result.tier);
    });

    const tierLists = new Map();
    cells.forEach((cell, index) => {
        if (cell.empty) return;
        const result = tierResults[index];
        if (!result) return;
        if (!tierLists.has(result.tier)) tierLists.set(result.tier, []);
        tierLists.get(result.tier).push(cell);
    });

    let best = null;
    for (let startIndex = 0; startIndex < cells.length; startIndex++) {
        const startCell = cells[startIndex];
        if (!startCell || startCell.empty) continue;

        const capacity = cells.length - startIndex;
        if (capacity < 3) continue;

        for (const [tier, group] of tierLists) {
            if (tier > SUSHI_MAX_CASCADE_TIER) continue;
            if (group.length < 3) continue;

            const seq = [tier];
            let next = tier - 1;
            const limit = Math.min(capacity - 2, maxChain);
            while (seq.length < limit && tierLists.has(next)) {
                seq.push(next);
                next--;
            }

            const slotsTiers = [tier, tier, ...seq];
            let matches = 0;
            for (let i = 0; i < slotsTiers.length; i++) {
                const cell = cells[startIndex + i];
                if (cell && tierByKey.get(`${cell.row}:${cell.col}`) === slotsTiers[i]) {
                    matches++;
                }
            }

            const mismatches = slotsTiers.length - matches;
            const score = slotsTiers.length - mismatches / 3;

            const better = !best ||
                score > best.score + 1e-9 ||
                (Math.abs(score - best.score) <= 1e-9 &&
                    slotsTiers.length > best.slotsTiers.length) ||
                (Math.abs(score - best.score) <= 1e-9 &&
                    slotsTiers.length === best.slotsTiers.length &&
                    mismatches < best.mismatches) ||
                (Math.abs(score - best.score) <= 1e-9 &&
                    slotsTiers.length === best.slotsTiers.length &&
                    mismatches === best.mismatches && tier > best.tier);

            if (better) {
                best = { startIndex, tier, seq, slotsTiers, score, mismatches };
            }
        }
    }

    if (!best) return null;

    const slotTiers = best.slotsTiers;
    const slots = slotTiers.map((_, index) => cells[best.startIndex + index]);

    const state = new Map(tierByKey);

    const pathKeys = new Set(slots.map(cell => `${cell.row}:${cell.col}`));
    const used = new Set();
    const ops = [];

    const findSource = (desired, targetKey) => {
        // Prefer a source outside the path so the rest of the board is untouched.
        for (const outside of [true, false]) {
            for (const [key, tier] of state) {
                if (tier !== desired) continue;
                if (key === targetKey || used.has(key)) continue;
                if (outside && pathKeys.has(key)) continue;
                return key;
            }
        }
        return null;
    };

    for (let i = 0; i < slots.length; i++) {
        const target = slots[i];
        const targetKey = `${target.row}:${target.col}`;
        const desired = slotTiers[i];

        if (state.get(targetKey) === desired) {
            used.add(targetKey);
            continue;
        }

        const sourceKey = findSource(desired, targetKey);
        if (!sourceKey) return null;

        const source = byPosition.get(sourceKey);
        const targetTier = state.get(targetKey);

        if (targetTier === null) {
            ops.push({
                type: 'move',
                fromRow: source.row,
                fromCol: source.col,
                toRow: target.row,
                toCol: target.col,
                fromTier: desired,
                toTier: null
            });
            state.set(targetKey, desired);
            state.set(sourceKey, null);
        } else {
            ops.push({
                type: 'swap',
                fromRow: source.row,
                fromCol: source.col,
                toRow: target.row,
                toCol: target.col,
                fromTier: desired,
                toTier: targetTier
            });
            state.set(targetKey, desired);
            state.set(sourceKey, targetTier);
        }

        used.add(targetKey);
    }

    return {
        layout: {
            pairTier: best.tier,
            seq: best.seq,
            chainCount: best.seq.length,
            source: slots[0],
            target: slots[1],
            startIndex: best.startIndex,
            row: slots[0].row,
            startCol: slots[0].col
        },
        ops,
        expected: slots.map((cell, index) => ({
            row: cell.row,
            col: cell.col,
            tier: slotTiers[index]
        }))
    };
}

/**
 * Picks the merge with the longest exact cascade.
 *
 * The target is always the later cell of the pair in row-major order, so the
 * consumed source becomes a gap behind it. The merged result is tier+1, so the
 * chain requires exactly `tier`, then `tier-1`, and so on, walking right and
 * wrapping into the next row. A gap, an equal neighbour (4,3,3,2,1 stops at the
 * second 3), an empty cell or the board end stops it.
 *
 * Returns {source,target,tier,cascadeCount,cascade,key} or null.
 */
export function planBestCascadeMerge(cells, tierResults, options = {}) {
    const columns = options.columns || SUSHI_BOARD_DEFAULTS.columns;
    const rows = options.rows || SUSHI_BOARD_DEFAULTS.rows;
    const minGap = options.minGap !== undefined ? options.minGap : TIER_ATLAS_DEFAULTS.minGap;
    const maxDistance = options.maxDistance !== undefined ? options.maxDistance : TIER_ATLAS_DEFAULTS.maxDistance;
    const blocked = options.blocked || new Set();

    const byPosition = new Map(cells.map(cell => [`${cell.row}:${cell.col}`, cell]));
    const groups = new Map();

    cells.forEach((cell, index) => {
        if (cell.empty) return;
        const result = tierResults[index];
        if (!result || result.gap < minGap || result.distance > maxDistance) return;
        if (!groups.has(result.tier)) groups.set(result.tier, []);
        groups.get(result.tier).push(cell);
    });

    let best = null;

    for (const [tier, group] of groups) {
        if (group.length < 2) continue;

        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i];
                const b = group[j];
                const key = pairKey(a, b);
                if (blocked.has(key)) continue;

                const aIndex = a.row * columns + a.col;
                const bIndex = b.row * columns + b.col;

                // Later cell is the merge target; earlier becomes the gap.
                const source = aIndex < bIndex ? a : b;
                const target = aIndex < bIndex ? b : a;

                const cascade = countCascade(
                    cells, tierResults, target, tier,
                    columns, rows, byPosition, source
                );

                if (!best ||
                    cascade.count > best.cascadeCount ||
                    (cascade.count === best.cascadeCount && tier > best.tier)) {
                    best = {
                        source,
                        target,
                        tier,
                        cascadeCount: cascade.count,
                        cascade,
                        key
                    };
                }
            }
        }
    }

    return best;
}

function countCascade(cells, tierResults, target, tier, columns, rows, byPosition, source) {
    const details = [];
    let count = 0;
    let expected = tier;

    // Tier 54 is the highest pair that triggers Heat of the East Wind.
    if (tier > SUSHI_MAX_CASCADE_TIER) return { count, details };

    const sourceIndex = source ? source.row * columns + source.col : -1;

    // Walk row-major, wrapping into the next row after the last column.
    for (let index = target.row * columns + target.col + 1; index < cells.length; index++) {
        if (index === sourceIndex) break;

        const cell = cells[index];
        if (!cell || cell.empty) break;

        const result = tierResults[index];
        if (!result) break;

        // The merged tile is tier+1 and chains through a tile of exactly the
        // merged tier (tier), then tier-1, tier-2, ... A gap or an equal
        // neighbour (4,3,3,2,1) stops the cascade at the second 3.
        if (result.tier === expected) {
            count++;
            details.push({ cell, from: result.tier, to: result.tier + 1 });
            expected = result.tier - 1;
        } else {
            break;
        }
    }

    return { count, details };
}
