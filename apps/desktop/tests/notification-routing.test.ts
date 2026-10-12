import { describe, expect, test } from 'bun:test';
import {
	acceptsNotificationSessionOpen,
	notificationWorkspace,
	type NotificationSessionOpen,
} from '../src/lib/notification-routing';

const project = {
	path: '/workspace',
	name: 'Workspace',
	lastOpened: '',
	projectId: 'project-1',
};
const workspace = notificationWorkspace(project, 'https://server-a.test');
const open: NotificationSessionOpen = {
	windowLabel: 'owner',
	workspace,
	sessionId: 'session-1',
};

describe('desktop notification activation', () => {
	test('only the addressed owner accepts activation before focus/navigation', () => {
		const windows = ['nonowner', 'same-project-other-session', 'owner'];
		expect(
			windows.filter((label) =>
				acceptsNotificationSessionOpen(open, label, workspace),
			),
		).toEqual(['owner']);
	});

	test('a reused owner window ignores its previous workspace', () => {
		expect(
			acceptsNotificationSessionOpen(open, 'owner', {
				...workspace,
				projectPath: '/other-workspace',
			}),
		).toBe(false);
	});

	test('identical remote project/session IDs do not cross server boundaries', () => {
		const otherServer = notificationWorkspace(project, 'https://server-b.test');
		expect(acceptsNotificationSessionOpen(open, 'owner', otherServer)).toBe(
			false,
		);
	});

	test('a different project on the same server ignores activation', () => {
		expect(
			acceptsNotificationSessionOpen(open, 'owner', {
				...workspace,
				projectId: 'project-2',
			}),
		).toBe(false);
	});

	test('no listener accepts a closed owner target', () => {
		expect(
			['main', 'main-2'].some((label) =>
				acceptsNotificationSessionOpen(open, label, workspace),
			),
		).toBe(false);
	});
});
