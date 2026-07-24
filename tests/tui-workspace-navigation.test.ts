import { describe, expect, test } from 'bun:test';
import {
	moveActivityTab,
	moveWorkspaceFocus,
} from '../apps/tui/src/lib/workspace-navigation.ts';

const TABS = ['todos', 'subagents', 'shells', 'terminals'] as const;

describe('TUI workspace navigation', () => {
	test('moves right through all visible panes', () => {
		expect(
			moveWorkspaceFocus(
				{ focus: 'chat', showDetail: true, showActivity: true },
				'right',
			),
		).toBe('detail');
		expect(
			moveWorkspaceFocus(
				{ focus: 'detail', showDetail: true, showActivity: true },
				'right',
			),
		).toBe('activity');
	});

	test('moves left and stops at the edge', () => {
		expect(
			moveWorkspaceFocus(
				{ focus: 'activity', showDetail: true, showActivity: true },
				'left',
			),
		).toBe('detail');
		expect(
			moveWorkspaceFocus(
				{ focus: 'chat', showDetail: true, showActivity: true },
				'left',
			),
		).toBe('chat');
	});

	test('skips panes that are not visible', () => {
		expect(
			moveWorkspaceFocus(
				{ focus: 'chat', showDetail: false, showActivity: true },
				'right',
			),
		).toBe('activity');
		expect(
			moveWorkspaceFocus(
				{ focus: 'detail', showDetail: true, showActivity: false },
				'right',
			),
		).toBe('detail');
	});

	test('wraps H/L tab navigation', () => {
		expect(moveActivityTab(TABS, 'todos', 'left')).toBe('terminals');
		expect(moveActivityTab(TABS, 'terminals', 'right')).toBe('todos');
		expect(moveActivityTab(TABS, 'subagents', 'right')).toBe('shells');
	});
});
