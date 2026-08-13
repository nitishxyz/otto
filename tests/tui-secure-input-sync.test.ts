import { describe, expect, it } from 'bun:test';
import { reconcilePendingSecureInputs } from '../apps/tui/src/stream/client.ts';
import type { PendingSecureInput } from '../apps/tui/src/types.ts';

function pendingInput(
	promptId: string,
	overrides: Partial<PendingSecureInput> = {},
): PendingSecureInput {
	return {
		promptId,
		prompt: 'Password:',
		messageId: 'message-1',
		callId: 'call-1',
		inputKind: 'password',
		allowRemember: true,
		allowEmpty: false,
		createdAt: 1,
		...overrides,
	};
}

describe('TUI secure-input synchronization', () => {
	it('adds prompts recovered from a server snapshot', () => {
		const recovered = [pendingInput('prompt-1')];

		expect(reconcilePendingSecureInputs([], recovered)).toBe(recovered);
	});

	it('removes prompts resolved while an SSE event was missed', () => {
		const current = [pendingInput('prompt-1')];
		const resolved: PendingSecureInput[] = [];

		expect(reconcilePendingSecureInputs(current, resolved)).toBe(resolved);
	});

	it('preserves state identity for an unchanged snapshot', () => {
		const current = [pendingInput('prompt-1')];
		const unchanged = [pendingInput('prompt-1')];

		expect(reconcilePendingSecureInputs(current, unchanged)).toBe(current);
	});

	it('applies updated prompt metadata', () => {
		const current = [pendingInput('prompt-1')];
		const updated = [pendingInput('prompt-1', { allowEmpty: true })];

		expect(reconcilePendingSecureInputs(current, updated)).toBe(updated);
	});
});
