# Vercel Deployment Guide

This document explains the problems we hit deploying **mock-next-up** to Vercel and how the final solution works. The app runs on **Node.js ≥ 20** everywhere; Vercel uses WebAssembly Sharp while local dev uses the native OS binary.

---

## Table of contents

1. [Executive summary](#executive-summary)
2. [Runtime: Node.js everywhere](#runtime-nodejs-everywhere)
3. [Problem 1: Sharp native binaries do not survive bundling](#problem-1-sharp-native-binaries-do-not-survive-bundling)
4. [Problem 2: Mockup assets were not shipped to the function](#problem-2-mockup-assets-were-not-shipped-to-the-function)
5. [Other issues encountered along the way](#other-issues-encountered-along-the-way)
6. [Final architecture](#final-architecture)
7. [Build pipeline (`prepare-vercel.mjs`)](#build-pipeline-prepare-vercelmjs)
8. [Runtime pipeline (request → PNG)](#runtime-pipeline-request--png)
9. [Configuration reference](#configuration-reference)
10. [Trade-offs and limitations](#trade-offs-and-limitations)
11. [Verification](#verification)
12. [Troubleshooting](#troubleshooting)

---

## Executive summary

**mock-next-up** is a server-side POD mockup renderer: it composites template PNGs (base, mask, shadow, highlight) with an uploaded design using [Sharp](https://sharp.pixelplumbing.com/).

Local development and Vercel both use **Node.js** serverless functions. Sharp backend differs by environment:

| Environment | Runtime | Entry point | Package manager | Sharp backend |
|-------------|---------|-------------|-----------------|---------------|
| **Local dev** | Node.js ≥ 20 | `src/index.ts` | npm (`npm install`, `npm run dev`) | Native OS binary (e.g. darwin arm64) |
| **Vercel** | Node.js ≥ 20 | `api/index.ts` | npm (`npm install --include=optional`) | WebAssembly (`@img/sharp-wasm32`) |

Two independent blockers had to be solved:

| # | Symptom | Root cause | Fix |
|---|---------|------------|-----|
| 1 | `libvips-cpp.so` missing, native `.node` binding not found | Vercel’s bundler drops Sharp’s native Linux binaries and libvips shared libraries | Use **`@img/sharp-wasm32`** on Vercel and inject the wasm binding before `require("sharp")` |
| 2 | `Designs directory not found: /var/task/src/assets/designs` | Template/design PNGs in `src/assets/` were **not included** in the deployed function bundle | Copy assets into **`api/vendor/assets/`** during the Linux build and point env vars there |

The working pattern: **vendor everything the function needs under `api/vendor/`**, next to the serverless entry (`api/index.ts`), and declare `includeFiles: "api/vendor/**"` in `vercel.json`.

---

## Runtime: Node.js everywhere

This project uses **Node.js ≥ 20** for local development and Vercel production.

| Environment | Runtime | Entry point | Package manager | Sharp backend |
|-------------|---------|-------------|-----------------|---------------|
| **Local dev** | Node.js ≥ 20 | `src/index.ts` | npm (`npm install`, `npm run dev`) | Native OS binary (e.g. darwin arm64) |
| **Vercel** | Node.js ≥ 20 | `api/index.ts` | npm (`npm install --include=optional`) | WebAssembly (`@img/sharp-wasm32`) |

Dev runs via **tsx** (`npm run dev`).

### Why WebAssembly Sharp on Vercel only?

Sharp native Linux binaries are often dropped by Vercel bundler. Locally, npm installs the correct native `@img/sharp-*` package. On Vercel we use wasm binding injection and `includeFiles` for `api/vendor/**`.

### How local and Vercel are wired

```
Local:
  npm run dev  →  src/index.ts  →  src/app.ts  →  routes + mockup pipeline

Vercel:
  api/index.ts  →  re-exports src/app.ts  →  same routes + pipeline
```

`api/index.ts` is a thin re-export:

```typescript
export { default, GET, POST, PATCH, DELETE, PUT, type API } from "../src/app.js";
```

Vercel treats files under `api/` as **serverless functions**. The default **Node.js** runtime applies.

`src/index.ts` starts the HTTP listener when **not** on Vercel:

```typescript
if (!env.isVercel) {
  app.listen(env.port);
}
```

---

## Problem 1: Sharp native binaries do not survive bundling

### What Sharp expects

Sharp 0.35 resolves a **platform-specific binding** at runtime, for example:

- macOS dev: `@img/sharp-darwin-arm64` (native `.node` + libvips)
- Linux x64: `@img/sharp-linux-x64` + `@img/sharp-libvips-linux-x64` (includes `libvips-cpp.so`)

The binding is loaded through `sharp/dist/sharp.cjs`, which picks the correct `@img/sharp-*` package for the current OS/arch/libc.

### What Vercel does

Vercel bundles each serverless function into a deployment artifact under `/var/task/`. The bundler:

- Traces JavaScript imports
- Tree-shakes and packages `node_modules`
- **Often omits** large native artifacts (`.so`, `.node`, `.wasm`) unless explicitly included

### Errors we saw

Typical failures during early deployment attempts:

```
Could not load the "sharp" module using the linux-x64 runtime
Something went wrong installing the "sharp" module
libvips-cpp.so.42: cannot open shared object file
```

Even when we added `includeFiles` for `@img/sharp-linux-x64/**` and `@img/sharp-libvips-linux-x64/**`, files were still missing at runtime — the bundle layout and Sharp’s dynamic resolution did not align reliably.

### Attempted approaches (and why they failed)

| Approach | Outcome |
|----------|---------|
| `includeFiles: "node_modules/@img/**"` | `.so` / `.node` still dropped or wrong paths at runtime |
| Copy native binding to `src/vendor/` or `api/sharp-native/` | Files gitignored or not traced from function entry |
| `@img/sharp-wasm32` copied to `src/native/` | Wasm loader present but `.wasm` binary not always bundled |
| `functions` block targeting `src/index.ts` | Invalid — Vercel requires function config under `api/` |

### Working solution: WebAssembly Sharp on Vercel

On Linux (Vercel’s build environment and runtime), we:

1. Install `@img/sharp-wasm32@0.35.0` (pinned to match `sharp@0.35.0`)
2. Copy the wasm package to `api/vendor/sharp-wasm32/`
3. Generate `src/platform/sharp/vercel-binding.cjs` that:
   - `readFileSync()` the `.node.wasm` file (forces the bundler to include it)
   - `require()` the `.node.js` loader
   - exports the binding module
4. At runtime, **patch** Sharp’s internal `sharp.cjs` cache with that binding, then `require("sharp")`

Relevant code in `src/platform/sharp/client.ts`:

```typescript
function initVercelSharp(): void {
  const binding = require("./vercel-binding.cjs");
  patchSharpBindingModule(binding);
  sharpModule = require("sharp") as typeof Sharp;
}
```

`patchSharpBindingModule` replaces the exports of `sharp/dist/sharp.cjs` in `require.cache` so Sharp loads wasm instead of searching for a missing native linux binding.

Locally (non-Vercel), `initSharp()` skips wasm and uses the normal native Sharp binary:

```typescript
if (env.isVercel) {
  initVercelSharp();
  return;
}
sharpModule = require("sharp") as typeof Sharp;
```

### Performance note

Wasm Sharp is **slower** than native libvips but **portable** — no `.so` dependency. A single 2000×2000 mockup render on Vercel took ~3–4 seconds in testing. Acceptable for serverless; native Sharp on a dedicated server would be faster.

---

## Problem 2: Mockup assets were not shipped to the function

### What the app needs on disk

Besides Sharp, rendering reads **static PNG assets**:

```
src/assets/
├── templates/
│   └── t-shirt/hang/white/v1/
│       ├── base.png
│       ├── mask.png
│       ├── shadow.png
│       ├── highlight.png
│       └── config.json
└── designs/          ← used by POST /mockups/test only
    ├── design-01.png
    └── design-02.png
```

`POST /mockups/render` uploads a design via multipart form — it does **not** need `designs/` on disk.

`POST /mockups/test` batch-renders every PNG in the designs directory — it **does** need `designs/` bundled.

Both routes need **templates** on disk.

### The error

After Sharp wasm worked, `/mockups/test` failed with:

```json
{
  "success": false,
  "error": "Designs directory not found: /var/task/src/assets/designs",
  "code": "RENDER_FAILURE"
}
```

The code was correct. The directory simply **did not exist** inside the deployed function at `/var/task/src/assets/designs`.

### Why `includeFiles: "src/assets/**"` was not enough

We tried bundling assets from their source location:

```json
"includeFiles": "{src/native/sharp-wasm32/lib/*,src/assets/**}"
```

Assets still were not present at runtime. Likely reasons:

- Files far from the function entry (`api/index.ts`) are less reliably traced
- Brace-glob patterns did not consistently include nested PNGs
- The bundler’s static analysis does not follow filesystem reads in application code — only explicit imports and `includeFiles`

### Working solution: co-locate assets under `api/vendor/`

During the Linux build, `scripts/prepare-vercel.mjs` copies:

```
src/assets/  →  api/vendor/assets/
```

Then `vercel.json` sets:

```json
"TEMPLATES_DIR": "api/vendor/assets/templates",
"DESIGNS_DIR": "api/vendor/assets/designs"
```

And bundles everything with:

```json
"includeFiles": "api/vendor/**"
```

At runtime, paths resolve to:

```
/var/task/api/vendor/assets/templates/...
/var/task/api/vendor/assets/designs/...
```

Because `api/vendor/` sits next to the serverless entry, Vercel consistently ships it.

### Asset tracing sidecar

`src/app.ts` imports a generated CommonJS module so the bundler sees static file references:

```typescript
import "./platform/sharp/vercel-binding.cjs";
import "./platform/sharp/vercel-assets.cjs";
```

`vercel-assets.cjs` (generated on Linux) calls `readFileSync()` on a template config and a sample design PNG. That complements `includeFiles` by giving the tracer concrete file paths.

---

## Other issues encountered along the way

### ESM on Node / Vercel

The project uses `"type": "module"`. Relative imports must include `.js` extensions (TypeScript `moduleResolution: "NodeNext"`). Paths use `fileURLToPath(import.meta.url)`.

### Writable directories on Vercel

Only `/tmp` is writable in serverless functions. `src/config/env.ts` routes outputs and uploads there when `VERCEL` is set:

| Variable | Local default | Vercel default |
|----------|---------------|----------------|
| `OUTPUTS_DIR` | `outputs/` | `/tmp/mock-next-up/outputs/` |
| `UPLOADS_DIR` | `uploads/` | `/tmp/mock-next-up/uploads/` |

Rendered PNGs in `/tmp` are **ephemeral** — fine for smoke tests, not durable storage.

### Do not gitignore vendor output

Post-install copies (`api/vendor/`, generated `.cjs` stubs) must **not** be gitignored if you expect them in the bundle via git-based deploys. On Vercel, the build script regenerates `api/vendor/` on every deploy, so committed copies are optional — but gitignoring `api/vendor/**` broke earlier experiments.

### Stub files for local macOS dev

`prepare-vercel.mjs` runs only on **Linux** (`process.platform !== "linux"` → exit 0). On macOS:

- `vercel-binding.cjs` exports `null` (never loaded — native Sharp used)
- `vercel-assets.cjs` exports `null` (import is harmless)

Local dev is unaffected.

---

## Final architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LOCAL (Node.js + tsx)                    │
├─────────────────────────────────────────────────────────────────┤
│  npm run dev  →  src/index.ts  →  src/app.ts                    │
│  Sharp: native darwin binary                                    │
│  Assets: src/assets/templates, src/assets/designs               │
│  Writes: outputs/, uploads/                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     VERCEL (Node.js)                            │
├─────────────────────────────────────────────────────────────────┤
│  api/index.ts  →  src/app.ts                                    │
│                                                                 │
│  Build (linux):                                                 │
│    npm install --include=optional                               │
│    node scripts/prepare-vercel.mjs                              │
│      ├── copy @img/sharp-wasm32 → api/vendor/sharp-wasm32/      │
│      ├── copy src/assets        → api/vendor/assets/            │
│      └── generate vercel-{binding,assets}.cjs in src/platform/sharp/ │
│                                                                 │
│  Bundle: includeFiles api/vendor/**                             │
│                                                                 │
│  Runtime:                                                       │
│    Sharp: wasm via binding injection                            │
│    Assets: api/vendor/assets/ (via TEMPLATES_DIR, DESIGNS_DIR)  │
│    Writes: /tmp/mock-next-up/outputs, uploads                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Build pipeline (`prepare-vercel.mjs`)

Script: [`scripts/prepare-vercel.mjs`](../scripts/prepare-vercel.mjs)

Triggered by:

- `postinstall` in `package.json`
- `vercel.json` → `installCommand` and `buildCommand`

Steps (Linux only):

1. Remove and recreate `api/vendor/`
2. Copy `@img/sharp-wasm32` from `node_modules` → `api/vendor/sharp-wasm32/`
3. Copy `src/assets` → `api/vendor/assets/`
4. Validate wasm layout (`*.node.js` loader + `*.node.wasm` binary)
5. Validate required assets (designs dir, template `config.json`)
6. Write `src/platform/sharp/vercel-binding.cjs` with paths to wasm under `api/vendor/`
7. Write `src/platform/sharp/vercel-assets.cjs` with `readFileSync` on template + sample design

Locally on macOS, the script prints `prepare-vercel: skipped (not linux)` and exits — no vendor directory created.

Manual run on a Linux machine or in CI:

```bash
node scripts/prepare-vercel.mjs
# or
npm run prepare:vercel
```

---

## Runtime pipeline (request → PNG)

Example: `POST /mockups/test` with `{ "templateId": "generic-hang-white", "debug": true }`

1. Vercel invokes `api/index.ts` (Node.js)
2. `src/app.ts` loads routes; sidecar imports ensure wasm + assets are bundled
3. First render call → `loadRenderDeps()` → `initSharp()`
4. On Vercel: wasm binding patched, Sharp ready
5. Template loaded from `api/vendor/assets/templates/.../config.json` + PNG layers
6. Designs read from `api/vendor/assets/designs/*.png`
7. Sharp pipeline: mask → resize → composite → encode PNG
8. Output written to `/tmp/mock-next-up/outputs/...`

Successful log markers:

```
succeeded: 2, failed: 0
status: 200
currentStepName: "complete"
designPath: api/vendor/assets/designs/design-02.png
templateDir: api/vendor/assets/templates/t-shirt/hang/white/v1
```

---

## Configuration reference

### `vercel.json`

```json
{
  "installCommand": "npm install --include=optional && node scripts/prepare-vercel.mjs",
  "buildCommand": "node scripts/prepare-vercel.mjs",
  "functions": {
    "api/index.ts": {
      "includeFiles": "api/vendor/**"
    }
  },
  "env": {
    "SHARP_IGNORE_GLOBAL_LIBVIPS": "1",
    "TEMPLATES_DIR": "api/vendor/assets/templates",
    "DESIGNS_DIR": "api/vendor/assets/designs"
  }
}
```

| Setting | Purpose |
|---------|---------|
| `installCommand` | npm install + first vendor preparation |
| `buildCommand` | Re-run vendor prep (clean copy every deploy) |
| `includeFiles` | Ship `api/vendor/**` inside the function artifact |
| `SHARP_IGNORE_GLOBAL_LIBVIPS` | Prevent Sharp from looking for system libvips |
| `TEMPLATES_DIR` / `DESIGNS_DIR` | Runtime paths relative to project root (`/var/task`) |

### Key source files

| File | Role |
|------|------|
| [`api/index.ts`](../api/index.ts) | Vercel serverless entry (re-exports app) |
| [`src/app.ts`](../src/app.ts) | Elysia app, imports binding/asset sidecars |
| [`src/config/env.ts`](../src/config/env.ts) | Path resolution, `/tmp` on Vercel |
| [`src/platform/sharp/client.ts`](../src/platform/sharp/client.ts) | Native vs wasm Sharp initialization |
| [`src/platform/sharp/vercel-binding.cjs`](../src/platform/sharp/vercel-binding.cjs) | Generated wasm loader (Linux build) |
| [`src/platform/sharp/vercel-assets.cjs`](../src/platform/sharp/vercel-assets.cjs) | Generated asset tracer (Linux build) |
| [`scripts/prepare-vercel.mjs`](../scripts/prepare-vercel.mjs) | Linux build: vendor wasm + assets |

### Dependencies (Sharp)

```json
"dependencies": {
  "@img/sharp-wasm32": "0.35.0",
  "sharp": "0.35.0"
},
"optionalDependencies": {
  "@img/sharp-linux-x64": "0.35.0",
  "@img/sharp-libvips-linux-x64": "1.3.0"
}
```

Wasm is used on Vercel. Optional native linux packages remain for non-Vercel Linux deployments (containers, etc.).

---

## Trade-offs and limitations

| Topic | Detail |
|-------|--------|
| **Wasm vs native** | Wasm Sharp works everywhere but is slower than libvips-native |
| **Ephemeral `/tmp`** | Outputs disappear after the function instance recycles; use `/mockups/render` response body or external storage for production |
| **`/mockups/test` on Vercel** | Good smoke test; bundles all designs (~20MB+ if large PNGs) into the function |
| **Same runtime** | Local and Vercel both use Node.js; only Sharp backend differs (native vs wasm) |
| **Build platform** | `prepare-vercel.mjs` must run on **Linux** (Vercel builder satisfies this) |
| **Node engine** | `"engines": { "node": ">=20.9.0" }` in `package.json` |

---

## Verification

### Health check

```bash
curl https://<your-deployment>.vercel.app/health
# {"status":"ok"}
```

### Batch test (requires bundled designs)

```bash
curl -X POST https://<your-deployment>.vercel.app/mockups/test \
  -H "Content-Type: application/json" \
  -d '{"templateId":"generic-hang-white","debug":true}'
```

Expect `status: 200`, `succeeded: N`, `failed: 0`, steps through `"complete"`.

### Production render (upload)

```bash
curl -X POST https://<your-deployment>.vercel.app/mockups/render \
  -F "templateId=generic-hang-white" \
  -F "design=@./my-design.png" \
  --output mockup.png
```

Does not require `designs/` on disk — only templates must be bundled.

---

## Troubleshooting

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| `libvips-cpp.so` / linux-x64 binding errors | Native Sharp on Vercel | Confirm `env.isVercel` path uses wasm; binding stub not `null` in deployed artifact |
| `sharp wasm binding missing` | `prepare-vercel.mjs` did not run on Linux build | Vercel build logs for `prepare-vercel: ready` |
| `Designs directory not found: /var/task/src/assets/...` | Old env or missing vendor assets | `TEMPLATES_DIR` / `DESIGNS_DIR` should point to `api/vendor/assets/...` |
| `Missing mockup asset at ...` | Assets not copied or incomplete git checkout | `src/assets/` present in repo; build log shows `prepare-vercel: assets=...` |
| Renders succeed but no persistent files | Expected on Vercel | `/tmp` is ephemeral; return PNG in HTTP response instead |
| Works on Vercel, fails locally | Unlikely if stubs intact | Local uses `src/assets/` defaults; run `npm run dev` |

### Useful build log lines

```
prepare-vercel: wasm=/vercel/path0/api/vendor/sharp-wasm32/lib/sharp-wasm32.node.js
prepare-vercel: assets=/vercel/path0/api/vendor/assets
prepare-vercel: ready
```

If you see `prepare-vercel: skipped (not linux)` **on Vercel**, something is wrong with the build environment detection (should not happen on Vercel’s Linux builders).

---

## Summary

Deploying a Sharp-based image pipeline to Vercel required switching Sharp to **WebAssembly on Vercel** (native Sharp locally), and **vendoring all runtime files under `api/vendor/`** so the serverless bundler actually ships them.

The failures were not application logic bugs — they were **packaging and runtime environment** mismatches in Vercel’s constrained Node.js function sandbox.
