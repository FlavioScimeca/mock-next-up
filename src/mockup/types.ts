export interface CanvasConfig {
  width: number;
  height: number;
}

export interface PrintAreaConfig {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayerConfig {
  enabled: boolean;
  blend: string;
  opacity: number;
}

export interface TemplateConfig {
  id: string;
  canvas: CanvasConfig;
  printArea: PrintAreaConfig;
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
  };
}

export interface RenderOptions {
  templateId: string;
  designPath: string;
  outputPath?: string;
  debug?: boolean;
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
