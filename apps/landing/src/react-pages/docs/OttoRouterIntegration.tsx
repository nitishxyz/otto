import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import { Callout, DocHero, Steps } from '../../components/docs';

export function OttoRouterIntegration() {
	return (
		<DocPage>
			<DocHero
				eyebrow="OttoRouter"
				title="Integration guide"
				lede="Use OttoRouter from your own application, or from the otto CLI. The SDK is the supported path; raw HTTP works when the SDK cannot fit your runtime."
				tags={['@ottorouter/ai-sdk', 'oauth bearer', 'provider-shaped api']}
			/>

			<h2>Use the SDK</h2>
			<CodeBlock>{`bun add @ottorouter/ai-sdk ai`}</CodeBlock>
			<CodeBlock>{`import { createOttoRouter } from "@ottorouter/ai-sdk";
import { generateText } from "ai";

const ottorouter = createOttoRouter({
  accessToken: process.env.OTTOROUTER_ACCESS_TOKEN,
  baseURL: "https://api.ottorouter.org",
});

const result = await generateText({
  model: ottorouter.model("claude-sonnet-4-20250514"),
  prompt: "Hello",
});`}</CodeBlock>
			<p>
				The SDK attaches the bearer header, surfaces cost and balance from
				responses, and returns objects the AI SDK can use anywhere a model is
				expected.
			</p>

			<h2>Raw HTTP</h2>
			<p>
				Endpoints are provider-shaped. An existing Anthropic or OpenAI client
				usually needs only a new base URL and auth header.
			</p>
			<CodeBlock>{`curl https://api.ottorouter.org/v1/messages \\
  -H "Authorization: Bearer $OTTOROUTER_ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 256,
    "messages": [{ "role": "user", "content": "Hello" }]
  }'`}</CodeBlock>

			<h2>Getting a token</h2>
			<Steps
				items={[
					{
						title: 'Create an account',
						desc: 'Sign in at the OttoRouter dashboard and add balance.',
						code: 'https://dash.ottorouter.org',
					},
					{
						title: 'Authorize a client',
						desc: 'otto uses an OAuth device flow; your own app authorizes the same way.',
						code: 'otto auth login ottorouter',
					},
					{
						title: 'Use the access token',
						desc: 'Send it as a bearer token. Tokens carry scopes such as `inference`.',
						code: 'Authorization: Bearer <access-token>',
					},
				]}
			/>

			<Callout kind="warn" title="Treat tokens like any other secret">
				<p>
					An access token can spend your balance. Keep it in environment
					variables or a secret store, never in committed config or client-side
					bundles.
				</p>
			</Callout>

			<h2>Use with otto</h2>
			<CodeBlock>{`otto auth login ottorouter
otto models
otto ask "hello" --provider ottorouter`}</CodeBlock>

			<h2>Troubleshooting</h2>
			<table>
				<thead>
					<tr>
						<th>Symptom</th>
						<th>Cause</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>
							<code>401 invalid_token</code>
						</td>
						<td>Missing, malformed, or expired token — log in again</td>
					</tr>
					<tr>
						<td>
							<code>403 insufficient_scope</code>
						</td>
						<td>Token lacks the scope the route requires</td>
					</tr>
					<tr>
						<td>
							<code>402 insufficient_balance</code>
						</td>
						<td>
							Balance below the minimum — see{' '}
							<a href="/docs/ottorouter/payments">Balance &amp; billing</a>
						</td>
					</tr>
					<tr>
						<td>
							<code>400</code> on a model id
						</td>
						<td>
							Model not available on the router — check <code>otto models</code>
						</td>
					</tr>
				</tbody>
			</table>
		</DocPage>
	);
}
