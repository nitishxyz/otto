# Changesets

Use Changesets to collect release notes and produce package changelogs.

## Add a changelog entry

```sh
bun changeset
```

Commit the generated `.changeset/*.md` file with the code change.

## Prepare a release changelog

```sh
bun changeset:version
```

This consumes pending changesets, bumps package versions, and updates package `CHANGELOG.md` files. Commit and push those generated changes before publishing a release.
