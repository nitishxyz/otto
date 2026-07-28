import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	CardGrid,
	Diagram,
	DiagramFlow,
	DiagramLayer,
	DiagramNode,
	DiagramRow,
	DocCard,
	DocHero,
	Steps,
} from '../../components/docs';

export function Architecture() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Architecture"
				title="One daemon, many projects"
				lede="otto is a Bun monorepo where every surface — terminal, browser, desktop, editor — talks to the same local runtime. The daemon owns projects, sessions, tools, and streaming; everything else is a client."
				tags={[
					'local-first',
					'bun workspace',
					'hono + sse',
					'sqlite per project',
				]}
			/>

			<h2>Runtime shape</h2>
			<p>
				One daemon per user, bound to <code>127.0.0.1</code>. It serves many
				projects in a single process, and each project gets its own runtime with
				its own config, database, and tool state.
			</p>

			<Diagram
				label="runtime / one daemon, many projects"
				status="local only"
				md={`clients: TUI · CLI ask · web UI · desktop · launcher · ACP editors
      |  HTTP /v1/* + SSE, project scoped
otto daemon (127.0.0.1:47477)
  sessions · agents · tool execution · approvals · streaming
      |
project runtimes                      providers
  .otto/ config + SQLite                Anthropic · OpenAI · Google
  MCP servers, skills, custom tools     OpenRouter · OttoRouter · local`}
			>
				<DiagramRow cols={3}>
					<DiagramNode
						label="terminal"
						title="TUI / otto ask"
						accent="lime"
						items={['default surface', 'streams over SSE']}
					/>
					<DiagramNode
						label="browser + native"
						title="web · desktop · launcher"
						accent="blue"
						items={['same API as the TUI', 'bundled web UI assets']}
					/>
					<DiagramNode
						label="editors"
						title="ACP clients"
						accent="yellow"
						items={['otto --acp over stdio', 'editor owns the UI']}
					/>
				</DiagramRow>

				<DiagramFlow label="/v1/* + sse" />

				<DiagramNode
					label="daemon · 127.0.0.1:47477"
					title="otto server"
					emphasis
					accent="blue"
					desc="Hono runtime that resolves every request to a project, persists messages, runs tools, and streams model output back to whichever client asked."
					items={[
						'session + message orchestration',
						'agent resolution and prompt composition',
						'tool execution, approvals, terminals',
						'project registry, tunnel, OpenAPI',
					]}
				/>

				<DiagramFlow label="resolve project" />

				<DiagramRow cols={2}>
					<DiagramNode
						label="per project"
						title="Project runtime"
						accent="lime"
						items={[
							'.otto/ config, agents, tools, skills',
							'SQLite sessions, messages, artifacts',
							'MCP servers and terminal manager',
						]}
					/>
					<DiagramNode
						label="outbound"
						title="Model providers"
						accent="coral"
						items={[
							'Anthropic · OpenAI · Google · OpenRouter',
							'OttoRouter for one balance across providers',
							'auth stored outside the project',
						]}
					/>
				</DiagramRow>
			</Diagram>

			<h2>What happens on a prompt</h2>
			<Steps
				items={[
					{
						title: 'CLI resolves the project',
						desc: 'The current directory becomes the project root for the request.',
					},
					{
						title: 'Daemon is reused or started',
						desc: 'A healthy daemon with a matching version is reused; otherwise a detached one starts and registers itself.',
						code: '~/.local/state/otto/server.json',
					},
					{
						title: 'Project is opened',
						desc: 'The client calls the project route and receives a project id plus daemon auth headers.',
						code: 'POST /v1/projects/open',
					},
					{
						title: 'Session runs on the server',
						desc: 'Agent, prompt, tools, and provider are resolved server-side, then the model call starts.',
					},
					{
						title: 'Everything streams back',
						desc: 'Tool calls, deltas, approvals, and usage arrive over SSE while messages persist to the project database.',
					},
				]}
			/>

			<Callout kind="note" title="Project context travels with the request">
				<p>
					First-party clients send <code>projectId</code> (query param or{' '}
					<code>X-Otto-Project-Id</code>). The path form <code>?project=</code>{' '}
					and <code>X-Otto-Project</code> stay supported for scripts and older
					clients. Only the central server resolver falls back to the process
					cwd.
				</p>
			</Callout>

			<h2>Daemon files</h2>
			<p>
				The daemon writes its registration into the global state directory.
				Clients should read these instead of assuming a port.
			</p>
			<CodeBlock>{`~/.local/state/otto/server.json    # daemon id, version, url, pid, start time
~/.local/state/otto/server-token   # local token, restrictive permissions
~/.config/otto/projects.json       # known project registry`}</CodeBlock>
			<p>
				Startup binds the documented default port <code>47477</code>. If that
				port is taken, startup fails instead of drifting to another port. Use{' '}
				<code>OTTO_DAEMON_PORT</code> or{' '}
				<code>otto service start --port &lt;port&gt;</code> to change it.
			</p>
			<CodeBlock>{`otto service status     # is a daemon running, and which version
otto service restart    # restart after an upgrade
otto projects list      # open and known projects
otto projects close <id>`}</CodeBlock>

			<h2>Package layers</h2>
			<p>
				Dependencies flow one direction only. If an import would point back up
				this stack, the code belongs somewhere else.
			</p>

			<Diagram
				label="packages / dependency direction"
				status="no cycles"
				md={`level 0  database, install
level 1  sdk        providers, auth, config, prompts, tools, skills, MCP
level 2  api        generated client from the server OpenAPI spec
level 3  server     Hono routes, sessions, tool execution, SSE
level 4  web-sdk    React hooks, stores, components
level 5  apps       cli, tui, web, desktop, launcher, landing`}
			>
				<div className="space-y-2">
					<DiagramLayer
						label="level 5"
						title="apps"
						desc="cli · tui · web · desktop · launcher"
						accent="coral"
						tag="consumers"
					/>
					<DiagramLayer
						label="level 4"
						title="@ottocode/web-sdk"
						desc="React hooks, stores, shared UI"
						accent="yellow"
					/>
					<DiagramLayer
						label="level 3"
						title="@ottocode/server"
						desc="routes, orchestration, streaming"
						accent="blue"
					/>
					<DiagramLayer
						label="level 2"
						title="@ottocode/api"
						desc="generated type-safe client"
						accent="blue"
					/>
					<DiagramLayer
						label="level 1"
						title="@ottocode/sdk"
						desc="providers, auth, config, tools, skills"
						accent="lime"
					/>
					<DiagramLayer
						label="level 0"
						title="@ottocode/database · @ottocode/install"
						desc="SQLite + Drizzle, installer"
						accent="lime"
						tag="foundation"
					/>
				</div>
			</Diagram>

			<h2>Packages</h2>
			<CardGrid cols={2}>
				<DocCard
					kicker="packages/sdk"
					title="@ottocode/sdk"
					accent="lime"
					desc="Core runtime primitives shared by everything above it."
					items={[
						'provider catalog and auth helpers',
						'config + path resolution',
						'built-in tools, skills, MCP loading',
						'terminal manager and tunnel client',
					]}
				/>
				<DocCard
					kicker="packages/server"
					title="@ottocode/server"
					accent="blue"
					desc="The Hono app behind the daemon and every embedded mode."
					items={[
						'/v1 routes with Zod OpenAPI',
						'project manager and registry',
						'sessions, approvals, SSE streaming',
						'createApp / createStandaloneApp / createEmbeddedApp',
					]}
				/>
				<DocCard
					kicker="packages/api"
					title="@ottocode/api"
					accent="blue"
					desc="Generated client — the only supported way for first-party clients to call the API."
					footnote="bun run --filter @ottocode/api generate"
				/>
				<DocCard
					kicker="packages/database"
					title="@ottocode/database"
					accent="lime"
					desc="SQLite + Drizzle persistence, one table per schema file, bundled migrations."
					items={['sessions, messages, artifacts', 'goals and subagents']}
				/>
				<DocCard
					kicker="packages/web-sdk · web-ui"
					title="Web building blocks"
					accent="yellow"
					desc="Reusable React hooks/components plus the prebuilt static assets and serveWebUI() helper."
				/>
				<DocCard
					kicker="packages/acp"
					title="@ottocode/acp"
					accent="yellow"
					desc="Agent Client Protocol adapter so editors can drive otto over stdio."
					href="/docs/acp"
					footnote="otto --acp"
				/>
				<DocCard
					kicker="packages/ai-sdk"
					title="@ottocode/ai-sdk"
					accent="coral"
					desc="AI SDK v6 provider for OttoRouter, usable outside otto."
					href="/docs/ai-sdk"
				/>
				<DocCard
					kicker="packages/plugin-registry"
					title="Plugin registry"
					accent="coral"
					desc="The official plugin list otto searches and installs from."
					href="/docs/plugins"
					footnote="otto plugins search"
				/>
			</CardGrid>

			<h2>Workspace layout</h2>
			<CodeBlock>{`apps/
  cli/           CLI entrypoint, daemon management, ACP launch
  tui/           terminal UI (OpenTUI + React)
  web/           browser client
  desktop/       Tauri workspace shell
  launcher/      Tauri launcher for projects and services
  mobile/        Expo client (in development)
  preview-api/   session sharing backend
  preview-web/   public session viewer
  landing/       this site
  intro-video/   Remotion marketing assets

packages/
  sdk/           agents, tools, providers, auth, config, skills
  server/        Hono API + orchestration
  database/      SQLite/Drizzle schema and migrations
  api/           generated API client + openapi.json
  acp/           Agent Client Protocol adapter
  ai-sdk/        OttoRouter provider for the AI SDK
  web-sdk/       React hooks, stores, components
  web-ui/        prebuilt web assets + serveWebUI()
  themes/        shared theme definitions
  install/       install helper package

infra/           SST definitions      functions/og/  OG image rendering
docs/            long-form docs       tests/         Bun integration tests`}</CodeBlock>

			<h2>Change workflows</h2>
			<h3>API and client</h3>
			<Steps
				items={[
					{
						title: 'Edit the route',
						desc: 'Routes are Zod-first and registered through zodOpenApiRoute(...).',
						code: 'packages/server/src/routes/',
					},
					{
						title: 'Regenerate the client',
						code: 'bun run --filter @ottocode/api generate',
					},
					{
						title: 'Consume it through @ottocode/api',
						desc: 'No hand-written fetch calls or duplicated response types in first-party clients.',
					},
				]}
			/>

			<h3>Database</h3>
			<Steps
				items={[
					{
						title: 'Update the schema',
						desc: 'One table per file.',
						code: 'packages/database/src/schema/',
					},
					{
						title: 'Generate the migration',
						desc: 'Never write migration files by hand.',
						code: 'bunx drizzle-kit generate',
					},
					{
						title: 'Update bundled migrations and test locally',
						code: 'packages/database/src/runtime/migrations-bundled.ts',
					},
				]}
			/>

			<Callout kind="warn" title="Generated files are off-limits">
				<p>
					Model catalogs under{' '}
					<code>packages/sdk/src/providers/src/catalog.ts</code>,{' '}
					<code>packages/ai-sdk/src/catalog.ts</code>, and{' '}
					<code>apps/landing/public/catalog/models.json</code> are regenerated
					with <code>bun run scripts/update-catalog.ts</code>. Hand edits get
					overwritten.
				</p>
			</Callout>

			<h2>Local rules</h2>
			<ul>
				<li>
					Bun for installs, scripts, tests, and builds — never npm or pnpm.
				</li>
				<li>
					Cross-package imports use <code>@ottocode/*</code>; imports inside a
					package stay relative. No <code>@/</code> aliases.
				</li>
				<li>Keep routes, schemas, and tool modules small and focused.</li>
				<li>
					Verify with <code>bun test</code>, <code>bun lint</code>, and{' '}
					<code>bun typecheck</code>.
				</li>
			</ul>

			<h2>Next</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="clients"
					title="Surfaces"
					accent="lime"
					desc="Every way to run otto and when to reach for each one."
					href="/docs/surfaces"
				/>
				<DocCard
					kicker="http"
					title="API Reference"
					accent="blue"
					desc="Route groups, streaming, and the generated client."
					href="/docs/api"
				/>
				<DocCard
					kicker="integration"
					title="Embedding"
					accent="yellow"
					desc="Run the server or SDK inside your own app."
					href="/docs/embedding"
				/>
			</CardGrid>
		</DocPage>
	);
}
