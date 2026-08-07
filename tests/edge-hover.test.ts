import { describe, expect, test } from 'bun:test';

const HOOK_PATH = 'packages/web-sdk/src/hooks/useEdgeHover.ts';

describe('edge hover reveal', () => {
	test('cancels a queued opposite transition even when the state matches', async () => {
		const source = await Bun.file(HOOK_PATH).text();
		const start = source.indexOf('const scheduleVisible');
		expect(start).toBeGreaterThan(-1);
		const body = source.slice(start, source.indexOf('};', start));
		const clearIndex = body.indexOf('window.clearTimeout(oppositeRef.current)');
		const matchIndex = body.indexOf('isVisibleRef.current === visible');
		expect(clearIndex).toBeGreaterThan(-1);
		expect(matchIndex).toBeGreaterThan(-1);
		// A stale show timer must be dropped before the early return, otherwise
		// the surface pops open after the cursor already left the edge.
		expect(clearIndex).toBeLessThan(matchIndex);
	});

	test('skips the layout-reading ignore scan for far-away pointer moves', async () => {
		const source = await Bun.file(HOOK_PATH).text();
		const start = source.indexOf('const handleMouseMove');
		expect(start).toBeGreaterThan(-1);
		const body = source.slice(start, source.indexOf('const handleMouseLeave'));
		const zoneIndex = body.indexOf('const withinZone =');
		const scanIndex = body.indexOf('getIgnoredTargetMode(event)');
		expect(zoneIndex).toBeGreaterThan(-1);
		expect(scanIndex).toBeGreaterThan(-1);
		expect(zoneIndex).toBeLessThan(scanIndex);
		expect(body).toContain('if (!withinZone && !isVisibleRef.current) {');
	});
});
