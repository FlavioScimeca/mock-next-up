import { MockupError } from "./errors";
import type { TemplateConfig } from "./types";

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

  if (format !== "png") {
    throw new MockupError(
      "INVALID_CONFIG",
      'Invalid template config: output.format must be "png" for MVP',
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

  return {
    id,
    canvas: { width: canvasWidth, height: canvasHeight },
    printArea,
    layers: { shadow, highlight },
    output: { format, quality },
  };
}
