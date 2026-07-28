import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function OttoRouterIntegration() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">OttoRouter Integration</h1>
			<p className="text-otto-dim text-sm mb-8">
				Use OttoRouter from an application or from the otto CLI.
			</p>

			<h2>Use the SDK</h2>
			<p>
				The supported integration path is <code>@ottorouter/ai-sdk</code>. It
				wraps wallet auth and returns AI SDK-compatible models.
			</p>
			<CodeBlock>{`bun add @ottorouter/ai-sdk ai`}</CodeBlock>
			<CodeBlock>{`import { createOttoRouter } from "@ottorouter/ai-sdk";
import { generateText } from "ai";

const ottorouter = createOttoRouter({
  auth: { privateKey: process.env.OTTOROUTER_PRIVATE_KEY! },
});

const result = await generateText({
  model: ottorouter.model("claude-sonnet-4-20250514"),
  prompt: "Hello",
});`}</CodeBlock>

			<h2>Use an external signer</h2>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  auth: {
    signer: {
      walletAddress: "PUBLIC_KEY",
      signNonce: async (nonce) => signMessage(nonce),
      signTransaction: async (transaction) => signTransaction(transaction),
    },
  },
});`}</CodeBlock>

			<h2>Raw HTTP</h2>
			<p>
				Raw HTTP clients must implement wallet auth and payment handling. Use
				raw HTTP only if the SDK cannot fit your runtime.
			</p>
			<CodeBlock>{`x-wallet-address: <solana-public-key>
x-wallet-signature: <signature>
x-wallet-nonce: <nonce>`}</CodeBlock>

			<h2>Use with otto</h2>
			<CodeBlock>{`otto auth login ottorouter
otto ask "hello" --provider ottorouter`}</CodeBlock>

			<h2>Troubleshooting</h2>
			<ul>
				<li>Check that the wallet private key is base58 encoded.</li>
				<li>Check wallet balance/top-up state before large requests.</li>
				<li>
					Use SDK callbacks to surface payment or balance errors in your UI.
				</li>
			</ul>
		</DocPage>
	);
}
