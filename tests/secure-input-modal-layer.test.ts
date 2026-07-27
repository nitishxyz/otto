import { describe, expect, test } from 'bun:test';

describe('secure input modal layering', () => {
	test('renders through a body portal above all app modals', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/chat/InputSecureInputBar.tsx',
		).text();

		expect(source).toContain('createPortal(');
		expect(source).toContain('document.body');
		expect(source).toContain('z-[2147483647]');
		expect(source).toContain('data-native-overlay-root="true"');
	});
});
