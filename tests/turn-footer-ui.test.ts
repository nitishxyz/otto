import { describe, expect, it } from 'bun:test';
import type { Message } from '../packages/web-sdk/src/types/api';
import { shouldRenderTurnFooter } from '../packages/web-sdk/src/components/messages/turnFooter';

function assistantMessage(status: Message['status']): Pick<Message, 'status'> {
	return { status };
}

describe('assistant turn footer rendering', () => {
	it('renders the footer once on the last assistant message of a turn', () => {
		expect(
			shouldRenderTurnFooter(assistantMessage('complete'), 's1', false),
		).toBe(true);
	});

	it('hides the footer on non-last assistant messages within one turn', () => {
		expect(
			shouldRenderTurnFooter(assistantMessage('complete'), 's1', true),
		).toBe(false);
	});

	it('hides the footer while the message is still streaming', () => {
		expect(
			shouldRenderTurnFooter(assistantMessage('pending'), 's1', false),
		).toBe(false);
	});

	it('hides the footer when there is no session id', () => {
		expect(
			shouldRenderTurnFooter(assistantMessage('complete'), undefined, false),
		).toBe(false);
	});
});
