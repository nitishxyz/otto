import { beforeEach, describe, expect, it } from 'bun:test';
import { getMessageChatDraftAttachments } from '../packages/web-sdk/src/lib/chatAttachments';
import { useQueueStore } from '../packages/web-sdk/src/stores/queueStore';
import type { Message } from '../packages/web-sdk/src/types/api';

function messageWithParts(parts: NonNullable<Message['parts']>): Message {
	return { parts } as Message;
}

describe('queued attachment restore', () => {
	beforeEach(() => {
		useQueueStore.setState({ pendingRestore: null });
	});

	it('extracts persisted image and file references from a queued user message', () => {
		const attachments = getMessageChatDraftAttachments(
			messageWithParts([
				{
					id: 'image-part',
					type: 'image',
					content: '',
					contentJson: {
						name: 'image.png',
						mediaType: 'image/png',
						attachmentId: 'image-attachment',
						original: {
							filename: 'image.png',
							size: 123,
							sha256: 'image-sha',
							mimeType: 'image/png',
						},
					},
				} as NonNullable<Message['parts']>[number],
				{
					id: 'file-part',
					type: 'file',
					content: JSON.stringify({
						type: 'pdf',
						name: 'spec.pdf',
						mediaType: 'application/pdf',
						attachmentId: 'file-attachment',
					}),
				} as NonNullable<Message['parts']>[number],
			]),
		);

		expect(attachments).toHaveLength(2);
		expect(attachments[0]).toMatchObject({
			type: 'image',
			attachmentId: 'image-attachment',
		});
		expect(attachments[1]).toMatchObject({
			type: 'pdf',
			attachmentId: 'file-attachment',
		});
	});

	it('only consumes a restore payload in its owning session', () => {
		const restore = {
			sessionId: 'session-a',
			text: 'queued message',
			attachments: [],
		};
		useQueueStore.getState().setPendingRestore(restore);

		expect(useQueueStore.getState().consumeRestore('session-b')).toBeNull();
		expect(useQueueStore.getState().consumeRestore('session-a')).toEqual(
			restore,
		);
		expect(useQueueStore.getState().pendingRestore).toBeNull();
	});
});
