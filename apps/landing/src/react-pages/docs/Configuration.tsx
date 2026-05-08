import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function Configuration() {
	return (
		<DocPage>
			<h1 className="text-3xl font-bold mb-2">Configuration</h1>
			<p className="text-otto-dim text-sm mb-8">
				Where otto reads settings, credentials, agents, tools, and MCP servers.
			</p>

			<h2>Use the CLI first</h2>
			<p>
				Prefer the CLI for normal setup so files stay in the shape otto expects.
			</p>
			<CodeBlock>{`otto setup
otto auth login
otto models
otto agents
otto mcp add <name>`}</CodeBlock>

			<h2>Config locations</h2>
			<ul>
				<li>
					Project settings live under <code>.otto/</code> in the current
					workspace.
				</li>
				<li>
					User settings live under <code>~/.config/otto/</code>.
				</li>
				<li>
					Session data is stored locally, usually in the project{' '}
					<code>.otto/</code> directory.
				</li>
				<li>
					Secrets should be set with <code>otto auth</code> or environment
					variables, not committed to project config.
				</li>
			</ul>

			<h2>Environment variables</h2>
			<CodeBlock>{`ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENROUTER_API_KEY=...
OPENCODE_API_KEY=...
OTTOROUTER_PRIVATE_KEY=...`}</CodeBlock>

			<h2>Project overrides</h2>
			<p>
				Put project-specific files under <code>.otto/</code>. Common examples:
			</p>
			<CodeBlock>{`.otto/
├── config.json
├── agents.json
├── agents/
├── commands/
├── tools/
└── skills/`}</CodeBlock>

			<h2>MCP servers</h2>
			<p>
				Use <code>otto mcp add</code> when possible. If you edit config by hand,
				keep it small and avoid hard-coding secrets.
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
otto debug path`}</CodeBlock>
		</DocPage>
	);
}
