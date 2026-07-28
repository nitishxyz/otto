import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	Diagram,
	DiagramFlow,
	DiagramNode,
	DocHero,
} from '../../components/docs';

export function Configuration() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Configuration"
				title="Config, credentials, and state"
				lede="Settings merge from built-in defaults up through your global config and this project's .otto/ directory. Secrets and session data live outside the repo on purpose."
				tags={['.otto/', '~/.config/otto', 'xdg state', 'env vars']}
			/>

			<Diagram
				label="config / resolution order"
				status="last write wins"
				md={`built-in defaults        agent: build, toolApproval: auto, themes
   +  ~/.config/otto/config.json      machine-wide settings
   +  ~/.config/otto/skills.json      global skill settings
   +  .otto/config.json               project overrides (agent/provider/model)
   =  resolved config

credentials are separate: env vars, then secure auth storage`}
			>
				<DiagramNode
					label="layer 01"
					title="Built-in defaults"
					accent="neutral"
					desc="agent build · toolApproval auto · theme otto-dark"
				/>
				<DiagramFlow label="merge" />
				<DiagramNode
					label="layer 02"
					title="~/.config/otto/config.json"
					accent="blue"
					desc="Machine-wide defaults, provider settings, UI preferences."
				/>
				<DiagramFlow label="merge" />
				<DiagramNode
					label="layer 03"
					title=".otto/config.json"
					accent="lime"
					emphasis
					desc="Project overrides. Only agent, provider, and model defaults are taken from project scope — the rest stays machine-level."
				/>
			</Diagram>

			<h2>Use the CLI first</h2>
			<p>
				The commands keep files in the shape otto expects, and they write to the
				right scope.
			</p>
			<CodeBlock>{`otto setup
otto auth login
otto models
otto agents
otto agents --local
otto mcp add <name>`}</CodeBlock>

			<h2>Where things live</h2>
			<h3>Global config</h3>
			<CodeBlock>{`~/.config/otto/
├── config.json        defaults, providers, UI preferences
├── agents.json        agent registry
├── agents/            agent prompt overrides (.md / .txt)
├── tools/             custom tool plugins
├── commands/          custom slash commands
├── skills.json        global skill settings
├── plugins.json       installed plugins
└── projects.json      known project registry`}</CodeBlock>

			<h3>Project config</h3>
			<CodeBlock>{`.otto/
├── config.json        agent/provider/model defaults for this repo
├── agents.json
├── agents/<name>.md
├── tools/<name>/tool.js
├── commands/
├── skills/
└── plugins.json`}</CodeBlock>

			<h3>State and secrets</h3>
			<p>
				Session data is not stored in the repo. Each project gets a state
				directory keyed by a stable project id.
			</p>
			<CodeBlock>{`~/.local/state/otto/
├── server.json                       daemon registration
├── server-token                      local daemon token
└── projects/<project-id>/
    ├── otto.sqlite                   sessions, messages, artifacts
    ├── attachments/
    ├── logs/
    └── cache/`}</CodeBlock>
			<p>Credentials use platform-secure locations:</p>
			<CodeBlock>{`macOS    ~/Library/Application Support/otto/auth.json
Linux    $XDG_STATE_HOME/otto/auth.json  (or ~/.local/state/otto/auth.json)
Windows  %APPDATA%/otto/auth.json

OAuth tokens live alongside it under otto/oauth/`}</CodeBlock>

			<Callout kind="warn" title="Never commit credentials">
				<p>
					Use <code>otto auth login</code> or environment variables. Project
					config is meant to be committed; secrets in it will leak.
				</p>
			</Callout>

			<h2>Environment variables</h2>
			<CodeBlock>{`ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENROUTER_API_KEY=...
OPENCODE_API_KEY=...
ZAI_CODING_API_KEY=...

OTTO_HOME=...            override the state root
OTTO_DAEMON_PORT=47477   override the daemon port
XDG_CONFIG_HOME=...      override the config root`}</CodeBlock>
			<p>
				OttoRouter authenticates through OAuth rather than an environment key —
				use <code>otto auth login ottorouter</code>.
			</p>

			<h2>Config file shape</h2>
			<CodeBlock>{`{
  "defaults": {
    "agent": "build",
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "toolApproval": "auto"
  },
  "providers": {
    "anthropic": { "enabled": true }
  }
}`}</CodeBlock>

			<h2>MCP servers</h2>
			<p>
				Prefer <code>otto mcp add</code>. When editing by hand, keep secrets in
				environment variables.
			</p>
			<CodeBlock>{`{
  "mcp": {
    "servers": [
      {
        "name": "example",
        "command": "bunx",
        "args": ["some-mcp-server"],
        "env": { "TOKEN": "\${TOKEN}" }
      }
    ]
  }
}`}</CodeBlock>

			<h2>Debugging config</h2>
			<CodeBlock>{`otto doctor
otto auth list
otto debug status
otto debug on <scope>`}</CodeBlock>
		</DocPage>
	);
}
