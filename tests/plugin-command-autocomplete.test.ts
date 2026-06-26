import { describe, expect, test } from 'bun:test';
import {
	findPluginCommandEntry,
	getMissingRequiredParams,
	getPluginCommandStage,
	getPluginNamespaces,
	pluginCommandRows,
	pluginNamespaceCommands,
	pluginParameterRows,
} from '../packages/web-sdk/src/lib/commands';
import type { PluginCommandListEntry } from '../packages/web-sdk/src/lib/api-client/plugins';

const commands: PluginCommandListEntry[] = [
	{
		plugin: 'serve-sim',
		command: 'start',
		label: 'Start serve-sim',
		description: 'Start the serve-sim preview server.',
		scope: 'global',
		parameters: {
			port: {
				type: 'string',
				description: 'Preview server port.',
				default: '3200',
			},
			device: {
				type: 'string',
				description: 'Target device.',
				required: true,
			},
		},
	},
	{
		plugin: 'serve-sim',
		command: 'doctor',
		label: 'Check simulator dependencies',
		scope: 'global',
	},
	{
		plugin: 'playwright',
		command: 'install',
		scope: 'project',
	},
];

const namespaces = ['serve-sim', 'playwright'];

describe('plugin command autocomplete helpers', () => {
	test('getPluginNamespaces dedupes by plugin name', () => {
		expect(getPluginNamespaces(commands).map((n) => n.name)).toEqual([
			'serve-sim',
			'playwright',
		]);
	});

	test('pluginNamespaceCommands builds root rows with concise descriptions', () => {
		const rows = pluginNamespaceCommands(getPluginNamespaces(commands));
		expect(rows[0]).toMatchObject({
			id: 'plugin:serve-sim',
			label: '/serve-sim',
			description: 'serve-sim plugin commands',
			kind: 'plugin',
		});
	});

	test('pluginCommandRows scopes to a namespace and prefers description', () => {
		const rows = pluginCommandRows('serve-sim', commands);
		expect(rows.map((r) => r.id)).toEqual([
			'plugin-command:serve-sim:start',
			'plugin-command:serve-sim:doctor',
		]);
		expect(rows[0].label).toBe('/serve-sim start');
		expect(rows[0].description).toBe('Start the serve-sim preview server.');
		// Falls back to label when description is absent.
		expect(rows[1].description).toBe('Check simulator dependencies');
	});

	test('pluginParameterRows includes description, default, and required marker', () => {
		const entry = findPluginCommandEntry(commands, 'serve-sim', 'start');
		expect(entry).toBeDefined();
		const rows = pluginParameterRows(entry as PluginCommandListEntry);
		const port = rows.find((r) => r.label === '--port');
		const device = rows.find((r) => r.label === '--device');
		expect(port?.description).toBe('Preview server port., default 3200');
		expect(device?.description).toBe('Target device., required');
	});

	test('getPluginCommandStage returns root for a single token', () => {
		expect(getPluginCommandStage('/serve', namespaces)).toEqual({
			kind: 'root',
			query: 'serve',
		});
	});

	test('getPluginCommandStage returns namespace after a known namespace + space', () => {
		expect(getPluginCommandStage('/serve-sim ', namespaces)).toEqual({
			kind: 'namespace',
			namespace: 'serve-sim',
			query: '',
		});
		expect(getPluginCommandStage('/serve-sim sta', namespaces)).toEqual({
			kind: 'namespace',
			namespace: 'serve-sim',
			query: 'sta',
		});
	});

	test('getPluginCommandStage returns params after namespace + command', () => {
		expect(getPluginCommandStage('/serve-sim start --po', namespaces)).toEqual({
			kind: 'params',
			namespace: 'serve-sim',
			command: 'start',
			query: 'po',
		});
	});

	test('getPluginCommandStage falls back to root for unknown namespace', () => {
		expect(getPluginCommandStage('/unknown thing', namespaces)).toEqual({
			kind: 'root',
			query: 'unknown',
		});
	});

	test('getPluginCommandStage ignores non-slash input', () => {
		expect(getPluginCommandStage('hello world', namespaces)).toBeUndefined();
	});

	test('getMissingRequiredParams reports required flags not yet provided', () => {
		const entry = findPluginCommandEntry(
			commands,
			'serve-sim',
			'start',
		) as PluginCommandListEntry;
		expect(getMissingRequiredParams(entry, '/serve-sim start')).toEqual([
			'device',
		]);
		expect(
			getMissingRequiredParams(entry, '/serve-sim start --device iphone'),
		).toEqual([]);
		// port has a default, so it is never reported as missing.
		expect(
			getMissingRequiredParams(entry, '/serve-sim start --device iphone'),
		).not.toContain('port');
	});
});
