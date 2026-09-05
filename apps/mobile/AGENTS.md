# AI Agent Guidelines

Guidance for the Otto mobile foundation. Also follow the root `AGENTS.md` and
read `../../docs/mobile-development.md` before changing platform configuration.

## Key Points

1. **Do NOT start dev servers** - user handles `bun dev`
2. **Do NOT run migrations** - only update schema files in `src/db/schema/`
3. **Do NOT modify `drizzle/` directory** - generated files managed by user

## Project Structure

- `app/` - Expo Router screens and layouts
- `src/components/ui/` - Reusable UI primitives
- `src/hooks/` - Custom React hooks
- `src/services/` - API client and business logic
- `src/db/schema/` - Drizzle ORM schema definitions

## Styling

Uses React Native Unistyles. Check `src/utils/unistyles.ts` for theme configuration.

## Integration boundaries

- Routes are placeholders; authentication and an Otto API connection are not implemented.
- Use `@ottocode/api` when adding first-party API integration. Do not copy finance,
  wallet, or authentication providers from reference apps.
- Never copy reference credentials, EAS project IDs, or production API URLs.
- Native modules require a development build, not Expo Go.

## Checks

From the repository root, use `bun run --filter ottocode-mobile typecheck`,
`bun test tests/mobile-foundation.test.ts`, and `bun run --filter ottocode-mobile lint`.
Run `bun lint` as well; the root Biome command does not include mobile sources.
