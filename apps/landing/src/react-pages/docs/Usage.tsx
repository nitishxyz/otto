import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function Usage() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">Usage Guide</h1>
			<p className="text-otto-dim text-sm mb-8">
				Common CLI commands and daily workflows.
			</p>

			<h2>Prompting</h2>
			<CodeBlock>{`otto                         # interactive terminal UI
otto ask "fix the failing test"
otto ask "review this change" --agent general
otto ask "make a plan first" --agent plan`}</CodeBlock>
			<p>
				Use <code>otto --help</code> and <code>otto ask --help</code> for the
				current flags. The CLI is the source of truth for supported options.
			</p>

			<h2>Server and web UI</h2>
			<CodeBlock>{`otto serve
otto serve --port 3000
otto serve --network
otto serve --no-open
otto web`}</CodeBlock>
			<p>
				Server mode exposes the local otto HTTP API and can serve the bundled
				web UI. Use <code>--network</code> only when you intentionally want LAN
				access.
			</p>

			<h2>Sessions</h2>
			<CodeBlock>{`otto sessions
otto sessions --list
otto sessions --json
otto share`}</CodeBlock>
			<p>
				Sessions are stored locally. Sharing uploads a read-only copy through
				the share flow.
			</p>

			<h2>Models, providers, and auth</h2>
			<CodeBlock>{`otto setup
otto models
otto providers list
otto auth login
otto auth list
otto auth status`}</CodeBlock>
			<p>
				Use <code>otto models</code> to inspect/select model defaults and{' '}
				<code>otto auth</code> for credentials.
			</p>

			<h2>Agents, tools, MCP, and skills</h2>
			<CodeBlock>{`otto agents
otto tools
otto mcp list
otto mcp add <name>
otto skills list
otto skills validate`}</CodeBlock>
			<p>
				Agents choose the default behavior and tool set. MCP servers add tools
				from external processes or remote MCP endpoints.
			</p>

			<h2>Diagnostics and maintenance</h2>
			<CodeBlock>{`otto doctor
otto debug status
otto debug on <scope>
otto debug off
otto upgrade`}</CodeBlock>
			<p>
				Run <code>otto doctor</code> first when provider, path, database, or
				server behavior looks wrong.
			</p>
		</DocPage>
	);
}
