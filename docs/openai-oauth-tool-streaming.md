# OpenAI OAuth tool streaming

Otto defaults function tools to `strict: false` on Codex OAuth Responses
requests, for both HTTP and WebSocket transports. Explicit tool-level `strict`
settings are preserved. Tool schemas and local AI SDK input validation are
unchanged.

When `strict` is omitted, the Responses API can normalize schemas into strict
mode, making optional properties required. Otto's tools use optional fields and
defaults, so that implicit conversion does not preserve their input contract.
See the [OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling#strict-mode).

During investigation, GPT-6 Astra intermittently streamed an `update_todos`
array followed by an ongoing sequence of spaces and newlines instead of the
optional `note` or closing object. No complete tool call reached the execution
adapter. Continuous argument deltas kept the transport's between-event idle
timer alive, leaving the session displaying its initial text. Explicitly
disabling implicit strict mode avoided that loop in bounded comparison runs.
The original desktop turn did not retain raw provider events, so its exact
upstream output could not be confirmed retroactively.

Regression coverage: `bun test tests/openai-oauth-client.test.ts`. These tests
verify request normalization and first-call WebSocket streaming/execution with
the optional todo note omitted; they do not depend on live provider behavior.
