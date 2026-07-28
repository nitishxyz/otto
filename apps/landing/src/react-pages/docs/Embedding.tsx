import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	CardGrid,
	Diagram,
	DiagramNode,
	DiagramRow,
	DocCard,
	DocHero,
} from '../../components/docs';

export function Embedding() {
	return (
		<DocPage>
			<DocHero
				eyebrow="Embedding"
				title="Run otto inside your own product"
				lede="Three levels of integration: call a running daemon, host the server in your process, or drop down to the SDK primitives. Pick the highest one that still fits."
				tags={['@ottocode/api', '@ottocode/server', '@ottocode/web-ui']}
			/>

			<Diagram
				label="integration / pick the highest level that fits"
				status="least coupling wins"
				md={`level 1  @ottocode/api      talk to a running otto daemon over HTTP
level 2  @ottocode/server   host createEmbeddedApp() in your own process
level 3  @ottocode/sdk      providers, tools, config, auth primitives
ui       @ottocode/web-ui   serveWebUI() to mount the prebuilt interface`}
			>
				<DiagramRow cols={3}>
					<DiagramNode
						label="level 1 · recommended"
						title="@ottocode/api"
						accent="lime"
						desc="Your app is a client of a daemon that already runs."
						items={['typed methods', 'no runtime coupling']}
					/>
					<DiagramNode
						label="level 2"
						title="@ottocode/server"
						accent="blue"
						desc="Mount the Hono app inside your own service."
						items={['createEmbeddedApp(config)', 'inject provider + auth']}
					/>
					<DiagramNode
						label="level 3"
						title="@ottocode/sdk"
						accent="coral"
						desc="Build your own runtime on otto primitives."
						items={['providers, tools, config', 'most work, most control']}
					/>
				</DiagramRow>
			</Diagram>

			<h2>Level 1 — call a running daemon</h2>
			<CodeBlock>{`import { client, listSessions } from "@ottocode/api";

client.setConfig({
  baseURL: "http://127.0.0.1:47477",
  headers: { Authorization: \`Bearer \${serverToken}\` },
});

const sessions = await listSessions({
  headers: { "X-Otto-Project-Id": projectId },
});`}</CodeBlock>
			<p>
				Get the token with <code>otto service token</code> and the project id
				from the projects route or <code>otto projects list</code>.
			</p>

			<h2>Level 2 — host the server</h2>
			<p>
				<code>createEmbeddedApp()</code> accepts injected configuration and
				falls back to environment variables, then to <code>config.json</code> /{' '}
				<code>auth.json</code>.
			</p>
			<CodeBlock>{`import { createEmbeddedApp } from "@ottocode/server";

const app = createEmbeddedApp({
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaults: { agent: "build", toolApproval: "dangerous" },
  corsOrigins: ["https://app.example.com"],
});

Bun.serve({
  port: 3000,
  idleTimeout: 240,   // SSE needs a long idle timeout
  fetch: app.fetch,
});`}</CodeBlock>
			<p>
				<code>createStandaloneApp()</code> and <code>createApp()</code> are also
				exported for foreground and default runtimes.
			</p>

			<h2>Mount the web UI</h2>
			<CodeBlock>{`import { serveWebUI } from "@ottocode/web-ui";

const webUI = serveWebUI({ prefix: "/ui" });

Bun.serve({
  port: 3000,
  idleTimeout: 240,
  fetch: (req) => webUI(req) ?? new Response("Not found", { status: 404 }),
});`}</CodeBlock>
			<p>
				For a custom interface, reuse hooks, stores, and components from{' '}
				<code>@ottocode/web-sdk</code> instead of rebuilding session state
				handling.
			</p>

			<h2>Level 3 — SDK primitives</h2>
			<p>
				<code>@ottocode/sdk</code> exposes providers, auth, config resolution,
				tool discovery, skills, and the terminal manager. Reach for it when you
				need a different orchestration model than the server provides.
			</p>

			<Callout kind="warn" title="Approvals still matter">
				<p>
					Embedded runtimes execute shell commands and write files. Set{' '}
					<code>toolApproval</code> deliberately and surface approval events in
					your UI — otherwise the model runs unattended.
				</p>
			</Callout>

			<h2>Rules for integrations</h2>
			<ul>
				<li>Use package entrypoints, never deep private files.</li>
				<li>Prefer generated API methods over hand-written fetch calls.</li>
				<li>Keep provider credentials out of committed config.</li>
				<li>
					Set a long <code>idleTimeout</code> wherever you serve SSE.
				</li>
			</ul>

			<h2>Related</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="contract"
					title="API Reference"
					accent="blue"
					desc="Route groups, auth headers, and regeneration."
					href="/docs/api"
				/>
				<DocCard
					kicker="internals"
					title="Architecture"
					accent="lime"
					desc="Daemon, project runtimes, and package layers."
					href="/docs/architecture"
				/>
				<DocCard
					kicker="ai sdk"
					title="OttoRouter provider"
					accent="coral"
					desc="Use one balance across providers from your own AI SDK app."
					href="/docs/ai-sdk"
				/>
			</CardGrid>
		</DocPage>
	);
}
