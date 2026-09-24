import { describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemorySettings } from '../packages/web-sdk/src/components/settings/MemorySettings.tsx';
import type { MemoryConfigResponse } from '../packages/web-sdk/src/lib/api-client/memory.ts';
import { projectScopedKey } from '../packages/web-sdk/src/lib/api-client/utils.ts';

function render(data: MemoryConfigResponse): string {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(projectScopedKey(['config', 'memory'] as const), data);
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<MemorySettings onOpenJudgeSettings={() => {}} />
		</QueryClientProvider>,
	);
}

const base: MemoryConfigResponse = {
	settings: { enabled: true, autoCapture: true, recall: true },
	typesafe: { configured: false },
	path: '/Users/me/Library/Application Support/otto/memory.sqlite',
};

describe('MemorySettings', () => {
	it('prompts to set up TypeSafe when it is not configured', () => {
		const markup = render(base);
		expect(markup).toContain('TypeSafe is not configured');
		expect(markup).toContain('keyword-only recall');
		expect(markup).toContain('Set up TypeSafe');
		expect(markup).toContain('Active (keyword-only recall)');
		expect(markup).toContain('Requires TypeSafe');
		expect(markup).toContain('memory.sqlite');
	});

	it('hides the prompt and enables capture when TypeSafe is configured', () => {
		const markup = render({ ...base, typesafe: { configured: true } });
		expect(markup).not.toContain('TypeSafe is not configured');
		expect(markup).toContain('Active (TypeSafe ranking)');
		expect(markup).toContain('durability check');
	});

	it('shows disabled state and no prompt when memory is off', () => {
		const markup = render({
			...base,
			settings: { enabled: false, autoCapture: false, recall: false },
		});
		expect(markup).toContain('Disabled');
		expect(markup).not.toContain('TypeSafe is not configured');
	});
});
