import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function OpenClawOttoRouter() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">OpenClaw + OttoRouter</h1>
			<p className="text-otto-dim text-sm mb-8">
				Use the OpenClaw OttoRouter package from this monorepo.
			</p>

			<h2>Package</h2>
			<p>
				The integration package lives in{' '}
				<code>packages/openclaw-ottorouter</code>
				and is published as <code>@ottocode/openclaw</code> when released.
			</p>

			<h2>What it does</h2>
			<p>
				The package bridges OpenClaw to OttoRouter so OpenClaw can send requests
				through the wallet-authenticated router instead of storing provider API
				keys directly in OpenClaw config.
			</p>

			<h2>Source checkout usage</h2>
			<p>When working from this repo, use Bun and the package scripts.</p>
			<CodeBlock>{`bun install
bun run --filter @ottocode/openclaw --help`}</CodeBlock>

			<h2>Wallet setup</h2>
			<p>
				The integration still needs OttoRouter wallet credentials. Keep the
				private key out of source control.
			</p>
			<CodeBlock>{`OTTOROUTER_PRIVATE_KEY=...`}</CodeBlock>

			<h2>Troubleshooting</h2>
			<ul>
				<li>Check the package README or CLI help for current commands.</li>
				<li>
					Check the local proxy/process is running before configuring OpenClaw.
				</li>
				<li>Use OttoRouter SDK docs for wallet and payment issues.</li>
			</ul>
		</DocPage>
	);
}
