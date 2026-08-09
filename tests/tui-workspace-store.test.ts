import { beforeEach, describe, expect, test } from 'bun:test';
import { useWorkspaceStore } from '../apps/tui/src/stores/workspace.ts';

beforeEach(() => {
	useWorkspaceStore.setState({
		isOpen: false,
		tab: 'todos',
		focus: 'chat',
		detail: null,
	});
});

describe('TUI workspace focus', () => {
	test('opens and focuses the activity sidebar', () => {
		useWorkspaceStore.getState().toggle();

		expect(useWorkspaceStore.getState()).toMatchObject({
			isOpen: true,
			focus: 'activity',
			detail: null,
		});
	});

	test('can explicitly focus the activity panel', () => {
		useWorkspaceStore.getState().open();

		expect(useWorkspaceStore.getState()).toMatchObject({
			isOpen: true,
			focus: 'activity',
		});
	});

	test('escape from activity returns to chat without closing the sidebar', () => {
		useWorkspaceStore.getState().open();
		useWorkspaceStore.getState().back();

		expect(useWorkspaceStore.getState()).toMatchObject({
			isOpen: true,
			focus: 'chat',
		});
	});

	test('the visibility toggle still closes the sidebar from any focus', () => {
		useWorkspaceStore.getState().open();
		useWorkspaceStore.getState().toggle();

		expect(useWorkspaceStore.getState()).toMatchObject({
			isOpen: false,
			focus: 'chat',
			detail: null,
		});
	});

	test('opens a detail viewer without opening the activity sidebar', () => {
		useWorkspaceStore
			.getState()
			.openDetail({ kind: 'subagent', id: 'subagent-1' });

		expect(useWorkspaceStore.getState()).toMatchObject({
			isOpen: false,
			focus: 'detail',
			detail: { kind: 'subagent', id: 'subagent-1' },
		});
	});

	test('closing the activity sidebar preserves an open detail viewer', () => {
		useWorkspaceStore.getState().open();
		useWorkspaceStore
			.getState()
			.openDetail({ kind: 'subagent', id: 'subagent-1' });
		useWorkspaceStore.getState().toggle();

		expect(useWorkspaceStore.getState()).toMatchObject({
			isOpen: false,
			focus: 'detail',
			detail: { kind: 'subagent', id: 'subagent-1' },
		});
	});

	test('escape closes a standalone detail viewer back to chat', () => {
		useWorkspaceStore
			.getState()
			.openDetail({ kind: 'subagent', id: 'subagent-1' });
		useWorkspaceStore.getState().back();

		expect(useWorkspaceStore.getState()).toMatchObject({
			isOpen: false,
			focus: 'chat',
			detail: null,
		});
	});
});
