import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';

export function AiSdkCaching() {
	return (
		<DocPage>
			<h1 className="np-title mb-3">Caching</h1>
			<p className="text-otto-dim text-sm mb-8">
				Prompt caching options for <code>@ottorouter/ai-sdk</code>.
			</p>

			<h2>Anthropic cache control</h2>
			<p>
				The SDK can add Anthropic cache-control metadata for supported Anthropic
				requests. Keep this enabled for long, repeated system prompts; disable
				it when debugging request bodies.
			</p>
			<CodeBlock>{`createOttoRouter({ auth });

createOttoRouter({
  auth,
  cache: { anthropicCaching: false },
});`}</CodeBlock>

			<h2>Manual control</h2>
			<p>
				Use manual mode if your app already sets provider-specific caching
				fields.
			</p>
			<CodeBlock>{`createOttoRouter({
  auth,
  cache: {
    anthropicCaching: { strategy: "manual" },
  },
});`}</CodeBlock>

			<h2>Server-side cache keys</h2>
			<p>
				If you use OttoRouter cache keys, choose stable keys per application
				context and avoid putting user secrets into the key.
			</p>
			<CodeBlock>{`createOttoRouter({
  auth,
  cache: {
    promptCacheKey: "project-or-session-key",
    promptCacheRetention: "in_memory",
  },
});`}</CodeBlock>
		</DocPage>
	);
}
