import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Diagram,
	DiagramFlow,
	DiagramNode,
	DiagramRow,
	DocHero,
} from '../../components/docs';

export function MCPServers() {
	return (
		<DocPage>
			<DocHero
				eyebrow="MCP"
				title="Bring your own tools"
				lede="Model Context Protocol servers add tools to a session at runtime — issue trackers, databases, docs search, internal APIs — without touching agent prompts."
				tags={['stdio', 'http', 'sse', 'oauth']}
			/>

			<Diagram
				label="mcp / tools resolved per session"
				status="project scoped"
				md={`local server    child process over stdio    otto mcp add <name> --command bunx
remote server   http or sse endpoint       otto mcp add <name> --transport http --url ...
													|
							tools merged into the agent's tool set`}
			>
				<DiagramRow cols={2}>
					<DiagramNode
						label="local"
						title="stdio server"
						accent="lime"
						desc="Runs as a child process on your machine."
					/>
					<DiagramNode
						label="remote"
						title="http / sse server"
						accent="blue"
						desc="Hosted endpoint, often with its own OAuth or API key."
					/>
				</DiagramRow>
				<DiagramFlow label="merge" />
				<DiagramNode
					label="session"
					title="Agent tool set"
					accent="yellow"
					emphasis
					desc="MCP tools sit alongside built-ins and project tools, subject to the same approval rules."
				/>
			</Diagram>

			<h2>CLI workflow</h2>
			<CodeBlock>{`otto mcp list
otto mcp status
otto mcp add <name>
otto mcp test <name>
otto mcp auth <name>
otto mcp remove <name>`}</CodeBlock>
			<p>
				Run <code>otto mcp add --help</code> for the exact flags supported by
				the installed CLI.
			</p>

			<h2>Local server example</h2>
			<p>Local MCP servers run as child processes over stdio.</p>
			<CodeBlock>{`otto mcp add filesystem \
  --command bunx \
  --args "@modelcontextprotocol/server-filesystem"`}</CodeBlock>

			<h2>Remote server example</h2>
			<p>Remote MCP servers use HTTP or SSE depending on the server.</p>
			<CodeBlock>{`otto mcp add linear \
  --transport http \
  --url https://mcp.linear.app/mcp`}</CodeBlock>

			<h2>Config shape</h2>
			<p>
				If you need to edit config directly, keep secrets in environment
				variables.
			</p>
			<CodeBlock>{`{
  "mcp": {
    "servers": [
      {
        "name": "example",
        "command": "bunx",
        "args": ["some-mcp-server"],
        "env": { "TOKEN": "\${TOKEN}" }
      },
      {
        "name": "remote-example",
        "transport": "http",
        "url": "https://mcp.example.com/mcp"
      }
    ]
  }
}`}</CodeBlock>

			<h2>Troubleshooting</h2>
			<ul>
				<li>
					If a local server does not start, test the command in your shell
					first.
				</li>
				<li>
					If tools do not appear, run <code>otto mcp status</code> and restart
					the session after changing servers.
				</li>
				<li>
					If auth fails, run <code>otto mcp auth {'<name>'}</code> and check the
					server's own OAuth/API-key requirements.
				</li>
				<li>Do not commit tokens or private credentials in MCP config.</li>
			</ul>

			<h2>Shipping servers to a team</h2>
			<p>
				A <a href="/docs/plugins">plugin</a> can declare <code>mcpServers</code>{' '}
				in its manifest, so installing the plugin registers the server for
				everyone instead of each person running <code>otto mcp add</code>.
			</p>
		</DocPage>
	);
}
