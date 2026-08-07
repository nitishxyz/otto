import { describe, expect, test } from 'bun:test';

const SPINNER = 'packages/web-sdk/src/components/ui/StableSpinner.tsx';
const ACCOUNT_CONTROL =
	'apps/desktop/src/components/OttoRouterAccountControl.tsx';

describe('spinner animation is compositor friendly', () => {
	test('the animation runs on the svg box, not on an svg child', async () => {
		const source = await Bun.file(SPINNER).text();
		// Anchor on the JSX body so prose in the doc comment cannot satisfy this.
		const jsx = source.slice(source.indexOf('return ('));
		const svgOpen = jsx.indexOf('<svg');
		const groupOpen = jsx.search(/<g[\s>]/);
		expect(svgOpen).toBeGreaterThan(-1);
		expect(groupOpen).toBeGreaterThan(svgOpen);

		const svgTag = jsx.slice(svgOpen, groupOpen);
		const groupTag = jsx.slice(groupOpen, jsx.indexOf('>', groupOpen));

		// WebKit cannot accelerate a transform animation on an element inside
		// <svg>; spinning the <g> forced a main-thread style + layout +
		// compositing pass on every frame for the spinner's whole lifetime.
		expect(svgTag).toContain('animate-spin');
		expect(groupTag).not.toContain('animate-spin');
	});

	test('the spinner is promoted and contained so invalidation cannot escape', async () => {
		const source = await Bun.file(SPINNER).text();
		expect(source).toContain("willChange: 'transform'");
		expect(source).toContain("contain: 'layout style'");
	});

	test('caller supplied styles still win over the spin defaults', async () => {
		const source = await Bun.file(SPINNER).text();
		expect(source).toContain('style={{ ...ACCELERATED_SPIN_STYLE, ...style }}');
	});
});

describe('no always-mounted hidden animations', () => {
	test('the account control only mounts its spinner while busy', async () => {
		const source = await Bun.file(ACCOUNT_CONTROL).text();
		// `opacity: 0` does not pause a CSS animation, so an unconditionally
		// mounted spinner kept ticking for the whole life of the window.
		expect(source).toContain('{busy ? (');
		expect(source).toContain(
			'<StableSpinner size="sm" title="Disconnecting" />',
		);

		const busyLayer = source.slice(source.indexOf('aria-hidden={!busy}'));
		const spinnerAt = busyLayer.indexOf('<StableSpinner');
		const conditionalAt = busyLayer.indexOf('{busy ? (');
		expect(conditionalAt).toBeGreaterThan(-1);
		expect(conditionalAt).toBeLessThan(spinnerAt);
	});

	test('components that render a spinner keep it behind a condition', async () => {
		// A spinner rendered unconditionally inside a permanently mounted,
		// opacity-toggled layer animates forever and drives a per-frame rendering
		// update, which is what made an idle window burn main-thread time.
		const files = [
			'packages/web-sdk/src/components/ui/ToggleSwitch.tsx',
			'packages/web-sdk/src/components/workspace/ViewerStatusBar.tsx',
			'packages/web-sdk/src/components/sessions/SessionItem.tsx',
		];
		for (const path of files) {
			const source = await Bun.file(path).text();
			const index = source.indexOf('<StableSpinner');
			expect(index).toBeGreaterThan(-1);
			const preceding = source.slice(Math.max(0, index - 260), index);
			expect(preceding).toMatch(/\?|&&/);
		}
	});
});
