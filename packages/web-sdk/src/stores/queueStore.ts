import { create } from 'zustand';
import type { ChatDraftAttachment } from './chatDraftStore';

export interface PendingQueueRestore {
	sessionId: string;
	text: string;
	attachments: ChatDraftAttachment[];
}

interface QueueState {
	pendingRestore: PendingQueueRestore | null;
	setPendingRestore: (restore: PendingQueueRestore | null) => void;
	consumeRestore: (sessionId: string) => PendingQueueRestore | null;
}

export const useQueueStore = create<QueueState>((set, get) => ({
	pendingRestore: null,
	setPendingRestore: (restore) => set({ pendingRestore: restore }),
	consumeRestore: (sessionId) => {
		const restore = get().pendingRestore;
		if (!restore || restore.sessionId !== sessionId) return null;
		set({ pendingRestore: null });
		return restore;
	},
}));
