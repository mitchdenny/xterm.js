/**
 * Copyright (c) 2018 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { BaseWindow } from './baseWindow';
import type { IControlWindow } from '../controlBar';
import type { IImageAddonOptions } from '@xterm/addon-image';

const enum Constants {
  KITTY_PLACEMENT_IMAGE_ID = 900,
  KITTY_CUBE_IMAGE_ID = 1000,
  KITTY_CUBE_FRAME_COUNT = 60,
  KITTY_CUBE_SIZE = 200
}

export class AddonImageWindow extends BaseWindow implements IControlWindow {
  public readonly id = 'addon-image';
  public readonly label = 'image';

  private _imageStorageLimitInput!: HTMLInputElement;
  private _imageShowPlaceholderCheckbox!: HTMLInputElement;
  private _imageOptionsTextarea!: HTMLTextAreaElement;

  public build(container: HTMLElement): void {
    // Storage limit
    const storageLimitLabel = document.createElement('label');
    storageLimitLabel.textContent = 'Storage Limit (in MB) ';
    this._imageStorageLimitInput = document.createElement('input');
    this._imageStorageLimitInput.type = 'number';
    this._imageStorageLimitInput.id = 'image-storagelimit';
    storageLimitLabel.appendChild(this._imageStorageLimitInput);
    container.appendChild(storageLimitLabel);
    container.appendChild(document.createElement('br'));

    // Show placeholder
    const placeholderLabel = document.createElement('label');
    placeholderLabel.textContent = 'Show Placeholder ';
    this._imageShowPlaceholderCheckbox = document.createElement('input');
    this._imageShowPlaceholderCheckbox.type = 'checkbox';
    this._imageShowPlaceholderCheckbox.id = 'image-showplaceholder';
    placeholderLabel.appendChild(this._imageShowPlaceholderCheckbox);
    container.appendChild(placeholderLabel);
    container.appendChild(document.createElement('br'));
    container.appendChild(document.createElement('br'));

    // Ctor options
    const optionsLabel = document.createElement('label');
    optionsLabel.appendChild(document.createTextNode('Ctor options (applied on addon relaunch)'));
    optionsLabel.appendChild(document.createElement('br'));
    this._imageOptionsTextarea = document.createElement('textarea');
    this._imageOptionsTextarea.id = 'image-options';
    this._imageOptionsTextarea.cols = 40;
    this._imageOptionsTextarea.rows = 12;
    optionsLabel.appendChild(this._imageOptionsTextarea);
    container.appendChild(optionsLabel);

    container.appendChild(document.createElement('br'));
    container.appendChild(document.createElement('br'));

    // Sixel demos
    const dlSixel = document.createElement('dl');
    const dtSixel = document.createElement('dt');
    dtSixel.textContent = 'Sixel';
    dlSixel.appendChild(dtSixel);
    this._addDdWithButton(dlSixel, 'image-demo1', 'snake');
    this._addDdWithButton(dlSixel, 'image-demo2', 'oranges');
    container.appendChild(dlSixel);

    // IIP demos
    const dlIip = document.createElement('dl');
    const dtIip = document.createElement('dt');
    dtIip.textContent = 'IIP (iTerm)';
    dlIip.appendChild(dtIip);
    this._addDdWithButton(dlIip, 'image-demo3', 'palette (png File)');
    this._addDdWithButton(dlIip, 'image-demo4', 'dice (qoi MultipartFile)');
    this._addDdWithButton(dlIip, 'image-demo5', 'rose (webp File)');
    this._addDdWithButton(dlIip, 'image-demo6', 'kimono (avif MultipartFile)');
    container.appendChild(dlIip);

    // Kitty demos
    const dlKitty = document.createElement('dl');
    const dtKitty = document.createElement('dt');
    dtKitty.textContent = 'Kitty';
    dlKitty.appendChild(dtKitty);
    this._addDdWithButton(dlKitty, 'image-demo-kitty1', 'palette');
    this._addDdWithButton(dlKitty, 'image-demo-kitty-placement-rain', 'placement rain (10 seconds)');
    this._addDdWithButton(dlKitty, 'image-demo-kitty-placement-cube', 'wireframe cube (15 seconds)');
    container.appendChild(dlKitty);

    this._initImageAddonExposed();
  }

  public get imageStorageLimitInput(): HTMLInputElement {
    return this._imageStorageLimitInput;
  }

  public get imageShowPlaceholderCheckbox(): HTMLInputElement {
    return this._imageShowPlaceholderCheckbox;
  }

  public get imageOptionsTextarea(): HTMLTextAreaElement {
    return this._imageOptionsTextarea;
  }

  private _addDdWithButton(dl: HTMLElement, id: string, label: string): HTMLButtonElement {
    const dd = document.createElement('dd');
    const button = document.createElement('button');
    button.id = id;
    button.textContent = label;
    dd.appendChild(button);
    dl.appendChild(dd);
    return button;
  }

  private _initImageAddonExposed(): void {
    const imageAddon = this._addons.image.instance!;
    const defaultOptions: IImageAddonOptions = (imageAddon as any)._defaultOpts;
    const limitStorageElement = document.querySelector<HTMLInputElement>('#image-storagelimit')!;
    limitStorageElement.valueAsNumber = imageAddon.storageLimit;
    this._addDomListener(limitStorageElement, 'change', () => {
      try {
        imageAddon.storageLimit = limitStorageElement.valueAsNumber;
        limitStorageElement.valueAsNumber = imageAddon.storageLimit;
        console.log('changed storageLimit to', imageAddon.storageLimit);
      } catch (e) {
        limitStorageElement.valueAsNumber = imageAddon.storageLimit;
        console.log('storageLimit at', imageAddon.storageLimit);
        throw e;
      }
    });
    const showPlaceholderElement = document.querySelector<HTMLInputElement>('#image-showplaceholder')!;
    showPlaceholderElement.checked = imageAddon.showPlaceholder;
    this._addDomListener(showPlaceholderElement, 'change', () => {
      imageAddon.showPlaceholder = showPlaceholderElement.checked;
    });
    const ctorOptionsElement = document.querySelector<HTMLTextAreaElement>('#image-options')!;
    ctorOptionsElement.value = JSON.stringify(defaultOptions, null, 2);

    const sixelDemo = (url: string) => () => fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(buffer => {
        this._terminal.write('\r\n');
        this._terminal.write(new Uint8Array(buffer));
      });

    const iipDemo = (url: string) => () => fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(buffer => {
        const data = new Uint8Array(buffer);
        let sdata = '';
        for (let i = 0; i < data.length; ++i) sdata += String.fromCharCode(data[i]);
        this._terminal.write('\r\n');
        this._terminal.write(`\x1b]1337;File=inline=1;size=${data.length}:${btoa(sdata)}\x1b\\`);
      });

    const iipDemoMulti = (url: string) => () => fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(buffer => {
        const data = new Uint8Array(buffer);
        let sdata = '';
        for (let i = 0; i < data.length; ++i) sdata += String.fromCharCode(data[i]);
        const encoded = btoa(sdata);
        this._terminal.write('\r\n');
        this._terminal.write(`\x1b]1337;MultipartFile=inline=1\x1b\\`);
        for (let i = 0; i < encoded.length; i += 100) {
          this._terminal.write(`\x1b]1337;FilePart=${encoded.slice(i, i + 100)}\x1b\\`);
        }
        this._terminal.write(`\x1b]1337;FileEnd\x1b\\`);
      });

    const kittyDemo = (url: string) => () => fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(buffer => {
        const data = new Uint8Array(buffer);
        let sdata = '';
        for (let i = 0; i < data.length; ++i) sdata += String.fromCharCode(data[i]);
        const payload = btoa(sdata);
        this._terminal.write('\r\n');
        this._terminal.write(`\x1b_Ga=T,f=100;${payload}\x1b\\`);
      });

    const setKittyAnimationButtonsDisabled = (disabled: boolean): void => {
      for (const id of ['image-demo-kitty-placement-rain', 'image-demo-kitty-placement-cube']) {
        (document.getElementById(id) as HTMLButtonElement).disabled = disabled;
      }
    };

    const kittyPlacementRainDemo = async (): Promise<void> => {
      const imageId = Constants.KITTY_PLACEMENT_IMAGE_ID;
      const write = (data: string): Promise<void> => new Promise(resolve => this._terminal.write(data, resolve));
      const delay = (duration: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, duration));
      const activeBuffer = this._terminal.buffer.active;
      const restoreCursor = `\x1b[${activeBuffer.cursorY + 1};${Math.min(this._terminal.cols, activeBuffer.cursorX + 1)}H`;
      const sprite = [
        '   1   ',
        '   1   ',
        '   2   ',
        '  222  ',
        '  222  ',
        ' 22222 ',
        ' 22222 ',
        '2222222',
        '2222222',
        ' 22222 ',
        '  222  ',
        '   2   '
      ];
      const spriteWidth = sprite[0].length;
      const spriteHeight = sprite.length;
      const pixels = new Uint8Array(spriteWidth * spriteHeight * 4);
      for (let y = 0; y < spriteHeight; y++) {
        for (let x = 0; x < spriteWidth; x++) {
          const shade = sprite[y][x];
          if (shade === ' ') {
            continue;
          }
          const offset = (y * spriteWidth + x) * 4;
          pixels[offset] = shade === '1' ? 125 : 56;
          pixels[offset + 1] = shade === '1' ? 211 : 189;
          pixels[offset + 2] = 248;
          pixels[offset + 3] = shade === '1' ? 160 : 230;
        }
      }
      let binary = '';
      for (const value of pixels) {
        binary += String.fromCharCode(value);
      }
      const payload = btoa(binary);

      const screen = this._terminal.element!.querySelector<HTMLElement>('.xterm-screen')!;
      const bounds = screen.getBoundingClientRect();
      const cellWidth = Math.max(1, Math.floor(bounds.width / this._terminal.cols));
      const cellHeight = Math.max(1, Math.floor(bounds.height / this._terminal.rows));
      const maxY = Math.max(cellHeight, (this._terminal.rows - 1) * cellHeight);
      const dropCount = Math.max(12, Math.min(40, Math.floor(this._terminal.cols / 2)));
      const drops = Array.from({ length: dropCount }, (_, index) => ({
        placementId: index + 1,
        column: 1 + Math.floor(Math.random() * this._terminal.cols),
        xOffset: Math.floor(Math.random() * Math.max(1, cellWidth - spriteWidth + 1)),
        y: Math.random() * maxY,
        speed: 60 + Math.random() * 120,
        visible: false
      }));

      setKittyAnimationButtonsDisabled(true);
      try {
        await write(`\x1b_Ga=t,f=32,s=${spriteWidth},v=${spriteHeight},i=${imageId},q=2;${payload}\x1b\\`);
        let previousFrame = performance.now();
        const endTime = previousFrame + 9000;
        while (performance.now() < endTime) {
          const frameStart = performance.now();
          const elapsed = Math.min((frameStart - previousFrame) / 1000, 0.1);
          previousFrame = frameStart;
          let sequence = '';
          for (const drop of drops) {
            drop.y += drop.speed * elapsed;
            if (drop.y >= maxY) {
              if (drop.visible) {
                sequence += `\x1b_Ga=d,d=i,i=${imageId},p=${drop.placementId},q=2\x1b\\`;
              }
              drop.column = 1 + Math.floor(Math.random() * this._terminal.cols);
              drop.xOffset = Math.floor(Math.random() * Math.max(1, cellWidth - spriteWidth + 1));
              drop.y = -spriteHeight - Math.random() * maxY * 0.15;
              drop.speed = 60 + Math.random() * 120;
              drop.visible = false;
              continue;
            }
            if (drop.y < 0) {
              continue;
            }
            const row = Math.floor(drop.y / cellHeight) + 1;
            const yOffset = Math.floor(drop.y % cellHeight);
            sequence += `\x1b[${row};${drop.column}H\x1b_Ga=p,i=${imageId},p=${drop.placementId},X=${drop.xOffset},Y=${yOffset},C=1,q=2\x1b\\`;
            drop.visible = true;
          }
          if (sequence) {
            await write(`${sequence}${restoreCursor}`);
          }
          const remainingFrameTime = 50 - (performance.now() - frameStart);
          if (remainingFrameTime > 0) {
            await delay(remainingFrameTime);
          }
        }

        const bottomRow = Math.max(1, this._terminal.rows - 1);
        await write(
          `\x1b[${bottomRow};2H\x1b_Ga=p,i=${imageId},p=0,C=1,q=2\x1b\\` +
          `\x1b[${bottomRow};4H\x1b_Ga=p,i=${imageId},p=0,C=1,q=2\x1b\\${restoreCursor}`
        );
        await delay(200);
        await write(`\x1b_Ga=d,d=a,q=2\x1b\\`);
        await delay(200);
        await write(`\x1b[${Math.ceil(this._terminal.rows / 2)};${Math.ceil(this._terminal.cols / 2)}H\x1b_Ga=p,i=${imageId},p=1,C=1,q=2\x1b\\${restoreCursor}`);
        await delay(300);
        await write(`\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\${restoreCursor}`);
      } finally {
        setKittyAnimationButtonsDisabled(false);
      }
    };

    const kittyPlacementCubeDemo = async (button: HTMLButtonElement): Promise<void> => {
      const write = (data: string): Promise<void> => new Promise(resolve => this._terminal.write(data, resolve));
      const delay = (duration: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, duration));
      const originalLabel = button.textContent;
      const activeBuffer = this._terminal.buffer.active;
      const restoreCursor = `\x1b[${activeBuffer.cursorY + 1};${Math.min(this._terminal.cols, activeBuffer.cursorX + 1)}H`;
      const vertices = [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
      ];
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ];
      const framePayloads: string[] = [];
      let canvas: HTMLCanvasElement | undefined;
      let transmittedFrameCount = 0;
      let currentImageId: number | undefined;
      let placementStarted = false;

      setKittyAnimationButtonsDisabled(true);
      button.textContent = 'preparing cube frames...';
      try {
        const screen = this._terminal.element!.querySelector<HTMLElement>('.xterm-screen')!;
        const bounds = screen.getBoundingClientRect();
        const cellWidth = Math.max(1, bounds.width / this._terminal.cols);
        const cellHeight = Math.max(1, bounds.height / this._terminal.rows);
        const availableSize = Math.floor(Math.min(bounds.width - cellWidth, bounds.height - cellHeight));
        if (availableSize < 32) {
          button.textContent = 'terminal too small for cube';
          await delay(1200);
          return;
        }
        const cubeSize = Math.min(Constants.KITTY_CUBE_SIZE, availableSize);
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = cubeSize;
        const context = canvas.getContext('2d')!;

        for (let frame = 0; frame < Constants.KITTY_CUBE_FRAME_COUNT; frame++) {
          const angle = frame / Constants.KITTY_CUBE_FRAME_COUNT * Math.PI * 2;
          const sinX = Math.sin(angle * 0.7);
          const cosX = Math.cos(angle * 0.7);
          const sinY = Math.sin(angle);
          const cosY = Math.cos(angle);
          const projected = vertices.map(([x, y, z]) => {
            const rotatedX = x * cosY - z * sinY;
            const rotatedZ = x * sinY + z * cosY;
            const rotatedY = y * cosX - rotatedZ * sinX;
            const depth = y * sinX + rotatedZ * cosX;
            const perspective = 2.8 / (depth + 4);
            return [
              cubeSize / 2 + rotatedX * cubeSize * 0.31 * perspective,
              cubeSize / 2 - rotatedY * cubeSize * 0.31 * perspective
            ];
          });

          context.clearRect(0, 0, canvas.width, canvas.height);
          context.strokeStyle = '#38bdf8';
          context.lineWidth = Math.max(1.5, cubeSize / 67);
          context.lineJoin = 'round';
          context.shadowColor = '#0ea5e9';
          context.shadowBlur = cubeSize / 25;
          for (const [start, end] of edges) {
            context.beginPath();
            context.moveTo(projected[start][0], projected[start][1]);
            context.lineTo(projected[end][0], projected[end][1]);
            context.stroke();
          }
          framePayloads.push(canvas.toDataURL('image/png').split(',')[1]);
        }

        for (let frame = 0; frame < framePayloads.length; frame++) {
          const imageId = Constants.KITTY_CUBE_IMAGE_ID + frame;
          await write(`\x1b_Ga=t,f=100,i=${imageId},q=2;${framePayloads[frame]}\x1b\\`);
          transmittedFrameCount++;
        }

        button.textContent = 'wireframe cube running...';
        const maxX = Math.max(0, bounds.width - cubeSize - 1);
        const maxY = Math.max(0, bounds.height - cubeSize - 1);
        let x = maxX / 3;
        let y = maxY / 3;
        let velocityX = 110;
        let velocityY = 80;
        const animationStart = performance.now();
        let previousFrame = animationStart;
        const endTime = animationStart + 15000;

        while (performance.now() < endTime) {
          const frameStart = performance.now();
          const elapsed = Math.min((frameStart - previousFrame) / 1000, 0.1);
          previousFrame = frameStart;
          x += velocityX * elapsed;
          y += velocityY * elapsed;
          if (x <= 0 || x >= maxX) {
            x = Math.max(0, Math.min(maxX, x));
            velocityX *= -1;
          }
          if (y <= 0 || y >= maxY) {
            y = Math.max(0, Math.min(maxY, y));
            velocityY *= -1;
          }

          const frameIndex = Math.floor((frameStart - animationStart) / 50) % Constants.KITTY_CUBE_FRAME_COUNT;
          const imageId = Constants.KITTY_CUBE_IMAGE_ID + frameIndex;
          let sequence = '';
          if (currentImageId !== undefined && currentImageId !== imageId) {
            sequence += `\x1b_Ga=d,d=i,i=${currentImageId},p=1,q=2\x1b\\`;
          }
          const row = Math.floor(y / cellHeight) + 1;
          const col = Math.floor(x / cellWidth) + 1;
          const xOffset = Math.floor(x % cellWidth);
          const yOffset = Math.floor(y % cellHeight);
          sequence += `\x1b[${row};${col}H\x1b_Ga=p,i=${imageId},p=1,X=${xOffset},Y=${yOffset},C=1,q=2\x1b\\${restoreCursor}`;
          await write(sequence);
          placementStarted = true;
          currentImageId = imageId;

          const remainingFrameTime = 50 - (performance.now() - frameStart);
          if (remainingFrameTime > 0) {
            await delay(remainingFrameTime);
          }
        }

      } finally {
        try {
          let cleanup = '';
          if (currentImageId !== undefined) {
            cleanup += `\x1b_Ga=d,d=i,i=${currentImageId},p=1,q=2\x1b\\`;
          }
          for (let frame = 0; frame < transmittedFrameCount; frame++) {
            cleanup += `\x1b_Ga=d,d=I,i=${Constants.KITTY_CUBE_IMAGE_ID + frame},q=2\x1b\\`;
          }
          if (placementStarted) {
            cleanup += restoreCursor;
          }
          if (cleanup) {
            await write(cleanup);
          }
        } finally {
          if (canvas) {
            canvas.width = canvas.height = 0;
          }
          button.textContent = originalLabel;
          setKittyAnimationButtonsDisabled(false);
        }
      }
    };

    document.getElementById('image-demo1')!.addEventListener('click',
      sixelDemo('https://raw.githubusercontent.com/saitoha/libsixel/master/images/snake.six'));
    document.getElementById('image-demo2')!.addEventListener('click',
      sixelDemo('https://raw.githubusercontent.com/jerch/node-sixel/master/testfiles/test2.sixel'));
    document.getElementById('image-demo3')!.addEventListener('click',
      iipDemo('https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-image/fixture/palette.png'));
    document.getElementById('image-demo4')!.addEventListener('click',
      iipDemoMulti('https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-image/fixture/testimages/dice.qoi'));
    document.getElementById('image-demo5')!.addEventListener('click',
      iipDemo('https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-image/fixture/testimages/1_webp_a.webp'));
    document.getElementById('image-demo6')!.addEventListener('click',
      iipDemoMulti('https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-image/fixture/testimages/kimono.crop.avif'));
    document.getElementById('image-demo-kitty1')!.addEventListener('click',
      kittyDemo('https://raw.githubusercontent.com/xtermjs/xterm.js/master/addons/addon-image/fixture/palette.png'));
    const kittyPlacementRainButton = document.getElementById('image-demo-kitty-placement-rain') as HTMLButtonElement;
    kittyPlacementRainButton.addEventListener('click', () => {
      void kittyPlacementRainDemo();
    });
    const kittyPlacementCubeButton = document.getElementById('image-demo-kitty-placement-cube') as HTMLButtonElement;
    kittyPlacementCubeButton.addEventListener('click', () => {
      void kittyPlacementCubeDemo(kittyPlacementCubeButton);
    });

    // demo for image retrieval API
    this._terminal.element!.addEventListener('click', (ev: MouseEvent) => {
      if (!ev.ctrlKey || !imageAddon) return;

      // TODO...
      // if (ev.altKey) {
      //   const sel = term.getSelectionPosition();
      //   if (sel) {
      //     addons.image.instance
      //       .extractCanvasAtBufferRange(term.getSelectionPosition())
      //       ?.toBlob(data => window.open(URL.createObjectURL(data), '_blank'));
      //     return;
      //   }
      // }

      const pos = (this._terminal as any)._core._mouseCoordsService!.getCoords(ev, (this._terminal as any)._core.screenElement!, this._terminal.cols, this._terminal.rows);
      const x = pos[0] - 1;
      const y = pos[1] - 1;
      const canvas = ev.shiftKey
        // ctrl+shift+click: get single tile
        ? imageAddon.extractTileAtBufferCell(x, this._terminal.buffer.active.viewportY + y)
        // ctrl+click: get original image
        : imageAddon.getImageAtBufferCell(x, this._terminal.buffer.active.viewportY + y);
      canvas?.toBlob(data => data && window.open(URL.createObjectURL(data), '_blank'));
    });
  }

  private _addDomListener(element: HTMLElement, type: string, handler: (...args: any[]) => any): void {
    element.addEventListener(type, handler);
    (this._terminal as any)._core._register({ dispose: () => element.removeEventListener(type, handler) });
  }
}
