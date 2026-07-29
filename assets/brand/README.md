# otto Brand Assets

Canonical brand assets for otto and OttoRouter. All product icons, favicons,
raster exports, and in-app logo components must derive from the files in this
directory. Do not redraw or hand-edit the mark geometry.

## Sources

- **In-product mark:** Lucide `ShipWheel` (`ship-wheel`)
- **Package:** `lucide-react@0.563.0` (extracted from `node_modules/lucide-react/dist/esm/icons/ship-wheel.js`)
- **Upstream repo:** https://github.com/lucide-icons/lucide
- **License:** ISC (use and modification permitted)
- **Extraction date:** 2026-07-14
- **App icon and loading artwork:** custom NeoPop `otto` glyphs from the
  landing-page wordmark

## Files

| File | Purpose |
| --- | --- |
| `shipwheel-mark.svg` | Canonical 24x24 mark, `currentColor`, for in-app UI and theme-aware favicons |
| `otto-app-icon.svg` | 1024x1024 full-bleed app-icon master (light tile + blue NeoPop `o`) |
| `otto-wordmark.svg` | Horizontal multicolor NeoPop wordmark for product UI |
| `otto-wordmark-1x1.png` | 1024x1024 transparent square export used by branded loading surfaces |
| `otto-lockup.svg` | Compatibility alias for the horizontal multicolor NeoPop wordmark |
| `ottorouter-lockup.svg` | Horizontal ShipWheel + `OttoRouter` lockup with purple accent |

## ShipWheel geometry rules

The canonical mark is exactly the upstream Lucide geometry:

- `viewBox="0 0 24 24"`
- `fill="none"`
- `stroke-width="2"`
- `stroke-linecap="round"`
- `stroke-linejoin="round"`

Elements (verbatim from `lucide-react@0.563.0`):

```
circle cx="12" cy="12" r="8"
path   d="M12 2v7.5"
path   d="m19 5-5.23 5.23"
path   d="M22 12h-7.5"
path   d="m19 19-5.23-5.23"
path   d="M12 14.5V22"
path   d="M10.23 13.77 5 19"
path   d="M9.5 12H2"
path   d="M10.23 10.23 5 5"
circle cx="12" cy="12" r="2.5"
```

Never alter spokes, proportions, line caps, or joins. Scale by wrapping the
24x24 group in a `<g transform>`; never rewrite the path data.

## App-icon treatment

- **Tile color:** `#f7f8f6`
- **Face color:** `#4865cc`
- **Hard extrusion:** `#283c8c`
- **Safe padding:** the mark occupies the central ~56% of the canvas so it
  remains clear under square, rounded-square, and circular masks.
- The master is a full-bleed square; do not pre-round corners. Operating
  systems apply their own masks, and pre-rounding causes double-rounded
  corners.

## Usage rules

1. Never modify the ShipWheel geometry when it is used in-product —
   differentiate subproducts by color/presentation only.
2. Below ~128px, use the app icon's `o` alone; never place a wide textual
   lockup inside small OS icons.
3. Use `currentColor` for in-app UI SVG components and theme-aware favicons.
4. Use explicit colors (`#f7f8f6`, `#4865cc`, and `#283c8c`) in
   icon-generation inputs — never `currentColor` in files fed to raster/icon
   pipelines.
5. Android monochrome (themed) icons: transparent background, single-color
   mark.
6. Android adaptive icons: keep the mark inside the adaptive-icon safe area
   (central ~66% of the canvas).
7. No double-rounded corners: full-bleed square masters, OS applies the mask.
8. Always test real 16px output (favicon) — verify the `o` remains legible.
9. Decorative instances of the mark must be `aria-hidden="true"`.
10. Meaningful standalone images need an accessible label (`role="img"` +
    `aria-label`, or `alt` text).

## otto vs OttoRouter

When the ShipWheel is used in-product, otto and OttoRouter use **identical**
geometry. The only differentiation is presentation:

- **otto:** neutral `currentColor` in UI. OS icons use the blue NeoPop `o` on
  the light tile instead of the ShipWheel.
- **OttoRouter:** the same mark with the purple accent `#9333ea` (Tailwind
  `purple-600`, matching `apps/intro-video/src/theme.ts` and the landing
  OttoRouter page) in dedicated marketing, authentication, billing, routing,
  video, and social contexts. In mixed provider lists, use `currentColor`
  like other monochrome provider logos.

Do not create a geometrically distinct OttoRouter mark, and do not retain or
overlay the legacy lightning-bolt mark.
