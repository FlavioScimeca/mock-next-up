export type CompositeBlendMode =
  | "over"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light";

export interface Point {
  x: number;
  y: number;
}

export interface CanvasConfig {
  width: number;
  height: number;
}

export interface PrintAreaConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  quad?: [Point, Point, Point, Point];
}

export interface LayerConfig {
  enabled: boolean;
  blend: CompositeBlendMode;
  opacity: number;
}

export interface DesignConfig {
  opacity?: number;
}

export type PrintSubstrate = "light" | "dark" | "color";

export interface PrintConfig {
  rasterize?: boolean;
  resolutionScale?: number;
  soften?: number;
  brightness?: number;
  saturation?: number;
  contrast?: number;
  blackLift?: number;
  substrate?: PrintSubstrate;
  edgeSpread?: number;
}

export interface FabricConfig {
  enabled?: boolean;
  textureSource?: "shadow" | "fabricSplit" | "fabricTexture";
  textureOpacity?: number;
  darkOpacity?: number;
  lightOpacity?: number;
  blend?: "multiply" | "overlay" | "soft-light";
  embedded?: boolean;
}

export interface MaskConfig {
  feather?: number;
}

export interface WarpConfig {
  enabled?: boolean;
  strength?: number;
  source?: "displacement";
}

export interface HarmonizeConfig {
  grain?: number;
  colorMatch?: boolean;
}

export interface TemplateConfig {
  id: string;
  canvas: CanvasConfig;
  printArea: PrintAreaConfig;
  design?: DesignConfig;
  print?: PrintConfig;
  fabric?: FabricConfig;
  mask?: MaskConfig;
  warp?: WarpConfig;
  harmonize?: HarmonizeConfig;
  layers: {
    shadow: LayerConfig;
    highlight: LayerConfig;
  };
  output: {
    format: string;
    quality: number;
  };
}

export interface LoadedTemplate {
  id: string;
  dir: string;
  config: TemplateConfig;
  paths: {
    base: string;
    mask: string;
    shadow: string;
    highlight: string;
    config: string;
    fabricDark?: string;
    fabricLight?: string;
    fabricTexture?: string;
    displacement?: string;
  };
}

export interface RenderConfigOverride {
  design?: DesignConfig;
  print?: PrintConfig;
  fabric?: FabricConfig;
  mask?: MaskConfig;
  warp?: WarpConfig;
  harmonize?: HarmonizeConfig;
  layers?: {
    shadow?: Partial<LayerConfig>;
    highlight?: Partial<LayerConfig>;
  };
}

export interface RenderOptions {
  templateId: string;
  designPath: string;
  outputPath?: string;
  debug?: boolean;
  configOverride?: RenderConfigOverride;
}

export interface RenderResult {
  success: true;
  templateId: string;
  outputPath: string;
  width: number;
  height: number;
}

export const REQUIRED_TEMPLATE_FILES = [
  "base.png",
  "mask.png",
  "shadow.png",
  "highlight.png",
  "config.json",
] as const;

export const OPTIONAL_FABRIC_FILES = [
  "fabric-dark.png",
  "fabric-light.png",
] as const;

export const OPTIONAL_TEMPLATE_FILES = [
  "fabric-texture.png",
  "displacement.png",
] as const;
