import { describe, expect, test } from 'bun:test';
import {
	detectSecurePrompt,
	hasAuthenticationFailure,
	normalizeSudoCommand,
} from '../packages/server/src/runtime/tools/secure-prompt.ts';

describe('secure command prompt detection', () => {
	test.each([
		['[sudo] password for alice: ', 'password'],
		['Passphrase: ', 'password'],
		["alice@example.com's password: ", 'password'],
		["Password for 'https://alice@example.com': ", 'password'],
		['Password (alice@example.com): ', 'password'],
		['Enter passphrase for key "/home/alice/.ssh/id_ed25519": ', 'password'],
		['Verification code: ', 'password'],
		["Username for 'https://example.com': ", 'text'],
		['Do you want to continue? [Y/n] ', 'text'],
		['Enter project name: ', 'text'],
		['Choose an environment: ', 'text'],
		['Your email: ', 'text'],
		[
			'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
			'text',
		],
	] as const)('detects %s', (prompt, inputKind) => {
		expect(detectSecurePrompt(prompt)).toEqual({
			prompt: prompt.trim(),
			inputKind,
		});
	});

	test.each([
		'Press Enter to continue...',
		'Project name (default: my-app): ',
		'Optional label [optional]: ',
	])('allows an empty response for %s', (prompt) => {
		expect(detectSecurePrompt(prompt)).toEqual({
			prompt: prompt.trim(),
			inputKind: 'text',
			allowEmpty: true,
		});
	});

	test('detects prompts after ANSI output and command logs', () => {
		expect(
			detectSecurePrompt(
				"Connecting...\r\n\u001b[33mPassword for 'https://git.example.com': \u001b[0m",
			),
		).toEqual({
			prompt: "Password for 'https://git.example.com':",
			inputKind: 'password',
		});
	});

	test('recognizes authentication failures before repeated prompts', () => {
		expect(
			hasAuthenticationFailure('Permission denied, please try again.'),
		).toBe(true);
		expect(hasAuthenticationFailure('Authenticated successfully')).toBe(false);
	});

	test('does not classify ordinary output as a prompt', () => {
		expect(
			detectSecurePrompt('Password authentication is disabled.\n'),
		).toBeNull();
	});

	test('normalizes sudo to read a password from stdin', () => {
		if (process.platform === 'win32') return;
		expect(normalizeSudoCommand('sudo whoami')).toBe(
			'sudo -S -p "[sudo] password for %u: " whoami',
		);
	});
});
