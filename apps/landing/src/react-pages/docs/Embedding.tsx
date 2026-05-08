import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function Embedding() {
	return (
		<DocPage>
			<h1 className="text-3xl font-bold mb-2">Embedding Guide</h1>
			<p className="text-otto-dim text-sm mb-8">
				Use otto packages from another app or service.
			</p>

			<h2>Recommended path</h2>
			<p>
				For most integrations, run the otto server and talk to it through the
				generated API client. This keeps your app on the same API surface as the
				first-party clients.
			</p>
			<CodeBlock>{`import { client, listSessions } from "@ottocode/api";

client.setConfig({ baseURL: "http://localhost:3000" });
const sessions = await listSessions();`}</CodeBlock>

			<h2>Server package</h2>
			<p>
				Use <code>@ottocode/server</code> when you need to host the local API in
				your own process. Check the package exports for the current entrypoints
				before relying on an example.
			</p>

			<h2>SDK package</h2>
			<p>
				Use <code>@ottocode/sdk</code> for lower-level provider, agent, config,
				auth, and tool primitives. This is a lower-level integration surface
				than the HTTP API.
			</p>

			<h2>Web UI</h2>
			<p>
				The web UI is built as a first-party client of the server API. If you
				are building your own UI, prefer <code>@ottocode/api</code> and reuse
				patterns from <code>apps/web</code> or <code>packages/web-sdk</code>.
			</p>

			<h2>Rules for integrations</h2>
			<ul>
				<li>Use workspace package imports inside this monorepo.</li>
				<li>Do not call private files across package boundaries.</li>
				<li>Prefer generated API methods over hand-written fetch calls.</li>
				<li>Keep provider credentials outside committed config.</li>
			</ul>
		</DocPage>
	);
}
