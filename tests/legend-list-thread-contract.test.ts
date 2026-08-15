import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const messageThreadPath = new URL(
	'../packages/web-sdk/src/components/messages/MessageThread.tsx',
	import.meta.url,
);
const webSdkPackagePath = new URL(
	'../packages/web-sdk/package.json',
	import.meta.url,
);

describe('Legend List message thread contract', () => {
	test('uses the supported dataset reset path without remounting the list', async () => {
		const source = await readFile(messageThreadPath, 'utf8');
		expect(source).toContain("dataKey={sessionId ?? 'thread'}");
		expect(source).not.toMatch(/<LegendList[\s\S]*?key=\{sessionId/);
		expect(source).toContain('style={LIST_STYLE}');
	});

	test('keeps recycling disabled for stateful web rows', async () => {
		const source = await readFile(messageThreadPath, 'utf8');
		expect(source).toContain('recycleItems={false}');
	});

	test('lets Legend List detach end-follow on any upward scroll', async () => {
		const source = await readFile(messageThreadPath, 'utf8');
		expect(source).toContain(
			'maintainScrollAtEndThreshold={END_FOLLOW_THRESHOLD}',
		);
		expect(source).toContain('const END_FOLLOW_THRESHOLD = 0;');
		expect(source).toContain("'isWithinMaintainScrollAtEndThreshold'");
		expect(source).not.toContain('createThreadFollowState');
	});

	test('covers an absolute top jump without pinning expensive history rows', async () => {
		const source = await readFile(messageThreadPath, 'utf8');
		expect(source).toContain('data-history-edge-cover');
		expect(source).toContain('schedulePrependAfterViewportPaint(');
		expect(source).not.toContain('alwaysRender=');
	});

	test('uses a Legend List release with current dataKey and chat fixes', async () => {
		const packageJson = JSON.parse(
			await readFile(webSdkPackagePath, 'utf8'),
		) as { dependencies?: Record<string, string> };
		expect(packageJson.dependencies?.['@legendapp/list']).toBe('^3.3.5');
	});
});
