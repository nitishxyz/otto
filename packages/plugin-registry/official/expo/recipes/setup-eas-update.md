---
description: Configure EAS Update (over-the-air updates) for this project.
---

Set up EAS Update so the app can ship over-the-air JavaScript and asset updates. Some steps are interactive, so run them in a visible terminal.

1. Make sure EAS is already set up for this project (run the **setup-eas** recipe first if `eas.json` does not exist or the project is not linked).
2. Ensure the EAS CLI is available (`eas --version`) and the user is logged in (`eas whoami`, otherwise `eas login`).
3. Install and configure updates: run `eas update:configure`. This installs `expo-updates`, sets the update URL and runtime version policy in `app.json`/`app.config.js`, and updates `eas.json`.
4. Verify build profiles in `eas.json` reference an update channel (for example, add `"channel": "preview"` / `"channel": "production"` to the relevant profiles).
5. Publish a test update once a build with the matching channel is installed: `eas update --branch preview --message "Initial update"`.
6. Confirm the rollout by checking update health (the `eas-update-insights` skill covers adoption, crash rates, and payload size).

Official docs: https://docs.expo.dev/eas-update/getting-started/
