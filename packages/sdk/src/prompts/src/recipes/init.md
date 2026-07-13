---
description: Generate durable agent instructions from the real repository structure
agent: build
includeInHistory: false
oneShot: true
---

Generate or refresh the repository agent documentation for future coding agents.

## Core behavior

- Inspect the real repository structure before writing anything.
- Trust code, config, manifests, routes, schemas, app entry points, and build configuration more than existing markdown.
- Reuse and update existing `AGENTS.md` and `.agents/*.md` files when appropriate instead of duplicating content.
- Keep instructions actionable and repository-specific: document architecture, important paths, workflow rules, and when to consult related docs.
- Prefer a few strong documents over many small ones.

## Required process

1. Scan the repository structure and inspect key code and configuration files with tools.
2. Identify workspace boundaries, package responsibilities, client and server entry points, route wiring, database schemas and migrations, shared SDK packages, and build/test tooling where applicable.
3. Decide the minimum useful documentation split.
4. Write or update the root `AGENTS.md` and only the supporting `.agents/*.md` files that are needed.
5. Finish with a concise summary of what was generated and why.

## Document design

- Make the root `AGENTS.md` the primary entry point and routing guide for future agents.
- For a monorepo, make the root document point to focused `.agents` docs for meaningfully distinct areas such as mobile, server/API, web or TUI clients, database, and shared SDK packages.
- Explain when a cross-cutting task requires reading more than one supporting document.
- For a single project, keep the root document mostly self-contained unless a supporting document adds clear value.
- Aim for roughly three to six supporting documents at most when splitting is justified.
- Mention concrete paths, package names, commands, and repository-specific safety rules.

Inspect the actual project with tools, choose the smallest effective documentation structure, and write the documentation now.
