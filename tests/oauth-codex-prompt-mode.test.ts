import { describe, expect, test } from 'bun:test';
import { composeSystemPrompt } from '../packages/server/src/runtime/prompt/builder.ts';
import {
	adaptRunnerCall,
	detectOAuth,
} from '../packages/server/src/runtime/provider/oauth-adapter.ts';

describe('oauth codex prompt mode', () => {
	test('composes base, agent, and dedicated OpenAI OAuth provider guidance', async () => {
		const result = await composeSystemPrompt({
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectRoot: process.cwd(),
			agentPrompt: 'OPENAI_OAUTH_AGENT_MARKER',
			includeEnvironment: false,
			isOpenAIOAuth: true,
		});

		expect(result.components.slice(0, 3)).toEqual([
			'base',
			'agent',
			'provider:openai-oauth',
		]);
		expect(result.components).toContain('base');
		expect(result.components).toContain('provider:openai-oauth');
		expect(result.prompt).toContain('OPENAI_OAUTH_AGENT_MARKER');
		expect(result.prompt).toContain(
			'Provider identity: OpenAI OAuth through the Codex backend.',
		);
		expect(result.prompt.toLowerCase()).toContain(
			'your turn ends when you stop calling tools',
		);
		expect(result.prompt.toLowerCase()).not.toContain('finish` tool');
	});

	test('keeps base prompt for non-oauth openai', async () => {
		const result = await composeSystemPrompt({
			provider: 'openai',
			model: 'gpt-5.3-codex',
			projectRoot: process.cwd(),
			agentPrompt: '',
			includeEnvironment: false,
			isOpenAIOAuth: false,
		});

		expect(result.components).toContain('base');
		expect(result.components).not.toContain('provider:openai-oauth');
		expect(result.prompt.toLowerCase()).toContain(
			'your turn ends when you stop calling tools',
		);
	});

	test('preserves shared composition through every OAuth transport', async () => {
		for (const provider of [
			'openai',
			'anthropic',
			'xai',
			'kimi',
			'ottorouter',
			'copilot',
		]) {
			const oauth = detectOAuth(provider, { type: 'oauth' });
			const composed = await composeSystemPrompt({
				provider,
				projectRoot: process.cwd(),
				agentPrompt: `OAUTH_AGENT_MARKER_${provider}`,
				includeEnvironment: false,
				isOpenAIOAuth: oauth.isOpenAIOAuth,
			});
			const adapted = adaptRunnerCall(oauth, composed, {
				provider,
				rawMaxOutputTokens: 1_000,
			});
			const deliveredInstructions = [
				adapted.system,
				...adapted.additionalSystemMessages.map((message) => message.content),
				readOpenAIInstructions(adapted.providerOptions),
			].join('\n');

			expect(composed.components).toContain('base');
			expect(composed.components).toContain('agent');
			expect(deliveredInstructions).toContain(`OAUTH_AGENT_MARKER_${provider}`);
			expect(deliveredInstructions.toLowerCase()).toContain(
				'your turn ends when you stop calling tools',
			);
		}
	});
});

function readOpenAIInstructions(
	providerOptions: Record<string, unknown>,
): string {
	const openai = providerOptions.openai;
	if (!openai || typeof openai !== 'object') return '';
	const instructions = (openai as Record<string, unknown>).instructions;
	return typeof instructions === 'string' ? instructions : '';
}
