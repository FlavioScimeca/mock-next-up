# POD Mockup Renderer

Lightweight server-side print-on-demand mockup generator using Bun, ElysiaJS, TypeScript, and Sharp. Templates are prepared manually in Photoshop; runtime compositing uses filesystem PNG assets only — no browser, PSD parsing, or displacement maps in the MVP.

## How Templates Work

Templates live under `src/assets/templates/` in nested folders. Each template directory must contain:

| File | Purpose |
|------|---------|
| `base.png` | Full mockup photo (reference canvas) |
| `mask.png` | Print-area mask — white reveals, black hides (luminance converted to alpha at runtime) |
| `shadow.png` | Full-canvas shadow texture, composited with `multiply` |
| `highlight.png` | Full-canvas highlight texture, composited with `screen` |
| `config.json` | Canvas size, print area, layer opacity/blend settings |

All four PNG assets must match `config.canvas.width` × `config.canvas.height` and are already aligned to `base.png`. Only the uploaded design is resized.

The template **ID** is defined in `config.json` (`"id": "generic-hang-white"`), not the folder name. The server discovers templates by scanning for directories that contain all required files.

### Example `config.json`

```json
{
  "id": "generic-hang-white",
  "canvas": { "width": 2000, "height": 2000 },
  "printArea": { "x": 650, "y": 610, "width": 700, "height": 760 },
  "layers": {
    "shadow": { "enabled": true, "blend": "multiply", "opacity": 0.42 },
    "highlight": { "enabled": true, "blend": "screen", "opacity": 0.18 }
  },
  "output": { "format": "png", "quality": 90 }
}
```

## Rendering Pipeline

```
base.png
+ masked design (centered contain in printArea, clipped by mask)
+ masked shadow.png (multiply, configurable opacity)
+ masked highlight.png (screen, configurable opacity)
= final mockup PNG
```

The same luminance-derived alpha mask is applied to the design, shadow, and highlight layers before compositing.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMPLATES_DIR` | `src/assets/templates` | Root directory for template folders |
| `OUTPUTS_DIR` | `outputs` | Generated mockup output directory |
| `UPLOADS_DIR` | `uploads` | Temporary uploaded design files |
| `PORT` | `3000` | HTTP server port |
| `EVLOG_SERVICE` | `mock-next-up` | Service name in evlog wide events |

Logging uses [evlog](https://www.evlog.dev/integrate/frameworks/elysia) for structured request-wide events. `/health` is excluded from request logging.

### Vercel deployment (Linux x64, serverless)

Vercel bundles your app **without** native `libvips-cpp.so` files, so linux-x64 `sharp` fails at runtime even when install succeeds ([common Vercel sharp issue](https://community.vercel.com/t/help-adding-sharp-to-serverless-function/6069)).

**Fix used in this repo:** WebAssembly sharp on Vercel only.

[`vercel.json`](vercel.json):

```json
{
  "bunVersion": "1.x",
  "installCommand": "bun install && bun add @img/sharp-wasm32@0.35.0"
}
```

[`src/mockup/sharp-init.ts`](src/mockup/sharp-init.ts) and [`src/mockup/sharp-client.ts`](src/mockup/sharp-client.ts) inject the wasm binding before any render code runs. Sharp’s loader always tries native linux-x64 first on Vercel, which fails when libvips `.so` files are missing from the bundle.

Wasm is slower than native but works reliably on serverless. Writable dirs use `/tmp/mock-next-up/outputs` and `/tmp/mock-next-up/uploads`.

### Linux ARM64 + musl (Alpine, many containers)

If you deploy to **linux arm64 with musl** (e.g. Alpine-based machines), install the matching sharp binaries at build time. See [sharp cross-platform install](https://sharp.pixelplumbing.com/install/#cross-platform) (Bun is supported: `bun add sharp`).

**buildspec / CI example** (after `bun install`):

```bash
bun add --cpu=arm64 --os=linux --optional @img/sharp-linuxmusl-arm64@0.35.0 @img/sharp-libvips-linuxmusl-arm64@1.3.0
```

Or use the Bun script:

```bash
bun run install:sharp:linux-arm64-musl
```

Pinned optional packages for that target (already in [`package.json`](package.json)):

- `@img/sharp-linuxmusl-arm64@0.35.0`
- `@img/sharp-libvips-linuxmusl-arm64@1.3.0`

Build on the same OS/arch as production, or run the command above on your CI agent. Do not copy macOS `node_modules` onto Linux arm64.

| Deploy target | libc | CPU | Bun install |
|---------------|------|-----|-------------|
| Vercel | serverless x64 | x64 | `@img/sharp-wasm32` via [`vercel.json`](vercel.json) `installCommand` |
| Alpine / musl container | musl | arm64 | `bun run install:sharp:linux-arm64-musl` |
| Debian/Ubuntu container | glibc | arm64 | `bun add --cpu=arm64 --os=linux sharp` |

## Development

Install dependencies:

```bash
bun install
```

Start the dev server with file watching:

```bash
bun run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Test One Render (No HTTP)

Runs the renderer directly against a local design file with debug intermediates:

```bash
bun run render:test
```

Outputs:

- Final mockup: `outputs/generic-hang-white-<timestamp>-<suffix>.png`
- Debug intermediates: `outputs/debug/` (`resized-design.png`, `design-canvas.png`, `masked-design.png`, `masked-shadow.png`, `masked-highlight.png`, `final.png`)

## HTTP Render Endpoint

```bash
curl -X POST http://localhost:3000/mockups/render \
  -F "templateId=generic-hang-white" \
  -F "design=@src/assets/designs/design-01.png"
```

Success response:

```json
{
  "success": true,
  "templateId": "generic-hang-white",
  "outputPath": "outputs/generic-hang-white-20260610-193000-a8f2.png",
  "width": 2000,
  "height": 2000
}
```

## Debug Mode

Pass `debug: true` to `renderMockup()` to write pipeline intermediates into `outputs/debug/`. The test script enables this by default.

## Type Checking

```bash
bun run typecheck
```

## Current Limitations

- PNG design input only
- No displacement mapping
- No perspective warp
- No PSD support at runtime
- No browser / headless rendering
- One render at a time (sequential lock for predictable RAM usage)
- Filesystem output for local/server/container runtime — not optimized for Vercel ephemeral storage

## Future

- `displacement.png` support for fabric warp
- Batch rendering (`20 designs × 20 templates`)
- Optional concurrency increase (2–3 parallel renders)
- Cloud storage adapter for outputs
