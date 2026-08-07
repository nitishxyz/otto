import { describe, expect, test } from 'bun:test';

const SPINNER = 'packages/web-sdk/src/components/ui/StableSpinner.tsx';
const ACCOUNT_CONTROL =
	'apps/desktop/src/components/OttoRouterAccountControl.tsx';

describe('spinner animation stays visually centered', () => {
	test('the original spiked graphic rotates around the SVG center', async () => {
		const source = await Bun.file(SPINNER).text();
		const jsx = source.slice(source.indexOf('return ('));
		const svgOpen = jsx.indexOf('<svg');
		const groupOpen = jsx.search(/<g[\s>]/);
		expect(svgOpen).toBeGreaterThan(-1);
		expect(groupOpen).toBeGreaterThan(svgOpen);

		const svgTag = jsx.slice(svgOpen, groupOpen);
		const groupTag = jsx.slice(groupOpen, jsx.indexOf('>', groupOpen));

		expect(svgTag).not.toContain('animate-spin');
		expect(groupTag).toContain('animate-spin');
		expect(groupTag).toContain("transformBox: 'view-box'");
		expect(groupTag).toContain("transformOrigin: '8px 8px'");
	});

	test('all eight original spikes are preserved', async () => {
		const source = await Bun.file(SPINNER).text();
		const jsx = source.slice(source.indexOf('return ('));
		expect(jsx.match(/<path/g)?.length).toBe(8);
		expect(jsx).not.toContain('<circle');
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
