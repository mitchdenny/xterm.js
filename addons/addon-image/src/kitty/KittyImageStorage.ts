/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { IDisposable } from '@xterm/xterm';
import { IImageStoragePixelCache, ImageStorage } from '../ImageStorage';
import { ImageLayer, IAddImageOpts } from '../Types';
import { IKittyImageData } from './KittyGraphicsTypes';

interface IStoredKittyImage extends IKittyImageData {
  decodedSource?: ImageBitmap;
  decodePromise?: Promise<ImageBitmap>;
  decodedPixels: number;
  lastDecodeUse: number;
  decodeGeneration: number;
}

interface IKittyPlacement {
  imageId: number;
  placementId: number;
}

const enum Constants {
  MAX_STORED_IMAGES = 256
}

// Kitty-specific image storage controller.
//
// Transmitted image data is image-scoped and survives placement deletion.
// Displayed placements are tracked independently by (image id, placement id);
// omitted/zero placement ids are anonymous and additive.
export class KittyImageStorage implements IDisposable, IImageStoragePixelCache {
  private _nextImageId = 1;
  private _decodeUseSequence = 0;
  private _decodedPixels = 0;
  private _operationGeneration = 0;
  private _isDisposed = false;
  private readonly _images: Map<number, IStoredKittyImage> = new Map();
  private readonly _namedPlacements: Map<number, Map<number, number>> = new Map();
  private readonly _anonymousPlacements: Map<number, Set<number>> = new Map();
  private readonly _storageIdToPlacement: Map<number, IKittyPlacement> = new Map();

  private readonly _previousOnImageDeleted: ((storageId: number) => void) | undefined;
  private readonly _wrappedOnImageDeleted: (storageId: number) => void;
  private readonly _pixelCacheRegistration: IDisposable;
  private readonly _handleStorageImageDeleted = (storageId: number): void => {
    const placement = this._storageIdToPlacement.get(storageId);
    if (!placement) {
      return;
    }
    this._storageIdToPlacement.delete(storageId);
    if (placement.placementId > 0) {
      const named = this._namedPlacements.get(placement.imageId);
      named?.delete(placement.placementId);
      if (!named?.size) {
        this._namedPlacements.delete(placement.imageId);
      }
    } else {
      const anonymous = this._anonymousPlacements.get(placement.imageId);
      anonymous?.delete(storageId);
      if (!anonymous?.size) {
        this._anonymousPlacements.delete(placement.imageId);
      }
    }
  };
  private _addImageOpts: IAddImageOpts = { scrolling: true, layer: 'top', zIndex: 0, cursorPos: 'iip' };

  constructor(
    private readonly _storage: ImageStorage
  ) {
    this._previousOnImageDeleted = this._storage.onImageDeleted;
    this._wrappedOnImageDeleted = (storageId: number) => {
      this._previousOnImageDeleted?.(storageId);
      this._handleStorageImageDeleted(storageId);
    };
    this._storage.onImageDeleted = this._wrappedOnImageDeleted;
    this._pixelCacheRegistration = this._storage.registerPixelCache(this);
  }

  public reset(): void {
    this._invalidatePlacementOperations();
    this._deleteAllPlacements();
    this.clear();
    this._nextImageId = 1;
    this._images.clear();
    this._namedPlacements.clear();
    this._anonymousPlacements.clear();
    this._storageIdToPlacement.clear();
  }

  public dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this.reset();
    this._isDisposed = true;
    this._invalidatePlacementOperations();
    this._pixelCacheRegistration.dispose();
    if (this._storage.onImageDeleted === this._wrappedOnImageDeleted) {
      this._storage.onImageDeleted = this._previousOnImageDeleted;
    }
  }

  public storeImage(id: number | undefined, imageData: Omit<IKittyImageData, 'id'>): number {
    this._invalidatePlacementOperations();
    const imageId = id ?? this._nextImageId++;

    this._deletePlacements(imageId);
    if (this._images.has(imageId)) {
      this._deleteImageData(imageId);
    }

    if (this._images.size >= Constants.MAX_STORED_IMAGES) {
      this._evictUndisplayedImages();
      while (this._images.size >= Constants.MAX_STORED_IMAGES) {
        const oldestImageId = this._images.keys().next().value;
        if (oldestImageId === undefined) {
          break;
        }
        this._deletePlacements(oldestImageId);
        this._deleteImageData(oldestImageId);
      }
    }

    this._images.set(imageId, {
      ...imageData,
      id: imageId,
      decodedPixels: 0,
      lastDecodeUse: 0,
      decodeGeneration: 0
    });
    return imageId;
  }

  public addImage(kittyId: number, placementId: number, image: HTMLCanvasElement | ImageBitmap, scrolling: boolean, layer: ImageLayer, zIndex: number): void {
    if (placementId > 0) {
      const oldStorageId = this._namedPlacements.get(kittyId)?.get(placementId);
      if (oldStorageId !== undefined) {
        this._storage.deleteImage(oldStorageId);
      }
    }

    this._addImageOpts.scrolling = scrolling;
    this._addImageOpts.layer = layer;
    this._addImageOpts.zIndex = zIndex;
    const storageId = this._storage.addImage(image, this._addImageOpts);
    this._storageIdToPlacement.set(storageId, { imageId: kittyId, placementId });

    if (placementId > 0) {
      let named = this._namedPlacements.get(kittyId);
      if (!named) {
        named = new Map();
        this._namedPlacements.set(kittyId, named);
      }
      named.set(placementId, storageId);
    } else {
      let anonymous = this._anonymousPlacements.get(kittyId);
      if (!anonymous) {
        anonymous = new Set();
        this._anonymousPlacements.set(kittyId, anonymous);
      }
      anonymous.add(storageId);
    }
  }

  public getImage(kittyId: number): IKittyImageData | undefined {
    return this._images.get(kittyId);
  }

  public getDecodedImage(kittyId: number, decode: () => Promise<ImageBitmap>): Promise<ImageBitmap> {
    const image = this._images.get(kittyId);
    if (!image) {
      return Promise.reject(new Error('image not found'));
    }
    image.lastDecodeUse = ++this._decodeUseSequence;
    if (image.decodedSource) {
      return Promise.resolve(image.decodedSource);
    }
    if (image.decodePromise) {
      return image.decodePromise;
    }

    const generation = image.decodeGeneration;
    const promise = decode().then(bitmap => {
      if (this._images.get(kittyId) !== image || image.decodeGeneration !== generation) {
        bitmap.close();
        throw new Error('image data was deleted while decoding');
      }
      image.decodePromise = undefined;
      image.decodedSource = bitmap;
      image.decodedPixels = bitmap.width * bitmap.height;
      image.lastDecodeUse = ++this._decodeUseSequence;
      this._decodedPixels += image.decodedPixels;
      return bitmap;
    }, error => {
      if (image.decodePromise === promise) {
        image.decodePromise = undefined;
      }
      throw error;
    });
    image.decodePromise = promise;
    return promise;
  }

  public get operationGeneration(): number {
    return this._operationGeneration;
  }

  public isPlacementOperationCurrent(generation: number, image: IKittyImageData): boolean {
    return !this._isDisposed &&
      generation === this._operationGeneration &&
      this._images.get(image.id) === image;
  }

  public enforceCacheLimit(): void {
    this._storage.enforceLimit();
  }

  public deletePlacements(kittyId: number, placementId?: number): void {
    this._invalidatePlacementOperations();
    this._deletePlacements(kittyId, placementId);
  }

  public deleteVisiblePlacements(freeData: boolean): void {
    this._invalidatePlacementOperations();
    const storageIds = new Set<number>();
    const kittyIds = new Set<number>();
    for (const storageId of this._storage.getVisibleImageStorageIds()) {
      const placement = this._storageIdToPlacement.get(storageId);
      if (placement) {
        storageIds.add(storageId);
        kittyIds.add(placement.imageId);
      }
    }
    if (storageIds.size) {
      this._storage.deleteImages(storageIds);
    }
    if (freeData) {
      for (const kittyId of kittyIds) {
        if (!this._hasPlacements(kittyId)) {
          this._deleteImageData(kittyId);
        }
      }
    }
  }

  public deleteImage(kittyId: number, placementId?: number): void {
    this._invalidatePlacementOperations();
    const placementDeleted = this._deletePlacements(kittyId, placementId);
    if (placementId !== undefined && placementId > 0 && !placementDeleted) {
      return;
    }
    if (!this._hasPlacements(kittyId)) {
      this._deleteImageData(kittyId);
    }
  }

  private _deletePlacements(kittyId: number, placementId?: number): boolean {
    if (placementId !== undefined && placementId > 0) {
      const storageId = this._namedPlacements.get(kittyId)?.get(placementId);
      if (storageId !== undefined) {
        this._storage.deleteImage(storageId);
        return true;
      }
      return false;
    }

    const storageIds = this._getPlacementStorageIds(kittyId);
    if (storageIds.length) {
      this._storage.deleteImages(storageIds);
    }
    return storageIds.length > 0;
  }

  private _deleteAllPlacements(): void {
    const storageIds = [...this._storageIdToPlacement.keys()];
    if (storageIds.length) {
      this._storage.deleteImages(storageIds);
    }
  }

  public get pixelCount(): number {
    return this._decodedPixels;
  }

  public evict(pixels: number): number {
    let freed = 0;
    const candidates = [...this._images.values()]
      .filter(image => image.decodedSource)
      .sort((a, b) => a.lastDecodeUse - b.lastDecodeUse);
    for (const image of candidates) {
      if (freed >= pixels) {
        break;
      }
      freed += image.decodedPixels;
      this._dropDecodedSource(image);
    }
    return freed;
  }

  public clear(): void {
    for (const image of this._images.values()) {
      this._dropDecodedSource(image);
    }
  }

  public get images(): ReadonlyMap<number, IKittyImageData> {
    return this._images;
  }

  public get kittyIdToStorageId(): ReadonlyMap<number, number> {
    const result = new Map<number, number>();
    for (const [kittyId, placements] of this._namedPlacements) {
      const storageId = placements.values().next().value;
      if (storageId !== undefined) {
        result.set(kittyId, storageId);
      }
    }
    for (const [kittyId, placements] of this._anonymousPlacements) {
      if (result.has(kittyId)) {
        continue;
      }
      const storageId = placements.values().next().value;
      if (storageId !== undefined) {
        result.set(kittyId, storageId);
      }
    }
    return result;
  }

  public get lastImageId(): number {
    return this._nextImageId - 1;
  }

  private _getPlacementStorageIds(kittyId: number): number[] {
    return [
      ...this._namedPlacements.get(kittyId)?.values() ?? [],
      ...this._anonymousPlacements.get(kittyId)?.values() ?? []
    ];
  }

  private _deleteImageData(kittyId: number): void {
    const image = this._images.get(kittyId);
    if (!image) {
      return;
    }
    this._dropDecodedSource(image);
    this._images.delete(kittyId);
  }

  private _hasPlacements(kittyId: number): boolean {
    return !!this._namedPlacements.get(kittyId)?.size ||
      !!this._anonymousPlacements.get(kittyId)?.size;
  }

  private _invalidatePlacementOperations(): void {
    this._operationGeneration++;
  }

  private _dropDecodedSource(image: IStoredKittyImage): void {
    image.decodeGeneration++;
    image.decodePromise = undefined;
    if (image.decodedSource) {
      image.decodedSource.close();
      image.decodedSource = undefined;
      this._decodedPixels -= image.decodedPixels;
    }
    image.decodedPixels = 0;
  }

  private _evictUndisplayedImages(): void {
    for (const [kittyId] of this._images) {
      if (this._images.size <= Constants.MAX_STORED_IMAGES / 2) {
        break;
      }
      if (!this._namedPlacements.has(kittyId) && !this._anonymousPlacements.has(kittyId)) {
        this._deleteImageData(kittyId);
      }
    }
  }
}
