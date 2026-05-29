# Usage

[← Back to README](../README.md) • [Docs Index](./index.md)

## Core Commands

### Session Management

```bash
otto sessions              # Interactive session picker (default)
otto sessions --list       # List all sessions
otto sessions --json       # Output sessions as JSON
otto sessions --limit 10   # Limit number of sessions shown
```

### Provider & Model Configuration

```bash
otto models               # Interactive provider/model selection
otto switch               # Alias for models command
otto auth login           # Configure provider credentials
otto auth list            # List configured providers
otto auth logout          # Remove provider credentials
```

`otto auth login xai` supports both `XAI_API_KEY` and browser OAuth for
SuperGrok / X Premium+ accounts. If xAI accepts the login but model calls return
`403`, your subscription tier may not be allowlisted for OAuth API access; use an
`XAI_API_KEY` fallback.

`otto auth login openai` offers both OpenAI browser-callback OAuth and
device-code OAuth for ChatGPT Plus/Pro accounts. Device-code OAuth works from SSH
sessions, headless machines, and the web UI over a tunnel because it does not
depend on a `localhost` callback.

### Agent & Tool Management

```bash
otto agents               # List and configure agents interactively
otto agents --local       # Edit local project agents
otto tools                # List available tools and agent access
otto scaffold             # Generate new agents, tools, or commands
```

### Diagnostics

```bash
otto doctor               # Check configuration and diagnose issues
otto --version            # Show version
otto --help               # Show help with discovered commands
```

## Server Mode

```bash
otto serve                  # Start HTTP server on random port
otto serve --no-open        # Start server + web UI without opening browser
otto serve --port 3000      # Start on specific port
otto serve --network        # Start with network access (0.0.0.0)
otto serve --port 3000 --network  # Combine port and network flags
otto serve --tunnel         # Enable Cloudflare tunnel for remote access
```

## Web UI Modes

```bash
otto --web                  # Start local API server + open Web UI
otto web --api <url>        # Start Web UI only, connected to an existing API server
otto web --api <url> --no-open  # Start Web UI only without opening browser
```

### Remote Access with Tunnels

The `--tunnel` flag creates a secure Cloudflare tunnel, giving you a public URL to access otto from anywhere - including your phone.

```bash
otto serve --tunnel
```

**What happens:**
1. First run downloads the tunnel binary (~17MB, one-time)
2. Creates an anonymous Cloudflare tunnel (no account needed)
3. Displays a QR code you can scan with your phone
4. Shows the public URL (e.g., `https://random-words.trycloudflare.com`)

**Web UI Integration:**

The tunnel can also be started from the Web UI:
1. Click the Globe icon in the right sidebar
2. Click "Start Tunnel"
3. Scan the QR code or copy the URL

The tunnel URL changes each session, but you can always scan a new QR code to reconnect.
