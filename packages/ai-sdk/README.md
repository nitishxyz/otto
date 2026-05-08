# @ottorouter/ai-sdk

A drop-in SDK for accessing AI models (OpenAI, Anthropic, Google, Moonshot, MiniMax, Z.AI) through the [OttoRouter](https://github.com/slashforge/ottorouter) proxy with automatic x402 payments via Solana USDC.

All you need is a Solana wallet — the SDK handles authentication, payment negotiation, and provider routing automatically.

Normal API requests use bearer auth. The SDK signs a wallet nonce once to exchange for a short-lived OttoRouter token, reuses that token across requests, and refreshes it automatically when needed.

## Install

```bash
bun add @ottorouter/ai-sdk ai
# or
npm install @ottorouter/ai-sdk ai
```

## Quick Start

```ts
import { createOttoRouter } from "@ottorouter/ai-sdk";
import { generateText } from "ai";

const ottorouter = createOttoRouter({
  auth: { privateKey: process.env.SOLANA_PRIVATE_KEY! },
});

const { text } = await generateText({
  model: ottorouter.model("claude-sonnet-4-20250514"),
  prompt: "Hello!",
});

console.log(text);
```

The SDK auto-resolves which provider to use based on the model name. It returns ai-sdk compatible model instances that work directly with `generateText()`, `streamText()`, etc.

Under the hood, the first protected request exchanges wallet auth headers for a bearer token via `POST /v1/auth/wallet-token`. Subsequent requests reuse `Authorization: Bearer <token>` until refresh is needed.

## Provider Auto-Resolution

Models are resolved to providers by prefix:

| Prefix                             | Provider  | API Format  |
| ---------------------------------- | --------- | ----------- |
| `claude-`                          | Anthropic | Messages    |
| `gpt-`, `o1`, `o3`, `o4`, `codex-` | OpenAI    | Responses   |
| `gemini-`                          | Google    | Native      |
| `kimi-`                            | Moonshot  | OpenAI Chat |
| `MiniMax-`                         | MiniMax   | Messages    |
| `z1-`                              | Z.AI      | OpenAI Chat |

```ts
ottorouter.model("claude-sonnet-4-20250514"); // → anthropic
ottorouter.model("gpt-4o"); // → openai
ottorouter.model("gemini-2.5-pro"); // → google
ottorouter.model("kimi-k2"); // → moonshot
```

## Explicit Provider

Override auto-resolution when needed:

```ts
const model = ottorouter.provider("openai").model("gpt-4o");
const model = ottorouter
  .provider("anthropic", "anthropic-messages")
  .model("claude-sonnet-4-20250514");
```

## Configuration

```ts
const ottorouter = createOttoRouter({
  // Required: Solana wallet private key (base58)
  auth: { privateKey: "..." },

  // Optional: OttoRouter API base URL (default: https://api.ottorouter.org)
  baseURL: "https://api.ottorouter.org",

  // Optional: Solana RPC URL (default: https://api.mainnet-beta.solana.com)
  rpcURL: "https://api.mainnet-beta.solana.com",

  // Optional: Payment callbacks
  callbacks: {
    /* see Payment Callbacks */
  },

  // Optional: Cache configuration
  cache: {
    /* see Caching */
  },

  // Optional: Payment options
  payment: {
    /* see Payment Options */
  },

  // Optional: Custom model→provider mappings
  modelMap: {
    "my-custom-model": "openai",
  },

  // Optional: Register custom providers
  providers: [
    {
      id: "my-provider",
      apiFormat: "openai-chat",
      modelPrefix: "myp-",
    },
  ],
});
```

## Payment Callbacks

Monitor and control the payment lifecycle:

Request authentication and payment signing are separate: bearer auth is used for normal OttoRouter HTTP requests, while your wallet still signs the x402 payment transaction during topups.

```ts
const ottorouter = createOttoRouter({
  auth: { privateKey: "..." },
  callbacks: {
    // Called when a 402 is received and payment is needed
    onPaymentRequired: (amountUsd, currentBalance) => {
      console.log(`Payment required: $${amountUsd}`);
    },

    // Called when the SDK is signing a transaction
    onPaymentSigning: () => {
      console.log("Signing payment...");
    },

    // Called after successful payment
    onPaymentComplete: ({ amountUsd, newBalance, transactionId }) => {
      console.log(`Paid $${amountUsd}, balance: $${newBalance}`);
    },

    // Called on payment failure
    onPaymentError: (error) => {
      console.error("Payment failed:", error);
    },

    // Called after each request with cost info (streaming & non-streaming)
    onBalanceUpdate: ({
      costUsd,
      balanceRemaining,
      inputTokens,
      outputTokens,
    }) => {
      console.log(`Cost: $${costUsd}, remaining: $${balanceRemaining}`);
    },

    // Optional: interactive approval before payment
    onPaymentApproval: async ({ amountUsd, currentBalance }) => {
      // return 'crypto' to pay, 'fiat' for fiat flow, 'cancel' to abort
      return "crypto";
    },
  },
});
```

## Payment Options

```ts
const ottorouter = createOttoRouter({
  auth: { privateKey: "..." },
  payment: {
    // 'auto' (default) — pay automatically
    // 'approval' — call onPaymentApproval before each payment
    topupApprovalMode: "auto",

    // Auto-pay without approval if wallet USDC balance >= threshold
    autoPayThresholdUsd: 5.0,

    // Max retries for a single API request (default: 3)
    maxRequestAttempts: 3,

    // Max total payment attempts per wallet (default: 20)
    maxPaymentAttempts: 20,
  },
});
```

## Caching

### Anthropic Cache Control

By default, the SDK automatically injects `cache_control: { type: 'ephemeral' }` on the first system block and the last message for Anthropic models. This saves ~90% on cached token costs.

```ts
// Default: auto caching (1 system + 1 message breakpoint)
createOttoRouter({ auth });

// Disable completely
createOttoRouter({ auth, cache: { anthropicCaching: false } });

// Manual: SDK won't inject cache_control — set it yourself in messages
createOttoRouter({ auth, cache: { anthropicCaching: { strategy: "manual" } } });

// Custom breakpoint count and placement
createOttoRouter({
  auth,
  cache: {
    anthropicCaching: {
      systemBreakpoints: 2, // cache first 2 system blocks
      systemPlacement: "first", // 'first' | 'last' | 'all'
      messageBreakpoints: 3, // cache last 3 messages
      messagePlacement: "last", // 'first' | 'last' | 'all'
    },
  },
});

// Full custom transform
createOttoRouter({
  auth,
  cache: {
    anthropicCaching: {
      strategy: "custom",
      transform: (body) => {
        // modify body however you want
        return body;
      },
    },
  },
});
```

| Option               | Default       | Description                                       |
| -------------------- | ------------- | ------------------------------------------------- |
| `strategy`           | `'auto'`      | `'auto'`, `'manual'`, `'custom'`, or `false`      |
| `systemBreakpoints`  | `1`           | Number of system blocks to cache                  |
| `messageBreakpoints` | `1`           | Number of messages to cache                       |
| `systemPlacement`    | `'first'`     | Which system blocks: `'first'`, `'last'`, `'all'` |
| `messagePlacement`   | `'last'`      | Which messages: `'first'`, `'last'`, `'all'`      |
| `cacheType`          | `'ephemeral'` | The `cache_control.type` value                    |

### OttoRouter Server-Side Caching

Provider-agnostic caching at the OttoRouter proxy layer:

```ts
createOttoRouter({
  auth,
  cache: {
    promptCacheKey: "my-session-123",
    promptCacheRetention: "in_memory", // or '24h'
  },
});
```

### OpenAI / Google

- **OpenAI**: Automatic server-side prefix caching — no configuration needed
- **Google**: Requires pre-uploaded `cachedContent` at the application level

## Balance

```ts
// OttoRouter account balance
const balance = await ottorouter.balance();
// { walletAddress, balance, totalSpent, totalTopups, requestCount }

// On-chain USDC balance
const wallet = await ottorouter.walletBalance("mainnet");
// { walletAddress, usdcBalance, network }

// Wallet address
console.log(ottorouter.walletAddress);
```

## Custom Providers

Register providers at init or runtime:

```ts
// At init
const ottorouter = createOttoRouter({
  auth,
  providers: [
    { id: "my-provider", apiFormat: "openai-chat", modelPrefix: "myp-" },
  ],
});

// At runtime
ottorouter.registry.register({
  id: "another-provider",
  apiFormat: "anthropic-messages",
  models: ["specific-model-id"],
});

// Map a specific model to a provider
ottorouter.registry.mapModel("some-model", "openai");
```

### API Formats

| Format               | Description                          | Used by            |
| -------------------- | ------------------------------------ | ------------------ |
| `openai-responses`   | OpenAI Responses API                 | OpenAI             |
| `anthropic-messages` | Anthropic Messages API               | Anthropic, MiniMax |
| `openai-chat`        | OpenAI Chat Completions (compatible) | Moonshot, Z.AI     |
| `google-native`      | Google GenerativeAI native           | Google             |

## Low-Level: Custom Fetch

Use the x402-aware fetch wrapper directly:

`ottorouter.fetch()` uses bearer auth for normal requests and automatically refreshes the OttoRouter access token on `401` once before retrying.

```ts
const customFetch = ottorouter.fetch();

const response = await customFetch('https://api.ottorouter.org/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [...] }),
});
```

## Standalone Utilities

```ts
import {
  fetchBalance,
  fetchWalletUsdcBalance,
  getPublicKeyFromPrivate,
  addAnthropicCacheControl,
  createOttoRouterFetch,
  createWalletContext,
} from "@ottorouter/ai-sdk";

// Get wallet address from private key
const address = getPublicKeyFromPrivate(privateKey);

// Fetch balance without creating a full OttoRouter instance
const balance = await fetchBalance({ privateKey });

// Fetch on-chain USDC
const usdc = await fetchWalletUsdcBalance({ privateKey }, "mainnet");

// Create a standalone x402-aware fetch
const ottorouterFetch = createOttoRouterFetch({
  wallet: createWalletContext({ privateKey }),
  baseURL: "https://api.ottorouter.org",
});
```

`createWalletContext()` remains available for advanced usage. Its wallet headers are now intended for token exchange only; regular API traffic should go through `createOttoRouter()`, `ottorouter.fetch()`, `createOttoRouterFetch()`, or `fetchBalance()` so bearer auth refresh is handled automatically.

## How It Works

1. You call `ottorouter.model('claude-sonnet-4-20250514')` — the SDK resolves this to Anthropic
2. It creates an ai-sdk provider (`@ai-sdk/anthropic`) pointed at the OttoRouter proxy
3. A custom fetch wrapper intercepts all requests to:
   - Exchange signed wallet headers for a short-lived bearer token when needed
   - Inject `Authorization: Bearer <token>` into normal API requests
   - Inject Anthropic cache control (if enabled)
   - Handle `401` by refreshing the bearer token once and retrying
   - Handle 402 responses by signing USDC payments via x402
   - Sniff balance/cost info from SSE stream comments
4. During topups, the wallet still signs the x402 transaction, but the `/v1/topup` HTTP request itself uses bearer auth
5. The OttoRouter proxy verifies the wallet/token, checks balance, forwards to the real provider, and tracks usage

## Requirements

- Solana wallet with USDC (for payments)
- `ai` SDK v6+ as a peer dependency
- Node.js 18+ or Bun

## License

MIT
