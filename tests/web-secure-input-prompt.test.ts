import { describe, expect, test } from 'bun:test';
import { allowsEmptySecureInput } from '../packages/web-sdk/src/lib/secure-input-prompt.ts';

describe('web secure input prompt compatibility', () => {
	test.each([
		'Press Enter to continue...',
		'Hit return when ready',
		'Project name (default: my-app):',
		'Optional label [optional]:',
	])('allows an empty response for %s', (prompt) => {
		expect(allowsEmptySecureInput(prompt)).toBe(true);
	});

	test('honors the explicit server field', () => {
		expect(allowsEmptySecureInput('Custom prompt', true)).toBe(true);
	});

	test('still requires text for ordinary prompts', () => {
		expect(allowsEmptySecureInput('Enter project name:')).toBe(false);
	});
});
