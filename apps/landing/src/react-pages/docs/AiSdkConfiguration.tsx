import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import { Callout, DocHero } from '../../components/docs';

export function AiSdkConfiguration() {
	return (
		<DocPage>
			<DocHero
				eyebrow="AI SDK"
				title="Configuration"
				lede="Credentials, base URL, and the callbacks worth wiring up before you ship."
				tags={['accessToken', 'baseURL', 'callbacks']}
			/>

			<h2>Credentials</h2>
			<p>
				The SDK authenticates with an OttoRouter OAuth access token sent as a
				bearer header.
			</p>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  accessToken: process.env.OTTOROUTER_ACCESS_TOKEN,
});`}</CodeBlock>

			<h2>Base URL</h2>
			<p>Override when pointing at a self-hosted or staging router.</p>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  accessToken,
  baseURL: "https://api.ottorouter.org",
});`}</CodeBlock>

			<h2>Callbacks</h2>
			<p>
				Use callbacks to keep your UI honest about spend and to fail loudly when
				the balance runs out.
			</p>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  accessToken,
  callbacks: {
    onBalanceUpdate: (usage) => {},
    onPaymentRequired: (amountUsd, currentBalance) => {},
    onPaymentError: (error) => {},
  },
});`}</CodeBlock>

			<Callout kind="note" title="Check the package for the current surface">
				<p>
					Options evolve with the router. Treat the{' '}
					<code>@ottorouter/ai-sdk</code> package types as the source of truth
					and this page as orientation.
				</p>
			</Callout>

			<h2>Environment variables</h2>
			<CodeBlock>{`OTTOROUTER_ACCESS_TOKEN=...
OTTOROUTER_BASE_URL=...`}</CodeBlock>

			<h2>Use with the otto CLI</h2>
			<p>
				otto manages its own OttoRouter credentials — you do not need to set
				environment variables for CLI usage.
			</p>
			<CodeBlock>{`otto auth login ottorouter
otto ask "hello" --provider ottorouter`}</CodeBlock>
		</DocPage>
	);
}
