import { create } from 'zustand';

export interface PendingSecureInput {
	promptId: string;
	messageId?: string;
	callId?: string;
	prompt: string;
	inputKind?: 'password' | 'passphrase' | 'token';
	createdAt: number;
}

interface SecureInputState {
	pendingInputs: PendingSecureInput[];
	addPendingInput: (input: PendingSecureInput) => void;
	removePendingInput: (promptId: string) => void;
	setPendingInputs: (inputs: PendingSecureInput[]) => void;
	clearPendingInputs: () => void;
}

export const useSecureInputStore = create<SecureInputState>((set) => ({
	pendingInputs: [],
	addPendingInput: (input) =>
		set((state) => ({
			pendingInputs: [
				...state.pendingInputs.filter(
					(item) => item.promptId !== input.promptId,
				),
				input,
			],
		})),
	removePendingInput: (promptId) =>
		set((state) => ({
			pendingInputs: state.pendingInputs.filter(
				(input) => input.promptId !== promptId,
			),
		})),
	setPendingInputs: (inputs) => set({ pendingInputs: inputs }),
	clearPendingInputs: () => set({ pendingInputs: [] }),
}));
