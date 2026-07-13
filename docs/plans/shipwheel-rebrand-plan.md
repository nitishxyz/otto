# ShipWheel Rebrand Plan

## Purpose

Make the Lucide `ShipWheel` icon the official otto identity across the entire monorepo, including:

- Canonical vector and raster assets
- Desktop, launcher, and Canvas Tauri applications
- Native macOS application
- Expo mobile application
- Web favicons, PWA icons, and generated CLI web assets
- In-product logo and wordmark components
- Landing site, social images, and intro video
- TUI and CLI branding
- OttoRouter provider and product branding
- Documentation and repository-level presentation

The existing reference is `ShipWheel` from `lucide-react@0.563.0`, currently used for the agents tab in `packages/web-sdk/src/components/looper/LooperTabBar.tsx`.

## Brand Decisions

### Primary mark

Use the exact Lucide `ShipWheel` geometry as the canonical otto mark.

- Do not redraw it manually.
- Do not alter its spokes, proportions, line caps, or joins.
- Pin the extracted geometry to the installed `lucide-react@0.563.0` version.
- Store the canonical SVG independently of React so native, web, raster, video, and generated assets all use the same source.
- Record that Lucide is ISC-licensed and that use and modification are permitted.

### Primary app-icon treatment

Use a dark neutral background tile with an off-white ShipWheel:

- Suggested tile: `#141416`
- Suggested mark: `#f7f7f8`
- Keep approximately 18–22% outer padding around the mark.
- Test optical size at 16, 20, 32, 64, 128, 512, and 1024 px.
- Keep the tile fixed-color for OS and installed application icons.
- Use `currentColor` only for in-product SVG components and theme-aware favicons.

### Wordmark and lockup

The existing geometric `o11o` wordmark should be retired.

Use one of these combinations based on available space:

- ShipWheel alone for icons and compact controls.
- ShipWheel plus lowercase `otto` for navigation, title bars, hero sections, README, and social cards.
- ShipWheel plus `OttoRouter` for OttoRouter-specific marketing and account contexts.

Do not place a wide textual lockup inside small OS icons.

### OttoRouter relationship

OttoRouter should use the exact same ShipWheel geometry as otto.

Differentiate it through presentation, not geometry:

- Main otto mark: neutral/current-color, or off-white on the canonical dark tile.
- OttoRouter mark: the same ShipWheel with the existing purple accent in dedicated marketing, authentication, billing, routing, video, and social contexts.
- Mixed provider lists: use `currentColor`, matching other monochrome provider logos.
- Do not retain or overlay the existing lightning-bolt mark.
- Do not create a geometrically distinct OttoRouter mark.

This makes OttoRouter recognizable as an otto service while preserving product-level differentiation.

---

# Current-State Inventory

## Core mark and wordmark

The current otto identity is a filled geometric `o11o` wordmark. Its first character is also used as a rounded rectangular “O” icon.

Active implementations include:

- `packages/web-sdk/src/components/common/OttoOIcon.tsx`
- `packages/web-sdk/src/components/common/StatusIndicator.tsx`
- `apps/web/src/components/layout/OttoWordmark.tsx`
- `apps/desktop/src/components/Icons.tsx`
- `apps/landing/src/components/OttoWordmark.tsx`
- `apps/intro-video/src/scenes/LogoReveal.tsx`
- `functions/og/index.tsx`
- `functions/og/preview.tsx`

The old long path begins with `M192.877 257.682`.

## Tauri icons

- `apps/desktop/src-tauri/icons/**` currently shows white `o11o` on a dark square.
- `apps/canvas/src-tauri/icons/**` currently uses the same `o11o` image.
- `apps/launcher/src-tauri/icons/**` shows `o11o` with the word “launcher.”
- All three directories include `.icns`, `.ico`, Windows `Square*Logo.png`, iOS, and Android generated assets.

Product identities from configuration:

- `apps/desktop/src-tauri/tauri.conf.json`
  - Product: `otto`
  - Identifier: `io.ottocode.otto`
- `apps/launcher/src-tauri/tauri.conf.json`
  - Product: `otto-launcher`
  - Identifier: `io.ottocode.launcher`
- `apps/canvas/src-tauri/tauri.conf.json`
  - Product: `Otto Canvas`
  - Identifier: `io.ottocode.canvas`

Launcher and Canvas are therefore otto-family products and should share the ShipWheel identity.

## Native macOS icon

`apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/**` contains ten macOS icon PNGs using the dark `o11o` composition.

## Mobile identity

Expo assets under `apps/mobile/assets/images/` currently use a separate black custom glyph on white:

- `icon.png`
- `favicon.png`
- `splash-icon.png`
- `android-icon-background.png`
- `android-icon-foreground.png`
- `android-icon-monochrome.png`

`apps/mobile/assets/icons/app-icon.tsx` renders a nested hexagon unrelated to either the desktop identity or ShipWheel.

All raster paths are referenced by `apps/mobile/app.config.ts`.

## Web identity

The following favicons use the old rounded “O”:

- `apps/web/public/favicon.svg`
- `apps/desktop/public/favicon.svg`
- `apps/preview-web/public/favicon.svg`
- `apps/landing/public/favicon.svg`

`apps/web/public/pwa-icon.svg` uses a dark rounded tile containing three rectangular forms, not ShipWheel.

Missing referenced favicons:

- `apps/launcher/index.html` references `/favicon.svg`, but no `apps/launcher/public/favicon.svg` exists.
- `apps/canvas/index.html` references `/favicon.svg`, but no `apps/canvas/public/favicon.svg` exists.

## Generated CLI web assets

`apps/cli/src/web-dist/**` is generated from `apps/web/dist` by `scripts/build-web.ts`.

Generated files include:

- `apps/cli/src/web-dist/favicon.svg`
- `apps/cli/src/web-dist/pwa-icon.svg`
- `apps/cli/src/web-dist/manifest.webmanifest`
- `apps/cli/src/web-dist/manifest.json`
- `apps/cli/src/web-dist/index.html`
- `apps/cli/src/web-assets.ts`

These must not be hand-edited.

## TUI and CLI

- `apps/tui/src/components/StatusBar.tsx` uses text-only `otto`.
- `apps/tui/src/components/ChatInput.tsx` uses “Message otto…”.
- No first-party ASCII-art otto logo was found in `apps/tui` or `apps/cli`.
- The CLI’s browser UI inherits branding from the generated web application.

## OttoRouter identity

The current OttoRouter identity is a filled lightning bolt with a 100×100 viewBox.

The old path begins with `M55.0151 11H45.7732` and appears in:

- `apps/landing/src/assets/provider-logos.ts`
- `packages/web-sdk/src/assets/provider-logos.ts`
- `apps/landing/src/components/Nav.tsx`
- `apps/intro-video/src/scenes/Providers.tsx`
- `apps/intro-video/src/scenes/OttoRouter.tsx`

---

# Phase 1: Canonical Brand Assets

## 1. Create the brand directory

Create:

- `assets/brand/README.md`
- `assets/brand/shipwheel-mark.svg`
- `assets/brand/otto-app-icon.svg`
- `assets/brand/otto-lockup.svg`
- `assets/brand/ottorouter-lockup.svg`

Optional, only if standalone product tiles are required:

- `assets/brand/otto-launcher-app-icon.svg`
- `assets/brand/otto-canvas-app-icon.svg`
- `assets/brand/ottorouter-tile.svg`

Do not create a separate `ottorouter-mark.svg`; OttoRouter should reuse `shipwheel-mark.svg`.

## 2. Extract the exact Lucide geometry

Extract `ShipWheel` from the installed `lucide-react@0.563.0` package or the matching upstream Lucide tag.

The source must contain:

- `viewBox="0 0 24 24"`
- `fill="none"`
- `stroke="currentColor"`
- Lucide’s canonical stroke width
- `stroke-linecap="round"`
- `stroke-linejoin="round"`
- Exact upstream `ShipWheel` path and circle nodes

Do not infer the paths from appearance. Copy them from the pinned package source.

The canonical source should not include React-specific properties such as `className`, `strokeWidth`, or JSX camel-cased attributes.

## 3. Document provenance and licensing

In `assets/brand/README.md`, record:

- Source icon: Lucide `ShipWheel`
- Package: `lucide-react@0.563.0`
- Repository: Lucide upstream repository
- License: ISC
- Extraction date
- Exact viewBox and stroke rules
- The distinction between canonical geometry and otto-specific color/tile composition

Lucide’s ISC license permits use and modification. Preserve attribution/provenance even though the application’s tile and lockup compositions are otto-specific.

## 4. Define canonical compositions

### `shipwheel-mark.svg`

- Transparent background
- 24×24 viewBox
- `currentColor`
- Exact Lucide geometry
- Suitable for React, React Native, SVG strings, video, and OG renderers

### `otto-app-icon.svg`

- 1024×1024 square viewBox
- Explicit dark background color
- Explicit light ShipWheel color
- Safe-area padding for Apple, Windows, Linux, and Android masks
- No `currentColor`
- No text

### `otto-lockup.svg`

- ShipWheel plus lowercase `otto`
- Intended for README, landing, social, and wide navigation contexts
- Keep the mark visually dominant
- Use explicit geometry or a carefully selected text treatment that renders consistently

### `ottorouter-lockup.svg`

- Identical ShipWheel geometry
- `OttoRouter` text
- Purple accent permitted for dedicated OttoRouter contexts
- No lightning bolt

## 5. Document usage rules

Add these rules to `assets/brand/README.md`:

- Never modify the ShipWheel geometry for a subproduct.
- Keep at least 18–22% outer padding in app tiles.
- Use mark-only below approximately 128 px.
- Use `currentColor` in application UI.
- Use explicit colors in standalone icon-generation inputs.
- Use a transparent single-color mark for Android monochrome icons.
- Keep Android foreground content inside the adaptive safe area.
- Avoid double-rounded corners on platforms that apply their own mask.
- Test real 16 px output instead of relying only on vector previews.
- Decorative instances must be hidden from assistive technology.
- Meaningful standalone brand images require an accessible label.

---

# Phase 2: Reproducible Asset Generation

## 1. Add a generator

Create:

- `scripts/generate-brand-assets.ts`

Use the existing root dependency `@resvg/resvg-js` for deterministic SVG-to-PNG rendering.

The script should:

1. Read canonical SVGs from `assets/brand/`.
2. Validate the ShipWheel viewBox and geometry.
3. Render PNGs at requested dimensions.
4. Generate theme-aware favicon SVGs.
5. Generate PWA and Apple touch assets.
6. Generate Expo icon, splash, and Android adaptive assets.
7. Generate native macOS AppIcon PNGs.
8. Prepare or invoke Tauri icon generation for each Tauri app.
9. Print every generated output.
10. Fail if an output path is unexpected.
11. Avoid timestamps or nondeterministic image metadata.
12. Support a check mode that detects stale generated assets.

Add root scripts to `package.json`:

```json
{
  "brand:generate": "bun run scripts/generate-brand-assets.ts",
  "brand:check": "bun run scripts/generate-brand-assets.ts --check"
}
```

## 2. Keep source and generated files distinct

Editable sources:

- `assets/brand/*.svg`
- `scripts/generate-brand-assets.ts`
- Source manifests/configuration
- React/React Native/native component implementations

Generated outputs:

- Tauri icon directories
- macOS AppIcon PNGs
- Expo raster assets
- PWA/touch PNGs
- CLI embedded web distribution
- Any generated provider-logo constants, if generation is adopted

The generator should never use an already-generated PNG as the source of another generation.

## 3. Tauri generation commands

Use Tauri’s icon generator from each package.

Desktop:

```sh
bun run --cwd apps/desktop tauri icon ../../assets/brand/otto-app-icon.svg --output src-tauri/icons
```

Launcher:

```sh
bun run --cwd apps/launcher tauri icon ../../assets/brand/otto-launcher-app-icon.svg --output src-tauri/icons
```

Canvas:

```sh
bun run --cwd apps/canvas tauri icon ../../assets/brand/otto-canvas-app-icon.svg --output src-tauri/icons
```

If launcher and Canvas use the exact same tile, point all three commands at `../../assets/brand/otto-app-icon.svg`.

Tauri should generate:

- `32x32.png`
- `64x64.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.png`
- `icon.icns`
- `icon.ico`
- `Square30x30Logo.png`
- `Square44x44Logo.png`
- `Square71x71Logo.png`
- `Square89x89Logo.png`
- `Square107x107Logo.png`
- `Square142x142Logo.png`
- `Square150x150Logo.png`
- `Square284x284Logo.png`
- `Square310x310Logo.png`
- `StoreLogo.png`
- `ios/AppIcon-*.png`
- `android/mipmap-*/*`
- Android adaptive icon XML and color files

Do not manually edit the generated `Square*Logo.png`, iOS, Android, `.icns`, or `.ico` files.

## 4. Update package scripts

`apps/desktop/package.json` currently runs:

```json
"icon": "tauri icon src-tauri/icons/icon.png"
```

This uses a generated icon as the source and risks cumulative quality loss.

Change it to use the canonical SVG.

Add equivalent scripts to:

- `apps/launcher/package.json`
- `apps/canvas/package.json`

## 5. Update icon documentation

Update `apps/desktop/README.md`.

Replace the current workflow that instructs contributors to place an `icon.png` in the app directory with:

- Canonical source paths under `assets/brand/`
- `bun run brand:generate`
- Per-app Tauri commands for troubleshooting
- A warning not to hand-edit generated Tauri outputs
- A warning not to use `src-tauri/icons/icon.png` as generation input
- A note that canonical SVGs and generated icon sets should be committed according to repository convention

---

# Phase 3: OttoRouter Brand Rollout

## 1. Shared-mark implementation

OttoRouter must use the exact canonical ShipWheel nodes.

Presentation rules:

- Provider grids and controls: `currentColor`
- Dedicated landing hero: purple ShipWheel
- Dedicated video scene: purple ShipWheel
- OttoRouter-specific OG image: purple ShipWheel
- General otto application loading: neutral ShipWheel
- No bolt overlay or geometry changes

Add optional canonical compositions:

- `assets/brand/ottorouter-lockup.svg`
- `assets/brand/ottorouter-tile.svg`

## 2. Landing provider-logo registry

Current:

- `apps/landing/src/assets/provider-logos.ts`
- `ottorouterLogo` is a custom 100×100 filled bolt.
- `providerLogos.ottorouter` maps to it.

Change:

1. Replace `ottorouterLogo` with the canonical 24×24 ShipWheel SVG.
2. Use `fill="none"` and `stroke="currentColor"`.
3. Preserve the exported constant and registry key.
4. Verify it through `apps/landing/src/components/ProviderLogo.tsx`.
5. Check `apps/landing/src/react-pages/sections/ProvidersSection.tsx`, where OttoRouter appears as a provider card.

## 3. Web SDK provider-logo registry

Current:

- `packages/web-sdk/src/assets/provider-logos.ts`
- `ottorouterLogo` duplicates the custom bolt.
- `packages/web-sdk/src/components/common/ProviderLogo.tsx` injects the SVG and substitutes runtime dimensions.

Known consumers include:

- `packages/web-sdk/src/components/onboarding/steps/ProviderSetupStep.tsx`
- `packages/web-sdk/src/components/onboarding/steps/DefaultsStep.tsx`
- Generic chat, usage, header, session, and model/provider displays

Change:

1. Replace the bolt with canonical ShipWheel SVG.
2. Preserve `currentColor`.
3. Preserve the `ottorouter` registry key.
4. Add a focused test for `ProviderLogo provider="ottorouter"`.
5. Verify sizes 16, 18, 20, 22, and 24 px.
6. Check disconnected, connecting, connected, removal, balance-loading, and default-provider states.

## 4. Prevent registry drift

The landing and web-sdk provider-logo files duplicate SVG strings.

Choose one:

- Generate both `ottorouterLogo` constants from `assets/brand/shipwheel-mark.svg`; or
- Make `brand:check` extract and compare both constants with the canonical source

Do not add a cross-package import from the landing app to `packages/web-sdk`, or the reverse.

## 5. Web SDK settings

`packages/web-sdk/src/components/settings/SettingsSidebar.tsx` uses Lucide `Zap` for OttoRouter identity in the settings navigation and credits/account section.

Change only product-identity instances:

- Replace OttoRouter product `Zap` instances with the shared ShipWheel component.
- Keep `Zap` where it communicates speed, electricity, or another functional concept.
- Preserve status, wallet, credit-card, refresh, and action icons.
- Verify credits, wallet, subscription, PAYG, top-up, sign-out, loading, and disconnected states.

Review:

- `packages/web-sdk/src/components/settings/OttoRouterTopupModal.tsx`
- `packages/web-sdk/src/components/common/StatusIndicator.tsx`

Use ShipWheel for product identity while preserving state-specific status icons.

## 6. Desktop OttoRouter surfaces

Review and update where the product name is presented:

- `apps/desktop/src/components/OttoRouterAccountControl.tsx`
- `apps/desktop/src/components/MachineLauncher.tsx`
- `apps/desktop/src/components/LocalTunnelPanel.tsx`
- `apps/desktop/src/components/OttoRouterLoader.tsx`
- `apps/desktop/src/components/onboarding/NativeOnboarding.tsx`
- `apps/desktop/src/components/ProjectPicker.tsx`
- `apps/desktop/src/components/workspace/DesktopWorkspaceApp.tsx`

Actions:

- Add ShipWheel beside `OttoRouter` in account and connection controls where space permits.
- Add ShipWheel to machine-launcher and managed-tunnel OttoRouter requirement states.
- Keep general workspace loaders neutral.
- Use purple only when the loader specifically communicates OttoRouter authentication or billing.
- Do not replace state dots, machine, tunnel, wallet, or action icons.

## 7. Landing navigation

Current:

- `apps/landing/src/components/Nav.tsx` defines local `OttoRouterIcon`.
- It duplicates the bolt.
- It appears in desktop and mobile links.

Change:

1. Remove the local bolt geometry.
2. Use the shared ShipWheel.
3. Keep the current `w-3.5 h-3.5` size.
4. Mark it decorative because adjacent text says `OttoRouter`.
5. Preserve links and analytics attributes.

## 8. Dedicated OttoRouter landing page

Relevant files:

- `apps/landing/src/react-pages/OttoRouter.tsx`
- `apps/landing/src/pages/ottorouter.astro`

Current:

- Hero is primarily text-only.
- Purple radial accent is already present.
- `HeroMockup` uses a generic circle-plus icon beside `api.ottorouter.org`.
- Functional SVGs represent payments, routing, security, and other concepts.

Change:

1. Add purple ShipWheel to the hero lockup.
2. Prefer visible product casing `OttoRouter`.
3. Retain lowercase `ottorouter` for package names, provider IDs, URLs, CLI arguments, and code.
4. Replace the generic circle-plus endpoint identity icon with ShipWheel.
5. Keep functional payment, wallet, routing, security, and provider icons unchanged.
6. Consider a compact ShipWheel lockup near the final CTA.
7. Preserve the existing purple radial gradient.
8. Add OttoRouter-specific OG metadata to `apps/landing/src/pages/ottorouter.astro`.

## 9. OttoRouter documentation

Relevant files:

- `apps/landing/src/layouts/DocsLayout.astro`
- `apps/landing/src/components/DocsMobileNav.tsx`
- `apps/landing/src/pages/docs/ottorouter/index.astro`
- `apps/landing/src/pages/docs/ottorouter/payments.astro`
- `apps/landing/src/pages/docs/ottorouter/integration.astro`
- `apps/landing/src/pages/docs/ottorouter/openclaw.astro`
- `apps/landing/src/react-pages/docs/OttoRouterOverview.tsx`
- `apps/landing/src/react-pages/docs/OttoRouterPayments.tsx`
- `apps/landing/src/react-pages/docs/OttoRouterIntegration.tsx`
- `apps/landing/src/react-pages/docs/OpenClawOttoRouter.tsx`
- OttoRouter AI SDK documentation under `apps/landing/src/react-pages/docs/AiSdk*.tsx`

Change:

- Add a small ShipWheel beside the OttoRouter docs section title in desktop and mobile navigation.
- Add a ShipWheel lockup to the OttoRouter overview introduction.
- Do not decorate every page heading.
- Do not alter code identifiers or environment-variable names.
- Keep these pages on the shared landing favicon.

Repository-level technical documents under `docs/` remain text-only unless a brand-guide link is useful.

## 10. Intro video OttoRouter identity

### Provider montage

Update:

- `apps/intro-video/src/scenes/Providers.tsx`

Replace the OttoRouter bolt path with canonical ShipWheel nodes. Adjust the rendering model because ShipWheel is stroked while many provider marks are filled.

### Dedicated scene

Update:

- `apps/intro-video/src/scenes/OttoRouter.tsx`

Current:

- Defines `OttoRouterBolt`
- Uses `boltProgress` and `boltScale`
- Renders the bolt at 130 px with `colors.accent`

Change:

- Rename to `OttoRouterMark`.
- Replace geometry with ShipWheel.
- Rename bolt-specific animation variables.
- Keep the purple accent.
- Re-tune size, scale, stroke animation, halo, orbit, and ring spacing.
- Ensure strokes are not clipped.
- Preserve routing narrative, provider orbit, and `ottorouter.org`.

## 11. OttoRouter catalogs

Generated files:

- `packages/sdk/src/providers/src/catalog.ts`
- `packages/ai-sdk/src/catalog.ts`
- `apps/landing/public/catalog/models.json`

`packages/sdk/src/providers/src/catalog-manual.ts` also contains provider metadata but no logo field.

Inspection shows that the catalogs contain:

- Provider ID and label
- Environment variables
- API and documentation URLs
- Model metadata
- Model input modalities

They do not embed provider logos.

Rules:

- Do not hand-edit generated catalogs.
- No catalog regeneration is required solely for the logo change.
- Keep visual assets outside the provider catalog schema.
- If provider metadata or models also change, regenerate with:

```sh
bun run scripts/update-catalog.ts
```

For the OttoRouter AI SDK catalog where appropriate:

```sh
bun run scripts/update-catalog.ts --ottorouter
```

Review generated diffs carefully because remote model data and the landing catalog timestamp may change.

## 12. OttoRouter social metadata

Current:

- `apps/landing/src/pages/ottorouter.astro` uses `BaseLayout`.
- `functions/og/index.tsx` and `functions/og/preview.tsx` have no explicit OttoRouter branch.
- The generic landing OG renderer uses the old otto identity.

Change:

1. Add an OttoRouter OG type or section if supported cleanly.
2. Render the same ShipWheel in purple.
3. Include the `OttoRouter` lockup and product description.
4. Keep general otto OG cards neutral.
5. Update the route to request the OttoRouter card.
6. Render and inspect a 1200×630 sample.

## 13. External OttoRouter site boundary

No separate OttoRouter favicon, PWA manifest, or public site asset directory was found in this repository.

The navigation links to `https://ottorouter.org`, which may be maintained elsewhere.

If that deployment belongs to another repository, create a follow-up covering:

- ShipWheel favicon
- Purple OttoRouter tile
- Apple touch and PWA icons
- OttoRouter lockup
- OG and social metadata

Do not block this monorepo’s rebrand on an external repository.

---

# Phase 4: Tauri Application Rollout

## Desktop

### Current files

- `apps/desktop/src-tauri/icons/**`
- `apps/desktop/public/favicon.svg`
- `apps/desktop/src-tauri/tauri.conf.json`

Current icon: white `o11o` on a dark square.

Changes:

1. Run the Tauri icon generator from `otto-app-icon.svg`.
2. Commit all regenerated root, Windows, iOS, and Android outputs.
3. Replace `apps/desktop/public/favicon.svg` with ShipWheel.
4. Keep current `tauri.conf.json` icon paths unless generated names change.
5. Verify all referenced files exist:
   - `icons/32x32.png`
   - `icons/128x128.png`
   - `icons/128x128@2x.png`
   - `icons/icon.icns`
   - `icons/icon.ico`
6. Inspect `.app`, `.dmg`, Windows, Linux, and updater artifacts.

## Launcher

### Current files

- `apps/launcher/src-tauri/icons/**`
- `apps/launcher/src-tauri/tauri.conf.json`
- `apps/launcher/index.html`

Current icon: `o11o` plus “launcher.”

Changes:

1. Use ShipWheel as the central mark.
2. Remove text from the OS icon.
3. Prefer the exact otto tile unless product differentiation is required.
4. If differentiation is necessary, use a restrained accent or badge that survives 16–32 px.
5. Regenerate all Tauri outputs.
6. Add `apps/launcher/public/favicon.svg`.
7. Keep product name and identifier unchanged.
8. Verify the existing HTML favicon reference resolves.

## Canvas

### Current files

- `apps/canvas/src-tauri/icons/**`
- `apps/canvas/src-tauri/tauri.conf.json`
- `apps/canvas/index.html`

Current icon: same dark `o11o` icon as desktop.

Changes:

1. Use ShipWheel.
2. Prefer the exact otto tile or a documented Canvas accent.
3. Regenerate all Tauri outputs.
4. Add `apps/canvas/public/favicon.svg`.
5. Keep current bundle references.
6. Verify the icon in Finder, Dock, and the app switcher.
7. Check interaction with Canvas’s transparent window treatment.

---

# Phase 5: Native macOS Application

## Files

- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/Contents.json`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_16x16.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_16x16@2x.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_32x32.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_32x32@2x.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_128x128.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_128x128@2x.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_256x256.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_256x256@2x.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_512x512.png`
- `apps/mac/otto/otto/Assets.xcassets/AppIcon.appiconset/icon_512x512@2x.png`

## Generation dimensions

Generate:

| Filename | Pixel size |
|---|---:|
| `icon_16x16.png` | 16×16 |
| `icon_16x16@2x.png` | 32×32 |
| `icon_32x32.png` | 32×32 |
| `icon_32x32@2x.png` | 64×64 |
| `icon_128x128.png` | 128×128 |
| `icon_128x128@2x.png` | 256×256 |
| `icon_256x256.png` | 256×256 |
| `icon_256x256@2x.png` | 512×512 |
| `icon_512x512.png` | 512×512 |
| `icon_512x512@2x.png` | 1024×1024 |

Keep `Contents.json` unchanged if filenames remain identical.

Verify:

- Every declared file exists.
- Dimensions match size and scale.
- No Xcode asset warnings occur.
- Finder, Dock, app switcher, and About metadata use the new icon.

Build:

```sh
xcodebuild \
  -project apps/mac/otto/otto.xcodeproj \
  -scheme otto \
  -configuration Debug \
  build \
  CODE_SIGNING_ALLOWED=NO
```

---

# Phase 6: Expo Mobile Application

## Raster assets

Replace:

- `apps/mobile/assets/images/icon.png`
- `apps/mobile/assets/images/favicon.png`
- `apps/mobile/assets/images/splash-icon.png`
- `apps/mobile/assets/images/android-icon-background.png`
- `apps/mobile/assets/images/android-icon-foreground.png`
- `apps/mobile/assets/images/android-icon-monochrome.png`

### Required treatments

`icon.png`:

- 1024×1024
- Canonical app tile
- No transparency if Expo/App Store requirements expect opaque output

`favicon.png`:

- ShipWheel composition suitable for Expo web
- At least the Expo-recommended favicon size
- Test at browser-tab size

`splash-icon.png`:

- Transparent ShipWheel or compact lockup
- Designed for the configured `#161616` background
- Avoid a second opaque square inside the splash screen

`android-icon-foreground.png`:

- Transparent background
- ShipWheel within adaptive safe zone

`android-icon-background.png`:

- Solid brand background if an image is retained
- Otherwise remove `backgroundImage` and use `backgroundColor`

`android-icon-monochrome.png`:

- Single-color mark with transparency
- No tile
- Suitable for Android themed icons

## React Native component

Update:

- `apps/mobile/assets/icons/app-icon.tsx`

Current: nested hexagon.

Change:

- Replace with React Native SVG nodes matching canonical ShipWheel.
- Preserve theme-aware coloring.
- Support existing width and height props.
- Use decorative accessibility behavior unless the icon conveys meaningful information.

## Expo configuration

Update or verify:

- `apps/mobile/app.config.ts`

Current references:

- `expo.icon`
- `android.adaptiveIcon.foregroundImage`
- `android.adaptiveIcon.backgroundImage`
- `android.adaptiveIcon.monochromeImage`
- `web.favicon`
- `expo-splash-screen.image`

Change:

- Update Android `backgroundColor` from `#E6F4FE` to the final brand tile color.
- Keep paths stable where filenames remain unchanged.
- Remove redundant `backgroundImage` if a solid color is sufficient.

Validate:

```sh
bunx expo config --type public
```

Test:

- iOS home-screen icon
- Android circle, squircle, and other adaptive masks
- Android monochrome themed icon
- Splash screen in light and dark system modes
- Expo web favicon
- In-product React Native mark

---

# Phase 7: Web Favicons, PWA, and Generated CLI Assets

## Favicons

Replace:

- `apps/web/public/favicon.svg`
- `apps/desktop/public/favicon.svg`
- `apps/preview-web/public/favicon.svg`
- `apps/landing/public/favicon.svg`

Add:

- `apps/launcher/public/favicon.svg`
- `apps/canvas/public/favicon.svg`

Recommended favicon SVG:

- 24×24 or carefully padded square viewBox
- ShipWheel with theme-aware light/dark stroke
- No old rounded “O”
- Test in Chromium, Firefox, and Safari

## PWA icon

Replace:

- `apps/web/public/pwa-icon.svg`

Use the canonical app tile with appropriate maskable safe area.

Review:

- `apps/web/public/manifest.webmanifest`

The current manifest references one SVG with `purpose: "any maskable"`.

Prefer explicit assets if compatibility testing warrants them:

- 192×192 PNG, purpose `any`
- 512×512 PNG, purpose `any`
- 192×192 maskable PNG
- 512×512 maskable PNG

Do not claim an image is maskable if the mark can be cropped.

## Apple touch icon

`apps/web/index.html` currently points `apple-touch-icon` at `/pwa-icon.svg`.

Safari support is more reliable with PNG.

Add:

- `apps/web/public/apple-touch-icon.png`

Update:

- `apps/web/index.html`

Consider adding equivalent touch metadata to:

- `apps/landing/src/layouts/BaseLayout.astro`

## HTML references

Verify:

- `apps/web/index.html`
- `apps/desktop/index.html`
- `apps/launcher/index.html`
- `apps/canvas/index.html`
- `apps/preview-web/src/layouts/Layout.astro`
- `apps/landing/src/layouts/BaseLayout.astro`

Every referenced icon must exist and have the correct MIME type.

## Generated CLI browser assets

Do not hand-edit:

- `apps/cli/src/web-dist/**`
- `apps/cli/src/web-assets.ts`

Source changes belong in:

- `apps/web/public/**`
- `apps/web/index.html`
- Other `apps/web` source files

Regenerate with:

```sh
bun run scripts/build-web.ts
```

The script:

1. Builds `@ottocode/api`.
2. Builds `@ottocode/web-sdk`.
3. Builds `apps/web`.
4. Deletes `apps/cli/src/web-dist`.
5. Copies `apps/web/dist`.
6. Generates `apps/cli/src/web-dist/manifest.json`.
7. Generates `apps/cli/src/web-assets.ts`.

Confirm the generated manifest and embedded mappings contain:

- `/favicon.svg`
- `/pwa-icon.svg`
- Any new PNG PWA assets
- `/apple-touch-icon.png`

---

# Phase 8: In-Application Identity

## Shared Web SDK mark

Update:

- `packages/web-sdk/src/components/common/OttoOIcon.tsx`
- `packages/web-sdk/src/components/index.ts`
- `packages/web-sdk/src/components/looper/LooperTabBar.tsx`

Current:

- `OttoOIcon` renders the old filled “O.”
- It is exported but no direct runtime consumers were found.
- `LooperTabBar` imports Lucide `ShipWheel` directly.

Change:

1. Introduce `OttoMark` or `OttoLogoMark` using canonical ShipWheel geometry.
2. Keep `OttoOIcon` as a compatibility alias if external consumers may rely on it.
3. Re-export the new component.
4. Update `LooperTabBar` to use the shared mark.
5. Preserve current agents-tab size and `currentColor`.
6. Support `className` and appropriate SVG props.
7. Add accessible labeling only when meaningful.

## Web wordmark

Update:

- `apps/web/src/components/layout/OttoWordmark.tsx`

Consumers:

- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/routes/index.tsx`

Change:

- Replace old `o11o` geometry with ShipWheel plus lowercase `otto`.
- Preserve the component name if minimizing API churn.
- Keep compact 12–14 px versions legible.
- Preserve `aria-label="otto"`.
- Use the shared web-sdk mark where package boundaries allow.

## Desktop logos and loading

Update:

- `apps/desktop/src/components/Icons.tsx`
- `apps/desktop/src/components/OttoRouterLoader.tsx`

Consumers of `OttoWordmark` include:

- `apps/desktop/src/components/DesktopSettings.tsx`
- `apps/desktop/src/components/ProjectPicker.tsx`
- `apps/desktop/src/components/ConnectedProjectPicker.tsx`

Current:

- `OttoLogo` and `OttoWordmark` duplicate the old path.
- `OttoRouterLoader` uses `OttoLogo`.

Change:

- Replace both with ShipWheel-based mark/lockup components.
- Use mark-only in loaders.
- Use ShipWheel plus `otto` in title bars.
- Update tests:
  - `apps/desktop/tests/settings-page.test.ts`
  - `apps/desktop/tests/loading-ui-audit.test.ts`
- Test loader behavior at 32 px.

## Shared status indicator

Update:

- `packages/web-sdk/src/components/common/StatusIndicator.tsx`

Current:

- Defines internal old `OttoWordmarkLogo`.
- Used by `packages/web-sdk/src/components/settings/OttoRouterTopupModal.tsx`.

Change:

- Replace with shared ShipWheel mark.
- Preserve status animation and success/error/loading semantics.

## Launcher in-product identity

Update:

- `apps/launcher/src/App.tsx`
- `apps/launcher/src/components/Welcome.tsx`

Current:

- Text-only `otto launcher`
- Text-only `otto`

Change:

- Add ShipWheel plus product text.
- Keep `launcher` outside the mark.
- Use mark-only where space is constrained.

## Canvas in-product identity

Search Canvas title bars, sidebar, empty states, and app shell for visible `Otto Canvas` or `otto` text.

Relevant likely surfaces include:

- `apps/canvas/src/app/App.tsx`
- `apps/canvas/src/components/Sidebar.tsx`
- `apps/canvas/src/components/OttoBlock.tsx`

Add ShipWheel only to true product identity surfaces, not every Otto block or functional control.

## Intro video logo reveal

Update:

- `apps/intro-video/src/scenes/LogoReveal.tsx`

Current:

- Old “O” at 200×200
- Old full wordmark
- Halo, shimmer, scale, and reveal animation

Change:

1. Replace mark SVG with ShipWheel.
2. Replace wordmark with ShipWheel plus lowercase `otto`, or reveal text-only `otto` after the mark.
3. Re-tune scale because a stroked wheel has less visual mass.
4. Rework shimmer clipping if necessary.
5. Ensure no stroke clipping.
6. Preserve overall motion language.

Render using the package’s verified Remotion composition. Confirm the composition ID before overwriting:

- `apps/intro-video/out/IntroVideo.mp4`

---

# Phase 9: Landing Site, OG Images, and Documentation

## Landing wordmark

Update:

- `apps/landing/src/components/OttoWordmark.tsx`

Consumers:

- `apps/landing/src/components/Nav.tsx`
- `apps/landing/src/components/Footer.tsx`
- `apps/landing/src/react-pages/sections/HeroSection.tsx`
- `apps/landing/src/react-pages/sections/InstallSection.tsx`

Change:

- Replace `o11o` with ShipWheel plus lowercase `otto`.
- Keep navigation and footer compact.
- Allow the hero to use a larger mark-first composition.
- Verify light and dark themes and mobile navigation.

## Social images

Update:

- `functions/og/index.tsx`
- `functions/og/preview.tsx`

Current:

- Both define `OttoLogo` using `OTTO_WORDMARK_PATH`.
- The path is the old `o11o` geometry.
- The logo appears in multiple social-card layouts.

Change:

1. Replace with ShipWheel-based mark/lockup.
2. Prefer a framework-neutral generated geometry module or generation step.
3. Avoid duplicating canonical path data manually.
4. Update all card variants, not only the landing card.
5. Add the OttoRouter purple variant described earlier.
6. Render representative 1200×630 samples.
7. Inspect after downscaling and compression.

## Share-preview OG

Review:

- `apps/preview-web/src/pages/s/[shareId].astro`
- `apps/preview-api/src/components/OGImage.tsx`

Current:

- Share-preview pages reference a generated OG endpoint.
- `OGImage.tsx` does not appear to render an otto logo.

Decision:

- Add a subtle ShipWheel only if share cards should identify otto.
- Keep the shared content dominant.
- Do not force a logo into every generated share card without product intent.

## Metadata

Review:

- `apps/landing/src/layouts/BaseLayout.astro`
- `apps/web/index.html`
- `apps/preview-web/src/pages/s/[shareId].astro`

Verify:

- `og:image`
- `twitter:image`
- `og:site_name`
- `apple-touch-icon`
- Favicon references
- Theme color
- PWA metadata
- Canonical URL

## README

Current:

- `README.md` contains badges but no first-party logo.

Change:

- Add `assets/brand/otto-lockup.svg` near the top.
- Preserve existing badges.
- Keep asset path repository-relative.
- Do not alter vendor README logos.

## Docs

Add a brand-assets reference to:

- `docs/index.md`, or another suitable documentation index

Link to:

- `assets/brand/README.md`

Do not add repeated decorative logos to technical documents. Refresh first-party screenshots only when they visibly show obsolete branding.

---

# Phase 10: TUI and CLI

## TUI

Relevant files:

- `apps/tui/src/components/StatusBar.tsx`
- `apps/tui/src/components/ChatInput.tsx`

Current:

- Text-only `otto`
- No ASCII logo

Recommendation:

- Keep text branding as the baseline.
- Do not add a large ASCII-art banner solely for parity with graphical applications.
- A compact Unicode wheel approximation may be considered only if:
  - It degrades gracefully.
  - It works in common terminal fonts.
  - It fits narrow terminal layouts.
  - A plain-text fallback is available.
- Preserve `otto` in the status bar and input placeholder.

If a Unicode mark is introduced, centralize it in one constant and test limited-width and non-Unicode environments.

## CLI

No hand-authored CLI logo was found.

Actions:

- Keep command help and textual output as `otto`.
- Do not add startup ASCII art that delays or clutters command output.
- Let the CLI browser interface inherit the generated web ShipWheel assets.
- Do not hand-edit the CLI embedded distribution.

---

# Phase 11: Cleanup and Consistency Enforcement

## Remove old otto geometry

Search:

```sh
rg "OttoOIcon|OTTO_WORDMARK_PATH|OttoWordmarkLogo|viewBox=\"0 0 748 303\"|viewBox=\"-26 65 248 248\"" \
  apps packages functions README.md docs
```

Search for the old path prefix:

```sh
rg "M192\.877 257\.682" apps packages functions
```

Expected:

- No active source renders the old rounded “O” or `o11o`.
- A compatibility export named `OttoOIcon` may remain temporarily, but it must render ShipWheel.

## Remove old OttoRouter bolt

Search:

```sh
rg "M55\.0151 11H45\.7732" apps packages functions
rg "OttoRouterBolt|boltProgress|boltScale" apps/intro-video/src
```

Expected:

- No active source renders the bolt.
- No obsolete bolt-specific animation names remain.

## Check product-identity icon use

Search:

```sh
rg "<Zap|icon: <Zap" packages/web-sdk/src/components/settings
```

Review each match manually.

Expected:

- ShipWheel represents OttoRouter product identity.
- `Zap` remains only for functional concepts.

## Add automated brand checks

`bun run brand:check` should fail when:

- Canonical SVG geometry changes unexpectedly.
- Generated raster assets are stale.
- A required favicon or app icon is missing.
- Mac AppIcon dimensions disagree with `Contents.json`.
- Tauri config references missing files.
- Landing and web-sdk OttoRouter provider logos drift from the canonical mark.
- Old otto or OttoRouter path prefixes remain in active source.
- A generated output differs after a second generation run.

---

# Verification Checklist

## Canonical asset and generator verification

Run:

```sh
bun run brand:generate
bun run brand:check
```

Then run `brand:generate` a second time and confirm no Git diff.

Verify:

- Canonical SVGs parse successfully.
- PNG dimensions are correct.
- Transparency is retained where expected.
- Fixed-color assets do not rely on `currentColor`.
- Small sizes remain legible.
- No text is embedded in small OS icons.

## Web and PWA verification

Build:

```sh
bun run --cwd apps/web build
bun run --cwd apps/landing build
bun run --cwd apps/preview-web build
bun run --cwd apps/desktop build
bun run --cwd apps/launcher build
bun run --cwd apps/canvas build
```

Inspect:

- Browser tabs in light and dark browser themes
- Direct favicon URLs
- PWA installation
- Circle, squircle, and rounded-square mask previews
- Apple touch icon on Safari/iOS
- Service worker and browser cache behavior
- Missing asset requests in browser developer tools

## CLI generated web assets

Run:

```sh
bun run scripts/build-web.ts
```

Verify:

- `apps/cli/src/web-dist/` contains new assets.
- `apps/cli/src/web-assets.ts` includes them.
- Generated `manifest.json` references them.
- The CLI web server serves correct MIME types.
- No generated file was manually patched.

## Tauri verification

Generate:

```sh
bun run --cwd apps/desktop icon
bun run --cwd apps/launcher icon
bun run --cwd apps/canvas icon
```

Or run the root generator if it wraps these commands.

Build:

```sh
bun run build:desktop
bun run build:canvas
```

Use the launcher’s release/build command used by its package or release automation.

Inspect:

- macOS `.app`
- DMG presentation
- Dock and Finder
- Windows `.ico`
- Windows installer and `Square*Logo`
- Linux AppImage/deb desktop icon
- iOS and Android generated directories
- Updater artifacts

Confirm every `bundle.icon` path in each `tauri.conf.json` exists.

## Native macOS verification

Run:

```sh
xcodebuild \
  -project apps/mac/otto/otto.xcodeproj \
  -scheme otto \
  -configuration Debug \
  build \
  CODE_SIGNING_ALLOWED=NO
```

Verify:

- No asset-catalog warnings
- All icon slots populated
- Effective 16, 32, 128, 256, 512, and 1024 sizes
- Finder, Dock, app switcher, and About presentation

## Expo verification

Run:

```sh
bunx expo config --type public
```

Then run the mobile package’s supported lint/type checks and launch iOS and Android builds.

Verify:

- iOS icon
- Android adaptive masks
- Android monochrome themed icon
- Splash screen
- Expo web favicon
- In-app React Native ShipWheel
- No clipping or unintended opaque background

## In-product component verification

Inspect:

- Web sidebar and home page
- Desktop settings and project picker
- Desktop connected project picker
- Desktop loaders
- Web SDK status indicator
- OttoRouter onboarding and defaults
- OttoRouter settings, credits, wallet, subscription, and top-up
- Desktop OttoRouter account and machine controls
- Landing nav, hero, install section, and footer
- Launcher welcome and title
- Canvas product shell
- TUI status bar
- Intro-video logo reveal

Accessibility:

- Decorative marks use `aria-hidden`.
- Meaningful marks have an accessible name.
- Adjacent visible product text prevents duplicate screen-reader labels.
- Contrast remains sufficient in light and dark themes.

## OttoRouter verification

Render `ProviderLogo provider="ottorouter"` at:

- 16 px
- 18 px
- 20 px
- 22 px
- 24 px

Inspect:

- Landing provider grid
- Web SDK onboarding
- Default-provider selection
- Settings navigation
- Credits and wallet
- Top-up modal
- Desktop account and managed-tunnel prompts
- Landing desktop/mobile nav
- OttoRouter hero
- Endpoint mockup
- OttoRouter docs navigation
- OttoRouter intro-video scene
- OttoRouter OG card

Confirm:

- Geometry is identical to otto ShipWheel.
- Purple is presentation-only.
- Mixed provider lists use `currentColor`.
- Old bolt is absent.

## Video verification

Before overwriting final media:

1. Render still frames from `LogoReveal`.
2. Render still frames from `OttoRouter`.
3. Check stroke clipping and motion blur.
4. Compare visual weight against text and provider icons.
5. Confirm the Remotion composition ID.
6. Render final `apps/intro-video/out/IntroVideo.mp4`.

## OG verification

Render representative 1200×630 cards for:

- Landing
- Documentation
- OttoRouter
- Any blog/card variants
- Share previews if branded

Inspect:

- Mark size
- Text spacing
- Purple OttoRouter treatment
- Social-platform downscaling
- Compression artifacts
- Dark/light contrast

## Repository checks

Run:

```sh
bun lint
bun run typecheck
bun test
```

If full monorepo testing is impractical, run all affected package builds and tests plus `bun lint`, and document what was omitted.

Review:

```sh
git diff --stat
git diff
```

Confirm:

- Canonical sources are committed.
- Expected generated assets are committed.
- No unrelated catalog updates occurred.
- No generated files were hand-edited.
- No old geometry remains.
- A second generation run is clean.

---

# Pitfalls and Constraints

## Generated files

Do not hand-edit:

- `apps/cli/src/web-dist/**`
- `apps/cli/src/web-assets.ts`
- `packages/sdk/src/providers/src/catalog.ts`
- `packages/ai-sdk/src/catalog.ts`
- `apps/landing/public/catalog/models.json`
- Tauri-generated `Square*Logo.png`
- Tauri-generated `ios/*`
- Tauri-generated Android resources
- Tauri-generated `.icns` and `.ico`

Use:

```sh
bun run scripts/build-web.ts
bun run scripts/update-catalog.ts
bun run scripts/update-catalog.ts --ottorouter
```

Only run catalog regeneration if catalog data changes; a logo-only change does not require it.

## Icon source quality

Do not generate icons from:

- `src-tauri/icons/icon.png`
- Another generated PNG
- A screenshot
- A manually resized raster

Always use the canonical SVG.

## Platform masks

- macOS, iOS, Android, and some Windows surfaces apply their own masks.
- Avoid double-rounded corners.
- Keep the wheel inside safe areas.
- Test Android adaptive icon masks.
- Test macOS at real Finder and Dock sizes.

## Small-size legibility

Lucide’s two-pixel stroke may appear light at favicon scale.

If adjustment is needed:

- Increase the mark’s optical size within the tile.
- Create a small-size composition with less outer padding.
- Do not alter the canonical ShipWheel geometry or stroke relationships without an explicitly documented brand exception.

## `currentColor`

Use `currentColor` for:

- React components
- React Native theme-aware components
- Provider-logo registries
- Theme-aware favicon SVGs

Do not rely on `currentColor` for:

- Tauri generation input
- macOS AppIcon generation
- Expo raster generation
- Fixed PWA PNGs
- Social image rasterization

Those assets need explicit colors.

## Icon caches

Old icons may persist in:

- Browser favicon cache
- Service worker cache
- macOS Finder/Dock cache
- Windows shell icon cache
- iOS simulator/device launcher
- Android launcher

Use fresh profiles/build paths or appropriate local cache clearing before concluding generation failed.

## Product variants

Launcher, Canvas, and OttoRouter are otto-family products.

Recommended default:

- Same exact ShipWheel geometry
- Same default tile for otto, launcher, and Canvas unless differentiation is necessary
- Purple presentation accent for OttoRouter
- Product names outside the mark

Do not create arbitrary per-product geometry variants.

## Licensing

Lucide is ISC-licensed and permitted for this use.

Keep:

- Source package/version
- License
- Upstream reference
- Extraction date

in `assets/brand/README.md`.

## Repository rules

Follow `AGENTS.md`:

- Use Bun for all tooling.
- Use Biome.
- Run `bun lint`.
- Do not directly modify generated files.
- Keep changes focused.
- Add tests for behavior/component changes.
- Do not commit without explicit permission.

---

# Recommended Execution Order

1. Create `assets/brand/` and pin the exact ShipWheel geometry.
2. Document license, colors, safe areas, and otto/OttoRouter relationship.
3. Implement `scripts/generate-brand-assets.ts` and `brand:check`.
4. Replace shared in-product SVG components.
5. Replace OttoRouter provider registries and product identity icons.
6. Generate desktop, launcher, and Canvas Tauri icon sets.
7. Generate native macOS AppIcon assets.
8. Generate Expo mobile assets and update the React Native icon.
9. Replace web favicons, PWA icons, and touch icons.
10. Regenerate CLI web distribution.
11. Update landing, OG renderers, README, and docs.
12. Update intro-video scenes and render verified output.
13. Run stale-geometry audits.
14. Run package builds, tests, type checking, and `bun lint`.
15. Perform platform-specific visual verification.
