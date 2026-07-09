import { create } from 'zustand';

export type OnboardingStep = 'wallet' | 'defaults';

export interface ProviderInfo {
	configured: boolean;
	type?: 'api' | 'oauth';
	label: string;
	supportsOAuth: boolean;
	supportsToken?: boolean;
	supportsGhImport?: boolean;
	custom?: boolean;
	modelCount: number;
	costRange?: { min: number; max: number };
}

export interface AuthStatus {
	onboardingComplete: boolean;
	ottorouter: { configured: boolean; expiresAt?: number };
	providers: Record<string, ProviderInfo>;
	defaults: {
		agent: string;
		provider: string;
		model: string;
		toolApproval?: 'auto' | 'dangerous' | 'all' | 'yolo';
	};
}

interface OnboardingState {
	isOpen: boolean;
	currentStep: OnboardingStep;
	manageMode: boolean;
	isLoading: boolean;
	error: string | null;
	authStatus: AuthStatus | null;
	setOpen: (open: boolean) => void;
	setStep: (step: OnboardingStep) => void;
	setManageMode: (manageMode: boolean) => void;
	setLoading: (loading: boolean) => void;
	setError: (error: string | null) => void;
	setAuthStatus: (status: AuthStatus | null) => void;
	nextStep: () => void;
	prevStep: () => void;
	reset: () => void;
}

const STEPS: OnboardingStep[] = ['wallet', 'defaults'];

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
	isOpen: false,
	currentStep: 'wallet',
	manageMode: false,
	isLoading: false,
	error: null,
	authStatus: null,
	setOpen: (isOpen) => set({ isOpen }),
	setStep: (currentStep) => set({ currentStep }),
	setManageMode: (manageMode) => set({ manageMode }),
	setLoading: (isLoading) => set({ isLoading }),
	setError: (error) => set({ error }),
	setAuthStatus: (authStatus) => set({ authStatus }),
	nextStep: () => {
		const { currentStep } = get();
		const currentIndex = STEPS.indexOf(currentStep);
		if (currentIndex < STEPS.length - 1) {
			set({ currentStep: STEPS[currentIndex + 1] });
		}
	},
	prevStep: () => {
		const { currentStep } = get();
		const currentIndex = STEPS.indexOf(currentStep);
		if (currentIndex > 0) {
			set({ currentStep: STEPS[currentIndex - 1] });
		}
	},
	reset: () =>
		set({
			isOpen: false,
			currentStep: 'wallet',
			manageMode: false,
			isLoading: false,
			error: null,
		}),
}));
