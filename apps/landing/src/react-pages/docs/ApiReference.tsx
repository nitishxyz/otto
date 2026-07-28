import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	Diagram,
	DiagramFlow,
	DiagramNode,
	DiagramRow,
	DocHero,
	Steps,
} from '../../components/docs';

export function ApiReference() {
	return (
		<DocPage>
			<DocHero
				eyebrow="API"
				title="The local HTTP API"
				lede="Everything otto does is exposed under /v1 by the daemon. Routes are Zod-first, the OpenAPI spec is generated from them, and the typed client is generated from that spec."
				tags={['hono', 'zod openapi', 'sse', '@ottocode/api']}
			/>

			<Diagram
				label="api / one contract, generated downstream"
				status="single source"
				md={`packages/server/src/routes/*   Zod route definitions (zodOpenApiRoute)
        v
GET /openapi.json  ==  packages/api/openapi.json
        v
@ottocode/api      typed client used by TUI, web, desktop, CLI`}
			>
				<DiagramNode
					label="source"
					title="Zod routes"
					accent="lime"
					desc="packages/server/src/routes/ — request and response schemas live with the handler."
				/>
				<DiagramFlow label="generate" />
				<DiagramNode
					label="contract"
					title="openapi.json"
					accent="blue"
					emphasis
					desc="Served at /openapi.json and published as packages/api/openapi.json."
				/>
				<DiagramFlow label="generate" />
				<DiagramRow cols={2}>
					<DiagramNode
						label="clients"
						title="@ottocode/api"
						accent="yellow"
						desc="Typed methods for every documented endpoint."
					/>
					<DiagramNode
						label="consumers"
						title="TUI · web · desktop · CLI"
						accent="coral"
						desc="No hand-written fetch calls or duplicated response types."
					/>
				</DiagramRow>
			</Diagram>

			<Callout kind="note" title="Do not copy route details from docs">
				<p>
					Treat <code>/openapi.json</code> and the generated client as the
					source of truth. Route shapes change; this page describes the map, not
					the contract.
				</p>
			</Callout>

			<h2>Route groups</h2>
			<table>
				<thead>
					<tr>
						<th>Group</th>
						<th>What it covers</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>sessions</code>, <code>ask</code>
						</td>
						<td>
							Session lifecycle, messages, streaming, approvals, branching
						</td>
					</tr>
					<tr>
						<td>
							<code>projects</code>
						</td>
						<td>Open, close, list, and forget project runtimes</td>
					</tr>
					<tr>
						<td>
							<code>config</code>, <code>auth</code>
						</td>
						<td>Defaults, agents, tools, providers, credentials</td>
					</tr>
					<tr>
						<td>
							<code>files</code>, <code>git</code>, <code>terminals</code>
						</td>
						<td>Workspace inspection, diffs, and terminal sessions</td>
					</tr>
					<tr>
						<td>
							<code>mcp</code>, <code>skills</code>, <code>plugins</code>
						</td>
						<td>External tool sources and instruction bundles</td>
					</tr>
					<tr>
						<td>
							<code>goals</code>, <code>subagents</code>
						</td>
						<td>
							Long-running goal orchestration and delegated child sessions
						</td>
					</tr>
					<tr>
						<td>
							<code>tunnel</code>, <code>shares</code>
						</td>
						<td>Remote access and project share tokens</td>
					</tr>
					<tr>
						<td>
							<code>ottorouter</code>, <code>provider-usage</code>,{' '}
							<code>usage</code>
						</td>
						<td>Balance, model catalog, and token accounting</td>
					</tr>
					<tr>
						<td>
							<code>doctor</code>, <code>research</code>, <code>recipes</code>
						</td>
						<td>Diagnostics, session history search, saved workflows</td>
					</tr>
				</tbody>
			</table>

			<h2>Using the generated client</h2>
			<CodeBlock>{`import { client, listSessions } from "@ottocode/api";

client.setConfig({ baseURL: "http://127.0.0.1:47477" });

const { data, error } = await listSessions();
if (error) throw error;
console.log(data);`}</CodeBlock>

			<h2>Auth and project scope</h2>
			<p>
				Daemon requests need the local token, and every project-scoped route
				needs to know which project it is for.
			</p>
			<CodeBlock>{`Authorization: Bearer <server-token>     # otto service token
X-Otto-Project-Id: <project-id>          # preferred
?projectId=<project-id>                  # query-param form
X-Otto-Project / ?project=<path>         # compatibility`}</CodeBlock>

			<h2>Streaming</h2>
			<p>
				Session updates — deltas, tool calls, approvals, usage — arrive over
				SSE. Prefer the client and the web-sdk hooks over parsing events
				yourself unless you are writing a new client.
			</p>
			<Callout kind="warn" title="Watch server idle timeouts">
				<p>
					If you host the API yourself with <code>Bun.serve()</code>, raise{' '}
					<code>idleTimeout</code> (240s or more). The default drops SSE
					connections mid-stream.
				</p>
			</Callout>

			<h2>Changing the API</h2>
			<Steps
				items={[
					{
						title: 'Edit the route and its schemas',
						desc: 'Keep non-Zod exceptions narrow — WebSocket, SSE, binary, and multipart edges only.',
						code: 'packages/server/src/routes/',
					},
					{
						title: 'Register documented endpoints',
						code: 'zodOpenApiRoute(...)',
					},
					{
						title: 'Regenerate spec and client',
						code: 'bun run --filter @ottocode/api generate',
					},
					{
						title: 'Verify',
						code: 'bun lint && bun test',
					},
				]}
			/>
		</DocPage>
	);
}
