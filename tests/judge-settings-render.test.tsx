import { describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { JudgeSettings } from '../packages/web-sdk/src/components/settings/JudgeSettings.tsx';
import type { JudgeConfigResponse } from '../packages/web-sdk/src/lib/api-client/judge.ts';
import { projectScopedKey } from '../packages/web-sdk/src/lib/api-client/utils.ts';

function render(data: JudgeConfigResponse): string {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(projectScopedKey(['config', 'judge'] as const), data);
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<JudgeSettings />
		</QueryClientProvider>,
	);
}

const base: JudgeConfigResponse = {
	settings: {
		enabled: true,
		provider: 'typesafe',
		baseURL: 'https://api.typesafe.ai',
		model: 'jev-latest',
		timeoutMs: 4000,
		mcp: { classifyTools: true, preloadTools: true, preloadThreshold: 0.5 },
	},
	credential: { configured: false, source: 'none', envVar: 'TYPESAFE_API_KEY' },
	defaults: {
		baseURL: 'https://api.typesafe.ai',
		model: 'jev-latest',
		timeoutMs: 4000,
		preloadThreshold: 0.5,
	},
};

describe('JudgeSettings', () => {
	it('prompts for a key when none is configured', () => {
		const markup = render(base);
		expect(markup).toContain('No credential');
		expect(markup).toContain('TYPESAFE_API_KEY');
		expect(markup).toContain('Classify MCP tools');
		expect(markup).toContain('Pre-load MCP tools');
		expect(markup).toContain('aria-label="Save API key"');
		expect(markup).not.toContain('Remove stored key');
	});

	it('shows active state and a remove action for a stored key', () => {
		const markup = render({
			...base,
			credential: {
				configured: true,
				source: 'stored',
				envVar: 'TYPESAFE_API_KEY',
			},
		});
		expect(markup).toContain('Active (stored key)');
		expect(markup).toContain('Remove stored key');
	});

	it('hides key management when the env var is set', () => {
		const markup = render({
			...base,
			credential: {
				configured: true,
				source: 'env',
				envVar: 'TYPESAFE_API_KEY',
			},
		});
		expect(markup).toContain('from the server environment');
		expect(markup).not.toContain('aria-label="Save API key"');
	});
});
