import { memo, useEffect, type CSSProperties } from 'react';
import { ProviderSetupStep } from './steps/ProviderSetupStep';
import { DefaultsStep } from './steps/DefaultsStep';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useOttoRouterStore } from '../../stores/ottorouterStore';
import { useAuthStatus } from '../../hooks/useAuthStatus';
import { StableSpinner } from '../ui/StableSpinner';

interface OnboardingModalProps {
	hideHeader?: boolean;
	style?: CSSProperties;
}

export const OnboardingModal = memo(function OnboardingModal({
	hideHeader = false,
	style,
}: OnboardingModalProps) {
	const isOpen = useOnboardingStore((s) => s.isOpen);
	const currentStep = useOnboardingStore((s) => s.currentStep);
	const manageMode = useOnboardingStore((s) => s.manageMode);
	const isLoading = useOnboardingStore((s) => s.isLoading);
	const error = useOnboardingStore((s) => s.error);
	const authStatus = useOnboardingStore((s) => s.authStatus);
	const nextStep = useOnboardingStore((s) => s.nextStep);
	const prevStep = useOnboardingStore((s) => s.prevStep);
	const reset = useOnboardingStore((s) => s.reset);
	const openTopupModal = useOttoRouterStore((s) => s.openTopupModal);

	const {
		setupWallet,
		importWallet,
		addProvider,
		addCustomProvider,
		removeProvider,
		completeOnboarding,
		startOAuth,
		startOAuthManual,
		exchangeOAuthCode,
		startOpenAIDeviceFlow,
		pollOpenAIDeviceFlow,
		startCopilotDeviceFlow,
		pollCopilotDeviceFlow,
		startKimiDeviceFlow,
		pollKimiDeviceFlow,
		getCopilotAuthMethods,
		saveCopilotToken,
		importCopilotTokenFromGh,
		getCopilotDiagnostics,
	} = useAuthStatus();

	useEffect(() => {
		if (!isOpen) return;

		const handleNativeBack = (event: Event) => {
			const customEvent = event as CustomEvent<{ handled?: boolean }>;
			if (!customEvent.detail || customEvent.detail.handled) return;
			if (document.querySelector('[data-otto-nested-modal="true"]')) return;

			customEvent.detail.handled = true;
			event.preventDefault();
			reset();
		};

		window.addEventListener('otto:native-back', handleNativeBack);
		return () =>
			window.removeEventListener('otto:native-back', handleNativeBack);
	}, [isOpen, reset]);

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-[9999] bg-background text-foreground overflow-y-auto"
			style={style}
		>
			{!authStatus ? (
				<div className="min-h-full flex items-center justify-center p-6">
					<div className="flex flex-col items-center gap-3 text-center">
						<StableSpinner size="xl" title="Loading providers" />
						<div>
							<p className="font-medium">Loading providers…</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Fetching your current provider configuration.
							</p>
							{error && !isLoading && (
								<p className="mt-3 text-sm text-destructive">{error}</p>
							)}
						</div>
					</div>
				</div>
			) : currentStep === 'wallet' ? (
				<ProviderSetupStep
					authStatus={authStatus}
					onSetupWallet={setupWallet}
					onImportWallet={importWallet}
					onAddProvider={addProvider}
					onAddCustomProvider={addCustomProvider}
					onRemoveProvider={removeProvider}
					onStartOAuth={startOAuth}
					onStartOAuthManual={startOAuthManual}
					onExchangeOAuthCode={exchangeOAuthCode}
					onStartOpenAIDeviceFlow={startOpenAIDeviceFlow}
					onPollOpenAIDeviceFlow={pollOpenAIDeviceFlow}
					onOpenTopup={openTopupModal}
					onNext={nextStep}
					manageMode={manageMode}
					onClose={reset}
					hideHeader={hideHeader}
					onStartCopilotDeviceFlow={startCopilotDeviceFlow}
					onPollCopilotDeviceFlow={pollCopilotDeviceFlow}
					onStartKimiDeviceFlow={startKimiDeviceFlow}
					onPollKimiDeviceFlow={pollKimiDeviceFlow}
					onGetCopilotAuthMethods={getCopilotAuthMethods}
					onSaveCopilotToken={saveCopilotToken}
					onImportCopilotTokenFromGh={importCopilotTokenFromGh}
					onGetCopilotDiagnostics={getCopilotDiagnostics}
				/>
			) : currentStep === 'defaults' ? (
				<DefaultsStep
					authStatus={authStatus}
					onComplete={completeOnboarding}
					onBack={prevStep}
					hideHeader={hideHeader}
				/>
			) : null}
			{authStatus && error && !isLoading && (
				<div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-destructive/30 bg-background px-4 py-2 text-sm text-destructive shadow-lg">
					{error}
				</div>
			)}
		</div>
	);
});
