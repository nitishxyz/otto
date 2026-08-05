# Native Tool Extension Architecture

## Decision

Otto tools are native contributions in the existing plugin system.

Native extensions run with the Bun runtime embedded in the compiled Otto CLI. They do not import Otto server internals. Otto exposes a small, versioned capability context, and extension code runs in a separate process managed by the server runtime.

Built-in tools, native extension tools, and MCP tools continue to use the existing AI SDK tool adapter, persistence, streaming, approval, and event pipeline.

## Architecture

```text
Otto agent runtime
    |
    | AI SDK Tool.execute(input)
    v
Native extension client
    |
  | protocol v1 newline-delimited JSON frames
    v
otto __extension-host
    |
    +-- imports the plugin's external TypeScript/JavaScript entry
    +-- supplies the versioned Otto capability context
    +-- executes the handler with the bundled Bun runtime
  +-- streams progress frames and structured results over stdout
```

Otto keeps one host process per project/plugin pair and reuses it across calls.
Timeout, cancellation, or a host crash terminates that host, rejects its pending
calls, and allows the next call to start a clean host. Imported modules and their
in-memory state therefore persist during a healthy host lifetime.

## Plugin manifest contribution

Native tools are declared statically in `otto.plugin.json`:

```json
{
  "$schema": "https://ottocode.ai/schemas/plugin.json",
  "name": "cloud-deploy",
  "version": "1.0.0",
  "tools": [
    {
      "name": "deploy",
      "entry": "tools/deploy.ts",
      "description": "Deploy the current project",
      "inputSchema": {
        "type": "object",
        "properties": {
          "environment": {
            "type": "string",
            "enum": ["preview", "production"]
          }
        },
        "required": ["environment"],
        "additionalProperties": false
      },
    "outputSchema": {
    "type": "object",
    "properties": { "url": { "type": "string" } },
    "required": ["url"]
    },
      "effects": ["workspace-read", "process", "network", "external-write"],
    "secrets": [
    {
      "name": "deploy-token",
      "env": "DEPLOY_TOKEN"
    }
    ],
      "timeoutMs": 300000
    }
  ]
}
```

Manifest discovery is side-effect free. Code is imported only when an enabled tool is called.

Model-facing tool names are namespaced as `<plugin>__<tool>`, with unsupported characters normalized to underscores. Built-in names are therefore reserved without requiring a central collision list.

## Tool metadata and approval

Every extension tool declares its effects:

- `workspace-read`
- `workspace-write`
- `process`
- `network`
- `secrets`
- `external-write`

Native extension tools are always loadable. They never consume first-class tool
schema space before an agent explicitly loads them. Every agent can discover
installed extension tools through `load_tools`.

The tool registry attaches source, plugin, version, and effect metadata to the AI SDK tool. In `dangerous` approval mode, extension tools with any effect other than `workspace-read` require approval. Tool code cannot bypass that decision.

Future policy can add argument-aware effects and user grants without changing extension handlers.

## Author API

A native entry exports a handler function, or an object with an `execute` function:

```ts
import type { NativeToolHandler } from '@ottocode/sdk/tool-extension';

export default (async (input, context) => {
  const config = await context.workspace.readText('deploy.json');
  const result = await context.process.run({
    command: 'deploy-project',
    args: [String(input.environment)],
  });

  return {
    environment: input.environment,
    output: result.stdout,
    configLoaded: config.length > 0,
  };
}) satisfies NativeToolHandler;
```

The context contains:

- `projectRoot`, `pluginDir`, `toolName`, and `protocolVersion`;
- scoped workspace `readText`, `writeText`, and `exists` operations;
- structured process execution with a project-scoped working directory;
- `signal` for cancellation;
- `progress()` for streamed progress events;
- declared `secrets.get()` values without exposing the parent environment;
- project/plugin-scoped persistent JSON storage;
- image result creation from project files.

The manifest boundary uses JSON Schema instead of Otto's internal Zod or AI SDK
versions. Input schemas are enforced by the AI SDK before execution, and declared
output schemas are validated before a result reaches the model.

Rich results can contain text, JSON, and image content. Images are capped at 10
MiB and are converted to AI SDK image content by the standard tool adapter.

## Runtime and dependencies

The compiled Otto executable contains Bun and can dynamically import external TypeScript and JavaScript. Extension-local dependencies resolve from the plugin directory using Bun's normal module resolution.

Registry extensions should ship prebundled JavaScript unless an explicit dependency installation workflow is added. Otto must not implicitly run package lifecycle scripts while discovering or installing a tool.

## Process security

The child receives a minimal environment containing platform essentials such as `PATH`, home/temp paths, and locale variables. It does not inherit provider keys or Otto's complete environment.

The host redirects extension console output to stderr so stdout remains reserved for protocol responses.

A subprocess is an isolation and lifecycle boundary, not a security sandbox. Native Bun extensions can still call `node:fs`, `Bun.file`, or `Bun.spawn` directly. Native extensions must therefore be explicitly installed and trusted. A future untrusted marketplace tier requires an OS/container sandbox or a constrained WASM runtime.

Trust tiers are:

1. built-in tools: trusted and in-process;
2. native Bun extensions: trusted, installed, and out-of-process;
3. MCP servers: separately managed external integrations;
4. future sandboxed extensions: untrusted code in an enforceable sandbox.

## MCP relationship

Native extensions do not replace MCP.

Use native Bun tools for local, low-latency, Otto-aware functionality. Use MCP for portable integrations, existing ecosystems, external services, and non-JavaScript runtimes. Both should continue through the same agent tool adapter and approval pipeline.

## Implemented foundation

- plugin manifest `tools` contributions;
- static JSON input/output schemas;
- namespaced tool registration;
- source/effect metadata;
- isolated Bun execution using the current Otto executable;
- timeout and cancellation enforcement;
- minimal child environment;
- approval decisions based on declared effects;
- persistent per-plugin hosts with automatic restart;
- streamed progress events;
- JSON Schema output validation;
- scoped secret declarations;
- persistent plugin storage;
- rich text, JSON, and image results;
- `otto plugins validate` and `otto plugins dev` author commands.

## Follow-up

1. Add an enforceable OS/container or WASM sandbox for untrusted plugins.
2. Add plugin-contributed application UI surfaces if a concrete use case needs them.
