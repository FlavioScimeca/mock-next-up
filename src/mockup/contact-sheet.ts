import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSharp } from "../platform/sharp/client.js";

const DEBUG_TILES = [
  "resized-design.png",
  "print-ready-design.png",
  "print-adjusted-design.png",
  "design-canvas.png",
  "masked-design.png",
  "printed-design.png",
  "design-alpha-mask.png",
  "clipped-fabric-texture.png",
  "clipped-fabric-dark.png",
  "clipped-fabric-light.png",
  "clipped-shadow.png",
  "clipped-highlight.png",
  "final.png",
] as const;

const THUMB_WIDTH = 400;
const GRID_COLUMNS = 3;
const JPEG_QUALITY = 85;

export async function buildDebugContactSheet(debugDir: string): Promise<void> {
  const sharp = getSharp();
  const tiles: { buffer: Buffer; width: number; height: number }[] = [];

  for (const filename of DEBUG_TILES) {
    const filePath = join(debugDir, filename);
    if (!existsSync(filePath)) {
      continue;
    }

    const source = await readFile(filePath);
    const thumb = await sharp(source)
      .resize(THUMB_WIDTH, undefined, { fit: "inside" })
      .png()
      .toBuffer();
    const meta = await sharp(thumb).metadata();

    if (!meta.width || !meta.height) {
      continue;
    }

    tiles.push({
      buffer: thumb,
      width: meta.width,
      height: meta.height,
    });
  }

  if (tiles.length === 0) {
    return;
  }

  const cellWidth = THUMB_WIDTH;
  const cellHeight = Math.max(...tiles.map((tile) => tile.height));
  const rowCount = Math.ceil(tiles.length / GRID_COLUMNS);
  const canvasWidth = GRID_COLUMNS * cellWidth;
  const canvasHeight = rowCount * cellHeight;

  const composites = tiles.map((tile, index) => {
    const column = index % GRID_COLUMNS;
    const row = Math.floor(index / GRID_COLUMNS);

    return {
      input: tile.buffer,
      left: column * cellWidth + Math.round((cellWidth - tile.width) / 2),
      top: row * cellHeight + Math.round((cellHeight - tile.height) / 2),
    };
  });

  const contactSheet = await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  await writeFile(join(debugDir, "contact-sheet.jpg"), contactSheet);
}
