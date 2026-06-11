declare module "sharp" {
  type BlendMode =
    | "over"
    | "multiply"
    | "screen"
    | "dest-in"
    | (string & {});

  interface OverlayOptions {
    input: Buffer | string;
    blend?: BlendMode;
    left?: number;
    top?: number;
  }

  interface Metadata {
    width?: number;
    height?: number;
    format?: string;
    channels?: number;
  }

  interface RawInfo {
    width: number;
    height: number;
    channels: number;
  }

  interface SharpInstance {
    ensureAlpha(): SharpInstance;
    raw(): SharpInstance;
    resize(
      width?: number,
      height?: number,
      options?: { fit?: string; kernel?: string },
    ): SharpInstance;
    blur(sigma: number): SharpInstance;
    modulate(options: {
      brightness?: number;
      saturation?: number;
    }): SharpInstance;
    flatten(options?: {
      background?: { r: number; g: number; b: number };
    }): SharpInstance;
    composite(overlays: OverlayOptions[]): SharpInstance;
    png(): SharpInstance;
    jpeg(options?: { quality?: number }): SharpInstance;
    metadata(): Promise<Metadata>;
    toBuffer(): Promise<Buffer>;
    toBuffer(options: { resolveWithObject: true }): Promise<{
      data: Buffer;
      info: RawInfo;
    }>;
  }

  interface CreateOptions {
    create: {
      width: number;
      height: number;
      channels: 3 | 4;
      background: { r: number; g: number; b: number; alpha?: number };
    };
  }

  interface RawInputOptions {
    raw: {
      width: number;
      height: number;
      channels: number;
    };
  }

  interface SharpConstructor {
    (input?: string | Buffer): SharpInstance;
    (options: CreateOptions): SharpInstance;
    (input: Buffer, options: RawInputOptions): SharpInstance;
  }

  const sharp: SharpConstructor;
  export default sharp;
}
