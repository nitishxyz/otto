import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function AiSdkConfiguration() {
	return (
		<DocPage>
			<h1 className="text-3xl font-bold mb-2">AI SDK Configuration</h1>
			<p className="text-otto-dim text-sm mb-8">
				Common configuration for <code>@ottocode/ai-sdk</code>.
			</p>

			<h2>Private key auth</h2>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  auth: { privateKey: process.env.OTTOROUTER_PRIVATE_KEY! },
});`}</CodeBlock>

			<h2>External signer</h2>
			<p>
				Use a signer when your app cannot or should not expose the wallet
				private key to the SDK instance.
			</p>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  auth: {
    signer: {
      walletAddress: "PUBLIC_KEY",
      signNonce: async (nonce) => signMessage(nonce),
      signTransaction: async (transaction) => signTransaction(transaction),
    },
  },
});`}</CodeBlock>

			<h2>Base URL and RPC</h2>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  auth,
  baseURL: "https://api.ottorouter.org",
  rpcURL: "https://api.mainnet-beta.solana.com",
});`}</CodeBlock>

			<h2>Payment callbacks</h2>
			<p>
				Use callbacks to observe payment flow, update UI, or ask the user before
				signing a top-up.
			</p>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  auth,
  callbacks: {
    onPaymentRequired: (amountUsd, currentBalance) => {},
    onPaymentSigning: () => {},
    onPaymentComplete: (payment) => {},
    onPaymentError: (error) => {},
    onBalanceUpdate: (usage) => {},
    onPaymentApproval: async (request) => "crypto",
  },
});`}</CodeBlock>

			<h2>Environment variables</h2>
			<CodeBlock>{`OTTOROUTER_PRIVATE_KEY=...
OTTOROUTER_BASE_URL=...
OTTOROUTER_SOLANA_RPC_URL=...`}</CodeBlock>

			<h2>Use with otto CLI</h2>
			<CodeBlock>{`otto auth login ottorouter
otto ask "hello" --provider ottorouter`}</CodeBlock>
		</DocPage>
	);
}
