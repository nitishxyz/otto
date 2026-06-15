# Custom Declarative Providers PRD

## Problem

otto currently supports a fixed set of built-in providers. Adding a new provider requires touching multiple hardcoded codepaths:

- provider ID/type definitions
- config defaults and env mapping
- SDK model resolution
- server runtime model resolution
- model validation
- prompt family selection
- reasoning-option routing
- config/UI provider discovery

This makes self-hosted or user-defined providers awkward to support, even when they speak a compatible protocol such as OpenAI-compatible, Anthropic-compatible, or Google-compatible APIs.

## Goal

Allow users to define additional providers declaratively in config while preserving otto's existing built-in provider behavior and compatibility guarantees.

Examples:

- local Ollama
- self-hosted vLLM / LiteLLM
- private gateway over Tailscale
- internal company inference proxy

## Non-goals

- arbitrary code execution from config
- arbitrary npm package loading from config
- custom protocol adapters in v1
- bespoke OAuth flows for custom providers
- per-provider request/response transforms in v1

## Principles

1. **Declarative, not executable**
   - Config describes provider identity and wiring.
   - Runtime code owns behavior.

2. **Compatibility-driven**
   - Provider behavior should derive from a small set of supported protocol/compatibility targets.

3. **Built-ins remain first-class**
   - Existing providers keep their current OAuth, auth, model catalogs, and routing behavior.

4. **Custom providers should feel native**
   - They should participate in provider selection, authorization, model resolution, prompt family selection, and model validation.

## User Stories

### 1. Local Ollama

As a user, I want to point otto at a local Ollama endpoint so I can run coding agents against local models.

### 2. Self-hosted OpenAI-compatible gateway

As a user, I want to define a provider with a custom base URL and API key env var so otto can use my private gateway.

### 3. Tailscale-hosted inference box

As a user, I want to configure a provider that points to a Tailscale hostname and have otto treat it like a normal provider.

### 4. Static-model custom provider

As a user, I want to enumerate a fixed set of models for a custom provider so the UI and validation are predictable.

## Proposed Solution

Introduce a **provider definition registry** inside the SDK/server runtime.

The registry will normalize:

- built-in providers
- custom declarative providers from config

into one runtime definition shape.

### Provider compatibility targets

Custom providers must declare one of:

- `openai`
- `anthropic`
- `google`
- `openrouter`
- `openai-compatible`

### Provider family / prompt family

Custom providers may optionally declare a family used for prompts and behavior:

- `openai`
- `anthropic`
- `google`
- `kimi`
- `minimax`
- `glm`
- `openai-compatible`

If omitted, family defaults from compatibility.

## Config Shape

### Built-in provider override

```json
{
  "providers": {
    "openai": {
      "enabled": true,
      "baseURL": "https://my-openai-proxy.internal/v1"
    }
  }
}
```

### Custom provider

```json
{
  "defaults": {
    "provider": "my-ollama",
    "model": "qwen2.5-coder:14b"
  },
  "providers": {
    "my-ollama": {
      "enabled": true,
      "custom": true,
      "label": "Local Ollama",
      "compatibility": "openai-compatible",
      "family": "openai-compatible",
      "baseURL": "http://127.0.0.1:11434/v1",
      "models": ["qwen2.5-coder:14b", "deepseek-r1:32b"],
      "allowAnyModel": false
    }
  }
}
```

### Tailscale provider

```json
{
  "providers": {
    "gpu-box": {
      "enabled": true,
      "custom": true,
      "label": "GPU Box",
      "compatibility": "openai-compatible",
      "baseURL": "http://gpu-box.tailnet.ts.net:11434/v1",
      "allowAnyModel": true
    }
  }
}
```

## Data Model

### Config-level provider settings

Each provider entry should support:

- `enabled`
- `custom`
- `label`
- `compatibility`
- `family`
- `baseURL`
- `apiKey`
- `apiKeyEnv`
- `models`
- `allowAnyModel`
- `modelDiscovery` (future-friendly)

### Runtime provider definition

Normalized runtime fields:

- `id`
- `label`
- `source` (`built-in` or `custom`)
- `compatibility`
- `family`
- `baseURL`
- `apiKey`
- `apiKeyEnv`
- `models`
- `allowAnyModel`

## Behavior

### Authorization

- Built-ins continue using existing auth/env flows.
- Custom providers are authorized when:
  - they define no auth requirement, or
  - an API key is supplied via config or env.

### Model resolution

- Built-ins keep current specialized logic.
- Custom providers route through generic constructors by compatibility target.

### Validation

- If `models` is provided, validation enforces membership.
- If `allowAnyModel` is true, any non-empty model string is allowed.
- `modelDiscovery` is reserved for a follow-up to dynamically fetch `/models`.

### Reasoning and prompt behavior

- Custom providers should use their configured `family`.
- Reasoning options should map by compatibility/family, not by provider name alone.

## Implementation Plan

### Phase 1 — Foundations

- widen provider config to support custom entries
- add provider compatibility/family types
- introduce runtime provider registry helpers
- support custom provider auth + validation + selection
- support generic custom provider model resolution

### Phase 2 — Surface area

- expose custom providers in config/provider routes
- expose custom models in config/model routes
- update OpenAPI + SDK generation
- add docs/examples for Ollama and Tailscale

### Phase 3 — Discovery

- add optional `modelDiscovery`
- support standard `/models` discovery flows for compatible providers
- cache discovered models where appropriate

## Risks

1. **Type widening from fixed provider IDs to configured provider IDs**
   - Mitigation: keep explicit built-in provider helpers and introduce normalized provider-definition helpers.

2. **Behavior drift for built-ins**
   - Mitigation: preserve existing specialized built-in paths and use generic logic for custom providers only.

3. **UI/API assumptions about enum-based provider IDs**
   - Mitigation: phase route/OpenAPI changes after registry foundations land.

## Acceptance Criteria

1. Users can define a custom provider in `.otto/config.json`.
2. A custom provider can be selected as the default provider.
3. The runtime can resolve a model for a custom provider via declared compatibility.
4. Custom providers can specify static model lists or allow arbitrary model IDs.
5. Built-in providers continue to work unchanged.
6. No arbitrary code/package loading is required from config.
