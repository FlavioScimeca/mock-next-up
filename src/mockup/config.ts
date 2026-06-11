import { MockupError } from "./errors.js";
import type { LayerConfig, RenderConfigOverride, TemplateConfig } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path}.${key} must be a number`,
      422,
    );
  }
  return value;
}

function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path}.${key} must be a boolean`,
      422,
    );
  }
  return value;
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path}.${key} must be a non-empty string`,
      422,
    );
  }
  return value;
}

function parseLayer(
  raw: unknown,
  path: string,
  expectedBlend: string,
): TemplateConfig["layers"]["shadow"] {
  if (!isRecord(raw)) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path} must be an object`,
      422,
    );
  }

  const enabled = requireBoolean(raw, "enabled", path);
  const blend = requireString(raw, "blend", path);
  const opacity = requireNumber(raw, "opacity", path);

  if (enabled && blend !== expectedBlend) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path}.blend must be "${expectedBlend}"`,
      422,
    );
  }

  if (opacity < 0 || opacity > 1) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path}.opacity must be between 0 and 1`,
      422,
    );
  }

  return { enabled, blend, opacity };
}

function parseOptionalOpacity(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  if (!(key in obj)) {
    return undefined;
  }

  const opacity = requireNumber(obj, key, path);

  if (opacity < 0 || opacity > 1) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path}.${key} must be between 0 and 1`,
      422,
    );
  }

  return opacity;
}

function parseDesign(raw: unknown): TemplateConfig["design"] {
  if (raw === undefined) {
    return undefined;
  }

  if (!isRecord(raw)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: design must be an object",
      422,
    );
  }

  const opacity = parseOptionalOpacity(raw, "opacity", "design");
  return opacity === undefined ? {} : { opacity };
}

function parseFabric(raw: unknown): TemplateConfig["fabric"] {
  if (raw === undefined) {
    return undefined;
  }

  if (!isRecord(raw)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: fabric must be an object",
      422,
    );
  }

  const fabric: NonNullable<TemplateConfig["fabric"]> = {};

  if ("enabled" in raw) {
    fabric.enabled = requireBoolean(raw, "enabled", "fabric");
  }

  if ("textureSource" in raw) {
    const textureSource = requireString(raw, "textureSource", "fabric");
    if (textureSource !== "shadow" && textureSource !== "fabricSplit") {
      throw new MockupError(
        "INVALID_CONFIG",
        'Invalid template config: fabric.textureSource must be "shadow" or "fabricSplit"',
        422,
      );
    }
    fabric.textureSource = textureSource;
  }

  if ("textureOpacity" in raw) {
    fabric.textureOpacity = parseOptionalOpacity(
      raw,
      "textureOpacity",
      "fabric",
    );
  }

  if ("darkOpacity" in raw) {
    fabric.darkOpacity = parseOptionalOpacity(raw, "darkOpacity", "fabric");
  }

  if ("lightOpacity" in raw) {
    fabric.lightOpacity = parseOptionalOpacity(raw, "lightOpacity", "fabric");
  }

  if ("blend" in raw) {
    const blend = requireString(raw, "blend", "fabric");
    if (blend !== "multiply") {
      throw new MockupError(
        "INVALID_CONFIG",
        'Invalid template config: fabric.blend must be "multiply"',
        422,
      );
    }
    fabric.blend = "multiply";
  }

  return fabric;
}

function parseOptionalNumberInRange(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
  max: number,
): number | undefined {
  if (!(key in obj)) {
    return undefined;
  }

  const value = requireNumber(obj, key, path);

  if (value < min || value > max) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: ${path}.${key} must be between ${min} and ${max}`,
      422,
    );
  }

  return value;
}

function parsePrint(raw: unknown): TemplateConfig["print"] {
  if (raw === undefined) {
    return undefined;
  }

  if (!isRecord(raw)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: print must be an object",
      422,
    );
  }

  const print: NonNullable<TemplateConfig["print"]> = {};

  if ("rasterize" in raw) {
    print.rasterize = requireBoolean(raw, "rasterize", "print");
  }

  if ("resolutionScale" in raw) {
    print.resolutionScale = parseOptionalNumberInRange(
      raw,
      "resolutionScale",
      "print",
      0.25,
      1,
    );
  }

  if ("soften" in raw) {
    print.soften = parseOptionalNumberInRange(raw, "soften", "print", 0, 2);
  }

  if ("brightness" in raw) {
    print.brightness = parseOptionalNumberInRange(
      raw,
      "brightness",
      "print",
      0.5,
      1.5,
    );
  }

  if ("saturation" in raw) {
    print.saturation = parseOptionalNumberInRange(raw, "saturation", "print", 0, 2);
  }

  if ("contrast" in raw) {
    print.contrast = parseOptionalNumberInRange(raw, "contrast", "print", 0.5, 1.5);
  }

  if ("blackLift" in raw) {
    print.blackLift = parseOptionalNumberInRange(raw, "blackLift", "print", 0, 50);
  }

  return print;
}

function parseLayerOverride(
  raw: unknown,
  path: string,
  expectedBlend: string,
): Partial<LayerConfig> {
  if (!isRecord(raw)) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid render config: ${path} must be an object`,
      422,
    );
  }

  const layer: Partial<LayerConfig> = {};

  if ("enabled" in raw) {
    layer.enabled = requireBoolean(raw, "enabled", path);
  }

  if ("blend" in raw) {
    const blend = requireString(raw, "blend", path);
    if (blend !== expectedBlend) {
      throw new MockupError(
        "INVALID_CONFIG",
        `Invalid render config: ${path}.blend must be "${expectedBlend}"`,
        422,
      );
    }
    layer.blend = blend;
  }

  if ("opacity" in raw) {
    layer.opacity = parseOptionalOpacity(raw, "opacity", path);
  }

  return layer;
}

export function validateRenderConfigOverride(
  raw: unknown,
): RenderConfigOverride {
  if (!isRecord(raw)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid render config: must be an object",
      422,
    );
  }

  const override: RenderConfigOverride = {};

  if ("design" in raw) {
    override.design = parseDesign(raw.design);
  }

  if ("fabric" in raw) {
    override.fabric = parseFabric(raw.fabric);
  }

  if ("print" in raw) {
    override.print = parsePrint(raw.print);
  }

  if ("layers" in raw) {
    if (!isRecord(raw.layers)) {
      throw new MockupError(
        "INVALID_CONFIG",
        "Invalid render config: layers must be an object",
        422,
      );
    }

    const layers: NonNullable<RenderConfigOverride["layers"]> = {};

    if ("shadow" in raw.layers) {
      layers.shadow = parseLayerOverride(
        raw.layers.shadow,
        "layers.shadow",
        "multiply",
      );
    }

    if ("highlight" in raw.layers) {
      layers.highlight = parseLayerOverride(
        raw.layers.highlight,
        "layers.highlight",
        "screen",
      );
    }

    override.layers = layers;
  }

  return override;
}

export function applyRenderConfigOverride(
  base: TemplateConfig,
  override?: RenderConfigOverride,
): TemplateConfig {
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...(override.design !== undefined
      ? { design: { ...base.design, ...override.design } }
      : {}),
    ...(override.fabric !== undefined
      ? { fabric: { ...base.fabric, ...override.fabric } }
      : {}),
    ...(override.print !== undefined
      ? { print: { ...base.print, ...override.print } }
      : {}),
    layers: {
      shadow: override.layers?.shadow
        ? { ...base.layers.shadow, ...override.layers.shadow }
        : base.layers.shadow,
      highlight: override.layers?.highlight
        ? { ...base.layers.highlight, ...override.layers.highlight }
        : base.layers.highlight,
    },
  };
}

export function validateTemplateConfig(
  raw: unknown,
  expectedTemplateId: string,
): TemplateConfig {
  if (!isRecord(raw)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: root must be an object",
      422,
    );
  }

  const id = requireString(raw, "id", "config");

  if (id !== expectedTemplateId) {
    throw new MockupError(
      "INVALID_CONFIG",
      `Invalid template config: config.id "${id}" does not match templateId "${expectedTemplateId}"`,
      422,
    );
  }

  if (!isRecord(raw.canvas)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: canvas must be an object",
      422,
    );
  }

  const canvasWidth = requireNumber(raw.canvas, "width", "canvas");
  const canvasHeight = requireNumber(raw.canvas, "height", "canvas");

  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: canvas dimensions must be greater than 0",
      422,
    );
  }

  if (!isRecord(raw.printArea)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: printArea must be an object",
      422,
    );
  }

  const printArea = {
    x: requireNumber(raw.printArea, "x", "printArea"),
    y: requireNumber(raw.printArea, "y", "printArea"),
    width: requireNumber(raw.printArea, "width", "printArea"),
    height: requireNumber(raw.printArea, "height", "printArea"),
  };

  if (printArea.width <= 0 || printArea.height <= 0) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: printArea dimensions must be greater than 0",
      422,
    );
  }

  if (
    printArea.x < 0 ||
    printArea.y < 0 ||
    printArea.x + printArea.width > canvasWidth ||
    printArea.y + printArea.height > canvasHeight
  ) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: printArea exceeds canvas",
      422,
    );
  }

  if (!isRecord(raw.layers)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: layers must be an object",
      422,
    );
  }

  const shadow = parseLayer(raw.layers.shadow, "layers.shadow", "multiply");
  const highlight = parseLayer(
    raw.layers.highlight,
    "layers.highlight",
    "screen",
  );

  if (!isRecord(raw.output)) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: output must be an object",
      422,
    );
  }

  const format = requireString(raw.output, "format", "output");
  const quality = requireNumber(raw.output, "quality", "output");

  if (format !== "png" && format !== "jpeg") {
    throw new MockupError(
      "INVALID_CONFIG",
      'Invalid template config: output.format must be "png" or "jpeg"',
      422,
    );
  }

  if (quality < 1 || quality > 100) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid template config: output.quality must be between 1 and 100",
      422,
    );
  }

  const design = parseDesign(raw.design);
  const fabric = parseFabric(raw.fabric);
  const print = parsePrint(raw.print);

  return {
    id,
    canvas: { width: canvasWidth, height: canvasHeight },
    printArea,
    ...(design !== undefined ? { design } : {}),
    ...(print !== undefined ? { print } : {}),
    ...(fabric !== undefined ? { fabric } : {}),
    layers: { shadow, highlight },
    output: { format, quality },
  };
}
