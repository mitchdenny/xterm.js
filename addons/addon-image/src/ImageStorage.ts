/**
 * Copyright (c) 2020 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { IDisposable } from '@xterm/xterm';
import { ImageRenderer } from './ImageRenderer';
import type {
  ITerminalExt, IImageAddonOptions, IImageSpec, ICellSize, IAddImageOpts, ImageLayer
} from './Types';
import type { IBufferLine } from 'common/buffer/Types';
import { CellData } from 'common/buffer/CellData';

// fallback default cell size
export const CELL_SIZE_DEFAULT: ICellSize = {
  width: 7,
  height: 14
};

export interface IImageStoragePixelCache {
  readonly pixelCount: number;
  evict(pixels: number): number;
  clear(): void;
}

class ImageTileInfo {
  constructor(
    public imageId = -1,
    public tileId = -1) {
  }
}

/**
 * ImageStorage - extension of CoreTerminal:
 * - hold image data
 * - write/read image data to/from buffer
 *
 * TODO: image composition for overwrites
 */
export class ImageStorage implements IDisposable {
  // storage
  private _images: Map<number, IImageSpec> = new Map();
  private _evictedImages: Map<number, Pick<IImageSpec, 'marker' | 'bufferType' | 'layer'>> = new Map();
  private _imageCells: Map<number, Map<IBufferLine, Set<number>>> = new Map();
  private _pixelCaches: Set<IImageStoragePixelCache> = new Set();
  // last used id
  private _lastId = 0;
  // last evicted id
  private _lowestId = 0;
  // whether a full clear happened before
  private _fullyCleared = false;
  // whether render should do a full clear
  private _needsFullClear = false;
  // hard limit of stored pixels (fallback limit of 10 MB)
  private _pixelLimit: number = 2500000;
  private _workCell: CellData = new CellData();

  private _viewportMetrics: { cols: number, rows: number };
  public onImageAdded: (() => void) | undefined;
  public onImageDeleted: ((storageId: number) => void) | undefined;

  constructor(
    private _terminal: ITerminalExt,
    private _renderer: ImageRenderer,
    private _opts: IImageAddonOptions
  ) {
    try {
      this.setLimit(this._opts.storageLimit);
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message);
      }
      console.warn(`storageLimit is set to ${this.getLimit()} MB`);
    }
    this._viewportMetrics = {
      cols: this._terminal.cols,
      rows: this._terminal.rows
    };
  }

  public dispose(): void {
    this.reset();
  }

  public reset(): void {
    for (const cache of this._pixelCaches) {
      cache.clear();
    }
    for (const spec of this._images.values()) {
      spec.marker?.dispose();
    }
    for (const spec of this._evictedImages.values()) {
      spec.marker?.dispose();
    }
    // NOTE: marker.dispose above already calls ImageBitmap.close
    // therefore we can just wipe the map here
    this._images.clear();
    this._evictedImages.clear();
    this._imageCells.clear();
    this._renderer.clearAll();
  }

  public registerPixelCache(cache: IImageStoragePixelCache): IDisposable {
    this._pixelCaches.add(cache);
    return {
      dispose: () => this._pixelCaches.delete(cache)
    };
  }

  public getLimit(): number {
    return this._pixelLimit * 4 / 1000000;
  }

  public setLimit(value: number): void {
    if (value < 0.5 || value > 1000) {
      throw RangeError('invalid storageLimit, should be at least 0.5 MB and not exceed 1G');
    }
    this._pixelLimit = (value / 4 * 1000000) >>> 0;
    this._evictOldest(0);
  }

  public enforceLimit(): void {
    this._evictOldest(0);
  }

  public getUsage(): number {
    return this._getStoredPixels() * 4 / 1000000;
  }

  private _getStoredPixels(): number {
    let storedPixels = 0;
    for (const spec of this._images.values()) {
      if (spec.orig) {
        storedPixels += spec.orig.width * spec.orig.height;
        if (spec.actual && spec.actual !== spec.orig) {
          storedPixels += spec.actual.width * spec.actual.height;
        }
      }
    }
    for (const cache of this._pixelCaches) {
      storedPixels += cache.pixelCount;
    }
    return storedPixels;
  }

  private _delImg(id: number): void {
    const spec = this._images.get(id);
    if (!spec && !this._evictedImages.has(id) && !this._imageCells.has(id)) return;
    this._images.delete(id);
    this._evictedImages.delete(id);
    this._imageCells.delete(id);
    // FIXME: really ugly workaround to get bitmaps deallocated :(
    if (window.ImageBitmap && spec?.orig instanceof ImageBitmap) {
      spec.orig.close();
    }
    this.onImageDeleted?.(id);
  }

  /**
   * Wipe canvas and images on alternate buffer.
   */
  public wipeAlternate(): void {
    // remove all alternate tagged images
    const zero = [];
    for (const [id, spec] of this._images.entries()) {
      if (spec.bufferType === 'alternate') {
        spec.marker?.dispose();
        zero.push(id);
      }
    }
    for (const [id, spec] of this._evictedImages.entries()) {
      if (spec.bufferType === 'alternate') {
        spec.marker?.dispose();
        zero.push(id);
      }
    }
    for (const id of zero) {
      this._delImg(id);
    }
    // mark canvas to be wiped on next render
    this._needsFullClear = true;
    this._fullyCleared = false;
  }

  /**
   * Delete an image by its internal storage ID.
   * Used by protocols that support explicit deletion (e.g. Kitty a=d).
   */
  public deleteImage(id: number): number {
    return this.deleteImages([id]);
  }

  public deleteImages(ids: Iterable<number>): number {
    const uniqueIds = new Set(ids);
    this._rebuildImageCellIndex(uniqueIds);
    const clearedCells = this._clearImageCells(uniqueIds);
    for (const id of uniqueIds) {
      const spec = this._images.get(id);
      const evicted = this._evictedImages.get(id);
      if (spec || evicted || this._imageCells.has(id)) {
        (spec?.marker ?? evicted?.marker)?.dispose();
        this._delImg(id);
      }
    }
    if (uniqueIds.size) {
      this._needsFullClear = true;
      this._fullyCleared = false;
      this._terminal._core._inputHandler._dirtyRowTracker.markAllDirty();
    }
    return clearedCells;
  }

  public getVisibleImageStorageIds(): Set<number> {
    const result = new Set<number>();
    const buffer = this._terminal._core.buffer;
    const end = Math.min(buffer.ybase + this._terminal.rows, buffer.lines.length);
    for (let row = buffer.ybase; row < end; row++) {
      const line = buffer.lines.get(row);
      if (!line) {
        continue;
      }
      for (let col = 0; col < this._terminal.cols; col++) {
        const payload = line.getExtended(col)?.payload;
        if (payload instanceof ImageTileInfo && payload.imageId !== -1 && this._imageCells.has(payload.imageId)) {
          result.add(payload.imageId);
        }
      }
    }
    return result;
  }

  public reconcileImageCellIndexes(imageIds: Iterable<number>): void {
    this._rebuildImageCellIndex(new Set(imageIds));
  }

  /**
   * Method to add an image to the storage.
   * @param img - The image to add (canvas or bitmap).
   * @param opts - Options for addImage:
   *   - scrolling:  When true, cursor advances with the image.
   *                 When false, image is placed at ORIGIN and cursor does not move.
   *   - layer:      Which canvas layer to render on ('top' or 'bottom').
   *   - zIndex:     Z-index for image layering within the same layer.
   *   - cursorPos:  'vt340' for bottom-left, 'iip' for bottom.right.
   * @returns The internal image ID assigned to the stored image.
   */
  public addImage(img: HTMLCanvasElement | ImageBitmap, opts: IAddImageOpts): number {
    // never allow storage to exceed memory limit
    this._evictOldest(img.width * img.height);

    // calc rows x cols needed to display the image
    let cellSize = this._renderer.cellSize;
    if (cellSize.width === -1 || cellSize.height === -1) {
      cellSize = CELL_SIZE_DEFAULT;
    }
    const cols = Math.ceil(img.width / cellSize.width);
    const rows = Math.ceil(img.height / cellSize.height);

    const imageId = ++this._lastId;
    this._imageCells.set(imageId, new Map());

    const buffer = this._terminal._core.buffer;
    const termCols = this._terminal.cols;
    const termRows = this._terminal.rows;
    const originX = buffer.x;
    const originY = buffer.y;
    let offset = originX;
    let tileCount = 0;

    if (!opts.scrolling) {
      buffer.x = 0;
      buffer.y = 0;
      offset = 0;
    }

    this._terminal._core._inputHandler._dirtyRowTracker.markDirty(buffer.y);
    for (let row = 0; row < rows; ++row) {
      const line = buffer.lines.get(buffer.y + buffer.ybase)!;
      for (let col = 0; col < cols; ++col) {
        if (offset + col >= termCols) break;
        this._writeToCell(line, offset + col, imageId, row * cols + col);
        tileCount++;
      }
      if (opts.scrolling) {
        if (row < rows - 1) this._terminal._core._inputHandler.lineFeed();
      } else {
        if (++buffer.y >= termRows) break;
      }
      buffer.x = offset;
    }
    this._terminal._core._inputHandler._dirtyRowTracker.markDirty(buffer.y);

    // cursor positioning modes
    if (opts.scrolling) {
      if (opts.cursorPos === 'iip') {
        buffer.x = Math.min(offset + cols, termCols);
      } else {
        buffer.x = offset;
      }
    } else {
      buffer.x = originX;
      buffer.y = originY;
    }

    // deleted images with zero tile count
    const zero = [];
    for (const [id, spec] of this._images.entries()) {
      if (spec.tileCount < 1) {
        spec.marker?.dispose();
        zero.push(id);
      }
    }
    for (const id of zero) {
      this._delImg(id);
    }

    // eviction marker:
    // delete the image when the marker gets disposed
    const endMarker = this._terminal.registerMarker(0);
    endMarker?.onDispose(() => {
      this._delImg(imageId);
    });

    // since markers do not work on alternate for some reason,
    // we evict images here manually
    if (this._terminal.buffer.active.type === 'alternate') {
      this._evictOnAlternate();
    }

    // create storage entry
    const imgSpec: IImageSpec = {
      orig: img,
      origCellSize: cellSize,
      actual: img,
      actualCellSize: { ...cellSize },  // clone needed, since later modified
      marker: endMarker || undefined,
      tileCount,
      bufferType: this._terminal.buffer.active.type,
      layer: opts.layer,
      zIndex: opts.zIndex
    };

    // finally add the image
    this._images.set(imageId, imgSpec);
    this.onImageAdded?.();
    return imageId;
  }


  /**
   * Render method. Collects buffer information and triggers
   * canvas updates.
   */
  // TODO: Should we move this to the ImageRenderer?
  public render(range: { start: number, end: number }): void {
    // Determine which layers have images
    let hasTopImages = false;
    let hasBottomImages = false;
    for (const spec of this._images.values()) {
      if (spec.layer === 'bottom') {
        hasBottomImages = true;
      } else {
        hasTopImages = true;
      }
      if (hasTopImages && hasBottomImages) break;
    }
    if (!hasTopImages || !hasBottomImages) {
      for (const spec of this._evictedImages.values()) {
        if (spec.layer === 'bottom') {
          hasBottomImages = true;
        } else {
          hasTopImages = true;
        }
        if (hasTopImages && hasBottomImages) break;
      }
    }

    // Lazily insert layers that are needed
    if (hasTopImages && !this._renderer.hasLayer('top')) {
      this._renderer.insertLayerToDom('top');
      if (!this._renderer.hasLayer('top')) return;
    }
    if (hasBottomImages && !this._renderer.hasLayer('bottom')) {
      this._renderer.insertLayerToDom('bottom');
    }

    // rescale if needed
    this._renderer.rescaleCanvas();

    // exit early if we dont have any images to test for
    if (!this._images.size && !this._evictedImages.size) {
      if (!this._fullyCleared) {
        this._renderer.clearAll();
        this._fullyCleared = true;
        this._needsFullClear = false;
      }
      if (this._renderer.hasLayer('top')) {
        this._renderer.removeLayerFromDom('top');
      }
      if (this._renderer.hasLayer('bottom')) {
        this._renderer.removeLayerFromDom('bottom');
      }
      return;
    }

    // Remove layers no longer needed
    if (!hasTopImages && this._renderer.hasLayer('top')) {
      this._renderer.clearAll('top');
      this._renderer.removeLayerFromDom('top');
    }
    if (!hasBottomImages && this._renderer.hasLayer('bottom')) {
      this._renderer.clearAll('bottom');
      this._renderer.removeLayerFromDom('bottom');
    }

    // buffer switches force a full clear
    if (this._needsFullClear) {
      this._renderer.clearAll();
      this._fullyCleared = true;
      this._needsFullClear = false;
    }

    const { start, end } = range;
    const buffer = this._terminal._core.buffer;
    const cols = this._terminal._core.cols;

    // clear drawing area
    this._renderer.clearLines(start, end);

    // Collect draw calls so we can sort by z-index (lower z drawn first).
    const drawCalls: { imgSpec: IImageSpec, tileId: number, col: number, row: number, count: number }[] = [];
    const placeholderCalls: { col: number, row: number, count: number, layer: ImageLayer }[] = [];

    // walk all cells in viewport and collect tiles found
    for (let row = start; row <= end; ++row) {
      const line = buffer.lines.get(row + buffer.ydisp);
      if (!line) return;
      for (let col = 0; col < cols; ++col) {
        const e = line.getExtended(col)?.payload;
        if (e instanceof ImageTileInfo) {
          const imageId = e.imageId;
          if (imageId === undefined || imageId === -1) {
            continue;
          }
          const imgSpec = this._images.get(imageId);
          if (e.tileId !== -1) {
            const startTile = e.tileId;
            const startCol = col;
            let count = 1;
            /**
             * merge tiles to the right into a single draw call, if:
             * - not at end of line
             * - cell has same image id
             * - cell has consecutive tile id
             */
            while (++col < cols) {
              const nextE = line.getExtended(col)?.payload;
              if (!(nextE instanceof ImageTileInfo) || nextE.imageId !== imageId || nextE.tileId !== startTile + count) {
                break;
              }
              count++;
            }
            col--;
            if (imgSpec) {
              if (imgSpec.actual) {
                drawCalls.push({ imgSpec, tileId: startTile, col: startCol, row, count });
              }
            } else if (this._opts.showPlaceholder) {
              placeholderCalls.push({
                col: startCol,
                row,
                count,
                layer: this._evictedImages.get(imageId)?.layer ?? 'top'
              });
            }
            this._fullyCleared = false;
          }
        }
      }
    }

    // Sort by z-index so lower z draws first (higher z renders on top)
    drawCalls.sort((a, b) => a.imgSpec.zIndex - b.imgSpec.zIndex);

    // Draw placeholders first (lowest priority)
    for (const call of placeholderCalls) {
      this._renderer.drawPlaceholder(call.col, call.row, call.count, call.layer);
    }

    // Draw images in z-index order
    for (const call of drawCalls) {
      this._renderer.draw(call.imgSpec, call.tileId, call.col, call.row, call.count);
    }
  }

  public viewportResize(metrics: { cols: number, rows: number }): void {
    // exit early if we have nothing in storage
    if (!this._images.size && !this._evictedImages.size) {
      this._viewportMetrics = metrics;
      return;
    }

    if (metrics.cols !== this._viewportMetrics.cols) {
      this._rebuildImageCellIndex();
    }

    // handle only viewport width enlargements, exit all other cases
    // TODO: needs patch for tile counter
    if (this._viewportMetrics.cols >= metrics.cols) {
      this._viewportMetrics = metrics;
      return;
    }

    // walk scrollbuffer at old col width to find all possible expansion matches
    const buffer = this._terminal._core.buffer;
    const rows = buffer.lines.length;
    const oldCol = this._viewportMetrics.cols - 1;
    for (let row = 0; row < rows; ++row) {
      const line = buffer.lines.get(row)!;
      const e = line.getExtended(oldCol)?.payload;
      if (e instanceof ImageTileInfo) {
        const imageId = e.imageId;
        if (imageId === undefined || imageId === -1) {
          continue;
        }
        const imgSpec = this._images.get(imageId);
        if (!imgSpec) {
          continue;
        }
        // found an image tile at oldCol, check if it qualifies for right exapansion
        const tilesPerRow = Math.ceil((imgSpec.actual?.width || 0) / imgSpec.actualCellSize.width);
        if ((e.tileId % tilesPerRow) + 1 >= tilesPerRow) {
          continue;
        }
        // expand only if right side is empty (nothing got wrapped from below)
        let hasData = false;
        for (let rightCol = oldCol + 1; rightCol > metrics.cols; ++rightCol) {
          if (line.hasContent(rightCol)) {
            hasData = true;
            break;
          }
        }
        if (hasData) {
          continue;
        }
        // do right expansion on terminal buffer
        const end = Math.min(metrics.cols, tilesPerRow - (e.tileId % tilesPerRow) + oldCol);
        let lastTile = e.tileId;
        for (let expandCol = oldCol + 1; expandCol < end; ++expandCol) {
          this._writeToCell(line, expandCol, imageId, ++lastTile);
          imgSpec.tileCount++;
        }
      }
    }
    // store new viewport metrics
    this._viewportMetrics = metrics;
  }

  /**
   * Retrieve original canvas at buffer position.
   */
  public getImageAtBufferCell(x: number, y: number): HTMLCanvasElement | undefined {
    const buffer = this._terminal._core.buffer;
    const line = buffer.lines.get(y);
    if (line) {
      const e = line.getExtended(x)?.payload;
      if (e instanceof ImageTileInfo && e.imageId && e.imageId !== -1) {
        const orig = this._images.get(e.imageId)?.orig;
        if (window.ImageBitmap && orig instanceof ImageBitmap) {
          const canvas = ImageRenderer.createCanvas(window.document, orig.width, orig.height);
          canvas.getContext('2d')?.drawImage(orig, 0, 0, orig.width, orig.height);
          return canvas;
        }
        return orig as HTMLCanvasElement;
      }
    }
  }

  /**
   * Extract active single tile at buffer position.
   */
  public extractTileAtBufferCell(x: number, y: number): HTMLCanvasElement | undefined {
    const buffer = this._terminal._core.buffer;
    const line = buffer.lines.get(y);
    if (line) {
      const e = line.getExtended(x)?.payload;
      if (e instanceof ImageTileInfo && e.imageId && e.imageId !== -1 && e.tileId !== -1) {
        const spec = this._images.get(e.imageId);
        if (spec) {
          return this._renderer.extractTile(spec, e.tileId);
        }
      }
    }
  }

  // TODO: Do we need some blob offloading tricks here to avoid early eviction?
  // also see https://stackoverflow.com/questions/28307789/is-there-any-limitation-on-javascript-max-blob-size
  private _evictOldest(room: number): number {
    const used = this._getStoredPixels();
    let current = used;
    let evictedImage = false;
    for (const cache of this._pixelCaches) {
      const needed = current + room - this._pixelLimit;
      if (needed <= 0) {
        break;
      }
      current -= cache.evict(needed);
    }
    while (this._pixelLimit < current + room && this._images.size) {
      const spec = this._images.get(++this._lowestId);
      if (spec && spec.orig) {
        current -= spec.orig.width * spec.orig.height;
        if (spec.actual && spec.orig !== spec.actual) {
          current -= spec.actual.width * spec.actual.height;
        }
        this._images.delete(this._lowestId);
        this._evictedImages.set(this._lowestId, {
          marker: spec.marker,
          bufferType: spec.bufferType,
          layer: spec.layer
        });
        evictedImage = true;
        if (window.ImageBitmap && spec.orig instanceof ImageBitmap) {
          spec.orig.close();
        }
      }
    }
    if (evictedImage) {
      this._needsFullClear = true;
      this._fullyCleared = false;
      this._terminal._core._inputHandler._dirtyRowTracker.markAllDirty();
      this._terminal._core._renderService.refreshRows(0, this._terminal.rows - 1);
    }
    return used - current;
  }

  private _writeToCell(line: IBufferLine, x: number, imageId: number, tileId: number): void {
    const workCell = this._workCell;
    line.loadCell(x, workCell);
    if (workCell.hasExtendedAttrs()) {
      const old = workCell.extended.payload;
      if (old instanceof ImageTileInfo) {
        const oldSpec = this._images.get(old.imageId);
        if (oldSpec) {
          // early eviction for in-viewport overwrites
          oldSpec.tileCount--;
        }
        this._untrackCell(old.imageId, line, x);
        old.imageId = imageId;
        old.tileId = tileId;
        this._trackCell(imageId, line, x);
        return;
      }
    }
    // Image payloads must not reuse an ExtendedAttrs instance owned by another cell.
    const extattr = workCell.extended.clone();
    extattr.payload = new ImageTileInfo(imageId, tileId);
    workCell.extended = extattr;
    workCell.updateExtended();
    line.setCell(x, workCell);
    this._trackCell(imageId, line, x);
  }

  private _trackCell(imageId: number, line: IBufferLine, x: number): void {
    let lines = this._imageCells.get(imageId);
    if (!lines) {
      lines = new Map();
      this._imageCells.set(imageId, lines);
    }
    let columns = lines.get(line);
    if (!columns) {
      columns = new Set();
      lines.set(line, columns);
    }
    columns.add(x);
  }

  private _untrackCell(imageId: number, line: IBufferLine, x: number): void {
    const lines = this._imageCells.get(imageId);
    if (!lines) {
      return;
    }
    const columns = lines.get(line);
    if (!columns) {
      return;
    }
    const deleted = columns.delete(x);
    let remainingColumns = columns;
    if (!deleted || !columns.size) {
      const shiftedColumns = new Set<number>();
      for (let column = 0; column < line.length; column++) {
        const payload = line.getExtended(column)?.payload;
        if (column !== x && payload instanceof ImageTileInfo && payload.imageId === imageId) {
          shiftedColumns.add(column);
        }
      }
      if (shiftedColumns.size) {
        lines.set(line, shiftedColumns);
        remainingColumns = shiftedColumns;
      } else {
        lines.delete(line);
      }
    }
    if (!remainingColumns.size) {
      lines.delete(line);
    }
    if (!lines.size && this._evictedImages.has(imageId)) {
      this._evictedImages.get(imageId)?.marker?.dispose();
      this._delImg(imageId);
    }
  }

  private _clearImageCells(imageIds: ReadonlySet<number>): number {
    let cleared = 0;
    for (const imageId of imageIds) {
      const lines = this._imageCells.get(imageId);
      if (!lines) {
        continue;
      }
      for (const [line, columns] of lines) {
        for (const x of columns) {
          line.loadCell(x, this._workCell);
          const payload = this._workCell.extended.payload;
          if (!(payload instanceof ImageTileInfo) || payload.imageId !== imageId) {
            continue;
          }
          const extattr = this._workCell.extended.clone();
          extattr.payload = undefined;
          this._workCell.extended = extattr;
          this._workCell.updateExtended();
          line.setCell(x, this._workCell);
          cleared++;
        }
      }
    }
    return cleared;
  }

  private _rebuildImageCellIndex(imageIds?: ReadonlySet<number>): void {
    const targetIds = imageIds ?? new Set([
      ...this._images.keys(),
      ...this._evictedImages.keys(),
      ...this._imageCells.keys()
    ]);
    if (!imageIds) {
      this._imageCells.clear();
    }
    for (const imageId of targetIds) {
      const spec = this._images.get(imageId);
      if (!spec && !this._evictedImages.has(imageId) && !this._imageCells.has(imageId)) {
        continue;
      }
      this._imageCells.set(imageId, new Map());
      if (spec) {
        spec.tileCount = 0;
      }
    }
    const buffers = [this._terminal._core.buffers.normal, this._terminal._core.buffers.alt];
    for (const buffer of buffers) {
      for (let y = 0; y < buffer.lines.length; y++) {
        const line = buffer.lines.get(y);
        if (!line) {
          continue;
        }
        for (let x = 0; x < line.length; x++) {
          const payload = line.getExtended(x)?.payload;
          if (!(payload instanceof ImageTileInfo) || !targetIds.has(payload.imageId) || !this._imageCells.has(payload.imageId)) {
            continue;
          }
          this._trackCell(payload.imageId, line, x);
          const spec = this._images.get(payload.imageId);
          if (spec) {
            spec.tileCount++;
          }
        }
      }
    }
    const emptyImageIds = [...targetIds].filter(imageId => {
      const lines = this._imageCells.get(imageId);
      return !!lines && !lines.size;
    });
    for (const imageId of emptyImageIds) {
      const marker = this._images.get(imageId)?.marker ?? this._evictedImages.get(imageId)?.marker;
      marker?.dispose();
      this._delImg(imageId);
    }
  }

  private _evictOnAlternate(): void {
    // nullify tile count of all images on alternate buffer
    for (const spec of this._images.values()) {
      if (spec.bufferType === 'alternate') {
        spec.tileCount = 0;
      }
    }
    // re-count tiles on whole buffer
    const buffer = this._terminal._core.buffer;
    for (let y = 0; y < this._terminal.rows; ++y) {
      const line = buffer.lines.get(y);
      if (!line) {
        continue;
      }
      for (let x = 0; x < this._terminal.cols; ++x) {
        const payload = line.getExtended(x)?.payload;
        if (payload instanceof ImageTileInfo) {
          const spec = this._images.get(payload.imageId);
          if (spec) {
            spec.tileCount++;
          }
        }
      }
    }
    // deleted images with zero tile count
    const zero = [];
    for (const [id, spec] of this._images.entries()) {
      if (spec.bufferType === 'alternate' && !spec.tileCount) {
        spec.marker?.dispose();
        zero.push(id);
      }
    }
    for (const id of zero) {
      this._delImg(id);
    }
  }
}
