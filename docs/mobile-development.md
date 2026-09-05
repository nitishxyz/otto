# Mobile development

[Docs index](./index.md)

`apps/mobile` is the Otto mobile foundation, not a finished client. Its home,
spend, history, welcome, tutorial, and auth routes are placeholders. The existing
route names are retained for now; they do not implement finance or authentication.

## Setup and checks

Install from the repository root with `bun install`. The app uses Expo 56,
React Native 0.85.3, React 19.2.3, Unistyles 3, Reanimated 4, and Expo Router.
The root React/React DOM overrides must match the React version expected by Expo;
workspace dependency declarations alone do not override those pins.

```bash
bun run --filter ottocode-mobile typecheck
bun test tests/mobile-foundation.test.ts
bun run --filter ottocode-mobile lint
bun lint
cd apps/mobile
EXPO_NO_DOTENV=1 bun x expo install --check
EXPO_NO_DOTENV=1 bun x expo config --type prebuild --json
```

The config command evaluates native plugins without generating native projects.
Foundation tests run native-module mocks in isolated Bun processes, not a device.
Root Biome excludes mobile; run the mobile ESLint command separately.

A development build is required for native modules such as Unistyles/Nitro,
keyboard controller, and Vision Camera. Expo Go is not sufficient. Developers
manage the development client/server (`bun run --filter ottocode-mobile dev`);
agents must not start servers, run migrations, or modify generated Drizzle files.

## Foundation responsibilities

- `index.ts` loads text/URL polyfills and Unistyles before Router.
- The root provider composes gestures, theme, toast/network errors, keyboard,
  TanStack Query, and bottom sheets. There is no authentication provider.
- Theme initialization validates stored preferences and falls back to the system
  theme when native storage is unavailable. The splash stays visible until the
  themed navigation stack mounts.
- Query clients are scoped to their provider, including during web rendering.
  Native foreground and network changes update TanStack's focus/online managers;
  web retains its browser listeners. Clearing queries cancels active work first.
- The custom tab bar emits cancellable `tabPress` and `tabLongPress` events and
  exposes tab labels/selection to accessibility services.
- `src/utils/storage.ts` uses SecureStore on native. `storage.web.ts` is only
  best-effort localStorage for preferences: it is not encrypted credential
  storage, and it tolerates static rendering and blocked browser storage.
- SQLite/Drizzle schema files are scaffolding; no database migration or backend
  synchronization is wired into startup.

## Native and release configuration

Build properties target iOS 16.4+ and Android compile SDK 36, matching the Expo 56
foundation. The build-properties plugin is registered once. Environment-specific
identities use `EXPO_PUBLIC_ENV`: for example, `dev` produces
`com.ottocode.mobile.dev` and the `ottocodedev` URL scheme. Existing `prod` identity
suffixes are retained rather than silently changing release bundle identifiers.

EAS builds no longer point at copied StackForge API endpoints or a hard-coded
Expo project. Set these variables explicitly for the intended Otto project:

- `EAS_PROJECT_ID`: Expo project UUID; config uses it for both EAS metadata and
  the update URL. Without it, OTA updates are disabled.
- `EXPO_OWNER`: Expo account or organization owning that project.
- `EXPO_PUBLIC_ENV`: native identity suffix (`dev`, `beta`, or `prod` in the
  checked-in build profiles).

Provide these in the environment where Expo config is evaluated, including EAS
build/update environments. When enabled, OTA automatic checks run only for error
recovery; the existing notification manager owns normal update checks.
No project was created, linked, deployed, or contacted for updates during this pass.
The optional `update:sentry` helper still requires an explicitly configured EAS
project, Sentry upload credentials, and a real Sentry integration before use.

## Reference parity and next work

The read-only Riven mobile app was used to compare dependency versions, native
config, provider lifecycle, navigation, storage, and shared UI foundations. Expo
56 patch dependencies were refreshed without downgrading React Native. Navigation
theming imports now use `expo-router/react-navigation`, as required by Router 56.
Shared
blur/sheet/gesture primitives remain in place; wallet, payments, push, biometrics,
private-mode, and product-specific Sentry integrations were deliberately not copied.

Next, design Otto's routes and connection/authentication UX and connect through
`@ottocode/api`; do not invent a duplicate API client. Native simulator/device
checks are still needed for theme startup, background/reconnect behavior, tab
accessibility, keyboard/bottom-sheet interaction, and release OTA behavior.
Existing mobile ESLint warnings in untouched shared components remain separate
cleanup work.

The iOS and Android production JavaScript/Hermes exports pass. These are bundle
checks, not native Xcode/Gradle builds. Web static export currently fails during
Router's server route discovery because a themed stylesheet is evaluated before
Unistyles configuration. The existing `index.ts` and `app/+html.tsx` configuration
imports do not cover that server discovery order. Resolve this before treating
mobile's web target as supported; the separate `apps/web` client is unaffected.
