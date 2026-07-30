import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getRuntimeProjectContext } from '../lib/config';

export const NEW_SESSION_CHAT_DRAFT_KEY = '__new-session__';

const unavailableStorage = {
	getItem: (_key: string) => null,
	setItem: (_key: string, _value: string) => {},
	removeItem: (_key: string) => {},
};

function getProjectDraftScope(): string {
	return getRuntimeProjectContext()?.projectId ?? 'default';
}

export function getSessionChatDraftKey(sessionId: string): string {
	return `session:${getProjectDraftScope()}:${sessionId}`;
}

export function getNewSessionChatDraftKey(
	sessionType: 'main' | 'looper' = 'main',
): string {
	return `${NEW_SESSION_CHAT_DRAFT_KEY}:${getProjectDraftScope()}:${sessionType}`;
}

export interface ChatDraftAttachment {
	id: string;
	type: 'image' | 'pdf' | 'text' | 'binary';
	name: string;
	mediaType: string;
	attachmentId: string;
	original: {
		filename: string;
		size: number;
		sha256: string;
		mimeType: string;
	};
}

interface ChatDraftState {
	drafts: Record<string, string>;
	attachments: Record<string, ChatDraftAttachment[]>;
	setDraft: (key: string, value: string) => void;
	setAttachments: (key: string, attachments: ChatDraftAttachment[]) => void;
}

export const useChatDraftStore = create<ChatDraftState>()(
	persist(
		(set) => ({
			drafts: {},
			attachments: {},
			setDraft: (key, value) =>
				set((state) => {
					const drafts = { ...state.drafts };
					if (value.length === 0) {
						delete drafts[key];
					} else {
						drafts[key] = value;
					}
					return { drafts };
				}),
			setAttachments: (key, value) =>
				set((state) => {
					const attachments = { ...state.attachments };
					if (value.length === 0) {
						delete attachments[key];
					} else {
						attachments[key] = value;
					}
					return { attachments };
				}),
		}),
		{
			name: 'chat-drafts-storage',
			storage: createJSONStorage(() =>
				typeof localStorage === 'undefined' ? unavailableStorage : localStorage,
			),
		},
	),
);
