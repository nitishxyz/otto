import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createJSONStorage } from 'zustand/middleware';

const values = new Map<string, string>();
const originalLocalStorage = Object.getOwnPropertyDescriptor(
	globalThis,
	'localStorage',
);
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		key: (index: number) => [...values.keys()][index] ?? null,
		removeItem: (key: string) => values.delete(key),
		setItem: (key: string, value: string) => values.set(key, value),
	},
});

const { getNewSessionChatDraftKey, getSessionChatDraftKey, useChatDraftStore } =
	await import('../packages/web-sdk/src/stores/chatDraftStore');
const storage = createJSONStorage(() => globalThis.localStorage);

describe('chat draft store', () => {
	beforeEach(() => {
		values.clear();
		useChatDraftStore.persist.setOptions({ storage });
		useChatDraftStore.setState({ drafts: {}, attachments: {} });
	});

	afterAll(() => {
		if (originalLocalStorage) {
			Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
		} else {
			Reflect.deleteProperty(globalThis, 'localStorage');
		}
	});

	it('keeps independent drafts for new and existing sessions', () => {
		const { setDraft } = useChatDraftStore.getState();
		const newSessionKey = getNewSessionChatDraftKey();
		const firstSessionKey = getSessionChatDraftKey('session-a');
		const secondSessionKey = getSessionChatDraftKey('session-b');
		setDraft(newSessionKey, 'new session message');
		setDraft(firstSessionKey, 'first session message');
		setDraft(secondSessionKey, 'second session message');

		expect(useChatDraftStore.getState().drafts).toEqual({
			[newSessionKey]: 'new session message',
			[firstSessionKey]: 'first session message',
			[secondSessionKey]: 'second session message',
		});
	});

	it('removes a draft when the composer is cleared', () => {
		const { setDraft } = useChatDraftStore.getState();
		setDraft('session-a', 'message');
		setDraft('session-a', '');

		expect(useChatDraftStore.getState().drafts).toEqual({});
	});

	it('persists uploaded attachment references without file payloads', () => {
		useChatDraftStore.getState().setAttachments('session-a', [
			{
				id: 'local-file',
				type: 'image',
				name: 'screenshot.png',
				mediaType: 'image/png',
				attachmentId: 'attachment-1',
				original: {
					filename: 'screenshot.png',
					size: 1024,
					sha256: 'abc123',
					mimeType: 'image/png',
				},
			},
		]);

		const persisted = values.get('chat-drafts-storage') ?? '';
		expect(persisted).toContain('attachment-1');
		expect(persisted).not.toContain('data:image/png');
	});

	it('restores drafts from persistent storage', async () => {
		useChatDraftStore.getState().setDraft('session-a', 'survives reload');
		const persistedDrafts = values.get('chat-drafts-storage');
		useChatDraftStore.setState({ drafts: {} });
		if (persistedDrafts) {
			values.set('chat-drafts-storage', persistedDrafts);
		}

		await useChatDraftStore.persist.rehydrate();

		expect(useChatDraftStore.getState().drafts['session-a']).toBe(
			'survives reload',
		);
	});
});
