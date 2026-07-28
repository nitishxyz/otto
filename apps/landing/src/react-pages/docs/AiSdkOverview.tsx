import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function AiSdkOverview() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">AI SDK</h1>
			<p className="text-otto-dim text-sm mb-8">
				Use <code>@ottorouter/ai-sdk</code> with Vercel AI SDK and OttoRouter.
			</p>

			<h2>What it is</h2>
			<p>
				The package creates AI SDK-compatible model objects that send requests
				through OttoRouter. It is for app developers who want wallet-based
				OttoRouter access from normal AI SDK calls.
			</p>

			<h2>Install</h2>
			<CodeBlock>{`bun add @ottorouter/ai-sdk ai`}</CodeBlock>

			<h2>Basic usage</h2>
			<CodeBlock>{`import { createOttoRouter } from "@ottorouter/ai-sdk";
import { generateText } from "ai";

const ottorouter = createOttoRouter({
  auth: { privateKey: process.env.OTTOROUTER_PRIVATE_KEY! },
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

			<h2>Auth options</h2>
			<ul>
				<li>
					Use <code>OTTOROUTER_PRIVATE_KEY</code> for server-side scripts.
				</li>
				<li>
					Use an external signer when a wallet, hardware signer, or app-specific
					signing flow owns the private key.
				</li>
			</ul>

			<h2>Related pages</h2>
			<ul>
				<li>
					<a href="/docs/ai-sdk/configuration">AI SDK configuration</a>
				</li>
				<li>
					<a href="/docs/ai-sdk/caching">Caching</a>
				</li>
				<li>
					<a href="/docs/ottorouter/integration">OttoRouter integration</a>
				</li>
			</ul>
		</DocPage>
	);
}
