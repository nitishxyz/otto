# TUI Architecture

The terminal UI (`apps/tui`) is built on [OpenTUI](https://github.com/anomalyco/opentui) (`@opentui/core` + `@opentui/react`) and consumes the server through `@ottocode/api`.

## Module map

```text
apps/tui/src/
├── App.tsx                  composition root: wires session, stream, overlays
├── stream/
│   ├── reducer.ts           pure message reducer (unit-tested)
│   └── client.ts            SSE connect + message/queue/secure-input loaders
├── commands/
│   ├── registry.ts          slash command list, aliases, parseCommand
│   ├── dispatcher.ts        executeCommand(name, args, CommandContext)
│   └── index.ts
├── hooks/
│   ├── useSession.ts        session CRUD + prefs via @ottocode/api
│   ├── useStream.ts         SSE subscription; dispatches into the reducer
│   ├── useGlobalKeymap.ts   app-level shortcuts, escape/abort handling
│   ├── useConfig.ts         server config defaults
│   └── useFileAttachments.ts
├── components/              ChatView, MessageItem, ToolCallItem, ChatInput,
│                            StatusBar, overlays (all overlays use ModalFrame)
├── stores/overlay.ts        zustand: overlay routing + status indicator
├── lib/clipboard.ts         clipboard + web session URL helpers
└── theme/                   theme context; palettes come from @ottocode/themes
```

## Conventions

- **Reducer stays pure.** All SSE message-state transitions live in
  `stream/reducer.ts` and are covered by `tests/tui-stream-reducer.test.ts`.
  Transport concerns (fetching, SSE) live in `stream/client.ts`.
- **Commands go through the dispatcher.** New slash commands are added to
  `commands/registry.ts` (name, alias, description) and handled in
  `commands/dispatcher.ts` with an explicit `CommandContext`. Unknown
  commands are forwarded to the server as `/name args` messages.
- **Keyboard precedence.** `useGlobalKeymap` owns global chords; `ChatInput`
  and overlays own their local keys. Secure-input prompts block everything
  except Ctrl+C.
- **Streaming perf.** `MessageItem` is memoized per message; while a text
  part streams, only completed lines run through the markdown parser and the
  trailing partial line renders as plain text.
- **Rendering.** Use native OpenTUI renderables where available (`<diff>`,
  `<ascii-font>`, `<scrollbox>` with sticky scroll). The markdown renderer in
  `components/Markdown.tsx` is a deterministic synchronous parser used
  instead of OpenTUI's tree-sitter markdown (unreliable in bundled builds).

## Commands

- Dev: `bun run --filter @ottocode/tui dev`
- Build: `bun run --filter @ottocode/tui build` (bundles with
  `--external '@opentui/core-*'` so native binaries resolve at runtime)
- Tests: `bun test tests/tui-stream-reducer.test.ts`
