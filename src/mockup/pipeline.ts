import { constants } from "node:fs";
import { access, mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSharp } from "../platform/sharp/client.js";
import { getDebugDir } from "../config/env.js";
import { isPngHeader } from "../lib/png.js";
import {
  applyLuminanceAwareMask,
  toCompositeBlend,
} from "./compositing.js";
import {
  applyKnockoutFabricBlend,
  shouldUseEmbeddedFabric,
} from "./fabric-blend.js";
import { applyHarmonization } from "./harmonize.js";
import { RenderProgress } from "./progress.js";
import { MockupError } from "./errors.js";
import {
  applyAlphaMask,
  extractAlphaMaskFromLayer,
  luminanceToAlphaMask,
} from "./mask.js";
import { applyOpacity } from "./opacity.js";
import {
  getPrintAreaQuad,
  hasPerspectiveWarp,
  warpDesignToQuad,
} from "./perspective.js";
import {
  adjustPrintColor,
  applyEdgeSpread,
  hasPrintColorAdjustment,
  simulatePrintRaster,
} from "./print.js";
import {
  applyColorSubstrateTint,
  applySubstrateUnderbase,
  resolveEffectivePrintConfig,
} from "./substrate.js";
import { applyDisplacementWarp } from "./warp.js";
import type { CompositeBlendMode, LoadedTemplate } from "./types.js";

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
  source: "shadow" | "fabricTexture",
  paths: LoadedTemplate["paths"],
): string {
  if (source === "fabricTexture" && paths.fabricTexture) {
    return paths.fabricTexture;
  }

  return paths.shadow;
}

function usesShadowAsFabric(
  template: LoadedTemplate,
  fabricTextureSource: string,
): boolean {
  return (
    fabricTextureSource === "shadow" && !template.paths.fabricTexture
  );
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
  const printConfig = resolveEffectivePrintConfig(template.config.print);

  progress.step("validate-design", { designPath });

  await validateDesignIsPng(designPath);

  progress.step("build-alpha-mask", {
    maskPath: template.paths.mask,
    canvas: `${canvas.width}x${canvas.height}`,
    feather: template.config.mask?.feather ?? 0,
  });

  const alphaMask = await luminanceToAlphaMask(
    template.paths.mask,
    template.config.mask?.feather ?? 0,
  );

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

  if (printConfig.rasterize) {
    progress.step("simulate-print-raster", {
      resolutionScale: printConfig.resolutionScale ?? 0.75,
      soften: printConfig.soften ?? 0.25,
      substrate: printConfig.substrate ?? "light",
    });
  }

  let processedDesign = await simulatePrintRaster(
    resizedDesign,
    resizedWidth,
    resizedHeight,
    printConfig,
  );

  await writeDebugImage(debug, "print-ready-design.png", processedDesign);

  if ((printConfig.edgeSpread ?? 0) > 0) {
    progress.step("apply-edge-spread", {
      edgeSpread: printConfig.edgeSpread,
    });
    processedDesign = await applyEdgeSpread(
      processedDesign,
      printConfig.edgeSpread ?? 0,
    );
  }

  processedDesign = await applySubstrateUnderbase(
    processedDesign,
    printConfig.substrate,
  );

  if (hasPrintColorAdjustment(printConfig)) {
    progress.step("adjust-print-color", {
      brightness: printConfig.brightness ?? 1,
      saturation: printConfig.saturation ?? 1,
      contrast: printConfig.contrast ?? 1,
      blackLift: printConfig.blackLift ?? 0,
    });
  }

  let printAdjustedDesign = await adjustPrintColor(processedDesign, printConfig);

  printAdjustedDesign = await applyColorSubstrateTint(
    printAdjustedDesign,
    template.paths.base,
    template.config.printArea,
    printConfig.substrate,
  );

  await writeDebugImage(debug, "print-adjusted-design.png", printAdjustedDesign);

  if (hasPerspectiveWarp(template.config.printArea)) {
    progress.step("perspective-warp", {
      quad: getPrintAreaQuad(template.config.printArea),
    });

    printAdjustedDesign = await warpDesignToQuad(
      printAdjustedDesign,
      canvas,
      placement,
      getPrintAreaQuad(template.config.printArea),
    );
    await writeDebugImage(debug, "perspective-warped-design.png", printAdjustedDesign);
  }

  progress.step("place-design-on-canvas", {
    left: placement.left,
    top: placement.top,
    canvas: `${canvas.width}x${canvas.height}`,
  });

  let designCanvas: Buffer;
  if (hasPerspectiveWarp(template.config.printArea)) {
    designCanvas = printAdjustedDesign;
  } else {
    designCanvas = await sharp({
      create: {
        width: canvas.width,
        height: canvas.height,
        channels: 4,
        background: { r: 0, g:  0, b: 0, alpha: 0 },
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
  }

  await writeDebugImage(debug, "design-canvas.png", designCanvas);

  progress.step("mask-design");

  let maskedDesign = await applyAlphaMask(designCanvas, alphaMask);
  await writeDebugImage(debug, "masked-design.png", maskedDesign);

  const warpConfig = template.config.warp;
  if (warpConfig?.enabled && template.paths.displacement) {
    progress.step("displacement-warp", {
      strength: warpConfig.strength ?? 6,
      source: warpConfig.source ?? "displacement",
    });

    maskedDesign = await applyDisplacementWarp(
      maskedDesign,
      template.paths.displacement,
      warpConfig.strength ?? 6,
    );
    await writeDebugImage(debug, "warped-design.png", maskedDesign);
  }

  const designOpacity = template.config.design?.opacity ?? 1;
  let printedDesign =
    designOpacity < 1
      ? await applyOpacity(maskedDesign, designOpacity)
      : maskedDesign;

  await writeDebugImage(debug, "printed-design.png", printedDesign);

  const fabric = template.config.fabric;
  if (shouldUseEmbeddedFabric(fabric)) {
    progress.step("apply-knockout-fabric", {
      textureSource: fabric?.textureSource ?? "shadow",
      embedded: true,
    });

    printedDesign = await applyKnockoutFabricBlend(
      printedDesign,
      template.paths.base,
      {
        fabric,
        fabricDarkPath: template.paths.fabricDark,
        fabricLightPath: template.paths.fabricLight,
      },
    );
    await writeDebugImage(debug, "knockout-blend.png", printedDesign);
  }

  progress.step("extract-design-alpha-mask");

  const designAlphaMask = await extractAlphaMaskFromLayer(printedDesign);
  await writeDebugImage(debug, "design-alpha-mask.png", designAlphaMask);

  progress.step("composite-base", { basePath: template.paths.base });

  const composites: Array<{
    input: Buffer;
    blend: CompositeBlendMode;
  }> = [
    {
      input: printedDesign,
      blend: "over",
    },
  ];

  const fabricEnabled = fabric?.enabled ?? false;
  const fabricTextureSource = fabric?.textureSource ?? "shadow";
  const fabricTextureOpacity = fabric?.textureOpacity ?? 0.05;
  const fabricBlend = toCompositeBlend(fabric?.blend ?? "multiply");
  const embeddedFabric = shouldUseEmbeddedFabric(fabric);

  if (fabricEnabled && !embeddedFabric) {
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
        fabricTextureSource === "fabricTexture" ? "fabricTexture" : "shadow",
        template.paths,
      );

      progress.step("apply-fabric-texture", {
        textureSource: fabricTextureSource,
        blend: fabricBlend,
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
        blend: fabricBlend,
      });
    }
  }

  let effectiveShadowOpacity = layers.shadow.opacity;
  if (
    fabricEnabled &&
    !embeddedFabric &&
    usesShadowAsFabric(template, fabricTextureSource)
  ) {
    effectiveShadowOpacity = Math.max(
      0,
      effectiveShadowOpacity - fabricTextureOpacity,
    );
  }

  if (layers.shadow.enabled) {
    progress.step("apply-shadow", {
      blend: layers.shadow.blend,
      opacity: effectiveShadowOpacity,
    });

    const shadowWithOpacity = await applyOpacity(
      template.paths.shadow,
      effectiveShadowOpacity,
    );
    const luminanceAwareShadow = await applyLuminanceAwareMask(
      shadowWithOpacity,
      printedDesign,
      "shadow",
    );
    const clippedShadow = await applyAlphaMask(
      luminanceAwareShadow,
      designAlphaMask,
    );
    await writeDebugImage(debug, "clipped-shadow.png", clippedShadow);
    composites.push({
      input: clippedShadow,
      blend: toCompositeBlend(layers.shadow.blend),
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
    const luminanceAwareHighlight = await applyLuminanceAwareMask(
      highlightWithOpacity,
      printedDesign,
      "highlight",
    );
    const clippedHighlight = await applyAlphaMask(
      luminanceAwareHighlight,
      designAlphaMask,
    );
    await writeDebugImage(debug, "clipped-highlight.png", clippedHighlight);
    composites.push({
      input: clippedHighlight,
      blend: toCompositeBlend(layers.highlight.blend),
    });
  }

  progress.step("encode-final-png", {
    layers: composites.length,
  });

  let finalBuffer = await sharp(template.paths.base)
    .composite(composites)
    .png()
    .toBuffer();

  const harmonize = template.config.harmonize;
  if ((harmonize?.grain ?? 0) > 0 || harmonize?.colorMatch) {
    progress.step("apply-harmonization", {
      grain: harmonize?.grain ?? 0,
      colorMatch: harmonize?.colorMatch ?? false,
    });

    finalBuffer = await applyHarmonization(
      finalBuffer,
      template.paths.base,
      designAlphaMask,
      template.config.printArea,
      harmonize,
    );
  }

  return finalBuffer;
}
