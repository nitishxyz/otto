import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolResultRenderer } from '../packages/web-sdk/src/components/messages/renderers/index.tsx';
import { BrowserRenderer } from '../packages/web-sdk/src/components/messages/renderers/BrowserRenderer.tsx';

describe('browser tool renderer', () => {
	test('renders snapshot content with browser-specific element details', () => {
		const markup = renderToStaticMarkup(
			<BrowserRenderer
				contentJson={{
					args: { action: 'snapshot' },
					result: {
						ok: true,
						action: 'snapshot',
						url: 'https://example.com/',
						text: 'Example page',
						elements: [{ ref: '@e1', role: 'button', name: 'Continue' }],
					},
				}}
				toolDurationMs={25}
				isExpanded
				onToggle={() => {}}
			/>,
		);

		expect(markup).toContain('browser');
		expect(markup).toContain('inspecting page');
		expect(markup).toContain('Example page');
		expect(markup).toContain('@e1');
		expect(markup).toContain('Continue');
		expect(markup).not.toContain('&quot;elements&quot;');
	});

	test('shows the action and target in compact thread rows', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="browser"
				compact
				contentJson={{
					args: { action: 'click', selector: '@e7' },
					result: { ok: true, action: 'click', clicked: '@e7' },
				}}
			/>,
		);

		expect(markup).toContain('browser');
		expect(markup).toContain('clicking');
		expect(markup).toContain('@e7');
	});

	test('renders browser errors without the generic JSON renderer', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="Browser"
				contentJson={{
					args: { action: 'click', selector: '@e2' },
					result: { ok: false, error: 'Element not found: @e2' },
				}}
			/>,
		);

		expect(markup).toContain('browser error');
		expect(markup).not.toContain('&quot;ok&quot;');
	});
});
