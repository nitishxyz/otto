import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function Architecture() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">Architecture</h1>
			<p className="text-otto-dim text-sm mb-8">
				A practical map of the monorepo and how the main pieces fit together.
			</p>

			<h2>Runtime shape</h2>
			<ol>
				<li>The CLI starts or connects to a local otto server.</li>
				<li>The server owns sessions, tool execution, persistence, and SSE.</li>
				<li>Clients such as TUI, web, and desktop talk to the server API.</li>
				<li>
					The SDK contains shared provider, config, auth, agent, and tool code.
				</li>
			</ol>

			<h2>Repository layout</h2>
			<CodeBlock>{`apps/
  cli/        CLI entrypoint and commands
  tui/        terminal UI
  web/        browser UI
  desktop/    Tauri desktop app
  landing/    marketing/docs site

packages/
  sdk/        core agents, tools, providers, auth, config
  server/     local HTTP API server
  database/   SQLite/Drizzle schema and migrations
  api/        generated type-safe API client
  acp/        Agent Client Protocol adapter
  ai-sdk/     OttoRouter AI SDK integration
  web-sdk/    React client utilities
  web-ui/     built web UI assets
  install/    installer package`}</CodeBlock>

			<h2>Development rules</h2>
			<ul>
				<li>Use Bun for installs, scripts, tests, and builds.</li>
				<li>Use workspace imports between packages.</li>
				<li>Use relative imports inside a package.</li>
				<li>
					Do not use <code>@/</code> aliases.
				</li>
				<li>Keep route, schema, and tool modules small and focused.</li>
			</ul>

			<h2>API changes</h2>
			<CodeBlock>{`# after changing server routes/spec
bun run --filter @ottocode/api generate
bun lint
bun test`}</CodeBlock>

			<h2>Database changes</h2>
			<ol>
				<li>
					Update schema files in <code>packages/database/src/schema/</code>.
				</li>
				<li>
					Generate migrations with <code>bunx drizzle-kit generate</code>.
				</li>
				<li>Update bundled migrations if the package requires it.</li>
				<li>Run tests locally.</li>
			</ol>
		</DocPage>
	);
}
