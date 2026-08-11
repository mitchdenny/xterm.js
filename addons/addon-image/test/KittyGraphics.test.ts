/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import test from '@playwright/test';
import { readFileSync } from 'fs';
import { ITestContext, createTestContext, openTerminal, pollFor, timeout } from '../../../test/playwright/TestUtils';
import { deepStrictEqual, ok, strictEqual } from 'assert';

/**
 * Plugin ctor options.
 */
export interface IImageAddonOptions {
  enableSizeReports: boolean;
  pixelLimit: number;
  storageLimit: number;
  showPlaceholder: boolean;
  sixelSupport: boolean;
  sixelScrolling: boolean;
  sixelPaletteLimit: number;
  sixelSizeLimit: number;
  iipSupport: boolean;
  iipSizeLimit: number;
  kittySupport: boolean;
  kittySizeLimit: number;
}

// eslint-disable-next-line
declare const ImageAddon: {
  new(options?: Partial<IImageAddonOptions>): any;
};

interface IDimensions {
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
}

// Kitty graphics test images
const KITTY_BLACK_1X1_BASE64 = readFileSync('./addons/addon-image/fixture/kitty/black-1x1.png').toString('base64');
const KITTY_BLACK_1X1_BYTES = Array.from(readFileSync('./addons/addon-image/fixture/kitty/black-1x1.png'));
const KITTY_RGB_3X1_BASE64 = readFileSync('./addons/addon-image/fixture/kitty/rgb-3x1.png').toString('base64');
const KITTY_MULTICOLOR_200X100_BASE64 = readFileSync('./addons/addon-image/fixture/kitty/multicolor-200x100.png').toString('base64');
const KITTY_MULTICOLOR_200X100_BYTES = Array.from(readFileSync('./addons/addon-image/fixture/kitty/multicolor-200x100.png'));
const IIP_W3C_PNG = readFileSync('./addons/addon-image/fixture/iip/w3c_png.iip', { encoding: 'utf-8' });

// Raw RGB pixel data (f=24): 3 bytes per pixel, no header — requires s= and v=
const RAW_RGB_1X1_BLACK = Buffer.from([0, 0, 0]).toString('base64');
const RAW_RGB_1X1_RED = Buffer.from([255, 0, 0]).toString('base64');
const RAW_RGB_3X1 = Buffer.from([
  255, 0, 0,
  0, 255, 0,
  0, 0, 255
]).toString('base64');
const RAW_RGB_2X2 = Buffer.from([
  255, 0, 0,    0, 255, 0,
  0, 0, 255,    255, 255, 0
]).toString('base64');
// 5 pixels (1 uint32 block + 1 remainder) — tests block+tail boundary
const RAW_RGB_5X1 = Buffer.from([
  255, 0, 0,
  0, 255, 0,
  0, 0, 255,
  255, 255, 0,
  255, 0, 255
]).toString('base64');
// 8 pixels (2 full uint32 blocks, 0 remainder) — tests multi-block path
const RAW_RGB_4X2 = Buffer.from([
  255, 0, 0,    0, 255, 0,    0, 0, 255,    255, 255, 0,
  255, 0, 255,  0, 255, 255,  128, 128, 128, 255, 255, 255
]).toString('base64');

// Raw RGBA pixel data (f=32): 4 bytes per pixel, no header — requires s= and v=
const RAW_RGBA_1X1_WHITE = Buffer.from([255, 255, 255, 255]).toString('base64');
const RAW_RGBA_1X1_RED = Buffer.from([255, 0, 0, 255]).toString('base64');
const RAW_RGBA_1X1_TRANSPARENT = Buffer.from([0, 0, 0, 0]).toString('base64');
const RAW_RGBA_3X1 = Buffer.from([
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255
]).toString('base64');
const RAW_RGBA_2X2 = Buffer.from([
  255, 0, 0, 255,    0, 255, 0, 255,
  0, 0, 255, 255,    255, 255, 0, 255
]).toString('base64');
// 5 pixels — tests RGBA zero-copy with non-power-of-2 count
const RAW_RGBA_5X1 = Buffer.from([
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255,
  255, 255, 0, 255,
  255, 0, 255, 255
]).toString('base64');

let ctx: ITestContext;
test.beforeAll(async ({ browser }) => {
  ctx = await createTestContext(browser);
  await openTerminal(ctx, { cols: 80, rows: 24 });
});
test.afterAll(async () => await ctx.page.close());

test.describe('Kitty Graphics Protocol', () => {
  // TODO: Add tests for larger images with various dimensions
  // TODO: Add tests for virtual placement (U=1)
  // TODO: Add tests for animation frames
  // TODO: Add performance tests for streaming large images
  // TODO: Implement cursor movement per Kitty spec - cursor should move by cols/rows after placement (unless C=1)

  test.beforeEach(async ({}, testInfo) => {
    await ctx.page.evaluate(`
      window.term.reset()
      window.imageAddon?.dispose();
      window.imageAddon = new ImageAddon({ sixelPaletteLimit: 512 });
      window.term.loadAddon(window.imageAddon);
    `);
  });

  test.describe('Basic transmission and storage', () => {
    test('stores 1x1 black PNG with a=T (transmit and display)', async () => {
      const seq = `\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      deepStrictEqual(await getOrigSize(1), [1, 1]);
    });

    test('stores 3x1 RGB PNG with a=T', async () => {
      const seq = `\x1b_Ga=T,f=100;${KITTY_RGB_3X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      deepStrictEqual(await getOrigSize(1), [3, 1]);
    });

    test('transmit only (a=t) does not display but stores in handler', async () => {
      const seq = `\x1b_Ga=t,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
    });

    test('uses specified image ID', async () => {
      const seq = `\x1b_Ga=t,f=100,i=42;${KITTY_BLACK_1X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(42)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(1)`), false);
    });

    test('assigns auto-incrementing IDs when not specified', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(1)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(2)`), true);
    });

    test('defaults to transmit action when action is omitted', async () => {
      const seq = `\x1b_Gf=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
    });

    test('ignores command when action is empty string', async () => {
      const seq = `\x1b_Ga=,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 0);
    });
  });

  test.describe('Chunked transmission', () => {
    test('handles chunked transmission (m=1)', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      const seq1 = `\x1b_Ga=T,f=100,i=99,m=1;${part1}\x1b\\`;
      const seq2 = `\x1b_Ga=T,f=100,i=99;${part2}\x1b\\`;

      await ctx.proxy.write(seq1);
      await timeout(50);
      strictEqual(await getImageStorageLength(), 0);

      await ctx.proxy.write(seq2);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
    });

    test('verifies chunked data is assembled correctly', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=99,m=1;${part1}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=99;${part2}\x1b\\`);
      await timeout(100);

      const storedData = await ctx.page.evaluate(async () => {
        const blob = (window as any).imageAddon._handlers.get('kitty').images.get(99).data;
        const buffer = await blob.arrayBuffer();
        return Array.from(new Uint8Array(buffer));
      });
      deepStrictEqual(storedData, KITTY_BLACK_1X1_BYTES);
    });

    test('enforces size limit across chunked transmissions', async () => {
      // Create a custom addon with very small size limit (100 bytes)
      // The 1x1 PNG is ~164 bytes base64, so 2 chunks should exceed 100
      await ctx.page.evaluate(() => {
        (window as any).smallLimitAddon = new ImageAddon({
          kittySupport: true,
          kittySizeLimit: 100  // Very small limit
        });
        (window as any).term.loadAddon((window as any).smallLimitAddon);
      });

      // Split the base64 data into two chunks
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      // Send chunked data - first chunk (~82 bytes) is under limit
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=777,m=1;${part1}\x1b\\`);
      await timeout(50);

      // Second chunk brings total to ~164 bytes, exceeding 100 byte limit
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=777;${part2}\x1b\\`);
      await timeout(100);

      // Image should NOT be stored due to size limit
      strictEqual(await ctx.page.evaluate(`window.smallLimitAddon._handlers.get('kitty').images.has(777)`), false);

      // Cleanup
      await ctx.page.evaluate(() => {
        (window as any).smallLimitAddon.dispose();
      });
    });

    test('chunked a=T works when subsequent chunks omit i= (spec pattern)', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=400,m=1;${part1}\x1b\\`);
      await timeout(50);
      strictEqual(await getImageStorageLength(), 0);

      await ctx.proxy.write(`\x1b_Gm=0;${part2}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
    });

    test('chunked a=t works when subsequent chunks omit i= (spec pattern)', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=401,m=1;${part1}\x1b\\`);
      await ctx.proxy.write(`\x1b_Gm=0;${part2}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(401)`), true);
    });

    test('chunked data without i= on subsequent chunks is assembled correctly', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=402,m=1;${part1}\x1b\\`);
      await ctx.proxy.write(`\x1b_Gm=0;${part2}\x1b\\`);
      await timeout(100);

      const storedData = await ctx.page.evaluate(async () => {
        const blob = (window as any).imageAddon._handlers.get('kitty').images.get(402).data;
        const buffer = await blob.arrayBuffer();
        return Array.from(new Uint8Array(buffer));
      });
      deepStrictEqual(storedData, KITTY_BLACK_1X1_BYTES);
    });

    test('three-chunk transfer with only m= on middle and last chunks', async () => {
      const third = Math.floor(KITTY_BLACK_1X1_BASE64.length / 3);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, third);
      const part2End = third + Math.floor((KITTY_BLACK_1X1_BASE64.length - third) / 2);
      const alignedPart2End = part2End - (part2End - third) % 4 + third;
      const part2 = KITTY_BLACK_1X1_BASE64.substring(third, alignedPart2End);
      const part3 = KITTY_BLACK_1X1_BASE64.substring(alignedPart2End);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=403,m=1;${part1}\x1b\\`);
      await ctx.proxy.write(`\x1b_Gm=1;${part2}\x1b\\`);
      await ctx.proxy.write(`\x1b_Gm=0;${part3}\x1b\\`);
      await timeout(100);

      const storedData = await ctx.page.evaluate(async () => {
        const blob = (window as any).imageAddon._handlers.get('kitty').images.get(403).data;
        const buffer = await blob.arrayBuffer();
        return Array.from(new Uint8Array(buffer));
      });
      deepStrictEqual(storedData, KITTY_BLACK_1X1_BYTES);
    });

    test('chunked a=T without i= on any chunk works (no response)', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      await ctx.proxy.write(`\x1b_Ga=T,f=100,m=1;${part1}\x1b\\`);
      await timeout(50);
      strictEqual(await getImageStorageLength(), 0);

      await ctx.proxy.write(`\x1b_Gm=0;${part2}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
    });

    test('chunked transfer responds OK on final chunk when i= on first only', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=405,m=1;${part1}\x1b\\`);
      await timeout(50);

      let response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '');

      await ctx.proxy.write(`\x1b_Gm=0;${part2}\x1b\\`);
      await timeout(100);

      response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=405;OK\x1b\\');
    });
  });

  test.describe('Delete commands', () => {
    test('delete command (a=d,d=i) preserves transmitted image data', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=10;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);

      await ctx.proxy.write(`\x1b_Ga=d,d=i,i=10\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
    });

    test('delete command (a=d) preserves all transmitted image data', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=2;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);

      await ctx.proxy.write(`\x1b_Ga=d\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);
    });

    test('delete by id aborts in-flight chunked upload', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=50,m=1;${part1}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.size`), 1);

      await ctx.proxy.write(`\x1b_Ga=d,d=i,i=50\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.size`), 0);
    });

    test('delete by id only aborts targeted upload, not others', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=55,m=1;${part1}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=56,m=1;${part1}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.size`), 2);

      await ctx.proxy.write(`\x1b_Ga=d,d=i,i=55\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.size`), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.has(56)`), true);
    });

    test('delete all aborts in-flight chunked upload', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=60,m=1;${part1}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=61,m=1;${part1}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.size`), 2);

      await ctx.proxy.write(`\x1b_Ga=d\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.size`), 0);
    });

    test('d=i selector preserves specific image data', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=80;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=81;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);

      await ctx.proxy.write(`\x1b_Ga=d,d=i,i=80\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(80)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(81)`), true);
    });

    test('d=I selector deletes specific image by id (uppercase)', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=82;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=83;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);

      await ctx.proxy.write(`\x1b_Ga=d,d=I,i=82\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(83)`), true);
    });

    test('d=a selector preserves all image data', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=84;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=85;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);

      await ctx.proxy.write(`\x1b_Ga=d,d=a\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);
    });

    test('d=A selector preserves transmitted data without visible placements', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=86;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=87;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);

      await ctx.proxy.write(`\x1b_Ga=d,d=A\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);
    });

    test('d=a selector also removes displayed images from storage', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=88;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);

      await ctx.proxy.write(`\x1b_Ga=d,d=a\x1b\\`);
      await timeout(50);
      strictEqual(await getImageStorageLength(), 0);
    });

    test('d=i selector also removes displayed image from storage', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=89;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);

      await ctx.proxy.write(`\x1b_Ga=d,d=i,i=89\x1b\\`);
      await timeout(50);
      strictEqual(await getImageStorageLength(), 0);
    });

    test('d=i without id does nothing', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=90;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);

      await ctx.proxy.write(`\x1b_Ga=d,d=i\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
    });

    test('d=i selector clears pixels from canvas', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=92,q=1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 255]);

      await ctx.proxy.write(`\x1b_Ga=d,d=i,i=92\x1b\\`);
      await timeout(100);
      strictEqual(await getPixel(0, 0, 0, 0), null);
    });

    test('d=a selector clears all pixels from canvas', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=93,q=1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 255]);

      await ctx.proxy.write(`\x1b_Ga=d,d=a\x1b\\`);
      await timeout(100);
      strictEqual(await getPixel(0, 0, 0, 0), null);
    });

    test('unsupported delete selector is ignored', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=91;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);

      await ctx.proxy.write(`\x1b_Ga=d,d=c\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
    });

    test('chunks sent after delete are not assembled with previous data', async () => {
      const half = Math.floor(KITTY_BLACK_1X1_BASE64.length / 2);
      const part1 = KITTY_BLACK_1X1_BASE64.substring(0, half);
      const part2 = KITTY_BLACK_1X1_BASE64.substring(half);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=70,m=1;${part1}\x1b\\`);
      await timeout(50);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').pendingTransmissions.size`), 1);

      await ctx.proxy.write(`\x1b_Ga=d\x1b\\`);
      await timeout(50);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=70;${part2}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(70)`), true);
      const storedSize: number = await ctx.page.evaluate(async () => {
        const blob = (window as any).imageAddon._handlers.get('kitty').images.get(70).data;
        return blob.size;
      });
      ok(storedSize < KITTY_BLACK_1X1_BYTES.length, 'stored data should be smaller than full image (only second half)');
    });
  });

  test.describe('Query support (a=q)', () => {
    test('responds with OK for capability query without payload', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write('\x1b_Gi=31,a=q;\x1b\\');
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=31;OK\x1b\\');
    });

    test('responds with OK for valid PNG query', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=42,a=q,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=42;OK\x1b\\');
    });

    test('query does NOT store the image (unlike transmit)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).term.onData(() => { /* consume response */ });
      });

      await ctx.proxy.write(`\x1b_Gi=50,a=q,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(50)`), false);
    });

    test('responds with error for invalid base64', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write('\x1b_Gi=60,a=q,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=60;EINVAL:'), true);
    });

    test('responds with error for RGB data without dimensions', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write('\x1b_Gi=70,a=q,f=24;AAAA\x1b\\');
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=70;EINVAL:width and height required for raw pixel data\x1b\\');
    });

    test('suppresses OK response when q=1', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Gi=80,a=q,q=1,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('suppresses OK response when q=2', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Gi=81,a=q,q=2,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('suppresses error response when q=2', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write('\x1b_Gi=90,a=q,q=2,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('responds with EINVAL when both i and I keys are specified', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      // Per spec: "Specifying both i and I keys in any command is an error"
      await ctx.proxy.write(`\x1b_Gi=100,I=200,a=q,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=100;EINVAL:cannot specify both i and I keys\x1b\\');
    });

    test('responds with EINVAL for i+I conflict even without payload', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      // Delete command with both i and I (no payload case)
      await ctx.proxy.write('\x1b_Gi=101,I=201,a=d\x1b\\');
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=101;EINVAL:cannot specify both i and I keys\x1b\\');
    });
  });

  test.describe('Error responses for transmit and display', () => {
    test('a=t sends EINVAL on decode error when id is specified', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write('\x1b_Gi=110,a=t,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=110;EINVAL:invalid base64 data\x1b\\');
    });

    test('a=t sends no response on decode error without id', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write('\x1b_Ga=t,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('a=T sends EINVAL on decode error when id is specified', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write('\x1b_Gi=120,a=T,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=120;EINVAL:invalid base64 data\x1b\\');
    });

    test('a=T sends no response on decode error without id', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write('\x1b_Ga=T,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('a=T sends EINVAL when raw pixel render fails (missing dimensions)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=130,a=T,f=24;${RAW_RGB_1X1_BLACK}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=130;EINVAL:'), true);
    });

    test('a=T sends OK on successful render with id', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=140,a=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=140;OK\x1b\\');
    });

    test('a=t sends OK on successful transmit with id', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=150,a=t,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=150;OK\x1b\\');
    });

    test('a=t EINVAL suppressed by q=2', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write('\x1b_Gi=160,a=t,q=2,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('a=T EINVAL suppressed by q=2', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write('\x1b_Gi=170,a=T,q=2,f=100;!!!invalid!!!\x1b\\');
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('a=t OK suppressed by q=1', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Gi=180,a=t,q=1,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('a=T OK suppressed by q=1', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Gi=190,a=T,q=1,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('a=t OK suppressed by q=2', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Gi=181,a=t,q=2,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('a=T OK suppressed by q=2', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Gi=191,a=T,q=2,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });
  });

  test.describe('Transmission medium rejection', () => {
    test('query rejects t=f (file transmission)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=200,a=q,t=f,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=200;EINVAL:'), true);
    });

    test('query rejects t=s (shared memory)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=201,a=q,t=s,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=201;EINVAL:'), true);
    });

    test('query rejects t=t (temp file)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=202,a=q,t=t,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=202;EINVAL:'), true);
    });

    test('query accepts t=d (direct transmission)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=203,a=q,t=d,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=203;OK\x1b\\');
    });

    test('query without t key defaults to direct (OK)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=204,a=q,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=204;OK\x1b\\');
    });

    test('transmit rejects t=f with id (EINVAL response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=300,a=t,t=f,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=300;EINVAL:'), true);
    });

    test('transmit rejects t=s with id (EINVAL response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=301,a=t,t=s,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=301;EINVAL:'), true);
    });

    test('transmit rejects t=t with id (EINVAL response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=302,a=t,t=t,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=302;EINVAL:'), true);
    });

    test('transmit rejects t=f without id (no response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Ga=t,t=f,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '');
    });

    test('transmit+display rejects t=f with id (EINVAL response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=310,a=T,t=f,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=310;EINVAL:'), true);
    });

    test('transmit+display rejects t=s with id (EINVAL response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=311,a=T,t=s,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=311;EINVAL:'), true);
    });

    test('transmit+display rejects t=t with id (EINVAL response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Gi=312,a=T,t=t,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response.startsWith('\x1b_Gi=312;EINVAL:'), true);
    });

    test('transmit+display rejects t=f without id (no response)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Ga=T,t=f,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '');
    });
  });

  test.describe('Placement action (a=p)', () => {
    test('displays a previously transmitted image at cursor', async () => {
      // Transmit image without display
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=210;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 0);

      // Place the previously transmitted image
      await ctx.proxy.write(`\x1b_Ga=p,i=210\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 255]);
    });

    test('responds OK on successful placement', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=211;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Ga=p,i=211\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=211;OK\x1b\\');
    });

    test('responds ENOENT for non-existent image id', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Ga=p,i=9999\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=9999;ENOENT:image not found\x1b\\');
    });

    test('without id sends no response', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Ga=p\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('places at specified column/row size (c/r)', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=212;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=212,c=5,r=3\x1b\\`);
      await timeout(200);

      strictEqual(await getImageStorageLength(), 1);
      deepStrictEqual(await getCursor(), [5, 2]);
    });

    test('cursor advances past placed image (default C=0)', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=213;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      deepStrictEqual(await getCursor(), [0, 0]);

      await ctx.proxy.write(`\x1b_Ga=p,i=213\x1b\\`);
      await timeout(100);
      deepStrictEqual(await getCursor(), [1, 0]);
    });

    test('cursor does not move when C=1', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=214;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await timeout(100);
      deepStrictEqual(await getCursor(), [0, 0]);

      await ctx.proxy.write(`\x1b_Ga=p,i=214,c=5,r=3,C=1\x1b\\`);
      await timeout(200);
      deepStrictEqual(await getCursor(), [0, 0]);
    });

    test('supports z-index (negative = bottom layer)', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=215;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=215,z=-1\x1b\\`);
      await timeout(100);

      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).layer`), 'bottom');
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).zIndex`), -1);
    });

    test('supports source crop via x/y', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=216;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await timeout(100);

      // Crop to the Orange rectangle (x=20, y=0, 20x50)
      await ctx.proxy.write(`\x1b_Ga=p,i=216,x=20,y=0,w=20,h=50\x1b\\`);
      await timeout(200);

      strictEqual(await getImageStorageLength(), 1);
      deepStrictEqual(await getOrigSize(1), [20, 50]);
      deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 128, 0, 255]);
    });

    test('supports sub-cell offset via X/Y', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=217;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=217,X=5,Y=3\x1b\\`);
      await timeout(100);

      deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 0]);
      deepStrictEqual(await getPixel(0, 0, 4, 2), [0, 0, 0, 0]);
      deepStrictEqual(await getPixel(0, 0, 5, 3), [0, 0, 0, 255]);
    });

    test('multiple placements of same image create separate displays', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=218;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 0);

      // First placement
      await ctx.proxy.write(`\x1b_Ga=p,i=218,p=1\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);

      // Move cursor down and place again with different placement ID
      await ctx.proxy.write('\x1b[3;1H');
      await ctx.proxy.write(`\x1b_Ga=p,i=218,p=2\x1b\\`);
      await timeout(100);

      // Both placements should be in shared storage
      strictEqual(await getImageStorageLength(), 2);
    });

    test('image data remains available after placement for future placements', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=219;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      // Place three times
      await ctx.proxy.write(`\x1b_Ga=p,i=219\x1b\\`);
      await timeout(100);
      await ctx.proxy.write('\x1b[2;1H');
      await ctx.proxy.write(`\x1b_Ga=p,i=219\x1b\\`);
      await timeout(100);
      await ctx.proxy.write('\x1b[3;1H');
      await ctx.proxy.write(`\x1b_Ga=p,i=219\x1b\\`);
      await timeout(100);

      // Image data should still be available
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(219)`), true);
    });

    test('OK response suppressed by q=1', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=220;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Ga=p,i=220,q=1\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
      strictEqual(await getImageStorageLength(), 1);
    });

    test('OK response suppressed by q=2', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=221;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Ga=p,i=221,q=2\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
      strictEqual(await getImageStorageLength(), 1);
    });

    test('ENOENT error suppressed by q=2', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyGotResponse = false;
        (window as any).term.onData(() => { (window as any).kittyGotResponse = true; });
      });

      await ctx.proxy.write(`\x1b_Ga=p,i=9998,q=2\x1b\\`);
      await timeout(100);

      strictEqual(await ctx.page.evaluate('window.kittyGotResponse'), false);
    });

    test('ENOENT still reported when q=1 (only suppresses OK)', async () => {
      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Ga=p,i=9997,q=1\x1b\\`);
      await timeout(100);

      const response: string = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=9997;ENOENT:image not found\x1b\\');
    });

    test('renders pixels correctly when placing a PNG image', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=221;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=221\x1b\\`);
      await timeout(100);

      const pixels = await getPixels(0, 0, 0, 0, 3, 1);
      deepStrictEqual(pixels?.slice(0, 4), [255, 0, 0, 255]);
      deepStrictEqual(pixels?.slice(4, 8), [0, 255, 0, 255]);
      deepStrictEqual(pixels?.slice(8, 12), [0, 0, 255, 255]);
    });

    test('renders pixels correctly when placing raw RGB image', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=24,s=3,v=1,i=222;${RAW_RGB_3X1}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=222\x1b\\`);
      await timeout(100);

      const pixels = await getPixels(0, 0, 0, 0, 3, 1);
      deepStrictEqual(pixels?.slice(0, 4), [255, 0, 0, 255]);
      deepStrictEqual(pixels?.slice(4, 8), [0, 255, 0, 255]);
      deepStrictEqual(pixels?.slice(8, 12), [0, 0, 255, 255]);
    });

    test('renders pixels correctly when placing raw RGBA image', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=32,s=3,v=1,i=223;${RAW_RGBA_3X1}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=223\x1b\\`);
      await timeout(100);

      const pixels = await getPixels(0, 0, 0, 0, 3, 1);
      deepStrictEqual(pixels?.slice(0, 4), [255, 0, 0, 255]);
      deepStrictEqual(pixels?.slice(4, 8), [0, 255, 0, 255]);
      deepStrictEqual(pixels?.slice(8, 12), [0, 0, 255, 255]);
    });

    test('response includes placement id when p is specified', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=224;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.page.evaluate(() => {
        (window as any).kittyResponse = '';
        (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
      });

      await ctx.proxy.write(`\x1b_Ga=p,i=224,p=42\x1b\\`);
      await timeout(100);

      const response = await ctx.page.evaluate('window.kittyResponse');
      strictEqual(response, '\x1b_Gi=224,p=42;OK\x1b\\');
    });

    test('only c specified computes r from aspect ratio', async () => {
      // 200x100 image (2:1 aspect) with c=10.
      // Per spec: r = ceil((h/w) * c * cw / ch) = ceil(0.5 * 10 * cw / ch)
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=225;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=225,c=10\x1b\\`);
      await timeout(200);

      const cursor = await getCursor();
      const cellDims: number[] = await ctx.page.evaluate(() => {
        const d = (window as any).term._core._renderService.dimensions.css.cell;
        return [d.width, d.height];
      });
      const expectedR = Math.ceil((100 / 200) * 10 * cellDims[0] / cellDims[1]);
      deepStrictEqual(cursor, [10, expectedR - 1]);
    });

    test('only r specified computes c from aspect ratio', async () => {
      // 200x100 image (2:1 aspect) with r=5.
      // Per spec: c = ceil((w/h) * r * ch / cw) = ceil(2 * 5 * ch / cw)
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=226;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=p,i=226,r=5\x1b\\`);
      await timeout(200);

      const cursor = await getCursor();
      const cellDims: number[] = await ctx.page.evaluate(() => {
        const d = (window as any).term._core._renderService.dimensions.css.cell;
        return [d.width, d.height];
      });
      const expectedC = Math.ceil((200 / 100) * 5 * cellDims[1] / cellDims[0]);
      deepStrictEqual(cursor, [expectedC, 4]);
    });
  });

  test.describe('Placement identity and lifetime', () => {
    test('tracks named sibling placements and decodes their shared source once', async () => {
      await startBlobDecodeCounter();
      try {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=900;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
        await timeout(100);

        await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=900,p=10,c=1,r=1,C=1\x1b\\');
        await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=900,p=20,c=1,r=1,C=1\x1b\\');
        await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=900,p=30,c=1,r=1,C=1\x1b\\');
        await timeout(100);

        strictEqual(await getImageStorageLength(), 3);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
        const storageIds = [
          await getViewportCellImageId(0, 0),
          await getViewportCellImageId(0, 2),
          await getViewportCellImageId(0, 4)
        ];
        strictEqual(new Set(storageIds).size, 3);
        deepStrictEqual(await getRenderedViewportPixel(0, 0), [0, 0, 0, 255]);
        deepStrictEqual(await getRenderedViewportPixel(0, 2), [0, 0, 0, 255]);
        deepStrictEqual(await getRenderedViewportPixel(0, 4), [0, 0, 0, 255]);
        strictEqual(await getBlobDecodeCount(), 1);
      } finally {
        await stopBlobDecodeCounter();
      }
    });

    test('renders independently cropped placements from one decoded source', async () => {
      await startBlobDecodeCounter();
      try {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=912;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=912,p=1,x=0,y=0,w=20,h=50,c=1,r=1,C=1\x1b\\');
        await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=912,p=2,x=20,y=0,w=20,h=50,c=1,r=1,C=1\x1b\\');
        await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=912,p=3,x=0,y=50,w=20,h=50,c=1,r=1,C=1\x1b\\');
        await ctx.proxy.write('\x1b[7;1H\x1b_Ga=p,i=912,p=4,x=180,y=50,w=20,h=50,c=1,r=1,C=1\x1b\\');
        await timeout(100);

        strictEqual(await getImageStorageLength(), 4);
        const storageIds = [
          await getViewportCellImageId(0, 0),
          await getViewportCellImageId(0, 2),
          await getViewportCellImageId(0, 4),
          await getViewportCellImageId(0, 6)
        ];
        strictEqual(new Set(storageIds).size, 4);
        deepStrictEqual(await getRenderedViewportPixel(0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getRenderedViewportPixel(0, 2), [255, 128, 0, 255]);
        deepStrictEqual(await getRenderedViewportPixel(0, 4), [255, 192, 203, 255]);
        deepStrictEqual(await getRenderedViewportPixel(0, 6), [255, 255, 255, 255]);
        strictEqual(await getBlobDecodeCount(), 1);
      } finally {
        await stopBlobDecodeCounter();
      }
    });

    test('replaces a named placement with cleanup proportional to its cells', async () => {
      await ctx.page.evaluate(() => new Promise<void>(resolve => {
        (window as any).term.write('\n'.repeat(2000), resolve);
      }));

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=901;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=901,p=5,c=2,r=1,C=1\x1b\\');
      await timeout(100);
      ok(await getViewportCellImageId(0, 0) > 0);
      ok(await getViewportCellImageId(1, 0) > 0);

      await ctx.page.evaluate(() => {
        const storage = (window as any).imageAddon._storage;
        const original = storage.deleteImage.bind(storage);
        (window as any)._kittyCleanupCounts = [];
        storage.deleteImage = (id: number) => {
          const count = original(id);
          (window as any)._kittyCleanupCounts.push(count);
          return count;
        };
      });

      await ctx.proxy.write('\x1b[4;5H\x1b_Ga=p,i=901,p=5,c=3,r=1,C=1\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await getViewportCellImageId(0, 0), -1);
      strictEqual(await getViewportCellImageId(1, 0), -1);
      ok(await getViewportCellImageId(4, 3) > 0);
      ok(await getViewportCellImageId(5, 3) > 0);
      ok(await getViewportCellImageId(6, 3) > 0);
      deepStrictEqual(await getRenderedViewportPixel(0, 0), [0, 0, 0, 0]);
      deepStrictEqual(await getRenderedViewportPixel(4, 3), [0, 0, 0, 255]);
      deepStrictEqual(await ctx.page.evaluate('window._kittyCleanupCounts'), [2]);
    });

    test('deletes only the targeted named placement and keeps image data reusable', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=902;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=902,p=10,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=902,p=20,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=902,p=30,c=1,r=1,C=1\x1b\\');
      await timeout(100);

      await ctx.proxy.write('\x1b_Ga=d,d=i,i=902,p=20\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 2);
      ok(await getViewportCellImageId(0, 0) > 0);
      strictEqual(await getViewportCellImageId(0, 2), -1);
      ok(await getViewportCellImageId(0, 4) > 0);
      deepStrictEqual(await getRenderedViewportPixel(0, 2), [0, 0, 0, 0]);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(902)`), true);

      await ctx.proxy.write('\x1b[7;1H\x1b_Ga=p,i=902,p=20,c=1,r=1,C=1\x1b\\');
      await timeout(100);
      strictEqual(await getImageStorageLength(), 3);
      deepStrictEqual(await getRenderedViewportPixel(0, 6), [0, 0, 0, 255]);
    });

    for (const [name, imageId, placementColumn, shift, shiftedColumns] of [
      ['ICH', 940, 1, '\x1b[1;1H\x1b[1@', [1, 2]],
      ['DCH', 941, 2, '\x1b[1;1H\x1b[1P', [0, 1]]
    ] as const) {
      test(`clears placement cells shifted by ${name}`, async () => {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=${imageId};${KITTY_BLACK_1X1_BASE64}\x1b\\`);
        await ctx.proxy.write(`\x1b[1;${placementColumn}H\x1b_Ga=p,i=${imageId},p=1,c=2,r=1,C=1\x1b\\`);
        await ctx.proxy.write(shift);
        await timeout(100);

        ok(await getViewportCellImageId(shiftedColumns[0], 0) > 0);
        ok(await getViewportCellImageId(shiftedColumns[1], 0) > 0);

        await ctx.proxy.write(`\x1b_Ga=d,d=i,i=${imageId},p=1\x1b\\`);
        await timeout(100);

        strictEqual(await getViewportCellImageId(shiftedColumns[0], 0), -1);
        strictEqual(await getViewportCellImageId(shiftedColumns[1], 0), -1);
        strictEqual(await getRenderedViewportPixel(shiftedColumns[0], 0), null);
        strictEqual(await getRenderedViewportPixel(shiftedColumns[1], 0), null);
      });
    }

    test('treats omitted and zero placement IDs as anonymous and additive', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=903;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=903,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=903,p=0,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=903,p=0,c=1,r=1,C=1\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 3);
      const storageIds = [
        await getViewportCellImageId(0, 0),
        await getViewportCellImageId(0, 2),
        await getViewportCellImageId(0, 4)
      ];
      strictEqual(new Set(storageIds).size, 3);
    });

    test('lowercase delete by image removes all placements but preserves payload', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=904;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=905;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=904,p=1,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=904,p=2,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=905,p=1,c=1,r=1,C=1\x1b\\');
      await timeout(100);

      await ctx.proxy.write('\x1b_Ga=d,d=i,i=904\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await getViewportCellImageId(0, 0), -1);
      strictEqual(await getViewportCellImageId(0, 2), -1);
      ok(await getViewportCellImageId(0, 4) > 0);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(904)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(905)`), true);

      await ctx.proxy.write('\x1b[7;1H\x1b_Ga=p,i=904,p=3,c=1,r=1,C=1\x1b\\');
      await timeout(100);
      strictEqual(await getImageStorageLength(), 2);
      deepStrictEqual(await getRenderedViewportPixel(0, 6), [0, 0, 0, 255]);
    });

    test('lowercase delete all preserves payloads for later placements', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=906;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=907;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=906,p=1,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=907,p=1,c=1,r=1,C=1\x1b\\');
      await timeout(100);

      await ctx.proxy.write('\x1b_Ga=d,d=a\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 0);
      strictEqual(await getViewportCellImageId(0, 0), -1);
      strictEqual(await getViewportCellImageId(0, 2), -1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 2);

      await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=906,p=2,c=1,r=1,C=1\x1b\\');
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      deepStrictEqual(await getRenderedViewportPixel(0, 4), [0, 0, 0, 255]);
    });

    for (const [selector, imageId] of [['a', 930], ['A', 931]] as const) {
      test(`d=${selector} deletes only visible placements and preserves scrollback references`, async () => {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=${imageId};${KITTY_BLACK_1X1_BASE64}\x1b\\`);
        await ctx.proxy.write(`\x1b[1;1H\x1b_Ga=p,i=${imageId},p=1,c=1,r=1,C=1\x1b\\`);
        await ctx.page.evaluate(() => new Promise<void>(resolve => {
          const term = (window as any).term;
          term.write('\n'.repeat(term.rows + 5), resolve);
        }));
        await ctx.proxy.write(`\x1b_Ga=p,i=${imageId},p=2,c=1,r=1,C=1\x1b\\`);
        await timeout(100);

        strictEqual(await getImageStorageLength(), 2);
        ok(await getAbsoluteCellImageId(0, 0) > 0);
        ok(await getViewportCellImageId(0, 23) > 0);

        await ctx.proxy.write(`\x1b_Ga=d,d=${selector}\x1b\\`);
        await timeout(100);

        strictEqual(await getImageStorageLength(), 1);
        ok(await getAbsoluteCellImageId(0, 0) > 0);
        strictEqual(await getViewportCellImageId(0, 23), -1);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(${imageId})`), true);
      });
    }

    for (const [selector, imageId] of [['a', 932], ['A', 933]] as const) {
      test(`d=${selector} affects only the active buffer's visible placements`, async () => {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=${imageId};${KITTY_BLACK_1X1_BASE64}\x1b\\`);
        await ctx.proxy.write(`\x1b[1;1H\x1b_Ga=p,i=${imageId},p=1,c=1,r=1,C=1\x1b\\`);
        await ctx.proxy.write('\x1b[?1049h');
        await ctx.proxy.write(`\x1b_Ga=p,i=${imageId},p=2,c=1,r=1,C=1\x1b\\`);
        await timeout(100);

        strictEqual(await getImageStorageLength(), 2);
        ok(await getViewportCellImageId(0, 0) > 0);

        await ctx.proxy.write(`\x1b_Ga=d,d=${selector}\x1b\\`);
        await timeout(100);

        strictEqual(await getImageStorageLength(), 1);
        strictEqual(await getViewportCellImageId(0, 0), -1);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(${imageId})`), true);

        await ctx.proxy.write('\x1b[?1049l');
        await timeout(100);
        ok(await getViewportCellImageId(0, 0) > 0);
        deepStrictEqual(await getRenderedViewportPixel(0, 0), [0, 0, 0, 255]);
      });
    }

    test('retains an alternate-buffer placement when rebuilding cell indexes', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=938;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[?1049h');
      await ctx.proxy.write('\x1b_Ga=p,i=938,p=1,c=1,r=1,C=1\x1b\\');
      await timeout(100);
      const storageId = await ctx.page.evaluate<number | undefined>(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(938)`);
      ok(storageId !== undefined);
      await ctx.page.evaluate(() => (window as any).imageAddon._storage.viewportResize({ cols: 79, rows: 24 }));
      await timeout(100);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.has(${storageId})`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(938)`), storageId);
      strictEqual(await getViewportCellImageId(0, 0), storageId);
      deepStrictEqual(await getRenderedViewportPixel(0, 0), [0, 0, 0, 255]);

      await ctx.proxy.write('\x1b[?1049l');
    });

    test('d=a leaves visible placements from other image protocols intact', async () => {
      await ctx.proxy.write(IIP_W3C_PNG);
      await ctx.proxy.write(`\x1b[10;1H\x1b_Ga=T,f=100,i=939,C=1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 2);

      await ctx.proxy.write('\x1b_Ga=d,d=a\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.has(1)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(939)`), true);
    });

    test('uppercase targeted delete frees data only after the last placement', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=934;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=934,p=1,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=934,p=2,c=1,r=1,C=1\x1b\\');
      await timeout(100);

      await ctx.proxy.write('\x1b_Ga=d,d=I,i=934,p=1\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await getViewportCellImageId(0, 0), -1);
      ok(await getViewportCellImageId(0, 2) > 0);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(934)`), true);

      await ctx.proxy.write('\x1b_Ga=d,d=I,i=934,p=2\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 0);
      strictEqual(await getViewportCellImageId(0, 2), -1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(934)`), false);
    });

    test('uppercase delete frees matching payloads and every placement', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=908;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=909;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=908,p=1,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=908,p=2,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=909,p=1,c=1,r=1,C=1\x1b\\');
      await timeout(100);

      await ctx.proxy.write('\x1b_Ga=d,d=I,i=908\x1b\\');
      await timeout(100);

      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await getViewportCellImageId(0, 0), -1);
      strictEqual(await getViewportCellImageId(0, 2), -1);
      ok(await getViewportCellImageId(0, 4) > 0);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(908)`), false);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(909)`), true);

      await ctx.proxy.write('\x1b_Ga=d,d=A\x1b\\');
      await timeout(100);
      strictEqual(await getImageStorageLength(), 0);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 0);
    });

    test('retransmitting an image removes all old placements before reuse', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=910;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b[1;1H\x1b_Ga=p,i=910,p=1,c=1,r=1,C=1\x1b\\');
      await ctx.proxy.write('\x1b[3;1H\x1b_Ga=p,i=910,p=2,c=1,r=1,C=1\x1b\\');
      await timeout(100);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=910;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(100);

      strictEqual(await getImageStorageLength(), 0);
      strictEqual(await getViewportCellImageId(0, 0), -1);
      strictEqual(await getViewportCellImageId(0, 2), -1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(910)`), true);

      await ctx.proxy.write('\x1b[5;1H\x1b_Ga=p,i=910,p=3,c=1,r=1,C=1\x1b\\');
      await timeout(100);
      deepStrictEqual(await getRenderedViewportPixel(0, 4), [255, 0, 0, 255]);
    });

    test('keeps transmitted data reusable after its only placement leaves scrollback', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=911;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b_Ga=p,i=911,p=1,c=1,r=1,C=1\x1b\\');
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);

      await ctx.page.evaluate(() => new Promise<void>(resolve => {
        const term = (window as any).term;
        term.write('\n'.repeat(term.options.scrollback + term.rows + 10), resolve);
      }));
      await pollFor(ctx.page, 'window.imageAddon._storage._images.size', 0);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(911)`), true);
      await ctx.proxy.write('\x1b_Ga=p,i=911,p=2,c=1,r=1,C=1\x1b\\');
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
    });

    test('caps retained image data when every image has a placement', async () => {
      let sequence = '';
      for (let id = 1000; id <= 1256; id++) {
        sequence += `\x1b_Ga=T,f=32,s=1,v=1,i=${id},p=1,C=1;${RAW_RGBA_1X1_RED}\x1b\\\n`;
      }
      await ctx.proxy.write(sequence);
      await timeout(100);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 256);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(1000)`), false);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(1256)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(1000)`), true);
      ok(await getAbsoluteCellImageId(0, 0) > 0);

      await ctx.proxy.write(`\x1b_Ga=t,f=32,s=1,v=1,i=1000;${RAW_RGBA_1X1_WHITE}\x1b\\`);
      await timeout(100);

      strictEqual(await getAbsoluteCellImageId(0, 0), -1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(1000)`), false);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(1000)`), true);
    });

    test('accounts for decoded sources and evicts them before visible placements', async () => {
      await startBlobDecodeCounter();
      try {
        await ctx.page.evaluate(`
          window.term.reset();
          window.imageAddon?.dispose();
          window.term.resize(80, 48);
          window.imageAddon = new ImageAddon({ storageLimit: 0.5 });
          window.term.loadAddon(window.imageAddon);
        `);

        const positions = [[1, 1], [30, 1], [1, 9], [30, 9]];
        for (let n = 0; n < positions.length; n++) {
          const id = 920 + n;
          const [column, row] = positions[n];
          await ctx.proxy.write(`\x1b_Ga=t,f=100,i=${id};${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
          await ctx.proxy.write(`\x1b[${row};${column}H\x1b_Ga=p,i=${id},p=1,C=1\x1b\\`);
        }
        await pollFor(ctx.page, 'window.imageAddon._storage._images.size', 4);

        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 4);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.get(920).decodedSource === undefined`), true);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.get(923).decodedSource !== undefined`), true);
        ok(await ctx.page.evaluate<number>('window.imageAddon.storageUsage') <= 0.5);
        strictEqual(await getBlobDecodeCount(), 4);

        await ctx.proxy.write('\x1b[25;1H\x1b_Ga=p,i=920,p=2,C=1\x1b\\');
        await pollFor(ctx.page, 'window.imageAddon._storage._images.size', 5);

        strictEqual(await getBlobDecodeCount(), 5);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.get(920).decodedSource !== undefined`), true);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 4);
        ok(await ctx.page.evaluate<number>('window.imageAddon.storageUsage') <= 0.5);
      } finally {
        await stopBlobDecodeCounter();
        await ctx.page.evaluate('window.term.resize(80, 24)');
      }
    });

    for (const [action, imageId] of [
      ['reset', 935],
      ['retransmit', 936],
      ['delete', 937],
      ['dispose', 938]
    ] as const) {
      test(`closes a stale placement bitmap after ${action}`, async () => {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=${imageId};${KITTY_BLACK_1X1_BASE64}\x1b\\`);
        await startPlacementBitmapPause();
        const writePromise = ctx.proxy.write(`\x1b_Ga=p,i=${imageId},p=1,C=1\x1b\\`);
        try {
          await pollFor(ctx.page, `typeof window._kittyReleasePlacementBitmap`, 'function');
          await ctx.page.evaluate(([action, imageId, replacementBytes]) => {
            const addon = (window as any).imageAddon;
            const storage = addon._handlers.get('kitty')?._kittyStorage;
            switch (action) {
              case 'reset':
                addon.reset();
                break;
              case 'retransmit':
                storage.storeImage(imageId, {
                  data: new Blob([new Uint8Array(replacementBytes)], { type: 'image/png' }),
                  width: 0,
                  height: 0,
                  format: 100
                });
                break;
              case 'delete':
                storage.deleteImage(imageId);
                break;
              case 'dispose':
                addon.dispose();
                break;
            }
          }, [action, imageId, KITTY_BLACK_1X1_BYTES] as const);

          await releasePlacementBitmap();
          await writePromise;
          await timeout(50);

          strictEqual(await getImageStorageLength(), 0);
          strictEqual(await ctx.page.evaluate(`window._kittyPausedPlacementBitmap.width`), 0);
          if (action === 'retransmit') {
            strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(${imageId})`), true);
          } else if (action !== 'dispose') {
            strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(${imageId})`), false);
          }
        } finally {
          await releasePlacementBitmap();
          await stopPlacementBitmapPause();
        }
      });
    }
  });

  test.describe('Cursor positioning', () => {
    // NOTE: Current tests document ACTUAL behavior (MVP - cursor doesn't move)
    // Per Kitty spec: cursor placed at first column after last image column,
    // on the last row of the image. C=1 means don't move cursor.

    test('cursor advances past 1x1 image', async () => {
      const cursorBefore = await getCursor();
      const seq = `\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);
      const cursorAfter = await getCursor();
      deepStrictEqual(cursorBefore, [0, 0]);
      // 1x1 pixel image occupies 1 column, cursor advances past it
      deepStrictEqual(cursorAfter, [1, 0]);
    });

    test('cursor advances with text before image', async () => {
      await ctx.proxy.write('Hello');
      deepStrictEqual(await getCursor(), [5, 0]);

      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      // Cursor advances 1 column past the image
      deepStrictEqual(await getCursor(), [6, 0]);
    });

    test('cursor advances with text after image', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      // Cursor at column 1 (past 1-col image)
      deepStrictEqual(await getCursor(), [1, 0]);

      await ctx.proxy.write('World');
      deepStrictEqual(await getCursor(), [6, 0]);
    });

    test('cursor position with multiple images on same line', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(50);
      deepStrictEqual(await getCursor(), [1, 0]);

      await ctx.proxy.write('###');
      deepStrictEqual(await getCursor(), [4, 0]);

      // 3x1 pixel image: ceil(3/cellWidth)=1 column
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(50);
      deepStrictEqual(await getCursor(), [5, 0]);
    });

    test('cursor advances on newline after image', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      deepStrictEqual(await getCursor(), [1, 0]);

      await ctx.proxy.write('\n');
      deepStrictEqual(await getCursor(), [1, 1]);
    });

    test('cursor should move right by cols when c specified', async () => {
      // c=5, r computed from 1x1 aspect ratio: r = ceil((1/1) * (5*cw) / ch)
      // With 1:1 aspect, image height in pixels = 5*cw, so r = ceil(5*cw/ch)
      await ctx.proxy.write(`\x1b_Ga=T,f=100,c=5;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const cursor = await getCursor();
      strictEqual(cursor[0], 5);
      // r is computed from aspect ratio, so y > 0 for a square image at c=5
    });

    test('cursor should move down by rows when r specified', async () => {
      // r=3, c computed from 1x1 aspect ratio: c = ceil((1/1) * (3*ch) / cw)
      await ctx.proxy.write(`\x1b_Ga=T,f=100,r=3;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      const cursor = await getCursor();
      strictEqual(cursor[1], 2);
      // c is computed from aspect ratio, so x > 1 for a square image at r=3
    });

    test('cursor should move by cols AND rows when both specified', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,c=4,r=2;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      // cursor at (4, 1): past 4 columns, on last row (row 1)
      deepStrictEqual(await getCursor(), [4, 1]);
    });

    test('cursor should NOT move when C=1 is specified', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,c=5,r=3,C=1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);

      // C=1: cursor stays at origin
      deepStrictEqual(await getCursor(), [0, 0]);
    });

    test('cursor should calculate cols/rows from image size when not specified', async () => {
      const dim = await getDimensions();

      // 3x1 pixel image: cols = ceil(3/cellWidth), rows = ceil(1/cellHeight)
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(100);

      const expectedCols = Math.ceil(3 / dim.cellWidth);
      const cursor = await getCursor();

      // Cursor advances past image columns, stays on row 0 (single row image)
      strictEqual(cursor[0], expectedCols, 'cursor should advance by image columns');
      strictEqual(cursor[1], 0, 'cursor should stay on row 0 for single-row image');
    });
  });

  test.describe('Z-index layer placement', () => {
    test('default placement (no z key) stores image on top layer', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).layer`), 'top');
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).zIndex`), 0);
    });

    test('z=0 stores image on top layer', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,z=0;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).layer`), 'top');
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).zIndex`), 0);
    });

    test('z=1 (positive) stores image on top layer', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,z=1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).layer`), 'top');
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).zIndex`), 1);
    });

    test('z=-1 uses bottom layer even when allowTransparency is disabled', async () => {
      await ctx.page.evaluate(`window.term.options.allowTransparency = false`);
      await ctx.proxy.write(`\x1b_Ga=T,f=100,z=-1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).layer`), 'bottom');
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).zIndex`), -1);
    });

    test('z=-1 (negative) stores image on bottom layer when allowTransparency is enabled', async () => {
      await ctx.page.evaluate(`window.term.options.allowTransparency = true`);
      await ctx.proxy.write(`\x1b_Ga=T,f=100,z=-1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).layer`), 'bottom');
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).zIndex`), -1);
    });

    test('z=-100 (large negative) stores image on bottom layer when allowTransparency is enabled', async () => {
      await ctx.page.evaluate(`window.term.options.allowTransparency = true`);
      await ctx.proxy.write(`\x1b_Ga=T,f=100,z=-100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).layer`), 'bottom');
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.get(1).zIndex`), -100);
    });

    test('top layer canvas has correct CSS class', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      const hasClass = await ctx.page.evaluate(() => {
        const el = document.querySelector('.xterm-image-layer-top');
        return el !== null;
      });
      strictEqual(hasClass, true);
    });

    test('bottom layer canvas has correct CSS class', async () => {
      await ctx.page.evaluate(`window.term.options.allowTransparency = true`);
      await ctx.proxy.write(`\x1b_Ga=T,f=100,z=-1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      const hasClass = await ctx.page.evaluate(() => {
        const el = document.querySelector('.xterm-image-layer-bottom');
        return el !== null;
      });
      strictEqual(hasClass, true);
    });

    test('bottom layer canvas is before text canvas in DOM order', async () => {
      await ctx.page.evaluate(`window.term.options.allowTransparency = true`);
      await ctx.proxy.write(`\x1b_Ga=T,f=100,z=-1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      const isFirst = await ctx.page.evaluate(() => {
        const screen = document.querySelector('.xterm-screen');
        return screen?.firstElementChild?.classList.contains('xterm-image-layer-bottom') ?? false;
      });
      strictEqual(isFirst, true);
    });
  });

  test.describe('Pixel verification', () => {
    test('renders 1x1 black PNG at cursor position', async () => {
      const seq = `\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);

      deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 255]);
    });

    test('renders 3x1 RGB PNG (red, green, blue pixels)', async () => {
      const seq = `\x1b_Ga=T,f=100;${KITTY_RGB_3X1_BASE64}\x1b\\`;
      await ctx.proxy.write(seq);
      await timeout(100);

      const pixels = await getPixels(0, 0, 0, 0, 3, 1);

      deepStrictEqual(pixels?.slice(0, 4), [255, 0, 0, 255]);
      deepStrictEqual(pixels?.slice(4, 8), [0, 255, 0, 255]);
      deepStrictEqual(pixels?.slice(8, 12), [0, 0, 255, 255]);
    });
  });

  test.describe('Larger image (200x100 multicolor PNG)', () => {
    test.describe('Basic transmission and storage', () => {
      test('stores 200x100 PNG with a=T', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [200, 100]);
      });

      test('transmit only (a=t) stores 200x100 image without display', async () => {
        await ctx.proxy.write(`\x1b_Ga=t,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.size`), 1);
      });

      test('stores with specified image ID', async () => {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=400;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(400)`), true);
      });
    });

    test.describe('Chunked transmission', () => {
      test('handles 2-chunk transmission', async () => {
        const half = Math.floor(KITTY_MULTICOLOR_200X100_BASE64.length / 2);
        const part1 = KITTY_MULTICOLOR_200X100_BASE64.substring(0, half);
        const part2 = KITTY_MULTICOLOR_200X100_BASE64.substring(half);

        await ctx.proxy.write(`\x1b_Ga=T,f=100,i=500,m=1;${part1}\x1b\\`);
        await timeout(50);
        strictEqual(await getImageStorageLength(), 0);

        await ctx.proxy.write(`\x1b_Ga=T,f=100,i=500;${part2}\x1b\\`);
        await timeout(200);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [200, 100]);
      });

      test('handles 3-chunk transmission', async () => {
        const third = Math.floor(KITTY_MULTICOLOR_200X100_BASE64.length / 3);
        const p1 = KITTY_MULTICOLOR_200X100_BASE64.substring(0, third);
        const p2 = KITTY_MULTICOLOR_200X100_BASE64.substring(third, third * 2);
        const p3 = KITTY_MULTICOLOR_200X100_BASE64.substring(third * 2);

        await ctx.proxy.write(`\x1b_Ga=T,f=100,i=501,m=1;${p1}\x1b\\`);
        await timeout(50);
        await ctx.proxy.write(`\x1b_Ga=T,f=100,i=501,m=1;${p2}\x1b\\`);
        await timeout(50);
        await ctx.proxy.write(`\x1b_Ga=T,f=100,i=501;${p3}\x1b\\`);
        await timeout(200);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [200, 100]);
      });

      test('verifies chunked data assembles correctly', async () => {
        const half = Math.floor(KITTY_MULTICOLOR_200X100_BASE64.length / 2);
        const part1 = KITTY_MULTICOLOR_200X100_BASE64.substring(0, half);
        const part2 = KITTY_MULTICOLOR_200X100_BASE64.substring(half);

        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=502,m=1;${part1}\x1b\\`);
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=502;${part2}\x1b\\`);
        await timeout(200);

        const storedData = await ctx.page.evaluate(async () => {
          const blob = (window as any).imageAddon._handlers.get('kitty').images.get(502).data;
          const buffer = await blob.arrayBuffer();
          return Array.from(new Uint8Array(buffer));
        });
        deepStrictEqual(storedData, KITTY_MULTICOLOR_200X100_BYTES);
      });
    });

    test.describe('Cursor positioning', () => {
      test('cursor advances past multi-cell image', async () => {
        const dim = await getDimensions();
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        const expectedCols = Math.ceil(200 / dim.cellWidth);
        const expectedRows = Math.ceil(100 / dim.cellHeight) - 1;
        const cursor = await getCursor();
        strictEqual(cursor[0], expectedCols, 'cursor should advance by image columns');
        strictEqual(cursor[1], expectedRows, 'cursor should be on last row of image');
      });

      test('cursor does not move with C=1', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,C=1;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        deepStrictEqual(await getCursor(), [0, 0]);
      });

      test('cursor uses explicit c and r over image dimensions', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,c=10,r=5;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        deepStrictEqual(await getCursor(), [10, 4]);
      });
    });

    test.describe('Pixel verification', () => {
      // The 200x100 image has 20 colored rectangles in a 10x2 grid.
      // Each rectangle is 20px wide x 50px tall.
      // Top row (y=0..49):  Red, Orange, Yellow, Lime, Green, Cyan, SkyBlue, Blue, Purple, Magenta
      // Bottom row (y=50..99): Pink, Brown, Maroon, Olive, Teal, Navy, Gray, DarkGray, LightGray, White

      test('renders red rectangle at top-left origin (0,0)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        // Pixel (0,0) is in the first rectangle: Red
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
      });

      test('renders top row colors at rectangle centers', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        // Sample center of each top-row rectangle (y=25, x=10,30,50,...,190)
        // All within the first cell row, so we read from the canvas at cell (0,0)
        // Red at x=10
        deepStrictEqual(await getPixel(0, 0, 10, 25), [255, 0, 0, 255]);
        // Orange at x=30
        deepStrictEqual(await getPixel(0, 0, 30, 25), [255, 128, 0, 255]);
        // Yellow at x=50
        deepStrictEqual(await getPixel(0, 0, 50, 25), [255, 255, 0, 255]);
        // Lime at x=70
        deepStrictEqual(await getPixel(0, 0, 70, 25), [0, 255, 0, 255]);
        // Green at x=90
        deepStrictEqual(await getPixel(0, 0, 90, 25), [0, 128, 0, 255]);
      });

      test('renders bottom row colors at rectangle centers', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        // Bottom row starts at y=50. Center at y=75.
        // Pink at x=10
        deepStrictEqual(await getPixel(0, 0, 10, 75), [255, 192, 203, 255]);
        // Brown at x=30
        deepStrictEqual(await getPixel(0, 0, 30, 75), [165, 42, 42, 255]);
        // Maroon at x=50
        deepStrictEqual(await getPixel(0, 0, 50, 75), [128, 0, 0, 255]);
        // Olive at x=70
        deepStrictEqual(await getPixel(0, 0, 70, 75), [128, 128, 0, 255]);
        // Teal at x=90
        deepStrictEqual(await getPixel(0, 0, 90, 75), [0, 128, 128, 255]);
      });

      test('renders correct colors at rectangle boundaries', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        // Last pixel of first rectangle (x=19, y=0): still Red
        deepStrictEqual(await getPixel(0, 0, 19, 0), [255, 0, 0, 255]);
        // First pixel of second rectangle (x=20, y=0): Orange
        deepStrictEqual(await getPixel(0, 0, 20, 0), [255, 128, 0, 255]);
        // Last pixel of top row (x=199, y=49): Magenta
        deepStrictEqual(await getPixel(0, 0, 199, 49), [255, 0, 255, 255]);
        // First pixel of bottom row (x=0, y=50): Pink
        deepStrictEqual(await getPixel(0, 0, 0, 50), [255, 192, 203, 255]);
      });

      test('renders correct color at bottom-right corner', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        // Bottom-right corner (x=199, y=99): White
        deepStrictEqual(await getPixel(0, 0, 199, 99), [255, 255, 255, 255]);
      });

      test('renders a strip of top-row pixels via getPixels', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        // Read 3 pixels starting at x=18 y=0, spanning the Red/Orange boundary
        const pixels = await getPixels(0, 0, 18, 0, 3, 1);
        // x=18,19 -> Red; x=20 -> Orange
        deepStrictEqual(pixels?.slice(0, 4), [255, 0, 0, 255]);     // x=18: Red
        deepStrictEqual(pixels?.slice(4, 8), [255, 0, 0, 255]);     // x=19: Red
        deepStrictEqual(pixels?.slice(8, 12), [255, 128, 0, 255]);  // x=20: Orange
      });

      test('applies source crop via x/y/w/h before display', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,x=20,y=0,w=20,h=50;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        deepStrictEqual(await getOrigSize(1), [20, 50]);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 128, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 19, 49), [255, 128, 0, 255]);
      });

      test('scales cropped source region to c/r placement rectangle', async () => {
        // Firefox's createImageBitmap uses different resize sampling, producing
        // slightly off pixel values compared to Chromium, so skip on Firefox.
        if (ctx.browser.browserType().name() === 'firefox') {
          test.skip();
        }
        await ctx.proxy.write(`\x1b_Ga=T,f=100,x=1,y=0,w=1,h=1,c=4,r=2;${KITTY_RGB_3X1_BASE64}\x1b\\`);
        await timeout(200);

        deepStrictEqual(await getCursor(), [4, 1]);
        const left = await getPixel(0, 0, 2, 10);
        const right = await getPixel(0, 0, 25, 10);
        deepStrictEqual(left, [0, 255, 0, 255]);
        deepStrictEqual(right, [0, 255, 0, 255]);
      });

      test('applies sub-cell offset via X/Y within first cell', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,X=5,Y=3;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
        await timeout(100);

        deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 0]);
        deepStrictEqual(await getPixel(0, 0, 4, 2), [0, 0, 0, 0]);
        deepStrictEqual(await getPixel(0, 0, 5, 3), [0, 0, 0, 255]);
      });

      test('w=0 is treated as unset (displays full width)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,w=0;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        deepStrictEqual(await getOrigSize(1), [200, 100]);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 199, 99), [255, 255, 255, 255]);
      });

      test('h=0 is treated as unset (displays full height)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,h=0;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        deepStrictEqual(await getOrigSize(1), [200, 100]);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 0, 50), [255, 192, 203, 255]);
      });

      test('x exceeding image width produces no display', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,x=999;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        strictEqual(await getImageStorageLength(), 0);
      });

      test('negative x/y values are clamped to 0', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,x=-10,y=-10;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        deepStrictEqual(await getOrigSize(1), [200, 100]);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
      });

      test('combined crop and sub-cell offset', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,x=20,y=0,w=20,h=50,X=5,Y=3;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 0]);
        deepStrictEqual(await getPixel(0, 0, 4, 2), [0, 0, 0, 0]);
        deepStrictEqual(await getPixel(0, 0, 5, 3), [255, 128, 0, 255]);
      });

      test('sub-cell offset with explicit c/r advances cursor correctly', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=100,X=5,Y=3,c=4,r=2;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
        await timeout(100);

        deepStrictEqual(await getCursor(), [4, 1]);
      });
    });

    test.describe('Query support', () => {
      test('responds with OK for valid 200x100 PNG query', async () => {
        await ctx.page.evaluate(() => {
          (window as any).kittyResponse = '';
          (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
        });

        await ctx.proxy.write(`\x1b_Gi=600,a=q,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);

        const response = await ctx.page.evaluate('window.kittyResponse');
        strictEqual(response, '\x1b_Gi=600;OK\x1b\\');
      });

      test('query does not store the 200x100 image', async () => {
        await ctx.page.evaluate(() => {
          (window as any).term.onData(() => { /* consume response */ });
        });

        await ctx.proxy.write(`\x1b_Gi=601,a=q,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(601)`), false);
      });
    });

    test.describe('Delete commands', () => {
      test('uppercase delete removes 200x100 image by id', async () => {
        await ctx.proxy.write(`\x1b_Ga=t,f=100,i=700;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        await timeout(200);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(700)`), true);

        await ctx.proxy.write(`\x1b_Ga=d,d=I,i=700\x1b\\`);
        await timeout(50);
        strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(700)`), false);
      });
    });
  });

  test.describe('Raw RGB pixel format (f=24)', () => {
    test.describe('Pixel verification', () => {
      test('renders 1x1 black pixel with alpha set to 255', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=1,v=1;${RAW_RGB_1X1_BLACK}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [0, 0, 0, 255]);
      });

      test('renders 1x1 red pixel with alpha set to 255', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=1,v=1;${RAW_RGB_1X1_RED}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
      });

      test('renders 3x1 strip (red, green, blue)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=3,v=1;${RAW_RGB_3X1}\x1b\\`);
        await timeout(100);

        const pixels = await getPixels(0, 0, 0, 0, 3, 1);
        deepStrictEqual(pixels?.slice(0, 4), [255, 0, 0, 255]);
        deepStrictEqual(pixels?.slice(4, 8), [0, 255, 0, 255]);
        deepStrictEqual(pixels?.slice(8, 12), [0, 0, 255, 255]);
      });

      test('renders 2x2 grid with correct pixel layout', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=2,v=2;${RAW_RGB_2X2}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 0), [0, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 0, 1), [0, 0, 255, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 1), [255, 255, 0, 255]);
      });

      test('renders 5x1 row with block+remainder pixel layout', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=5,v=1;${RAW_RGB_5X1}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 0), [0, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 2, 0), [0, 0, 255, 255]);
        deepStrictEqual(await getPixel(0, 0, 3, 0), [255, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 4, 0), [255, 0, 255, 255]);
      });

      test('renders 4x2 grid with multi-block pixel layout', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=4,v=2;${RAW_RGB_4X2}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 0), [0, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 2, 0), [0, 0, 255, 255]);
        deepStrictEqual(await getPixel(0, 0, 3, 0), [255, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 0, 1), [255, 0, 255, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 1), [0, 255, 255, 255]);
        deepStrictEqual(await getPixel(0, 0, 2, 1), [128, 128, 128, 255]);
        deepStrictEqual(await getPixel(0, 0, 3, 1), [255, 255, 255, 255]);
      });
    });

    test.describe('Storage and dimensions', () => {
      test('stores image with correct original dimensions (3x1)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=3,v=1;${RAW_RGB_3X1}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [3, 1]);
      });

      test('stores image with correct original dimensions (2x2)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=2,v=2;${RAW_RGB_2X2}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [2, 2]);
      });

      test('stores image with correct original dimensions (5x1)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=5,v=1;${RAW_RGB_5X1}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [5, 1]);
      });

      test('stores image with correct original dimensions (4x2)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=4,v=2;${RAW_RGB_4X2}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [4, 2]);
      });
    });

    test.describe('Validation', () => {
      test('does not render without width (s=)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,v=1;${RAW_RGB_1X1_BLACK}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('does not render without height (v=)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=1;${RAW_RGB_1X1_BLACK}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('does not render without either dimension', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24;${RAW_RGB_1X1_BLACK}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('does not render with insufficient byte count', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=24,s=2,v=2;${RAW_RGB_1X1_BLACK}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('query returns EINVAL without dimensions', async () => {
        await ctx.page.evaluate(() => {
          (window as any).kittyResponse = '';
          (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
        });
        await ctx.proxy.write(`\x1b_Gi=200,a=q,f=24;${RAW_RGB_1X1_BLACK}\x1b\\`);
        await timeout(100);
        const response = await ctx.page.evaluate('window.kittyResponse');
        strictEqual(response, '\x1b_Gi=200;EINVAL:width and height required for raw pixel data\x1b\\');
      });

      test('query returns EINVAL for insufficient pixel data', async () => {
        await ctx.page.evaluate(() => {
          (window as any).kittyResponse = '';
          (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
        });
        await ctx.proxy.write(`\x1b_Gi=201,a=q,f=24,s=2,v=2;${RAW_RGB_1X1_BLACK}\x1b\\`);
        await timeout(100);
        const response = await ctx.page.evaluate('window.kittyResponse');
        strictEqual(response, '\x1b_Gi=201;EINVAL:insufficient pixel data\x1b\\');
      });

      test('query returns OK for valid RGB data with correct dimensions', async () => {
        await ctx.page.evaluate(() => {
          (window as any).kittyResponse = '';
          (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
        });
        await ctx.proxy.write(`\x1b_Gi=202,a=q,f=24,s=1,v=1;${RAW_RGB_1X1_RED}\x1b\\`);
        await timeout(100);
        const response = await ctx.page.evaluate('window.kittyResponse');
        strictEqual(response, '\x1b_Gi=202;OK\x1b\\');
      });
    });
  });

  test.describe('Raw RGBA pixel format (f=32)', () => {
    test.describe('Pixel verification', () => {
      test('renders 1x1 opaque white pixel', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=1,v=1;${RAW_RGBA_1X1_WHITE}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 255, 255, 255]);
      });

      test('renders 1x1 opaque red pixel', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=1,v=1;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
      });

      test('preserves full transparency (alpha=0)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=1,v=1;${RAW_RGBA_1X1_TRANSPARENT}\x1b\\`);
        await timeout(100);
        const pixel = await getPixel(0, 0, 0, 0);
        strictEqual(pixel?.[3], 0);
      });

      test('renders 3x1 strip (red, green, blue opaque)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=3,v=1;${RAW_RGBA_3X1}\x1b\\`);
        await timeout(100);

        const pixels = await getPixels(0, 0, 0, 0, 3, 1);
        deepStrictEqual(pixels?.slice(0, 4), [255, 0, 0, 255]);
        deepStrictEqual(pixels?.slice(4, 8), [0, 255, 0, 255]);
        deepStrictEqual(pixels?.slice(8, 12), [0, 0, 255, 255]);
      });

      test('renders 2x2 grid with correct pixel layout', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=2,v=2;${RAW_RGBA_2X2}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 0), [0, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 0, 1), [0, 0, 255, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 1), [255, 255, 0, 255]);
      });

      test('renders 5x1 row with zero-copy pixel layout', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=5,v=1;${RAW_RGBA_5X1}\x1b\\`);
        await timeout(100);
        deepStrictEqual(await getPixel(0, 0, 0, 0), [255, 0, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 1, 0), [0, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 2, 0), [0, 0, 255, 255]);
        deepStrictEqual(await getPixel(0, 0, 3, 0), [255, 255, 0, 255]);
        deepStrictEqual(await getPixel(0, 0, 4, 0), [255, 0, 255, 255]);
      });
    });

    test.describe('Storage and dimensions', () => {
      test('stores image with correct original dimensions (3x1)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=3,v=1;${RAW_RGBA_3X1}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [3, 1]);
      });

      test('stores image with correct original dimensions (2x2)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=2,v=2;${RAW_RGBA_2X2}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [2, 2]);
      });

      test('stores image with correct original dimensions (5x1)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=5,v=1;${RAW_RGBA_5X1}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 1);
        deepStrictEqual(await getOrigSize(1), [5, 1]);
      });
    });

    test.describe('Validation', () => {
      test('does not render without width (s=)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,v=1;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('does not render without height (v=)', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=1;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('does not render without either dimension', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('does not render with insufficient byte count', async () => {
        await ctx.proxy.write(`\x1b_Ga=T,f=32,s=2,v=2;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        strictEqual(await getImageStorageLength(), 0);
      });

      test('query returns EINVAL without dimensions', async () => {
        await ctx.page.evaluate(() => {
          (window as any).kittyResponse = '';
          (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
        });
        await ctx.proxy.write(`\x1b_Gi=300,a=q,f=32;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        const response = await ctx.page.evaluate('window.kittyResponse');
        strictEqual(response, '\x1b_Gi=300;EINVAL:width and height required for raw pixel data\x1b\\');
      });

      test('query returns EINVAL for insufficient pixel data', async () => {
        await ctx.page.evaluate(() => {
          (window as any).kittyResponse = '';
          (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
        });
        await ctx.proxy.write(`\x1b_Gi=301,a=q,f=32,s=2,v=2;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        const response = await ctx.page.evaluate('window.kittyResponse');
        strictEqual(response, '\x1b_Gi=301;EINVAL:insufficient pixel data\x1b\\');
      });

      test('query returns OK for valid RGBA data with correct dimensions', async () => {
        await ctx.page.evaluate(() => {
          (window as any).kittyResponse = '';
          (window as any).term.onData((data: string) => { (window as any).kittyResponse = data; });
        });
        await ctx.proxy.write(`\x1b_Gi=302,a=q,f=32,s=1,v=1;${RAW_RGBA_1X1_RED}\x1b\\`);
        await timeout(100);
        const response = await ctx.page.evaluate('window.kittyResponse');
        strictEqual(response, '\x1b_Gi=302;OK\x1b\\');
      });
    });
  });

  test.describe('Eviction and memory leak prevention', () => {
    test('re-transmit with same i= cleans up old storage entry', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=50;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(50)`), true);
      const oldStorageId = await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(50)`);
      ok(oldStorageId !== undefined);

      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=50;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(50)`), true);
      const newStorageId = await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(50)`);
      ok(newStorageId !== undefined);
      ok(newStorageId !== oldStorageId);
    });

    test('memory limit eviction keeps placeholder placement deletable', async () => {
      // Resize terminal to fit 7 non-overlapping 200x100 images without scrolling.
      // Each image ≈ 29 cols × 8 rows at default cell size.
      await ctx.page.evaluate(`
        window.term.reset();
        window.imageAddon?.dispose();
        window.term.resize(80, 48);
        window.imageAddon = new ImageAddon({ storageLimit: 0.5 });
        window.term.loadAddon(window.imageAddon);
      `);

      // storageLimit 0.5 MB = 125,000 pixels. Each 200x100 image = 20,000 pixels.
      // 6 images = 120K pixels (under limit). 7th triggers eviction (140K > 125K).
      // Place non-overlapping so tile-count eviction doesn't interfere.
      const positions = [[1, 1], [30, 1], [1, 9], [30, 9], [1, 17], [30, 17]];
      let firstStorageId: number | undefined;
      let secondStorageId: number | undefined;
      for (let n = 0; n < 6; n++) {
        const [c, r] = positions[n];
        const id = 60 + n;
        await ctx.proxy.write(`\x1b[${r};${c}H\x1b_Ga=T,f=100,i=${id},C=1;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
        if (n === 0) {
          firstStorageId = await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(60)`);
        } else if (n === 1) {
          secondStorageId = await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(61)`);
        }
      }
      await pollFor(ctx.page, 'window.imageAddon._storage._images.size', 6);
      ok(firstStorageId !== undefined);
      ok(secondStorageId !== undefined);

      // 7th image pushes placement pixels past 125K — oldest raster is evicted.
      await ctx.proxy.write(`\x1b[25;1H\x1b_Ga=T,f=100,i=66,C=1;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await pollFor(ctx.page, `window.imageAddon._storage._images.has(${firstStorageId})`, false);
      await timeout(100);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(60)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(60)`), true);
      strictEqual(await getViewportCellImageId(0, 0), firstStorageId);
      deepStrictEqual(await getRenderedViewportPixel(0, 0), [0, 0, 0, 255]);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(66)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(66)`), true);

      await ctx.proxy.write('\x1b_Ga=d,d=i,i=60\x1b\\');
      await timeout(100);

      strictEqual(await getViewportCellImageId(0, 0), -1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(60)`), false);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(60)`), true);

      await ctx.proxy.write('\x1b[1;30H\x1b_Ga=p,i=66,p=2,C=1\x1b\\');
      await pollFor(ctx.page, `window.imageAddon._storage._images.has(${secondStorageId})`, false);

      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(61)`), false);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(61)`), true);
      ok(await getViewportCellImageId(29, 0) > 0);

      // Restore terminal size
      await ctx.page.evaluate('window.term.resize(80, 24)');
    });

    test('deletes a reflowed placement when only its evicted placeholder remains', async () => {
      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=71;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await ctx.proxy.write('\x1b_Ga=p,i=71,p=1,c=30,r=1,C=1\x1b\\');
      await timeout(100);
      const storageId = await ctx.page.evaluate<number | undefined>(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(71)`);
      ok(storageId !== undefined);

      await ctx.page.evaluate(() => {
        const storage = (window as any).imageAddon._storage;
        storage._pixelLimit = 0;
        storage.enforceLimit();
      });
      await pollFor(ctx.page, 'window.imageAddon._storage._images.size', 0);
      await timeout(100);
      deepStrictEqual(await getRenderedViewportPixel(0, 0), [0, 0, 0, 255]);

      await ctx.page.evaluate(() => (window as any).term.resize(20, 24));
      ok(await countBufferImageRefs(storageId) > 0);

      await ctx.proxy.write('\x1b_Ga=d,d=i,i=71\x1b\\');
      await timeout(100);

      strictEqual(await countBufferImageRefs(storageId), 0);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(71)`), false);
      await ctx.page.evaluate('window.term.resize(80, 24)');
    });

    test('index rebuild drops an evicted placement with no remaining cells', async () => {
      await ctx.proxy.write(`\x1b[1;80H\x1b_Ga=T,f=100,i=72,C=1;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      const storageId = await ctx.page.evaluate<number | undefined>(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(72)`);
      ok(storageId !== undefined);

      await ctx.page.evaluate(() => {
        const storage = (window as any).imageAddon._storage;
        storage._pixelLimit = 0;
        storage.enforceLimit();
      });
      await pollFor(ctx.page, 'window.imageAddon._storage._images.size', 0);
      strictEqual(await countActiveBufferImageRefs(storageId), 1);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(72)`), true);

      await ctx.page.evaluate((storageId: number) => {
        const term = (window as any).term;
        const buffer = term._core.buffer;
        for (let row = 0; row < buffer.lines.length; row++) {
          const line = buffer.lines.get(row);
          for (const key of Object.keys(line?._extendedAttrs ?? {})) {
            const column = Number(key);
            if (line._extendedAttrs[column]?.imageId === storageId) {
              delete line._extendedAttrs[column];
            }
          }
        }
        (window as any).imageAddon._storage.viewportResize({ cols: 79, rows: 24 });
      }, storageId);
      await pollFor(ctx.page, `window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(72)`, false);

      deepStrictEqual(await getActiveBufferImageRefs(storageId), []);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._evictedImages.has(${storageId})`), false);
    });

    test('scrollback eviction drops placement map but preserves Kitty image data', async () => {
      await ctx.page.evaluate(`
        window.term.reset();
        window.imageAddon?.dispose();
        window.imageAddon = new ImageAddon();
        window.term.loadAddon(window.imageAddon);
      `);

      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=70;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(70)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(70)`), true);

      // Scroll past scrollback + viewport to push image's marker off the buffer
      await ctx.page.evaluate(() => new Promise<void>(res => {
        const term = (window as any).term;
        const amount: number = (term.options.scrollback as number) + (term.rows as number) + 10;
        term.write('\n'.repeat(amount), res);
      }));

      await pollFor(ctx.page, `window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(70)`, false);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty').images.has(70)`), true);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.has(70)`), false);
    });

    test('re-transmit with a=t then a=T cleans old storage before display', async () => {
      await ctx.proxy.write(`\x1b_Ga=T,f=100,i=80;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await getImageStorageLength(), 1);
      const oldStorageId = await ctx.page.evaluate(`window.imageAddon._handlers.get('kitty')._kittyIdToStorageId.get(80)`);
      ok(oldStorageId !== undefined);

      await ctx.proxy.write(`\x1b_Ga=t,f=100,i=80;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await timeout(100);
      strictEqual(await ctx.page.evaluate(`window.imageAddon._storage._images.has(${oldStorageId})`), false);
    });
  });

  test.describe('onImageAdded callback', () => {
    test('onImageAdded fires for each kitty image', async () => {
      await ctx.page.evaluate(`
        window._imageAddedCount = 0;
        window.imageAddon.onImageAdded(() => { window._imageAddedCount++; });
      `);
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_BLACK_1X1_BASE64}\x1b\\`);
      await pollFor(ctx.page, 'window._imageAddedCount', 1);
      await ctx.proxy.write(`\x1b_Ga=T,f=100;${KITTY_RGB_3X1_BASE64}\x1b\\`);
      await pollFor(ctx.page, 'window._imageAddedCount', 2);
    });
  });

  test.describe('text overwrite removes tiles', () => {
    test('a=T placement', async () => {
      await ctx.proxy.write(`\x1b[H\x1b_Ga=T,f=100;${KITTY_MULTICOLOR_200X100_BASE64}\x1b\\`);
      await pollFor(ctx.page, '!!window.imageAddon.extractTileAtBufferCell(5, 1)', true);
      ok(await hasTileAtBufferCell(0, 1));
      await ctx.proxy.write('\x1b[2;6H#######');
      for (let x = 5; x < 12; x++) {
        strictEqual(await hasTileAtBufferCell(x, 1), false);
      }
      ok(await hasTileAtBufferCell(0, 1));
      ok(await hasTileAtBufferCell(13, 1));
      ok(((await ctx.page.evaluate('window.term.buffer.active.getLine(1).translateToString(true)')) as string).includes('#######'));
    });
  });
});

/**
 * Helper functions
 */
async function getDimensions(): Promise<IDimensions> {
  const dimensions: any = await ctx.page.evaluate(`term.dimensions`);
  return {
    cellWidth: Math.round(dimensions.css.cell.width),
    cellHeight: Math.round(dimensions.css.cell.height),
    width: Math.round(dimensions.css.canvas.width),
    height: Math.round(dimensions.css.canvas.height)
  };
}

async function getCursor(): Promise<[number, number]> {
  return ctx.page.evaluate('[window.term.buffer.active.cursorX, window.term.buffer.active.cursorY]');
}

async function getImageStorageLength(): Promise<number> {
  return ctx.page.evaluate('window.imageAddon._storage._images.size');
}

async function getOrigSize(id: number): Promise<[number, number]> {
  return ctx.page.evaluate<any>(`[
    window.imageAddon._storage._images.get(${id}).orig.width,
    window.imageAddon._storage._images.get(${id}).orig.height
  ]`);
}

async function getPixel(col: number, row: number, x: number, y: number): Promise<number[] | null> {
  return ctx.page.evaluate(([col, row, x, y]: number[]) => {
    const canvas = (window as any).imageAddon.getImageAtBufferCell(col, row);
    if (!canvas) return null;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return null;
    return Array.from(ctx2d.getImageData(x, y, 1, 1).data);
  }, [col, row, x, y]);
}

async function getPixels(col: number, row: number, x: number, y: number, w: number, h: number): Promise<number[] | null> {
  return ctx.page.evaluate(([col, row, x, y, w, h]: number[]) => {
    const canvas = (window as any).imageAddon.getImageAtBufferCell(col, row);
    if (!canvas) return null;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return null;
    return Array.from(ctx2d.getImageData(x, y, w, h).data);
  }, [col, row, x, y, w, h]);
}

async function hasTileAtBufferCell(x: number, y: number): Promise<boolean> {
  return ctx.page.evaluate(`!!window.imageAddon.extractTileAtBufferCell(${x}, ${y})`);
}

async function getViewportCellImageId(col: number, row: number): Promise<number> {
  return ctx.page.evaluate(([col, row]: number[]) => {
    const buffer = (window as any).term._core.buffer;
    return buffer.lines.get(buffer.ybase + row)?._extendedAttrs[col]?.imageId ?? -1;
  }, [col, row]);
}

async function getAbsoluteCellImageId(col: number, row: number): Promise<number> {
  return ctx.page.evaluate(([col, row]: number[]) => {
    const buffer = (window as any).term._core.buffer;
    return buffer.lines.get(row)?._extendedAttrs[col]?.imageId ?? -1;
  }, [col, row]);
}

async function countBufferImageRefs(imageId: number): Promise<number> {
  return ctx.page.evaluate((imageId: number) => {
    const buffers = (window as any).term._core.buffers;
    let count = 0;
    for (const buffer of [buffers.normal, buffers.alt]) {
      for (let row = 0; row < buffer.lines.length; row++) {
        const line = buffer.lines.get(row);
        for (const key of Object.keys(line?._extendedAttrs ?? {})) {
          if (line._extendedAttrs[Number(key)]?.imageId === imageId) {
            count++;
          }
        }
      }
    }
    return count;
  }, imageId);
}

async function countActiveBufferImageRefs(imageId: number): Promise<number> {
  return (await getActiveBufferImageRefs(imageId)).length;
}

async function getActiveBufferImageRefs(imageId: number): Promise<{ row: number, column: number, lineLength: number }[]> {
  return ctx.page.evaluate((imageId: number) => {
    const buffer = (window as any).term._core.buffer;
    const refs: { row: number, column: number, lineLength: number }[] = [];
    for (let row = 0; row < buffer.lines.length; row++) {
      const line = buffer.lines.get(row);
      for (const key of Object.keys(line?._extendedAttrs ?? {})) {
        const column = Number(key);
        if (line._extendedAttrs[column]?.imageId === imageId) {
          refs.push({ row, column, lineLength: line.length });
        }
      }
    }
    return refs;
  }, imageId);
}

async function getRenderedViewportPixel(col: number, row: number, x: number = 0, y: number = 0): Promise<number[] | null> {
  return getRenderedViewportPixels(col, row, x, y, 1, 1);
}

async function getRenderedViewportPixels(col: number, row: number, x: number, y: number, width: number, height: number): Promise<number[] | null> {
  return ctx.page.evaluate(([col, row, x, y, width, height]: number[]) => {
    const canvas = document.querySelector('.xterm-image-layer-top') as HTMLCanvasElement | null;
    const dimensions = (window as any).term._core._renderService.dimensions.css.cell;
    const context = canvas?.getContext('2d');
    if (!context) {
      return null;
    }
    return Array.from(context.getImageData(
      Math.floor(col * dimensions.width + x),
      Math.floor(row * dimensions.height + y),
      width,
      height
    ).data);
  }, [col, row, x, y, width, height]);
}

async function startBlobDecodeCounter(): Promise<void> {
  await ctx.page.evaluate(() => {
    const globalWindow = window as any;
    globalWindow._kittyOriginalCreateImageBitmap = globalWindow.createImageBitmap;
    globalWindow._kittyBlobDecodeCount = 0;
    globalWindow.createImageBitmap = (...args: any[]) => {
      if (args[0] instanceof Blob) {
        globalWindow._kittyBlobDecodeCount++;
      }
      return globalWindow._kittyOriginalCreateImageBitmap(...args);
    };
  });
}

async function stopBlobDecodeCounter(): Promise<void> {
  await ctx.page.evaluate(() => {
    const globalWindow = window as any;
    if (globalWindow._kittyOriginalCreateImageBitmap) {
      globalWindow.createImageBitmap = globalWindow._kittyOriginalCreateImageBitmap;
      delete globalWindow._kittyOriginalCreateImageBitmap;
    }
  });
}

async function getBlobDecodeCount(): Promise<number> {
  return ctx.page.evaluate('window._kittyBlobDecodeCount');
}

async function startPlacementBitmapPause(): Promise<void> {
  await ctx.page.evaluate(() => {
    const globalWindow = window as any;
    globalWindow._kittyOriginalCreateImageBitmap = globalWindow.createImageBitmap;
    globalWindow._kittyPlacementBitmapPaused = false;
    globalWindow.createImageBitmap = (...args: any[]) => {
      const result = globalWindow._kittyOriginalCreateImageBitmap(...args);
      if (!globalWindow._kittyPlacementBitmapPaused && args[0] instanceof ImageBitmap) {
        globalWindow._kittyPlacementBitmapPaused = true;
        return result.then((bitmap: ImageBitmap) => new Promise<ImageBitmap>(resolve => {
          globalWindow._kittyPausedPlacementBitmap = bitmap;
          globalWindow._kittyReleasePlacementBitmap = () => {
            delete globalWindow._kittyReleasePlacementBitmap;
            resolve(bitmap);
          };
        }));
      }
      return result;
    };
  });
}

async function releasePlacementBitmap(): Promise<void> {
  await ctx.page.evaluate(() => {
    (window as any)._kittyReleasePlacementBitmap?.();
  });
}

async function stopPlacementBitmapPause(): Promise<void> {
  await ctx.page.evaluate(() => {
    const globalWindow = window as any;
    if (globalWindow._kittyOriginalCreateImageBitmap) {
      globalWindow.createImageBitmap = globalWindow._kittyOriginalCreateImageBitmap;
      delete globalWindow._kittyOriginalCreateImageBitmap;
    }
    delete globalWindow._kittyReleasePlacementBitmap;
  });
}
