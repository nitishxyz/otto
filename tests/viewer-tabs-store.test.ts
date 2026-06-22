import { afterEach, describe, expect, test } from 'bun:test';
import {
	getHydratedViewerTab,
	useViewerTabsStore,
} from '../packages/web-sdk/src/stores/viewerTabsStore';
import { buildSyntheticDiffDocument } from '../packages/web-sdk/src/lib/activityDiffDocument';

function fileTabAnnotations(path: string) {
	const tab = useViewerTabsStore.getState().tabsById[`file:${path}`];
	if (!tab || tab.type !== 'file') return undefined;
	return tab.annotations;
}

function agentActivityAnnotations(path: string) {
	const tab = useViewerTabsStore.getState().tabsById[`agent-activity:${path}`];
	if (!tab || tab.type !== 'agent-activity') return undefined;
	return tab.annotations;
}

function hydratedFileTab(path: string) {
	const state = useViewerTabsStore.getState();
	const tab = getHydratedViewerTab(state, `file:${path}`);
	return tab?.type === 'file' ? tab : undefined;
}

function hydratedAgentActivityTab(path: string) {
	const state = useViewerTabsStore.getState();
	const tab = getHydratedViewerTab(state, `agent-activity:${path}`);
	return tab?.type === 'agent-activity' ? tab : undefined;
}

describe('viewer tab tool activity annotations', () => {
	afterEach(() => {
		useViewerTabsStore.getState().closeAllTabs();
	});

	test('keeps completed patch preview when there is a net change', () => {
		const store = useViewerTabsStore.getState();

		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'change-call',
			baseContent: 'const value = 1;\n',
			previewContent: 'const value = 2;\n',
			resultContent: 'const value = 2;\n',
			previewLineTones: [[10, 'add']],
			status: 'success',
		});

		expect(fileTabAnnotations('src/example.ts')).toBeUndefined();
		expect(hydratedFileTab('src/example.ts')).toBeUndefined();
		expect(
			hydratedAgentActivityTab('src/example.ts')?.patchPreview?.callId,
		).toBe('change-call');
		expect(
			hydratedAgentActivityTab('src/example.ts')?.patchPreview?.status,
		).toBe('success');
	});

	test('keeps latest completed patch preview after streaming finishes', () => {
		const store = useViewerTabsStore.getState();

		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'change-call',
			baseContent: 'const value = 1;\n',
			previewContent: 'const value = 2;\n',
			resultContent: 'const value = 2;\n',
			previewLineTones: [[10, 'add']],
			status: 'streaming',
		});
		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'change-call',
			baseContent: 'const value = 1;\n',
			previewContent: 'const value = 2;\n',
			resultContent: 'const value = 2;\n',
			previewLineTones: [[10, 'add']],
			status: 'success',
		});

		expect(fileTabAnnotations('src/example.ts')).toBeUndefined();
		expect(hydratedFileTab('src/example.ts')).toBeUndefined();
		expect(
			hydratedAgentActivityTab('src/example.ts')?.patchPreview?.callId,
		).toBe('change-call');
		expect(
			hydratedAgentActivityTab('src/example.ts')?.patchPreview?.status,
		).toBe('success');
	});

	test('keeps completed write preview when there is a net change', () => {
		const store = useViewerTabsStore.getState();

		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'change-call',
			previewLineTones: [[10, 'add']],
			status: 'success',
		});
		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'write',
			callId: 'write-call',
			content: 'one\ntwo',
			status: 'success',
		});

		expect(fileTabAnnotations('src/example.ts')).toBeUndefined();
		expect(agentActivityAnnotations('src/example.ts')?.at(-1)?.id).toBe(
			'write:write-call',
		);
		expect(
			hydratedAgentActivityTab('src/example.ts')?.writePreview?.callId,
		).toBe('write-call');
		expect(
			hydratedAgentActivityTab('src/example.ts')?.writePreview?.status,
		).toBe('success');
	});

	test('clears patch annotations and preview when same-turn edits revert to baseline', () => {
		const store = useViewerTabsStore.getState();

		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'change-call',
			baseContent: 'const value = 1;\n',
			previewContent: 'const value = 2;\n',
			resultContent: 'const value = 2;\n',
			previewLineTones: [[1, 'add']],
			status: 'success',
		});

		expect(fileTabAnnotations('src/example.ts')).toBeUndefined();
		expect(hydratedFileTab('src/example.ts')).toBeUndefined();
		expect(
			hydratedAgentActivityTab('src/example.ts')?.patchPreview?.callId,
		).toBe('change-call');
		expect(
			useViewerTabsStore.getState().turnFileChanges['src/example.ts'],
		).toEqual({
			baselineContent: 'const value = 1;\n',
			latestContent: 'const value = 2;\n',
		});

		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'revert-call',
			baseContent: 'const value = 2;\n',
			previewContent: 'const value = 1;\n',
			resultContent: 'const value = 1;\n',
			previewLineTones: [[1, 'remove']],
			status: 'success',
		});

		expect(fileTabAnnotations('src/example.ts')).toBeUndefined();
		expect(
			hydratedAgentActivityTab('src/example.ts')?.patchPreview,
		).toBeUndefined();
		expect(
			hydratedAgentActivityTab('src/example.ts')?.writePreview,
		).toBeUndefined();
		expect(
			useViewerTabsStore.getState().turnFileChanges['src/example.ts'],
		).toEqual({
			baselineContent: 'const value = 1;\n',
			latestContent: 'const value = 1;\n',
		});
	});

	test('does not leave stale remove tones after temporary lines are reverted in the same turn', () => {
		const store = useViewerTabsStore.getState();
		const original = '# License\n\nExisting license text.\n';
		const withTemporaryLines = `${original}\nTemporary line one.\nTemporary line two.\n`;

		store.openToolPreviewTab({
			path: 'docs/license.md',
			toolName: 'edit',
			callId: 'add-temporary-lines',
			baseContent: original,
			previewContent: withTemporaryLines,
			resultContent: withTemporaryLines,
			previewLineTones: [
				[5, 'add'],
				[6, 'add'],
			],
			status: 'success',
		});

		store.openToolPreviewTab({
			path: 'docs/license.md',
			toolName: 'edit',
			callId: 'remove-temporary-lines',
			baseContent: withTemporaryLines,
			previewContent: original,
			resultContent: original,
			previewLineTones: [
				[5, 'remove'],
				[6, 'remove'],
			],
			status: 'success',
		});

		expect(fileTabAnnotations('docs/license.md')).toBeUndefined();
		expect(
			hydratedAgentActivityTab('docs/license.md')?.patchPreview,
		).toBeUndefined();
		expect(
			hydratedAgentActivityTab('docs/license.md')?.writePreview,
		).toBeUndefined();
		expect(
			useViewerTabsStore.getState().turnFileChanges['docs/license.md'],
		).toEqual({
			baselineContent: original,
			latestContent: original,
		});
	});

	test('resetFollowTurnChanges starts a new baseline for the next turn', () => {
		const store = useViewerTabsStore.getState();

		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'first-turn-change',
			baseContent: 'const value = 1;\n',
			previewContent: 'const value = 2;\n',
			resultContent: 'const value = 2;\n',
			previewLineTones: [[1, 'add']],
			status: 'success',
		});
		store.resetFollowTurnChanges();

		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'edit',
			callId: 'second-turn-change',
			baseContent: 'const value = 2;\n',
			previewContent: 'const value = 1;\n',
			resultContent: 'const value = 1;\n',
			previewLineTones: [[1, 'remove']],
			status: 'success',
		});

		expect(fileTabAnnotations('src/example.ts')).toBeUndefined();
		expect(
			hydratedAgentActivityTab('src/example.ts')?.patchPreview?.callId,
		).toBe('second-turn-change');
		expect(
			useViewerTabsStore.getState().turnFileChanges['src/example.ts'],
		).toEqual({
			baselineContent: 'const value = 2;\n',
			latestContent: 'const value = 1;\n',
		});
	});

	test('opens read follow tabs with the requested highlight range', () => {
		const store = useViewerTabsStore.getState();

		store.openToolReadTab('src/example.ts', {
			startLine: 5,
			endLine: 9,
			reason: 'read',
			callId: 'read-call',
			status: 'success',
		});

		expect(hydratedFileTab('src/example.ts')).toBeUndefined();
		expect(hydratedAgentActivityTab('src/example.ts')?.highlight).toEqual({
			startLine: 5,
			endLine: 9,
			reason: 'read',
			callId: 'read-call',
			status: 'success',
		});
		expect(useViewerTabsStore.getState().activeWorkTabId).toBe(
			'agent-activity:src/example.ts',
		);
	});

	test('normal file tab and agent activity tab coexist for the same path', () => {
		const store = useViewerTabsStore.getState();

		store.openFileTab('src/example.ts');
		store.openToolReadTab('src/example.ts', {
			startLine: 2,
			reason: 'read',
			callId: 'read-call',
			status: 'success',
		});

		expect(hydratedFileTab('src/example.ts')?.type).toBe('file');
		expect(hydratedAgentActivityTab('src/example.ts')?.highlight?.callId).toBe(
			'read-call',
		);
		expect(useViewerTabsStore.getState().tabOrder).toContain(
			'file:src/example.ts',
		);
		expect(useViewerTabsStore.getState().tabOrder).toContain(
			'agent-activity:src/example.ts',
		);
	});

	test('manual file tab is unaffected by follow write preview', () => {
		const store = useViewerTabsStore.getState();

		store.openFileTab('src/example.ts');
		store.openToolPreviewTab({
			path: 'src/example.ts',
			toolName: 'write',
			callId: 'write-call',
			content: 'updated\n',
			status: 'success',
		});

		expect(hydratedFileTab('src/example.ts')?.writePreview).toBeUndefined();
		expect(hydratedFileTab('src/example.ts')?.patchPreview).toBeUndefined();
		expect(
			hydratedAgentActivityTab('src/example.ts')?.writePreview?.callId,
		).toBe('write-call');
	});

	test('stores Markdown preview toggle state per normalized path', () => {
		const store = useViewerTabsStore.getState();

		store.setMarkdownPreviewEnabled('./docs/readme.md', true);

		expect(
			useViewerTabsStore.getState().markdownPreviewPaths['docs/readme.md'],
		).toBe(true);

		store.setMarkdownPreviewEnabled('docs/readme.md', false);

		expect(
			useViewerTabsStore.getState().markdownPreviewPaths['docs/readme.md'],
		).toBe(false);
	});
});

describe('synthetic activity diff documents', () => {
	test('renders delete-at-top as a real removed row before surviving line 1', () => {
		const document = buildSyntheticDiffDocument(
			'// removed comment\nimport { value } from "./value";\n',
			'import { value } from "./value";\n',
		);

		expect(document?.content.split('\n').slice(0, 2)).toEqual([
			'// removed comment',
			'import { value } from "./value";',
		]);
		expect(document?.lineTones.get(1)).toBe('remove');
		expect(document?.lineTones.get(2)).toBeUndefined();
	});

	test('renders added lines as real added rows with unchanged context', () => {
		const document = buildSyntheticDiffDocument(
			'# Usage\n\nExisting text.\n',
			'# Usage\n\nNew setup line.\nExisting text.\n',
		);

		expect(document?.content.split('\n').slice(0, 4)).toEqual([
			'# Usage',
			'',
			'New setup line.',
			'Existing text.',
		]);
		expect(document?.lineTones.get(3)).toBe('add');
		expect(document?.lineTones.get(1)).toBeUndefined();
		expect(document?.lineTones.get(4)).toBeUndefined();
	});
});
