import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import {
	Callout,
	Diagram,
	DiagramFlow,
	DiagramNode,
	DiagramRow,
	DocHero,
} from '../../components/docs';

export function OttoRouterPayments() {
	return (
		<DocPage>
			<DocHero
				eyebrow="OttoRouter"
				title="Balance & billing"
				lede="One prepaid balance covers every provider. Each request is metered per token and deducted immediately, and the response tells you exactly what it cost."
				tags={['prepaid balance', 'per-token metering', 'cost headers']}
			/>

			<Diagram
				label="billing / metered per request"
				status="prepaid"
				md={`top up in the dashboard  ->  account balance
request  ->  router checks balance  ->  provider  ->  response
                                                       x-cost-usd
                                                       x-balance-remaining

balance below the minimum -> 402 Payment Required`}
			>
				<DiagramRow cols={3}>
					<DiagramNode
						label="fund"
						title="Top up"
						accent="lime"
						desc="Add credit from the OttoRouter dashboard."
					/>
					<DiagramNode
						label="spend"
						title="Per request"
						accent="blue"
						desc="Input and output tokens priced per model, deducted as you go."
					/>
					<DiagramNode
						label="observe"
						title="Cost headers"
						accent="yellow"
						desc="Every response reports its cost and your remaining balance."
					/>
				</DiagramRow>
				<DiagramFlow label="balance too low" />
				<DiagramNode
					label="guard"
					title="402 Payment Required"
					accent="coral"
					emphasis
					desc="Requests are rejected before they reach a provider, so you never accrue a surprise bill."
				/>
			</Diagram>

			<h2>Identity</h2>
			<p>
				Requests are tied to your OttoRouter account through an OAuth bearer
				token — there is no separate billing credential to manage.
			</p>
			<CodeBlock>{`otto auth login ottorouter    # OAuth device flow`}</CodeBlock>
			<CodeBlock>{`Authorization: Bearer <access-token>`}</CodeBlock>

			<h2>Topping up</h2>
			<p>
				Balance is managed from the dashboard at{' '}
				<a href="https://dash.ottorouter.org">dash.ottorouter.org</a>. Check the
				dashboard for the payment methods and currencies currently offered in
				your region.
			</p>

			<h2>Checking your balance</h2>
			<CodeBlock>{`curl -H "Authorization: Bearer $OTTOROUTER_ACCESS_TOKEN" \\
  https://api.ottorouter.org/v1/balance`}</CodeBlock>

			<h2>Reading cost from a response</h2>
			<p>Non-streaming responses return cost and balance as headers:</p>
			<CodeBlock>{`x-cost-usd: 0.00001234
x-balance-remaining: 4.99998766`}</CodeBlock>
			<p>
				Streaming responses append the same information as an SSE comment at the
				end of the stream, so it does not interfere with normal parsing:
			</p>
			<CodeBlock>{`: ottorouter {"cost_usd":"0.00000904","balance_remaining":"4.99856275","input_tokens":20,"output_tokens":11}`}</CodeBlock>

			<h2>Running out of balance</h2>
			<p>
				Below the minimum balance the router responds with{' '}
				<code>402 Payment Required</code> and an{' '}
				<code>insufficient_balance</code> error before forwarding anything
				upstream.
			</p>
			<CodeBlock>{`{
  "error": {
    "message": "Balance too low. Please top up.",
    "type": "insufficient_balance",
    "current_balance": "0.00",
    "minimum_balance": "0.05"
  }
}`}</CodeBlock>

			<Callout kind="tip" title="Handle 402 in long-running agents">
				<p>
					An agent mid-task will fail on a <code>402</code> like any other
					error. Surface it clearly rather than retrying in a loop — retries
					cannot succeed until the balance is topped up.
				</p>
			</Callout>

			<h2>Caching lowers cost</h2>
			<p>
				Cached input tokens are billed at the provider's reduced cache-read
				rate. See <a href="/docs/ai-sdk/caching">Caching</a> for how to keep
				prompts cacheable.
			</p>

			<h2>Using it from otto</h2>
			<CodeBlock>{`otto auth login ottorouter
otto ask "hello" --provider ottorouter`}</CodeBlock>
			<p>
				otto shows per-session token usage and cost in the TUI and web UI, so
				you can see spend without opening the dashboard.
			</p>
		</DocPage>
	);
}
