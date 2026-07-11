import { describe, expect, it } from 'bun:test';
import { normalizeDesktopRemoteUrl } from '../apps/desktop/src/lib/remote-url.ts';

describe('desktop remote URL normalization', () => {
	it('extracts and removes a project-share token', () => {
		expect(
			normalizeDesktopRemoteUrl(
				'https://xi4x6rocxr.ottorouter.org/?share=BYlTC8VGZvjnZYI',
			),
		).toEqual({
			apiUrl: 'https://xi4x6rocxr.ottorouter.org/',
			shareToken: 'BYlTC8VGZvjnZYI',
		});
	});

	it('preserves path, hash, and non-share query parameters', () => {
		const normalized = normalizeDesktopRemoteUrl(
			'https://device.example/api?foo=one&share=%20token-value%20&bar=two#sessions',
		);

		expect(normalized).toEqual({
			apiUrl: 'https://device.example/api?foo=one&bar=two#sessions',
			shareToken: 'token-value',
		});
	});

	it('leaves a plain daemon URL unchanged', () => {
		expect(normalizeDesktopRemoteUrl('http://192.168.1.50:9100')).toEqual({
			apiUrl: 'http://192.168.1.50:9100/',
			shareToken: undefined,
		});
	});
});
