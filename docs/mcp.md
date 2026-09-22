# MCP Servers

[← Back to README](../README.md) · [Docs Index](./index.md)

---

otto supports **MCP (Model Context Protocol)** — the open standard for connecting AI agents to external tools and data sources. Add local or remote MCP servers to extend your agent with tools like GitHub, Linear, Notion, Helius, filesystem access, databases, and more.

## Quick Start

### From the Web UI

1. Open the **MCP panel** in the right sidebar (click the blocks icon)
2. Click **+** to add a server
3. Choose **Local (stdio)** or **Remote (HTTP)**
4. Fill in the details and click **Add Server**
5. Click ▶ to start the server — its tools become available to the agent

### From the CLI

```bash
# Add a local server
otto mcp add github --command npx --args -y @modelcontextprotocol/server-github

# Add a remote server
otto mcp add linear --transport http --url https://mcp.linear.app/mcp

# List servers
otto mcp list

# Test a server connection
otto mcp test github

# Show running servers and tools
otto mcp status

# Authenticate with an OAuth server
otto mcp auth linear

# Remove a server
otto mcp remove github
```

### From Config

Add servers to `.otto/config.json` (project) or `~/.config/otto/config.json` (global):

```json
{
  "mcp": {
    "servers": [
      {
        "name": "github",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      },
      {
        "name": "helius",
        "command": "npx",
        "args": ["-y", "helius-mcp@latest"],
        "env": { "HELIUS_API_KEY": "your-key-here" }
      },
      {
        "name": "linear",
        "transport": "http",
        "url": "https://mcp.linear.app/mcp"
      }
    ]
  }
}
```

---

## Transports

MCP supports three transport types:

| Transport | Type | Use Case | Example |
|---|---|---|---|
| **stdio** | Local | Servers that run as a child process | `npx -y helius-mcp@latest` |
| **http** | Remote | Servers over HTTP (recommended for remote) | `https://mcp.linear.app/mcp` |
| **sse** | Remote | Servers over Server-Sent Events (legacy) | `https://mcp.asana.com/sse` |

### Local Servers (stdio)

Local servers are spawned as child processes using `StdioClientTransport`. The server communicates over stdin/stdout using JSON-RPC.

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
  "env": {}
}
```

### Remote Servers (HTTP/SSE)

Remote servers connect over the network. Use `http` (Streamable HTTP) for modern servers and `sse` for legacy ones.

```json
{
  "name": "linear",
  "transport": "http",
  "url": "https://mcp.linear.app/mcp"
}
```

You can pass static headers for servers that use API key auth:

```json
{
  "name": "my-server",
  "transport": "http",
  "url": "https://mcp.example.com",
  "headers": {
    "Authorization": "Bearer sk-xxx"
  }
}
```

---

## OAuth Authentication

Remote servers like Linear, Notion, and Sentry use OAuth for authentication. otto handles the full OAuth 2.0 + PKCE flow automatically.

### How It Works

1. **Start** a remote server → the server returns `401 Unauthorized`
2. otto detects auth is required → shows a yellow lock icon in the sidebar
3. The browser opens automatically with the OAuth authorization URL
4. You authorize in the browser → the OAuth provider redirects to `localhost:8090/callback`
5. otto receives the authorization code, exchanges it for tokens, and reconnects
6. The server turns green — tools are now available

### From the CLI

```bash
# Start the OAuth flow
otto mcp auth linear

# Check auth status
otto mcp auth linear --status

# Revoke stored credentials
otto mcp auth linear --revoke
```

### OAuth Configuration

For servers that need custom OAuth settings:

```json
{
  "name": "linear",
  "transport": "http",
  "url": "https://mcp.linear.app/mcp",
  "oauth": {
    "clientId": "your-client-id",
    "callbackPort": 8090,
    "scopes": ["read", "write"]
  }
}
```

### Token Storage

OAuth tokens are stored in `~/.config/otto/oauth/` with restricted file permissions (`0600`). Tokens are refreshed automatically when they expire — you only need to authorize once per server.

---

## How Tools Work

When an MCP server is started, otto:

1. Connects to the server (stdio/HTTP/SSE)
2. Calls `tools/list` to discover available tools
3. Converts each tool to an AI SDK-compatible format
4. Registers tools with the naming convention `servername__toolname`

For example, starting the `helius` server exposes tools like:
- `helius__getBalance`
- `helius__searchAssets`
- `helius__getTransactionHistory`

These tools are **automatically available to all agents** alongside built-in tools (read, write, shell, etc.). The LLM sees them in its tool list and can call them based on your prompt.

MCP tools bypass the per-agent tool allowlist — any started MCP server's tools are available to every agent.

### Safety classification and pre-activation

MCP servers seldom declare whether a tool reads or writes, so by default MCP
tools auto-run in `toolApproval: "dangerous"` mode. When a [judge](judge.md) is
configured, otto classifies each tool once (honoring MCP `readOnlyHint` /
`destructiveHint` annotations first) and attaches the result as `effects`
metadata; writes then trigger the normal approval prompt.

The judge also pre-activates the MCP tools most likely needed for each user
turn, so the model does not spend a step on `load_mcp_tools` for obvious cases.

---

## Server Config Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Unique server name |
| `transport` | `"stdio"` \| `"http"` \| `"sse"` | No | Transport type (default: `"stdio"`) |
| `command` | string | stdio only | Command to spawn |
| `args` | string[] | No | Command arguments |
| `env` | object | No | Environment variables for the process |
| `url` | string | http/sse only | Server URL |
| `headers` | object | No | Static HTTP headers |
| `oauth` | object | No | OAuth configuration |
| `oauth.clientId` | string | No | OAuth client ID |
| `oauth.callbackPort` | number | No | Callback port (default: `8090`) |
| `oauth.scopes` | string[] | No | OAuth scopes |
| `disabled` | boolean | No | Disable without removing |

---

## CLI Reference

```bash
otto mcp list                  # List configured servers
otto mcp status                # Show running servers and tools
otto mcp test <name>           # Test connection to a server
otto mcp add <name>            # Add a server
  --command <cmd>              #   Command (stdio)
  --args <args...>             #   Arguments
  --transport <type>           #   stdio, http, or sse
  --url <url>                  #   Server URL (http/sse)
  --header <headers...>        #   Headers (Key: Value)
  --global                     #   Add to global config
otto mcp remove <name>         # Remove a server
  --global                     #   Remove from global config
otto mcp auth <name>           # Authenticate with OAuth
  --status                     #   Show auth status
  --revoke                     #   Revoke credentials
```

---

## Popular MCP Servers

| Server | Command / URL | Auth |
|---|---|---|
| [GitHub](https://github.com/modelcontextprotocol/servers/tree/main/src/github) | `npx -y @modelcontextprotocol/server-github` | API key (env) |
| [Filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | `npx -y @modelcontextprotocol/server-filesystem /path` | None |
| [PostgreSQL](https://github.com/modelcontextprotocol/servers/tree/main/src/postgres) | `npx -y @modelcontextprotocol/server-postgres` | Connection string (env) |
| [Helius](https://github.com/helius-labs/helius-mcp) | `npx -y helius-mcp@latest` | API key (env) |
| [Linear](https://mcp.linear.app) | `https://mcp.linear.app/mcp` | OAuth |
| [Notion](https://github.com/modelcontextprotocol/servers/tree/main/src/notion) | `npx -y @modelcontextprotocol/server-notion` | API key (env) |

Browse more servers at [mcp.run](https://mcp.run) and [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers).

---

## Troubleshooting

### Server won't start

- Check the command exists: `which npx` or `which node`
- Check env vars are set (use `otto mcp test <name>` to verify)
- For remote servers, check the URL is reachable

### Tools not appearing for the agent

- Make sure the server is **started** (green dot in sidebar)
- MCP tools are loaded fresh each session — check the server is still running
- Use `otto mcp status` to verify tools are indexed

### OAuth flow not completing

- Ensure port 8090 (or configured port) is not in use
- Check your browser didn't block the popup
- Try `otto mcp auth <name>` from the CLI for more detailed output
- Use `otto mcp auth <name> --revoke` and try again

### Server crashes or disconnects

- Check server logs in the terminal where otto is running
- Some stdio servers crash if env vars are missing — verify with `otto mcp test`
