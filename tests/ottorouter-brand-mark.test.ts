import { describe, expect, test } from 'bun:test';
import { ottorouterLogo as webSdkOttorouterLogo } from '../packages/web-sdk/src/assets/provider-logos';
import { ottorouterLogo as landingOttorouterLogo } from '../apps/landing/src/assets/provider-logos';

const OLD_BOLT_PATH_START = 'M55.0151 11H45.7732';
const O_GLYPH_PATH_START = 'M0 27Q0 20 7 20L33 20';

describe('ottorouter brand mark', () => {
	test('web-sdk ottorouterLogo renders the canonical app-icon O', () => {
		expect(
			webSdkOttorouterLogo.match(new RegExp(O_GLYPH_PATH_START, 'g')),
		).toHaveLength(2);
		expect(webSdkOttorouterLogo).toContain('viewBox="-2 18 47 43"');
		expect(webSdkOttorouterLogo).toContain('transform="translate(3 3)"');
		expect(webSdkOttorouterLogo).toContain('fill="#283c8c"');
		expect(webSdkOttorouterLogo).toContain('fill="#4865cc"');
		expect(webSdkOttorouterLogo).not.toContain('<circle');
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
		expect(injected).toContain('viewBox="-2 18 47 43"');
	});
});
