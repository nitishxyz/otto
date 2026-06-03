# Changelog

## 0.1.296

All notable changes to `@ottocode/web-ui` will be documented in this file.

## [0.2.0] - 2025-01-XX (Upcoming)

### Added

- **`serveWebUI()` function** - Ultra-simple one-line integration
  - Automatic SPA routing and asset handling
  - Configurable prefix (`/ui`, `/admin`, etc.)
  - Optional root redirect
  - Custom 404 handler support
  - Handles both `/ui/assets/*` and `/assets/*` asset paths (fixes Vite build issues)
  - Works in both Bun and Node.js environments
  - Security: Directory traversal prevention
  - Automatic MIME type detection

### Changed

- README updated with new `serveWebUI()` examples
- Examples updated to use `serveWebUI()` instead of manual routing
- QUICK-START.md completely rewritten for the new API

### Improved

- Simplified integration from ~50 lines to ~3 lines of code
- Better error messages and documentation
- Comprehensive TypeScript types with JSDoc comments

## [0.1.0] - 2025-01-XX

### Added

- Initial release
- `getWebUIPath()` - Get path to web assets directory
- `getIndexPath()` - Get path to index.html
- `isWebUIAvailable()` - Check if assets are built
- Pre-built web UI assets from ottocode
- TypeScript definitions
- Examples for Bun and Express
- Comprehensive README and documentation

### Features

- Zero-config asset serving
- Framework-agnostic design
- Works with Bun, Express, Fastify, Hono
- Production-ready optimized build
- ~370 KB gzipped total size

---

## Migration Guides

### From 0.1.0 to 0.2.0

**Old way:**

```typescript
import { getWebUIPath, getIndexPath } from "@ottocode/web-ui";

const webUIPath = getWebUIPath();

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/ui")) {
      const filePath = url.pathname.replace("/ui", "") || "/";

      if (filePath === "/") {
        return new Response(Bun.file(getIndexPath()));
      }

      const file = Bun.file(webUIPath + filePath);
      if (await file.exists()) {
        return new Response(file);
      }

      return new Response(Bun.file(getIndexPath()));
    }

    return new Response("Not found", { status: 404 });
  },
});
```

**New way:**

```typescript
import { serveWebUI } from "@ottocode/web-ui";

Bun.serve({
  port: 3000,
  fetch: serveWebUI({ prefix: "/ui" }),
});
```

**Benefits of upgrading:**

- ✅ 95% less code
- ✅ Automatic asset path handling
- ✅ Better error handling
- ✅ Security built-in
- ✅ Easier to maintain

**Note:** The old functions (`getWebUIPath()`, `getIndexPath()`, `isWebUIAvailable()`) are still available and will continue to work.
