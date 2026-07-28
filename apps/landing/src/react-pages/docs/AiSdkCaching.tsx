import { CodeBlock } from '../../components/CodeBlock';
import { DocPage } from '../../components/DocPage';
import { Callout, DocHero } from '../../components/docs';

export function AiSdkCaching() {
	return (
		<DocPage>
			<DocHero
				eyebrow="AI SDK"
				title="Prompt caching"
				lede="Cached input tokens bill at the provider's reduced cache-read rate. On long system prompts that is the single biggest lever on cost."
				tags={['anthropic cache-control', 'cache keys', 'lower cost']}
			/>

			<h2>Anthropic cache control</h2>
			<p>
				The SDK can add Anthropic cache-control metadata automatically. Keep it
				on for long, repeated system prompts; turn it off when you are
				inspecting raw request bodies.
			</p>
			<CodeBlock>{`createOttoRouter({ accessToken });   // caching on by default

createOttoRouter({
  accessToken,
  cache: { anthropicCaching: false },
});`}</CodeBlock>

			<h2>Manual control</h2>
			<p>
				Use manual mode when your app already sets provider-specific caching
				fields itself.
			</p>
			<CodeBlock>{`createOttoRouter({
  accessToken,
  cache: {
    anthropicCaching: { strategy: "manual" },
  },
});`}</CodeBlock>

			<h2>Cache keys</h2>
			<p>
				Choose keys that are stable per application context — a project or
				session id works well.
			</p>
			<CodeBlock>{`createOttoRouter({
  accessToken,
  cache: {
    promptCacheKey: "project-or-session-key",
    promptCacheRetention: "in_memory",
  },
});`}</CodeBlock>

			<Callout kind="warn" title="Never put secrets in a cache key">
				<p>
					Cache keys are identifiers, not credentials. Keep user secrets and
					tokens out of them.
				</p>
			</Callout>

			<h2>What it saves</h2>
			<p>
				Cached reads are billed at the provider's cache-read rate rather than
				the full input rate, and appear in the usual cost headers. See{' '}
				<a href="/docs/ottorouter/payments">Balance &amp; billing</a>.
			</p>
		</DocPage>
	);
}
