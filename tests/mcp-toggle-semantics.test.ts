import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('MCP toggle semantics', () => {
	test('web UI renders and toggles persisted enablement instead of connectivity', async () => {
		const source = await readFile(
			'packages/web-sdk/src/components/mcp/MCPSidebar.tsx',
			'utf8',
		);
		expect(source).toContain('checked={!server.disabled}');
		expect(source).toContain('if (!server.disabled) {');
		expect(source).not.toContain('checked={server.connected}');
		expect(source).toContain(
			'return [...filtered].sort((a, b) => a.name.localeCompare(b.name));',
		);
		expect(source).not.toContain('if (a.connected && !b.connected)');
	});

	test('TUI disables an enabled server even when its connection failed', async () => {
		const source = await readFile(
			'apps/tui/src/components/MCPOverlay.tsx',
			'utf8',
		);
		expect(source).toContain('if (!server.disabled) {');
		expect(source).toContain("? 'disabled'");
		expect(source).not.toContain('if (a.connected && !b.connected)');
		expect(source).toContain('disabled: !server.disabled');
	});

	test('web mutations optimistically update only the selected server', async () => {
		const source = await readFile(
			'packages/web-sdk/src/hooks/useMCP.ts',
			'utf8',
		);
		expect(source).toContain('updateServer(name, { disabled: false });');
		expect(source).toContain('updateServer(name, { disabled: true });');
	});

	test('server reconciliation restarts only the selected MCP', async () => {
		const source = await readFile(
			'packages/server/src/routes/mcp/service/reconcile.ts',
			'utf8',
		);
		expect(source).toContain('await manager.stopServer(name);');
		expect(source).toContain('await manager.restartServer(server);');
		expect(source).not.toContain('reloadMCPManager');
	});
});
