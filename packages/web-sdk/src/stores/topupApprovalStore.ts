import { create } from 'zustand';

export interface PendingTopupApproval {
	sessionId: string;
	messageId: string;
	amountUsd: number;
	currentBalance: number;
	minTopupUsd: number;
	suggestedTopupUsd: number;
}

interface TopupApprovalState {
	pendingTopup: PendingTopupApproval | null;
	isProcessing: boolean;
	selectedMethod: 'fiat' | null;
	setPendingTopup: (topup: PendingTopupApproval | null) => void;
	setProcessing: (processing: boolean) => void;
	setSelectedMethod: (method: 'fiat' | null) => void;
	clearPendingTopup: () => void;
}

export const useTopupApprovalStore = create<TopupApprovalState>((set) => ({
	pendingTopup: null,
	isProcessing: false,
	selectedMethod: null,
	setPendingTopup: (pendingTopup) =>
		set({ pendingTopup, isProcessing: false, selectedMethod: null }),
	setProcessing: (isProcessing) => set({ isProcessing }),
	setSelectedMethod: (selectedMethod) => set({ selectedMethod }),
	clearPendingTopup: () =>
		set({ pendingTopup: null, isProcessing: false, selectedMethod: null }),
}));
