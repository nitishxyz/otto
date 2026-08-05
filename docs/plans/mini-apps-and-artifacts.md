# Mini Apps and Artifacts

> Status: implementation started; initial Artifact and Mini App runtime slices available
>
> This document records the direction discussed for generated visual artifacts,
> reusable Mini Apps, plugin distribution, agent access, and optional publishing.
> It is not a commitment to a specific hosting stack.

## Current Implementation Slice

The first vertical slice establishes the application contract without yet
introducing arbitrary dependency installation or hosted publishing:

- a dedicated `artifact` agent tool for explicitly requested conversational outputs;
- ephemeral TSX compilation into immutable project-local cache revisions;
- a curated Artifact runtime with Otto layout primitives, React, Motion, and Lucide;
- inline sandboxed Artifact rendering without exposing generated source as chat text;
- strict `app.json` validation for the `otto-react` runtime;
- source-tree hashing and stable revision descriptors;
- a lazy `mini_app` agent tool that validates or builds project-local packages;
- embedded Bun compilation for React, Motion, Lucide icons, CSS, and assets;
- a curated bare-package import boundary;
- immutable project-local build output and daemon preview routes;
- localhost-only external preview URLs;
- first-class Mini App cards in chat;
- a dedicated preview tab using a sandboxed iframe without same-origin access.

Installation scopes, storage, capabilities, revisions in the database, plugins,
advanced dependencies, and publishing remain future phases described below.

## Summary

Otto should let users create visual and interactive software through conversation.
The same underlying system can support several outcomes:

- a one-off chart, report, diagram, or interactive visualization;
- a reusable Mini App inside Otto;
- a project-specific or globally installed personal tool;
- an app contributed by an Otto plugin;
- a public app published to Otto-hosted services;
- an exported application that the user owns and develops normally.

The central product opportunity is larger than rendering generated HTML:

> Users can build small interfaces for their data, projects, integrations, and
> agent workflows, then keep them private, install them globally, package them as
> plugins, or publish selected apps.

Mini Apps should be first-class applications with identity, permissions,
storage, lifecycle, versions, and typed Otto capabilities. They may compile to
HTML, JavaScript, and CSS, but an `index.html` file is build output rather than
the Mini App model.

## Product Vocabulary

The distinction is intentional, and neither category replaces normal user work.
Ordinary requests to build websites, apps, components, dashboards, or scripts
are implemented normally in the current project. Artifacts are explicitly
conversation-native outputs; Mini Apps are explicitly installed, reusable Otto
extensions. Existing project work or an Artifact may be promoted later, but
Forge documentation never overrides user intent.

### Artifact

A substantial, self-contained output created during a conversation.

Artifacts use the `otto-react-artifact` runtime. The agent submits a TSX module
to the `artifact` tool, which compiles it against React, Motion, Lucide, and the
`@otto/artifact` primitive library. Otto persists the immutable compiled
revision in cache and stores only its descriptor in the message. Raw HTML is a
legacy fallback, not the authoring contract.

The primitive library includes `Artifact`, `Header`, `Section`, `Card`, `Grid`,
`Stack`, `Split`, `Metric`, `Badge`, `Button`, `Progress`, `Callout`, `List`,
`ListItem`, `BarChart`, and `Divider`. It ships with `studio`, `aurora`, `paper`,
and `terminal` themes; `violet`, `blue`, `cyan`, `emerald`, `amber`, and `rose`
accents; and compact or comfortable density. The tool description carries the
same component reference, composition rules, and a canonical dashboard example
so generated work starts from an Otto-owned visual system instead of inventing
ad hoc nested cards and raw CSS.

Standard controls should use runtime components. Artifact-specific CSS remains
available for genuinely custom visualizations, but it should not restyle the
runtime primitives. In particular, `Metric` owns its own surface and must not be
wrapped in `Card`; sections should stay compact enough to make the first viewport
useful.

Examples:

- document;
- chart or data visualization;
- diagram;
- landing-page draft;
- interactive report;
- generated application draft.

Artifacts can be viewed, revised, downloaded, exported, or promoted into a
reusable Mini App.

### Mini App

A versioned interactive application that runs inside Otto. A Mini App has:

- a stable identity and manifest;
- source modules and assets;
- an installation scope;
- declared permissions and capabilities;
- application storage;
- lifecycle and navigation;
- optional agent-usable actions;
- immutable revisions and builds.

### Plugin

An installable package of Otto capabilities. A plugin may contribute:

- Mini Apps;
- tools and typed actions;
- agents;
- skills;
- recipes;
- commands;
- MCP servers;
- integrations.

A Mini App can exist independently or be packaged as part of a plugin when it
needs custom host-side capabilities or should be distributed to others.

### Published App

A selected immutable Mini App revision deployed to Otto-hosted services. Public
app publishing and plugin publishing are different operations with different
security boundaries.

## Why This Fits Otto

Otto already operates where users do work: projects, files, Git, terminals,
agents, tools, sessions, plugins, integrations, and local runtime services.
Mini Apps provide a visual layer over those capabilities.

A recurring conversational workflow can become a reusable interface:

```text
Repeated conversation or commands
              ↓
"Turn this into a Mini App"
              ↓
Inputs, actions, progress, and structured results
              ↓
Reuse manually or ask an agent to operate it
```

This creates a feedback loop:

```text
Agent builds Mini App
        ↓
User operates Mini App
        ↓
Mini App starts visible agent work
        ↓
Agent invokes app capabilities
        ↓
Mini App presents the result
```

The differentiator is not merely that Otto generates React. It is that users can
create interfaces over Otto and their own tools without losing the transparency,
approvals, and project ownership of the normal Otto workflow.

## Example Use Cases

### GitHub PR Explorer

A global or project-aware app that shows:

- repositories and open pull requests;
- changed files and review comments;
- CI and merge status;
- related issues;
- agent-generated summaries and risk findings.

Actions can include reviewing a PR, checking out its branch, producing a test
plan, drafting a review, or opening a visible agent session to investigate it.
GitHub credentials remain in Otto's integration layer and are never exposed to
the app's browser code.

### Project Command Center

A project-scoped app that combines:

- branch and working-tree state;
- tests, lint, typecheck, and build actions;
- recent failures;
- project tasks;
- release readiness;
- recent agent activity.

### Simulator or Emulator Launcher

A global app that can list devices, save launch presets, boot devices, install
and launch apps, open deep links, display logs, and capture screenshots. It can
be a richer interface over first-party or plugin-provided simulator
capabilities.

### Docker Workbench

A global or project app for:

- images, containers, and Compose services;
- ports, volumes, health checks, and logs;
- start, stop, restart, build, and open-port actions;
- sending a selected error or unhealthy service to an agent.

Generated UI code must not receive direct Docker socket or unrestricted shell
access. It invokes validated host actions through Otto.

### Data Explorer

Given CSV, JSON, a database query, or an API response, Otto can create an app
with filters, tables, charts, summaries, grouping, export, and a structured
selection that can be attached to chat.

### Release Manager

A project app that models the repository's release process, runs checks,
prepares changelogs and versions, shows pending outputs, and stops for approval
before consequential actions.

### Other Examples

- API playground;
- database explorer;
- model and prompt comparison tool;
- research board;
- incident dashboard;
- content workflow;
- forms and internal tools;
- calculators, quizzes, invitations, and small games;
- agent workflow control panels.

## Scopes

Mini Apps should support explicit installation scopes.

### Session

Temporary output associated with one conversation. Suitable for a one-time data
explorer or investigation view.

### Project

Available when a particular Otto project is active. Project apps can be stored
in project configuration or Otto-managed project state depending on whether the
user wants them committed and shared.

Conceptual source location:

```text
<project>/.otto/apps/<app-id>/
```

### Global

Available across projects or without an active project.

Conceptual source location:

```text
~/.config/otto/apps/<app-id>/
```

A global app may still consume the active project as optional context. A GitHub
browser can show all repositories globally and narrow to the active repository
when opened from a project.

### Plugin-Contributed

Installed with a project- or globally scoped plugin. Plugin ownership is not a
new app scope; it identifies the package that supplies the app and its optional
host-side capabilities.

### Published

An immutable deployment to hosted services. This is never the default. Local and
private use must work without publication.

## Application Model

A Mini App should be source plus a manifest, not a standalone HTML document.

```text
github-pr-explorer/
├── app.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   ├── components/
│   └── styles.css
├── assets/
└── package.json        # only when advanced dependencies are required
```

An initial manifest could resemble:

```json
{
  "$schema": "otto://schemas/mini-app/v1",
  "schemaVersion": 1,
  "id": "github-pr-explorer",
  "name": "GitHub PR Explorer",
  "description": "Browse and review GitHub pull requests",
  "runtime": "otto-react",
  "entry": "src/main.tsx",
  "availability": {
    "global": true,
    "project": true,
    "requiresProject": false
  },
  "permissions": [
    "github.pullRequests.read",
    "agents.start"
  ],
  "capabilities": [
    "github.pullRequests.list",
    "github.pullRequests.get",
    "agents.start"
  ],
  "placements": [
    "apps",
    "commandPalette"
  ]
}
```

The manifest supplies the identity and boundaries that a raw webpage lacks.

## Runtime and Dependency Strategy

### Default Curated Runtime

Most apps should use an opinionated `otto-react` runtime with managed,
versioned dependencies such as:

- React and TypeScript;
- Motion;
- Otto UI primitives and themes;
- icons;
- charts and data tables;
- selected date and utility libraries.

Otto can compile lightweight app source through Bun build APIs already available
inside the Otto process. This path should not require a separate `node_modules`
directory for each app or a system Bun installation.

Dependencies should be resolved from a curated, content-addressed package store
and exact runtime version. Each revision records its dependency and runtime
fingerprints.

### Extended Bun Runtime

A full Bun toolchain is useful when an app needs:

- arbitrary npm dependencies;
- a conventional package workspace;
- custom package scripts;
- framework-specific build behavior;
- server-side Bun code;
- export as a standalone repository.

Users should still not have to install Bun manually. Otto can download a pinned
standalone Bun runtime on first advanced use and cache it once per machine. This
avoids increasing the default Otto binary by roughly the size of another Bun
executable while preserving a zero-setup experience.

### Workspace Model for Advanced Apps

If full package management is required, use one Bun workspace per Otto project
and one package per app:

```text
<otto-project-state>/artifacts/
├── package.json
├── bun.lock
├── node_modules/
├── apps/
│   ├── github-pr-explorer/
│   └── release-manager/
└── shared/
    ├── ui/
    └── theme/
```

Development dependencies can be shared locally, while each app remains an
independent build and deployment unit. Publishing one app uploads only its
immutable compiled output and never uploads the workspace's `node_modules` or
other apps.

## Otto Host Bridge

Mini Apps run as isolated browser applications and communicate with Otto through
a typed RPC bridge. They do not import Otto server internals.

Conceptual SDK:

```ts
const context = await otto.context.get();
const pullRequests = await otto.github.pullRequests.list({ repository });

await otto.agents.start({
  task: "Review this pull request",
  context: { repository, pullRequestNumber }
});
```

Potential capability groups include:

```text
context     project and current UI context
project     project metadata and declared actions
files       constrained file operations
git         repository state and operations
sessions    visible Otto sessions
agents      start or navigate to agent work
storage     app/project/user state
actions     validated host actions
integrations GitHub and other authenticated services
docker      plugin or first-party Docker operations
simulator   simulator and emulator operations
notifications host notifications
```

The bridge should use schemas for inputs and outputs and map each call to an
explicit permission and approval policy.

## Agent-Usable Apps

Mini Apps should be agent-usable, but agents should normally invoke structured
capabilities rather than visually clicking through the app.

A Mini App package can contain:

```text
Mini App
├── views       human-facing interfaces
├── actions     operations available to UI and eligible agents
└── resources   structured information agents can inspect
```

The UI and agent should call the same underlying action. Business logic must not
exist only inside React click handlers.

Example action declaration:

```json
{
  "id": "github.pullRequests.merge",
  "title": "Merge pull request",
  "description": "Merge an approved pull request",
  "agentUsable": true,
  "readOnly": false,
  "approval": "always",
  "permissions": ["github.pullRequests.write"]
}
```

Only actions explicitly marked `agentUsable` are exposed to agents. Actions
should load lazily by app or namespace so installed apps do not add every schema
to every model request.

### App to Agent

A user can select a PR, container, device, record, or error and choose `Ask
Otto`. The app starts or enriches a normal visible session with compact,
structured context.

### Agent to App

An agent can ask Otto to open an app at a route or focus a resource. Presentation
is separate from privileged action execution.

### Selection Context

Apps publish a compact selection object rather than exposing all internal state:

```ts
otto.context.setSelection({
  type: "pull-request",
  label: "PR #42: Fix session sharing",
  data: {
    repository: "ottocode/otto",
    number: 42,
    selectedFile: "packages/server/src/runtime/share/service.ts"
  }
});
```

This makes prompts such as "Why is this failing?" useful without bloating model
context or leaking unrelated state.

## Permissions and Security

Generated app code is untrusted UI code. The app runs in a sandboxed iframe on
an isolated origin and communicates only through the Otto bridge.

It must not receive:

- Otto authentication tokens;
- provider or integration credentials;
- inherited environment secrets;
- unrestricted filesystem access;
- unrestricted shell or terminal access;
- direct Docker socket access;
- direct host process access.

Each action declares:

- input and output schemas;
- required permissions;
- whether it is read-only;
- whether agents can use it;
- approval policy;
- platform and scope availability.

Consequential actions such as merging pull requests, deleting volumes,
publishing releases, or changing external resources require explicit approval.
A Mini App cannot bypass the approval required by an equivalent tool call.

The existing shell and terminal tools are host execution, not security
sandboxes. They must not be treated as the isolation boundary for generated
apps.

## Persistence

The initial storage API should be a constrained JSON/document model rather than
arbitrary database access:

```ts
await otto.storage.app.set("filters", filters);
await otto.storage.project.set("release-config", config);
await otto.storage.user.set("favorite-repositories", repositories);
```

Potential scopes:

- instance: one mounted app instance;
- app: all instances of one app installation;
- project: this app in the active project;
- user: this app across projects;
- hosted personal/shared/owner scopes in a later publishing phase.

Storage access is namespaced by app identity and installation scope.

## Plugin Integration

Mini Apps should become a plugin contribution alongside the capabilities already
described in `docs/plans/plugin-capabilities-and-commands.md`.

```text
Plugin
├── Mini Apps
├── tools/actions
├── agents
├── skills
├── recipes
├── commands
├── MCP servers
└── integrations
```

A conceptual plugin layout:

```text
github-workbench/
├── plugin.json
├── apps/
│   └── pr-explorer/
│       ├── app.json
│       └── src/
├── capabilities/
├── agents/
├── skills/
└── recipes/
```

A private standalone app can be promoted to a plugin when it needs custom
host-side code or distribution:

```text
Private Mini App
      ↓
Generate plugin manifest and capability boundaries
      ↓
Validate permissions and package contents
      ↓
Install locally or publish to a plugin registry
```

Plugin updates that request new permissions require renewed approval.

## Publishing

Publishing has two distinct meanings.

### Publish as a Web App

Compile a selected immutable revision and host it as browser assets through Otto
services. Suitable for calculators, invitations, visualizations, forms, and
hosted AI or data apps.

The deployment contains only the selected app's production output. It does not
contain other apps, local source workspaces, or `node_modules`.

Local capabilities are unavailable on a normal public website unless Otto
provides an authenticated, explicitly authorized connection to a running Otto
instance. A public Docker manager cannot silently operate a viewer's local
machine.

### Publish as a Plugin

Package the Mini App with its manifests, capabilities, tools, agents, skills,
and permission declarations for installation in Otto. This is the appropriate
path for GitHub workbenches, simulator launchers, Docker managers, and local
workflow tools.

### Export

Users should always be able to download source, export a full project, or copy
the app into an active repository. Otto-hosted publishing must not become a
lock-in requirement.

## Revisions and Builds

The app is a stable object with immutable revisions:

```text
Mini App
├── revision 1
├── revision 2
└── revision 3       current draft

Publication
└── revision 2       current live deployment
```

Each revision should record:

- source hash;
- manifest and capability versions;
- runtime version;
- exact dependency resolution;
- build hash;
- originating message part or agent work where applicable.

A publication stores compiled output and never rebuilds on each request.

## User Experience

There is no separate Canvas product assumption. Mini Apps and visual artifacts
should integrate into Otto's existing chat and viewer surfaces.

Suggested flow:

1. Otto creates an artifact during chat.
2. Chat shows a lightweight artifact/app card rather than mounting an active
   iframe in every message.
3. Opening it launches an Artifact or Mini App panel beside chat, or full-screen
   on constrained screens.
4. The user interacts, selects elements or data, edits source, and asks Otto for
   changes.
5. Revisions remain navigable and restorable.
6. The user can save the app to project or global scope, package it as a plugin,
   export it, or publish a selected revision.

The panel can eventually provide preview, source, versions, responsive sizing,
permissions, data, logs, and publishing state.

## Forge and Self-Authoring

Otto should use Forge as the authoritative authoring and discovery control plane
for Mini Apps and plugins. Forge manages recipes, skills, agents, MCP servers,
plugin commands, and local version-matched documentation. The documentation
registry now includes the shipped Mini App manifest, curated runtime, build
workflow, and security boundary. Forge does not yet create or mutate apps.

Conceptual requests:

```ts
forge({ action: "docs", kind: "skill", topic: "getting-started" });
forge({ action: "docs", kind: "plugin", topic: "manifest" });
forge({ action: "docs", kind: "app", topic: "permissions" });
```

No-topic calls should list available topics. Documentation should be a small,
structured local registry with concise guides, references, and working examples.
It should never read arbitrary filesystem paths or return an unbounded repository
dump.

Forge also needs capability discovery before generated apps can safely target
the host:

```ts
forge({
  action: "capabilities",
  kind: "app",
  query: "GitHub pull requests"
});
```

The returned catalog should describe actual installed capabilities, schemas,
permissions, risk, platform availability, and whether each capability is usable
by apps or agents.

Longer-term Forge responsibilities can include:

- app and plugin scaffolding;
- validation;
- packaging;
- permission review;
- installation and scope changes;
- publishing.

Build, preview, logs, reload, and process lifecycle may remain in a focused app
runtime tool rather than turning Forge into an unstructured execution tool.

## Documentation and Contract Generation

Mini App documentation, SDK types, runtime validation, agent schemas, and
permission descriptions should derive from the same typed capability contracts
where possible.

A capability definition should include:

- stable ID and description;
- Zod input and output schemas;
- permissions;
- risk/read-only metadata;
- app and agent availability;
- approval policy;
- examples.

From this definition Otto can generate:

- host runtime validation;
- Mini App SDK types;
- agent tool schemas;
- Forge capability search results;
- API reference documentation;
- permission prompts.

This reduces drift and lets Otto reliably build extensions for its own installed
version.

## Suggested Delivery Phases

### Phase 1: Visual Artifacts

- Lightweight compiled React artifacts; raw HTML is not the primary contract.
- Curated React, Motion, charts, icons, and Otto UI runtime.
- Sandboxed preview in the existing Otto interface.
- Source and rendered modes.
- Version history and error-to-chat repair.
- Download/export.

### Phase 2: Local Mini Apps

- Mini App manifest and runtime.
- Project and global installation scopes.
- Namespaced app storage.
- A small set of read-only Otto capabilities.
- Structured selection and `Ask Otto`.
- Validated app actions used by UI buttons.

### Phase 3: Agent and Plugin Integration

- Lazy agent discovery of app actions.
- Structured resources.
- Agent-to-app navigation.
- Plugin-contributed Mini Apps and host capabilities.
- Forge documentation, capability discovery, scaffolding, and validation.

### Phase 4: Publishing

- Immutable static app deployments.
- Public URLs, metadata, unpublish, and rollback.
- Plugin packaging and registry distribution.
- Hosted forms, storage, authentication, and controlled AI capabilities.

### Phase 5: Advanced Hosting

- Server functions and secrets.
- Webhooks and scheduled tasks.
- Team ownership and shared state.
- Custom domains, quotas, analytics, and billing controls.

Arbitrary public Bun servers should not be an initial requirement. Static builds
plus controlled hosted capabilities can support many useful small apps with a
smaller security and operational surface.

## Initial Validation Apps

A first implementation should validate the platform against four representative
apps:

1. **Data Explorer** validates generated UI, charts, local data, selection, and
   export.
2. **Project Command Center** validates project context, actions, approvals, and
   project scope.
3. **GitHub PR Explorer** validates global/project context, OAuth integrations,
   structured agent actions, and plugin distribution.
4. **Simulator Launcher or Docker Workbench** validates privileged local
   capabilities, logs, lifecycle, and explicit approvals.

## Product Principles

- Local and private by default; publishing is explicit.
- An app is a first-class object, not a raw HTML file.
- Humans and agents share typed actions rather than duplicating logic.
- Generated UI never receives raw secrets or unrestricted host access.
- Project and global scopes are equally important.
- Plugins are the reusable distribution envelope; standalone apps remain useful.
- Curated dependencies provide an instant path; a managed Bun runtime enables
  advanced projects without requiring user installation.
- Each app builds and deploys independently.
- Users can export source and leave the hosted platform.
- Start with narrow, reliable capabilities rather than a general low-code
  platform or arbitrary server hosting.

## Open Decisions

- Whether `Artifact` remains visible terminology or is primarily an internal
  model beneath `Mini App` and document/visualization labels.
- Exact placement and navigation for project and global apps in the existing UI.
- Whether project app source lives in `.otto/apps` or Otto-managed project state
  by default.
- Initial curated dependency catalog and versioning policy.
- Initial capability bridge surface and permission vocabulary.
- Whether the first plugin app contribution ships before or after standalone
  global apps.
- Hosted service, retention, abuse, and billing model for public apps.
- How organization-scoped apps and plugins should be distributed and governed.
