import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function MCPServers() {
	return (
		<DocPage>
			<h1 className="text-3xl font-bold mb-2">MCP Servers</h1>
			<p className="text-otto-dim text-sm mb-8">
				Connect otto to external tools through Model Context Protocol servers.
			</p>

			<h2>What MCP is for</h2>
			<p>
				MCP servers expose extra tools to the agent. Use them for integrations
				like issue trackers, databases, documentation search, local services, or
				company-specific APIs.
			</p>

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
		</DocPage>
	);
}
