import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	CardGrid,
	Diagram,
	DiagramFlow,
	DiagramNode,
	DiagramRow,
	DocCard,
	DocHero,
} from '../../components/docs';

export function OttoRouterOverview() {
	return (
		<DocPage>
			<DocHero
				eyebrow="OttoRouter"
				title="One account, every frontier model"
				lede="Sign in once and reach Anthropic, OpenAI, Google, and more through a single balance. No per-provider API keys to collect, rotate, or leak."
				tags={['oauth', 'pay as you go', 'one balance', 'switch anytime']}
			/>

			<Diagram
				label="ottorouter / one credential, many providers"
				status="all systems go"
				md={`otto / your app
      |  OAuth bearer token
OttoRouter  api.ottorouter.org
      |  provider request forwarded unchanged
Anthropic · OpenAI · Google · Kimi · and more

usage is metered per request and deducted from one balance`}
			>
				<DiagramNode
					label="client"
					title="otto or your app"
					accent="lime"
					desc="One credential from `otto auth login ottorouter`, or an access token in your own code."
				/>
				<DiagramFlow label="oauth bearer" />
				<DiagramNode
					label="router"
					title="OttoRouter"
					accent="blue"
					emphasis
					desc="Verifies the token, checks your balance, forwards the request to the provider, and meters the cost per token."
				/>
				<DiagramFlow label="unchanged" />
				<DiagramRow cols={2}>
					<DiagramNode
						label="providers"
						title="Frontier models"
						accent="yellow"
						items={[
							'Anthropic · OpenAI · Google',
							'Kimi and other hosted models',
						]}
					/>
					<DiagramNode
						label="billing"
						title="One balance"
						accent="coral"
						items={['pay per request', 'top up from the dashboard']}
					/>
				</DiagramRow>
			</Diagram>

			<h2>Why use it</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="one account"
					title="No key juggling"
					accent="lime"
					desc="Stop collecting an API key per provider just to try a different model."
				/>
				<DocCard
					kicker="pay as you go"
					title="Per-request billing"
					accent="blue"
					desc="Usage is metered per token and deducted from a single balance."
				/>
				<DocCard
					kicker="switch anytime"
					title="Same balance"
					accent="yellow"
					desc="Change models mid-project without touching credentials."
				/>
			</CardGrid>

			<h2>Use from otto</h2>
			<p>
				Login runs an OAuth device flow against <code>dash.ottorouter.org</code>
				. Tokens are stored in otto's secure auth location, not in your project.
			</p>
			<CodeBlock>{`otto auth login ottorouter
otto models                              # pick an OttoRouter model
otto ask "hello" --provider ottorouter`}</CodeBlock>

			<h2>Use from an app</h2>
			<CodeBlock>{`bun add @ottorouter/ai-sdk ai`}</CodeBlock>
			<CodeBlock>{`import { createOttoRouter } from "@ottorouter/ai-sdk";

const ottorouter = createOttoRouter({
  accessToken: process.env.OTTOROUTER_ACCESS_TOKEN,
  baseURL: "https://api.ottorouter.org",
});`}</CodeBlock>

			<h2>Raw HTTP</h2>
			<p>
				The API accepts a standard OAuth bearer token. Requests are
				provider-shaped, so an existing Anthropic or OpenAI client usually works
				by changing the base URL and the auth header.
			</p>
			<CodeBlock>{`Authorization: Bearer <access-token>`}</CodeBlock>

			<Callout kind="note" title="Tokens are scoped">
				<p>
					Access tokens carry scopes such as <code>inference</code>. A token
					without the scope a route needs gets a <code>403</code> with{' '}
					<code>insufficient_scope</code> rather than silently failing.
				</p>
			</Callout>

			<h2>Related</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="billing"
					title="Balance & billing"
					accent="coral"
					desc="Top-ups, cost headers, and low-balance handling."
					href="/docs/ottorouter/payments"
				/>
				<DocCard
					kicker="apps"
					title="Integration guide"
					accent="blue"
					desc="Wire OttoRouter into your own service."
					href="/docs/ottorouter/integration"
				/>
				<DocCard
					kicker="ai sdk"
					title="AI SDK"
					accent="lime"
					desc="Use it from normal Vercel AI SDK calls."
					href="/docs/ai-sdk"
				/>
			</CardGrid>
		</DocPage>
	);
}
