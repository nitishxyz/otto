import { memo, useEffect, type CSSProperties } from 'react';
import { ProviderSetupStep } from './steps/ProviderSetupStep';
import { DefaultsStep } from './steps/DefaultsStep';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useOttoRouterStore } from '../../stores/ottorouterStore';
import { useAuthStatus } from '../../hooks/useAuthStatus';

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
		startCopilotDeviceFlow,
		pollCopilotDeviceFlow,
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

	if (!isOpen || !authStatus) return null;

	return (
		<div
			className="fixed inset-0 z-[9999] bg-background text-foreground overflow-y-auto"
			style={style}
		>
			{currentStep === 'wallet' && (
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
					onOpenTopup={openTopupModal}
					onNext={nextStep}
					manageMode={manageMode}
					onClose={reset}
					hideHeader={hideHeader}
					onStartCopilotDeviceFlow={startCopilotDeviceFlow}
					onPollCopilotDeviceFlow={pollCopilotDeviceFlow}
					onGetCopilotAuthMethods={getCopilotAuthMethods}
					onSaveCopilotToken={saveCopilotToken}
					onImportCopilotTokenFromGh={importCopilotTokenFromGh}
					onGetCopilotDiagnostics={getCopilotDiagnostics}
				/>
			)}

			{currentStep === 'defaults' && (
				<DefaultsStep
					authStatus={authStatus}
					onComplete={completeOnboarding}
					onBack={prevStep}
					hideHeader={hideHeader}
				/>
			)}
		</div>
	);
});
