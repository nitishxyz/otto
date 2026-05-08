import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function ApiReference() {
	return (
		<DocPage>
			<h1 className="text-3xl font-bold mb-2">API Reference</h1>
			<p className="text-otto-dim text-sm mb-8">
				The local otto server API and generated client package.
			</p>

			<h2>Source of truth</h2>
			<p>
				Do not copy route details from this page into code. Use the generated
				OpenAPI file or the generated client.
			</p>
			<CodeBlock>{`packages/api/openapi.json
GET /openapi.json
@ottocode/api`}</CodeBlock>

			<h2>Route groups</h2>
			<p>
				Routes are implemented in <code>packages/server/src/routes/</code> and
				served under <code>/v1</code>. Current groups include sessions, ask,
				config, auth, files, git, MCP, skills, terminals, research, tunnel, and
				OttoRouter.
			</p>

			<h2>Use the generated client</h2>
			<CodeBlock>{`import { client, listSessions } from "@ottocode/api";

client.setConfig({ baseURL: "http://localhost:3000" });

const { data, error } = await listSessions();
if (error) throw error;
console.log(data);`}</CodeBlock>

			<h2>Streaming</h2>
			<p>
				Chat/session updates stream over SSE. Prefer the existing API client and
				UI hooks instead of manually parsing events unless you are adding a new
				client.
			</p>

			<h2>Updating API docs and SDK</h2>
			<ol>
				<li>
					Change route code in <code>packages/server/src/routes/</code>.
				</li>
				<li>
					Update the OpenAPI spec code in{' '}
					<code>packages/server/src/openapi</code>
					when the contract changes.
				</li>
				<li>
					Regenerate the API package with{' '}
					<code>bun run --filter @ottocode/api generate</code>.
				</li>
				<li>Update clients to use the generated methods.</li>
			</ol>
		</DocPage>
	);
}
