import { expect, test } from 'bun:test';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { serializeSessionUpdates } from '../packages/acp/src/connection';

test('all ACP notifications serialize per session and other sessions progress', async () => {
	const sent: string[] = [];
	const connection = serializeSessionUpdates({
		sessionUpdate: async (notification: {
			sessionId: string;
			update: { content: { text: string } };
		}) => {
			const text = notification.update.content.text;
			if (text === 'first') await Bun.sleep(10);
			sent.push(text);
		},
	} as unknown as AgentSideConnection);
	const send = (sessionId: string, text: string) =>
		connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text },
			},
		});
	await Promise.all([
		send('one', 'first'),
		send('one', 'second'),
		send('two', 'independent'),
	]);
	expect(sent).toEqual(['independent', 'first', 'second']);
});
