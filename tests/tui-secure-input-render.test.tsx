import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import React, { act } from 'react';
import { SecureInputBar } from '../apps/tui/src/components/SecureInputBar.tsx';
import { ThemeProvider } from '../apps/tui/src/theme/context.tsx';

describe('TUI secure-input prompt', () => {
	test('renders as a centered modal with password masking guidance', async () => {
		const setup = await testRender(
			React.createElement(
				ThemeProvider,
				null,
				React.createElement(SecureInputBar, {
					pendingInput: {
						promptId: 'prompt-1',
						messageId: 'message-1',
						prompt: 'Password for deploy:',
						inputKind: 'password',
						allowRemember: true,
						allowEmpty: false,
						createdAt: 1,
					},
					onSubmit: () => {},
					onCancel: () => {},
				}),
			),
			{ width: 80, height: 24 },
		);

		try {
			await setup.renderOnce();
			const frame = setup.captureCharFrame();
			expect(frame).toContain('Password required');
			expect(frame).toContain('Password for deploy:');
			expect(frame).toContain('type secret…');
			expect(frame).toContain('Enter send  ·  Esc cancel');
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
	});
});
