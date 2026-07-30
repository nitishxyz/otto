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

interface ChatDraftState {
	drafts: Record<string, string>;
	setDraft: (key: string, value: string) => void;
}

export const useChatDraftStore = create<ChatDraftState>()(
	persist(
		(set) => ({
			drafts: {},
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
		}),
		{
			name: 'chat-drafts-storage',
			storage: createJSONStorage(() =>
				typeof localStorage === 'undefined' ? unavailableStorage : localStorage,
			),
		},
	),
);
