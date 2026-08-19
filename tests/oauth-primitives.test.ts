import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { getBrowserCommand } from '../packages/sdk/src/auth/src/open-browser';
import {
	createOAuthState,
	createPkcePair,
} from '../packages/sdk/src/auth/src/oauth-primitives';

const BASE64URL_VALUE = /^[A-Za-z0-9_-]{43}$/;

describe('OAuth primitives', () => {
	test('creates a valid S256 PKCE pair', () => {
		const pair = createPkcePair();

		expect(pair.verifier).toMatch(BASE64URL_VALUE);
		expect(pair.challenge).toBe(
			createHash('sha256').update(pair.verifier).digest('base64url'),
		);
	});

	test('creates independent base64url state values', () => {
		const first = createOAuthState();
		const second = createOAuthState();

		expect(first).toMatch(BASE64URL_VALUE);
		expect(second).toMatch(BASE64URL_VALUE);
		expect(first).not.toBe(second);
	});
});

describe('external browser command selection', () => {
	const url = 'https://example.com/callback?x=1&next=$(echo pwned);"quoted"';

	test('passes macOS URLs as a single argument', () => {
		expect(getBrowserCommand(url, 'darwin')).toEqual({
			command: 'open',
			args: [url],
		});
	});

	test('passes Windows URLs without invoking a command shell', () => {
		expect(getBrowserCommand(url, 'win32')).toEqual({
			command: 'rundll32.exe',
			args: ['url.dll,FileProtocolHandler', url],
		});
	});

	test('passes Linux URLs as a single argument', () => {
		expect(getBrowserCommand(url, 'linux')).toEqual({
			command: 'xdg-open',
			args: [url],
		});
	});
});
