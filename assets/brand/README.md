# otto Brand Assets

Canonical brand assets for otto and OttoRouter. All product icons, favicons,
raster exports, and in-app logo components must derive from the files in this
directory. Do not redraw or hand-edit the mark geometry.

## Source

- **Icon:** Lucide `ShipWheel` (`ship-wheel`)
- **Package:** `lucide-react@0.563.0` (extracted from `node_modules/lucide-react/dist/esm/icons/ship-wheel.js`)
- **Upstream repo:** https://github.com/lucide-icons/lucide
- **License:** ISC (use and modification permitted)
- **Extraction date:** 2026-07-14

## Files

| File | Purpose |
| --- | --- |
| `shipwheel-mark.svg` | Canonical 24x24 mark, `currentColor`, for in-app UI and theme-aware favicons |
| `otto-app-icon.svg` | 1024x1024 full-bleed app-icon master (dark tile + off-white mark) |
| `otto-lockup.svg` | Horizontal ShipWheel + original `otto` wordmark path (fill), `currentColor`; mark height matches the wordmark x-height, gap ~0.45x mark width |
| `ottorouter-lockup.svg` | Horizontal ShipWheel + `OttoRouter` lockup with purple accent |

## Geometry rules

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

- **Tile color:** `#141416`
- **Mark color:** `#f7f7f8`
- **Safe padding:** 18–22% outer padding around the mark (in the 1024 master
  the mark occupies the central 624px, i.e. ~19.5% padding per side)
- The master is a full-bleed square; do not pre-round corners. Operating
  systems apply their own masks, and pre-rounding causes double-rounded
  corners.

## Usage rules

1. Never modify the ShipWheel geometry for subproducts — differentiate by
   color/presentation only.
2. Below ~128px, use the mark alone; never place a wide textual lockup inside
   small OS icons.
3. Use `currentColor` for in-app UI SVG components and theme-aware favicons.
4. Use explicit colors (`#141416` / `#f7f7f8`) in icon-generation inputs —
   never `currentColor` in files fed to raster/icon pipelines.
5. Android monochrome (themed) icons: transparent background, single-color
   mark.
6. Android adaptive icons: keep the mark inside the adaptive-icon safe area
   (central ~66% of the canvas).
7. No double-rounded corners: full-bleed square masters, OS applies the mask.
8. Always test real 16px output (favicon) — verify spokes remain legible.
9. Decorative instances of the mark must be `aria-hidden="true"`.
10. Meaningful standalone images need an accessible label (`role="img"` +
    `aria-label`, or `alt` text).

## otto vs OttoRouter

otto and OttoRouter use **identical** ShipWheel geometry. The only
differentiation is presentation:

- **otto:** neutral `currentColor` in UI, or `#f7f7f8` on the `#141416` tile.
- **OttoRouter:** the same mark with the purple accent `#9333ea` (Tailwind
  `purple-600`, matching `apps/intro-video/src/theme.ts` and the landing
  OttoRouter page) in dedicated marketing, authentication, billing, routing,
  video, and social contexts. In mixed provider lists, use `currentColor`
  like other monochrome provider logos.

Do not create a geometrically distinct OttoRouter mark, and do not retain or
overlay the legacy lightning-bolt mark.
