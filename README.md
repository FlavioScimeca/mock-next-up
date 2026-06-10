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

### Vercel deployment

Mockup routes are always enabled. Heavy dependencies (`sharp`, render pipeline) load **on first mockup request**, not at server cold start.

Vercel requires Linux-native sharp binaries. This repo pins:

- `sharp@0.35.0`
- optional `@img/sharp-linux-x64` + `@img/sharp-libvips-linux-x64`

[`vercel.json`](vercel.json) copies `node_modules/@img/**`, `node_modules/sharp/**`, and `src/assets/**` into the function bundle via `includeFiles`.

On Vercel, writable dirs use `/tmp/mock-next-up/outputs` and `/tmp/mock-next-up/uploads`.

If sharp still fails after deploy, redeploy with a **clean build** (no cached `node_modules`) so Linux optional deps install on Vercel's builders.

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
