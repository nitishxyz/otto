# Release changelogs

This repo uses [Changesets](https://github.com/changesets/changesets) to collect release notes and generate package changelogs.

## Daily development

When a change should appear in release notes, run:

```sh
bun changeset
```

Choose the changed package and semver bump, then write a short user-facing summary. Commit the generated `.changeset/*.md` file with the code change.

## Release preparation

Before publishing a release, run:

```sh
bun changeset:status
bun changeset:version
```

`bun changeset:version` consumes pending changesets, bumps package versions, and updates the relevant package `CHANGELOG.md` files. Commit and push those generated changes before running the release.

A separate CI “version PR” is optional. For this repo, simple pushes are enough: push code changes with changeset files, then push the generated version/changelog commit when you are ready to release.

## Fixed otto package versions

The main otto packages are configured as a fixed group so they stay on the same version when one of them is released:

- `@ottocode/api`
- `@ottocode/cli`
- `@ottocode/database`
- `@ottocode/install`
- `@ottocode/sdk`
- `@ottocode/server`
- `@ottocode/web-sdk`
- `@ottocode/web-ui`

Other packages can be versioned independently. Private app/example workspaces are ignored so Changesets does not bump desktop, launcher, web, canvas, preview, landing, mobile, or example package versions as part of the CLI/package release flow. Private packages are also configured not to create tags.
