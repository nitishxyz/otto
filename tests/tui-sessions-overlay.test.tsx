import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import React, { act } from 'react';
import { SessionsOverlay } from '../apps/tui/src/components/SessionsOverlay.tsx';
import { ThemeProvider } from '../apps/tui/src/theme/context.tsx';
import type { Session } from '../apps/tui/src/types.ts';

function session(
	id: string,
	title: string,
	overrides: Partial<Session> = {},
): Session {
	return {
		id,
		title,
		agent: 'build',
		provider: 'provider',
		model: 'model',
		projectPath: '/tmp/project',
		createdAt: Date.now(),
		lastActiveAt: Date.now(),
		totalInputTokens: null,
		totalOutputTokens: null,
		totalCachedTokens: null,
		totalCacheCreationTokens: null,
		currentContextTokens: null,
		...overrides,
	};
}

describe('TUI sessions overlay', () => {
	test('marks and selects the current session and spins for working sessions', async () => {
		const setup = await testRender(
			React.createElement(
				ThemeProvider,
				null,
				React.createElement(SessionsOverlay, {
					sessions: [
						session('session-1', 'First session'),
						session('session-2', 'Current working session', {
							isRunning: true,
						}),
					],
					currentSessionId: 'session-2',
					onSelect: () => {},
					onClose: () => {},
				}),
			),
			{ width: 100, height: 24 },
		);

		try {
			await setup.renderOnce();
			const frame = setup.captureCharFrame();
			expect(frame).toContain('Current working session');
			expect(frame).toContain('(current)');
			expect(frame).toContain('·');
			const currentLine = frame
				.split('\n')
				.find((line) => line.includes('Current working session'));
			expect(currentLine?.trimStart().startsWith('▌')).toBe(true);
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});
});
