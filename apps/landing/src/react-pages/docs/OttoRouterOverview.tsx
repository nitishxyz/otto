import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function OttoRouterOverview() {
	return (
		<DocPage>
			<h1 className="flex items-center gap-3 text-3xl font-bold mb-2">
				<svg
					aria-hidden="true"
					className="w-7 h-7 shrink-0 text-[#9333ea]"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<circle cx="12" cy="12" r="8" />
					<path d="M12 2v7.5" />
					<path d="m19 5-5.23 5.23" />
					<path d="M22 12h-7.5" />
					<path d="m19 19-5.23-5.23" />
					<path d="M12 14.5V22" />
					<path d="M10.23 13.77 5 19" />
					<path d="M9.5 12H2" />
					<path d="M10.23 10.23 5 5" />
					<circle cx="12" cy="12" r="2.5" />
				</svg>
				OttoRouter
			</h1>
			<p className="text-otto-dim text-sm mb-8">
				Wallet-authenticated access to model providers through one router.
			</p>

			<h2>What it is</h2>
			<p>
				OttoRouter is the provider route used by otto and the
				<code>@ottorouter/ai-sdk</code> package. It lets a client authenticate
				with a Solana wallet instead of a provider API key.
			</p>

			<h2>Use from otto</h2>
			<CodeBlock>{`otto auth login ottorouter
otto ask "hello" --provider ottorouter`}</CodeBlock>

			<h2>Use from an app</h2>
			<CodeBlock>{`bun add @ottorouter/ai-sdk ai`}</CodeBlock>
			<CodeBlock>{`import { createOttoRouter } from "@ottorouter/ai-sdk";

const ottorouter = createOttoRouter({
  auth: { privateKey: process.env.OTTOROUTER_PRIVATE_KEY! },
});`}</CodeBlock>

			<h2>Raw HTTP</h2>
			<p>
				If you do not use the SDK, you must sign requests with the wallet and
				include the wallet auth headers expected by the router. Prefer the SDK
				unless you specifically need raw HTTP.
			</p>

			<h2>Related pages</h2>
			<ul>
				<li>
					<a href="/docs/ottorouter/integration">Integration guide</a>
				</li>
				<li>
					<a href="/docs/ottorouter/payments">Payments</a>
				</li>
				<li>
					<a href="/docs/ai-sdk">AI SDK</a>
				</li>
			</ul>
		</DocPage>
	);
}
