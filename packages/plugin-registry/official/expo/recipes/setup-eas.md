---
description: Install EAS CLI and run the interactive EAS Build setup for this project.
---

Set up EAS Build for this Expo project. Several steps are interactive (login, account/project selection), so run them in a visible terminal and let the user complete prompts.

1. Confirm this is an Expo project (an `app.json`, `app.config.js`, or `app.config.ts` with an `expo` config exists).
2. Ensure the EAS CLI is available. Check with `eas --version`. If it is missing, install it globally with `npm install -g eas-cli` (or run commands through `npx eas-cli@latest`). Do not add `eas-cli` to project dependencies.
3. Authenticate: run `eas login` and let the user sign in. Verify with `eas whoami`.
4. Link and configure the project: run `eas build:configure`. This creates/updates `eas.json` and links the project to an EAS project ID.
5. Review the generated `eas.json` build profiles (`development`, `preview`, `production`) and adjust them to the user's needs.
6. To kick off a first build, use `eas build --platform ios` or `eas build --platform android` (or `--platform all`). These require platform credentials; let the user follow the interactive prompts.

Official docs: https://docs.expo.dev/build/setup/
