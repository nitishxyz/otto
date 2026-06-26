import { describe, expect, test } from 'bun:test';
import {
	getMcpSourceLabel,
	isPluginManagedMcpServer,
} from '../packages/web-sdk/src/lib/mcp-source';

describe('mcp source label helpers', () => {
	test('user server falls back to scope when sourceLabel is the scope', () => {
		expect(
			getMcpSourceLabel({
				sourceLabel: 'project',
				sourcePlugin: undefined,
				scope: 'project',
			}),
		).toBe('project');
	});

	test('plugin server uses backend sourceLabel', () => {
		expect(
			getMcpSourceLabel({
				sourceLabel: 'plugin: serve-sim',
				sourcePlugin: 'serve-sim',
				scope: 'global',
			}),
		).toBe('plugin: serve-sim');
	});

	test('derives plugin label from sourcePlugin when sourceLabel missing', () => {
		expect(
			getMcpSourceLabel({
				sourceLabel: undefined,
				sourcePlugin: 'serve-sim',
				scope: 'global',
			}),
		).toBe('plugin: serve-sim');
	});

	test('falls back to scope when no source metadata present', () => {
		expect(
			getMcpSourceLabel({
				sourceLabel: undefined,
				sourcePlugin: undefined,
				scope: 'global',
			}),
		).toBe('global');
	});

	test('isPluginManagedMcpServer is true for managedByPlugin', () => {
		expect(
			isPluginManagedMcpServer({ managedByPlugin: true, sourceKind: 'user' }),
		).toBe(true);
	});

	test('isPluginManagedMcpServer is true for plugin sourceKind', () => {
		expect(
			isPluginManagedMcpServer({
				managedByPlugin: undefined,
				sourceKind: 'plugin',
			}),
		).toBe(true);
	});

	test('isPluginManagedMcpServer is false for plain user servers', () => {
		expect(
			isPluginManagedMcpServer({
				managedByPlugin: undefined,
				sourceKind: 'user',
			}),
		).toBe(false);
	});
});
