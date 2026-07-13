import { describe, expect, test } from 'bun:test';
import { ottorouterLogo as webSdkOttorouterLogo } from '../packages/web-sdk/src/assets/provider-logos';
import { ottorouterLogo as landingOttorouterLogo } from '../apps/landing/src/assets/provider-logos';

const OLD_BOLT_PATH_START = 'M55.0151 11H45.7732';
const SHIPWHEEL_NODES = [
	'<circle cx="12" cy="12" r="8"/>',
	'<path d="M12 2v7.5"/>',
	'<path d="m19 5-5.23 5.23"/>',
	'<path d="M22 12h-7.5"/>',
	'<path d="m19 19-5.23-5.23"/>',
	'<path d="M12 14.5V22"/>',
	'<path d="M10.23 13.77 5 19"/>',
	'<path d="M9.5 12H2"/>',
	'<path d="M10.23 10.23 5 5"/>',
	'<circle cx="12" cy="12" r="2.5"/>',
];

describe('ottorouter brand mark', () => {
	test('web-sdk ottorouterLogo renders the canonical ShipWheel geometry', () => {
		for (const node of SHIPWHEEL_NODES) {
			expect(webSdkOttorouterLogo).toContain(node);
		}
		expect(webSdkOttorouterLogo).toContain('viewBox="0 0 24 24"');
		expect(webSdkOttorouterLogo).toContain('stroke="currentColor"');
		expect(webSdkOttorouterLogo).toContain('fill="none"');
		expect(webSdkOttorouterLogo).not.toContain(OLD_BOLT_PATH_START);
	});

	test('landing ottorouterLogo stays byte-identical to the web-sdk mark', () => {
		expect(landingOttorouterLogo).toBe(webSdkOttorouterLogo);
	});

	test('logo string supports ProviderLogo runtime size injection', () => {
		const size = 18;
		const injected = webSdkOttorouterLogo.replace(
			/<svg/,
			`<svg width="${size}" height="${size}" style="width:${size}px;height:${size}px"`,
		);
		expect(injected.startsWith(`<svg width="${size}" height="${size}"`)).toBe(
			true,
		);
		expect(injected).toContain('viewBox="0 0 24 24"');
	});
});
