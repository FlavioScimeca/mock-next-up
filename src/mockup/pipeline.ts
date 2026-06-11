import { constants } from "node:fs";
import { access, mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSharp } from "../platform/sharp/client.js";
import { getDebugDir } from "../config/env.js";
import { isPngHeader } from "../lib/png.js";
import { RenderProgress } from "./progress.js";
import { MockupError } from "./errors.js";
import {
  applyAlphaMask,
  extractAlphaMaskFromLayer,
  luminanceToAlphaMask,
} from "./mask.js";
import { applyOpacity } from "./opacity.js";
import { adjustPrintColor, hasPrintColorAdjustment, simulatePrintRaster } from "./print.js";
import type { LoadedTemplate } from "./types.js";

async function writeDebugImage(
  debug: boolean,
  filename: string,
  buffer: Buffer,
): Promise<void> {
  if (!debug) {
    return;
  }

  const debugDir = getDebugDir();
  await mkdir(debugDir, { recursive: true });
  await writeFile(join(debugDir, filename), buffer);
}

export async function validateDesignIsPng(designPath: string): Promise<void> {
  const sharp = getSharp();

  try {
    await access(designPath, constants.F_OK);
  } catch {
    throw new MockupError(
      "MISSING_DESIGN",
      "design file is required",
      400,
    );
  }

  const header = Buffer.alloc(8);
  const handle = await open(designPath, "r");
  try {
    await handle.read(header, 0, 8, 0);
  } finally {
    await handle.close();
  }

  const isPng = isPngHeader(header);

  if (!isPng) {
    throw new MockupError(
      "UNSUPPORTED_FILE_TYPE",
      "Only PNG designs are supported",
      415,
    );
  }

  const metadata = await sharp(designPath).metadata();
  if (metadata.format !== "png") {
    throw new MockupError(
      "UNSUPPORTED_FILE_TYPE",
      "Only PNG designs are supported",
      415,
    );
  }
}

function computeContainedPlacement(
  designWidth: number,
  designHeight: number,
  template: LoadedTemplate,
): {
  resizedWidth: number;
  resizedHeight: number;
  left: number;
  top: number;
} {
  const { printArea } = template.config;
  const scale = Math.min(
    printArea.width / designWidth,
    printArea.height / designHeight,
  );
  const resizedWidth = Math.max(1, Math.round(designWidth * scale));
  const resizedHeight = Math.max(1, Math.round(designHeight * scale));
  const left = printArea.x + Math.round((printArea.width - resizedWidth) / 2);
  const top = printArea.y + Math.round((printArea.height - resizedHeight) / 2);

  return { resizedWidth, resizedHeight, left, top };
}

function resolveFabricTexturePath(
  source: "shadow",
  paths: LoadedTemplate["paths"],
): string {
  return paths.shadow;
}

export async function runRenderPipeline(options: {
  template: LoadedTemplate;
  designPath: string;
  debug: boolean;
  progress: RenderProgress;
}): Promise<Buffer> {
  const sharp = getSharp();
  const { template, designPath, debug, progress } = options;
  const { canvas, layers } = template.config;

  progress.step("validate-design", { designPath });

  await validateDesignIsPng(designPath);

  progress.step("build-alpha-mask", {
    maskPath: template.paths.mask,
    canvas: `${canvas.width}x${canvas.height}`,
  });

  const alphaMask = await luminanceToAlphaMask(template.paths.mask);

  const designMetadata = await sharp(designPath).metadata();
  const designWidth = designMetadata.width;
  const designHeight = designMetadata.height;

  if (!designWidth || !designHeight) {
    throw new MockupError(
      "RENDER_FAILURE",
      "Render failed: unable to read design dimensions",
      500,
    );
  }

  const placement = computeContainedPlacement(
    designWidth,
    designHeight,
    template,
  );

  progress.step("resize-design", {
    source: `${designWidth}x${designHeight}`,
    target: `${placement.resizedWidth}x${placement.resizedHeight}`,
    printArea: `${template.config.printArea.width}x${template.config.printArea.height}`,
  });

  const resizedDesign = await sharp(designPath)
    .resize(placement.resizedWidth, placement.resizedHeight, {
      fit: "inside",
    })
    .png()
    .toBuffer();

  await writeDebugImage(debug, "resized-design.png", resizedDesign);

  const resizedMetadata = await sharp(resizedDesign).metadata();
  const resizedWidth = resizedMetadata.width;
  const resizedHeight = resizedMetadata.height;

  if (!resizedWidth || !resizedHeight) {
    throw new MockupError(
      "RENDER_FAILURE",
      "Render failed: unable to read resized design dimensions",
      500,
    );
  }

  const printConfig = template.config.print;
  if (printConfig?.rasterize) {
    progress.step("simulate-print-raster", {
      resolutionScale: printConfig.resolutionScale ?? 0.75,
      soften: printConfig.soften ?? 0.25,
    });
  }

  const printReadyDesign = await simulatePrintRaster(
    resizedDesign,
    resizedWidth,
    resizedHeight,
    printConfig,
  );

  await writeDebugImage(debug, "print-ready-design.png", printReadyDesign);

  if (hasPrintColorAdjustment(printConfig)) {
    progress.step("adjust-print-color", {
      brightness: printConfig?.brightness ?? 1,
      saturation: printConfig?.saturation ?? 1,
      contrast: printConfig?.contrast ?? 1,
      blackLift: printConfig?.blackLift ?? 0,
    });
  }

  const printAdjustedDesign = await adjustPrintColor(
    printReadyDesign,
    printConfig,
  );

  await writeDebugImage(debug, "print-adjusted-design.png", printAdjustedDesign);

  progress.step("place-design-on-canvas", {
    left: placement.left,
    top: placement.top,
    canvas: `${canvas.width}x${canvas.height}`,
  });

  const designCanvas = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: printAdjustedDesign,
        left: placement.left,
        top: placement.top,
      },
    ])
    .png()
    .toBuffer();

  await writeDebugImage(debug, "design-canvas.png", designCanvas);

  progress.step("mask-design");

  const maskedDesign = await applyAlphaMask(designCanvas, alphaMask);
  await writeDebugImage(debug, "masked-design.png", maskedDesign);

  const designOpacity = template.config.design?.opacity ?? 1;
  const printedDesign =
    designOpacity < 1
      ? await applyOpacity(maskedDesign, designOpacity)
      : maskedDesign;

  await writeDebugImage(debug, "printed-design.png", printedDesign);

  progress.step("extract-design-alpha-mask");

  const designAlphaMask = await extractAlphaMaskFromLayer(printedDesign);
  await writeDebugImage(debug, "design-alpha-mask.png", designAlphaMask);

  progress.step("composite-base", { basePath: template.paths.base });

  const composites: Array<{
    input: Buffer;
    blend: "over" | "multiply" | "screen";
  }> = [
    {
      input: printedDesign,
      blend: "over",
    },
  ];

  const fabric = template.config.fabric;
  const fabricEnabled = fabric?.enabled ?? false;
  const fabricTextureSource = fabric?.textureSource ?? "shadow";
  const fabricTextureOpacity = fabric?.textureOpacity ?? 0.05;

  if (fabricEnabled) {
    if (fabricTextureSource === "fabricSplit") {
      const darkOpacity = fabric?.darkOpacity ?? 0.05;
      const lightOpacity = fabric?.lightOpacity ?? 0.05;

      progress.step("apply-fabric-split-dark", {
        textureSource: fabricTextureSource,
        blend: "multiply",
        opacity: darkOpacity,
      });

      const fabricDarkWithOpacity = await applyOpacity(
        template.paths.fabricDark!,
        darkOpacity,
      );
      const clippedFabricDark = await applyAlphaMask(
        fabricDarkWithOpacity,
        designAlphaMask,
      );
      await writeDebugImage(debug, "clipped-fabric-dark.png", clippedFabricDark);
      composites.push({
        input: clippedFabricDark,
        blend: "multiply",
      });

      progress.step("apply-fabric-split-light", {
        textureSource: fabricTextureSource,
        blend: "screen",
        opacity: lightOpacity,
      });

      const fabricLightWithOpacity = await applyOpacity(
        template.paths.fabricLight!,
        lightOpacity,
      );
      const clippedFabricLight = await applyAlphaMask(
        fabricLightWithOpacity,
        designAlphaMask,
      );
      await writeDebugImage(debug, "clipped-fabric-light.png", clippedFabricLight);
      composites.push({
        input: clippedFabricLight,
        blend: "screen",
      });
    } else {
      const texturePath = resolveFabricTexturePath(
        fabricTextureSource,
        template.paths,
      );

      progress.step("apply-fabric-texture", {
        textureSource: fabricTextureSource,
        blend: fabric?.blend ?? "multiply",
        opacity: fabricTextureOpacity,
      });

      const fabricWithOpacity = await applyOpacity(
        texturePath,
        fabricTextureOpacity,
      );
      const clippedFabricTexture = await applyAlphaMask(
        fabricWithOpacity,
        designAlphaMask,
      );
      await writeDebugImage(debug, "clipped-fabric-texture.png", clippedFabricTexture);
      composites.push({
        input: clippedFabricTexture,
        blend: "multiply",
      });
    }
  }

  if (layers.shadow.enabled) {
    progress.step("apply-shadow", {
      blend: layers.shadow.blend,
      opacity: layers.shadow.opacity,
    });

    const shadowWithOpacity = await applyOpacity(
      template.paths.shadow,
      layers.shadow.opacity,
    );
    const clippedShadow = await applyAlphaMask(
      shadowWithOpacity,
      designAlphaMask,
    );
    await writeDebugImage(debug, "clipped-shadow.png", clippedShadow);
    composites.push({
      input: clippedShadow,
      blend: "multiply",
    });
  }

  if (layers.highlight.enabled) {
    progress.step("apply-highlight", {
      blend: layers.highlight.blend,
      opacity: layers.highlight.opacity,
    });

    const highlightWithOpacity = await applyOpacity(
      template.paths.highlight,
      layers.highlight.opacity,
    );
    const clippedHighlight = await applyAlphaMask(
      highlightWithOpacity,
      designAlphaMask,
    );
    await writeDebugImage(debug, "clipped-highlight.png", clippedHighlight);
    composites.push({
      input: clippedHighlight,
      blend: "screen",
    });
  }

  progress.step("encode-final-png", {
    layers: composites.length,
  });

  return sharp(template.paths.base).composite(composites).png().toBuffer();
}
