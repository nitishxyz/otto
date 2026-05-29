import { invoke } from '@tauri-apps/api/core';

export interface OnboardingStatus {
	onboardingComplete: boolean;
	ottorouter: { configured: boolean; publicKey?: string };
	providers: Record<
		string,
		{
			configured: boolean;
			type?: string;
			label: string;
			supportsOAuth: boolean;
			modelCount: number;
		}
	>;
	defaults: {
		agent?: string;
		provider?: string;
		model?: string;
		toolApproval?: string;
		theme?: 'light' | 'dark';
	};
}

interface DefaultsUpdate {
	agent?: string;
	provider?: string;
	model?: string;
	toolApproval?: string;
	theme?: 'light' | 'dark';
}

export const tauriOnboarding = {
	getStatus: () => invoke<OnboardingStatus>('get_onboarding_status'),
	setDefaults: (defaults: DefaultsUpdate) =>
		invoke<void>('set_defaults', {
			agent: defaults.agent,
			provider: defaults.provider,
			model: defaults.model,
			toolApproval: defaults.toolApproval,
			theme: defaults.theme,
		}),
	getHomeDirectory: () => invoke<string>('get_home_directory'),
};
