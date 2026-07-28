import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function OttoRouterPayments() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">Payments</h1>
			<p className="text-otto-dim text-sm mb-8">
				How OttoRouter identifies wallets and handles balance/top-up flows.
			</p>

			<h2>Wallet auth</h2>
			<p>
				OttoRouter requests are associated with a Solana wallet. The SDK handles
				request signing for you; raw HTTP clients must include wallet auth
				headers.
			</p>
			<CodeBlock>{`x-wallet-address: <solana-public-key>
x-wallet-signature: <signature>
x-wallet-nonce: <nonce>`}</CodeBlock>

			<h2>Recommended payment path</h2>
			<p>
				Use <code>@ottorouter/ai-sdk</code> so payment-required responses,
				transaction signing, retries, and balance updates are handled in one
				place.
			</p>
			<CodeBlock>{`const ottorouter = createOttoRouter({
  auth,
  callbacks: {
    onPaymentRequired: (amountUsd, currentBalance) => {},
    onPaymentComplete: (payment) => {},
    onPaymentError: (error) => {},
    onBalanceUpdate: (usage) => {},
  },
});`}</CodeBlock>

			<h2>CLI setup</h2>
			<CodeBlock>{`otto auth login ottorouter
otto ask "hello" --provider ottorouter`}</CodeBlock>

			<h2>Safety notes</h2>
			<ul>
				<li>Never commit a wallet private key.</li>
				<li>Use an external signer for browser or user-wallet flows.</li>
				<li>Surface payment errors clearly before retrying large requests.</li>
				<li>Check the live API/SDK for current top-up options and limits.</li>
			</ul>
		</DocPage>
	);
}
