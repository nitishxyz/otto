import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForgeRenderer } from '../packages/web-sdk/src/components/messages/renderers/ForgeRenderer.tsx';
import { ToolResultRenderer } from '../packages/web-sdk/src/components/messages/renderers/index.tsx';

describe('ForgeRenderer', () => {
	it('renders capability mutations without generic JSON', () => {
		const markup = renderToStaticMarkup(
			<ForgeRenderer
				contentJson={{
					args: { action: 'create', kind: 'recipe', name: 'release-check' },
					result: {
						ok: true,
						applied: true,
						plan: {
							action: 'create',
							target: {
								kind: 'recipe',
								name: 'release-check',
								scope: 'project',
								paths: ['/repo/.otto/recipes/release-check.md'],
							},
							changes: ['Create release-check recipe'],
						},
					},
				}}
				toolDurationMs={30}
				isExpanded
				onToggle={() => {}}
			/>,
		);

		expect(markup).toContain('forge');
		expect(markup).toContain('create');
		expect(markup).toContain('release-check');
		expect(markup).toContain('/repo/.otto/recipes/release-check.md');
		expect(markup).not.toContain('&quot;applied&quot;');
	});

	it('renders Forge inventory counts', () => {
		const markup = renderToStaticMarkup(
			<ForgeRenderer
				contentJson={{
					args: { action: 'inventory' },
					result: {
						ok: true,
						inventory: {
							recipes: [{ name: 'release-check' }],
							skills: [{ name: 'bun-testing' }],
							agents: [],
							mcpServers: [{ name: 'github' }],
							plugins: [{ name: 'serve-sim' }],
						},
					},
				}}
				isExpanded
				onToggle={() => {}}
			/>,
		);

		expect(markup).toContain('4 capabilities');
		expect(markup).toContain('MCP servers');
		expect(markup).toContain('plugins');
	});

	it('routes Forge calls through the dedicated renderer', () => {
		const markup = renderToStaticMarkup(
			<ToolResultRenderer
				toolName="forge"
				contentJson={{
					args: {
						action: 'execute',
						kind: 'plugin-command',
						plugin: 'serve-sim',
						commandName: 'start',
					},
					result: {
						ok: true,
						renderedCommand: 'bun x serve-sim',
						terminalId: 'term-123',
						execution: 'started',
					},
				}}
				isExpanded
			/>,
		);

		expect(markup).toContain('run plugin command');
		expect(markup).toContain('serve-sim start');
		expect(markup).toContain('started');
		expect(markup).not.toContain('&quot;renderedCommand&quot;');
	});
});
