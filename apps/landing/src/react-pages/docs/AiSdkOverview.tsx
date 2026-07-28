import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import { Callout, CardGrid, DocCard, DocHero } from '../../components/docs';

export function AiSdkOverview() {
	return (
		<DocPage>
			<DocHero
				eyebrow="AI SDK"
				title="OttoRouter models in normal AI SDK calls"
				lede="@ottorouter/ai-sdk returns model objects the Vercel AI SDK can use anywhere. One account and one balance instead of a key per provider."
				tags={['ai sdk v6', 'generateText', 'streamText', 'oauth']}
			/>

			<h2>Install</h2>
			<CodeBlock>{`bun add @ottorouter/ai-sdk ai`}</CodeBlock>

			<h2>Basic usage</h2>
			<CodeBlock>{`import { createOttoRouter } from "@ottorouter/ai-sdk";
import { generateText } from "ai";

const ottorouter = createOttoRouter({
  accessToken: process.env.OTTOROUTER_ACCESS_TOKEN,
  baseURL: "https://api.ottorouter.org",
});

const { text } = await generateText({
  model: ottorouter.model("claude-sonnet-4-20250514"),
  prompt: "Say hello in one sentence.",
});

console.log(text);`}</CodeBlock>

			<h2>Streaming</h2>
			<CodeBlock>{`import { streamText } from "ai";

const result = streamText({
  model: ottorouter.model("claude-sonnet-4-20250514"),
  prompt: "Write a short changelog.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}`}</CodeBlock>

			<h2>Switching models</h2>
			<p>
				Every model on the router shares the same credential and balance, so
				changing models is a one-line change with no new setup.
			</p>
			<CodeBlock>{`ottorouter.model("claude-sonnet-4-20250514")
ottorouter.model("gpt-5-mini")`}</CodeBlock>

			<Callout kind="warn" title="Keep the token server-side">
				<p>
					An access token can spend your balance. Read it from the environment
					on a server; never ship it in a browser bundle.
				</p>
			</Callout>

			<h2>Related</h2>
			<CardGrid cols={3}>
				<DocCard
					kicker="options"
					title="Configuration"
					accent="blue"
					desc="Base URL, callbacks, and environment variables."
					href="/docs/ai-sdk/configuration"
				/>
				<DocCard
					kicker="cost"
					title="Caching"
					accent="lime"
					desc="Cut spend on long, repeated prompts."
					href="/docs/ai-sdk/caching"
				/>
				<DocCard
					kicker="account"
					title="Balance & billing"
					accent="coral"
					desc="Top-ups, cost headers, and 402 handling."
					href="/docs/ottorouter/payments"
				/>
			</CardGrid>
		</DocPage>
	);
}
