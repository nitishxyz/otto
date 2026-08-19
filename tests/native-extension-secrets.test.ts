import { describe, expect, test } from 'bun:test';
import { collectNativeExtensionSecrets } from '../packages/sdk/src/core/src/tools/extensions/secrets.ts';

describe('native extension secrets', () => {
	const definitions = [
		{ name: 'required-token', env: 'REQUIRED_TOKEN', required: true },
		{ name: 'optional-token', env: 'OPTIONAL_TOKEN', required: false },
	] as const;

	test('collects required and present optional secrets from injected env', () => {
		expect(
			collectNativeExtensionSecrets(definitions, {
				environment: {
					REQUIRED_TOKEN: 'required',
					OPTIONAL_TOKEN: 'optional',
				},
				toolName: 'plugin__tool',
			}),
		).toEqual({
			'required-token': 'required',
			'optional-token': 'optional',
		});
	});

	test('omits missing optional secrets', () => {
		expect(
			collectNativeExtensionSecrets(definitions, {
				environment: { REQUIRED_TOKEN: 'required' },
				toolName: 'plugin__tool',
			}),
		).toEqual({ 'required-token': 'required' });
	});

	test('reports missing required secrets consistently with the tool name', () => {
		expect(() =>
			collectNativeExtensionSecrets(definitions, {
				environment: {},
				toolName: 'plugin__tool',
			}),
		).toThrow(
			'Native tool plugin__tool requires secret required-token from REQUIRED_TOKEN',
		);
	});
});
