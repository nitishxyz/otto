# Inspect an iOS Simulator App

Use this recipe to inspect and interact with a running iOS Simulator app through serve-sim.

1. Confirm the host is macOS.
2. Start serve-sim in a visible terminal with `bun x serve-sim@latest --port 3200`.
3. If Bun is unavailable, use `npx --yes serve-sim@latest --port 3200`.
4. Open the preview URL, usually `http://localhost:3200`.
5. Capture a screenshot and accessibility tree to understand the current state.
6. Use semantic accessibility targets for taps and typing when available; fall back to coordinates only when necessary.
7. Check foreground app and logs when diagnosing launch, navigation, or runtime issues.
8. Stop serve-sim when the workflow is complete unless the user wants it left running.
