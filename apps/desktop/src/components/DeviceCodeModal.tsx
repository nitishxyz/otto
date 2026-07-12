import { openUrl } from '@tauri-apps/plugin-opener';
import { StableSpinner } from '@ottocode/web-sdk/components';
import type { DeviceCodeResponse, OAuthState } from '../hooks/useGitHub';

export function DeviceCodeModal({
	oauthState,
	onStartPolling,
	onCancel,
}: {
	oauthState: OAuthState;
	onStartPolling: (deviceCode: string, interval: number) => void;
	onCancel: () => void;
}) {
	const deviceCode =
		oauthState.step === 'awaiting_user' ? oauthState.deviceCode : null;

	const handleCopyAndOpen = async (dc: DeviceCodeResponse) => {
		await navigator.clipboard.writeText(dc.userCode);
		await openUrl(dc.verificationUri).catch(() => {});
		onStartPolling(dc.deviceCode, dc.interval);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop overlay pattern
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onCancel}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onCancel();
			}}
			tabIndex={-1}
		>
			<div
				className="bg-background border border-border rounded-xl w-full max-w-md mx-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="dialog"
			>
				<div className="p-6 border-b border-border">
					<h3 className="text-lg font-semibold text-foreground">
						Connect GitHub
					</h3>
				</div>
				<div className="p-6">
					{oauthState.step === 'requesting' && (
						<div className="flex items-center justify-center py-8">
							<StableSpinner size="lg" title="Connecting to GitHub" />
							<span className="ml-3 text-muted-foreground">
								Connecting to GitHub...
							</span>
						</div>
					)}

					{oauthState.step === 'awaiting_user' && deviceCode && (
						<div className="space-y-5">
							<p className="text-sm text-muted-foreground">
								Copy the code below and enter it on GitHub to authorize otto.
							</p>
							<div className="flex items-center justify-center">
								<code className="px-6 py-3 bg-muted rounded-lg text-2xl font-mono font-bold tracking-widest text-foreground select-all">
									{deviceCode.userCode}
								</code>
							</div>
							<button
								type="button"
								onClick={() => handleCopyAndOpen(deviceCode)}
								className="w-full h-11 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
							>
								Copy Code & Open GitHub
							</button>
							<p className="text-xs text-muted-foreground text-center">
								The code will be copied to your clipboard and GitHub will open
								in your browser.
							</p>
						</div>
					)}

					{oauthState.step === 'polling' && (
						<div className="flex flex-col items-center py-8 gap-4">
							<StableSpinner size="lg" title="Waiting for authorization" />
							<p className="text-muted-foreground text-sm">
								Waiting for authorization...
							</p>
							<p className="text-xs text-muted-foreground">
								Complete the authorization in your browser, then this will
								update automatically.
							</p>
						</div>
					)}

					{oauthState.step === 'error' && (
						<div className="space-y-4">
							<div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
								<p className="text-sm text-destructive">{oauthState.message}</p>
							</div>
						</div>
					)}
				</div>
				<div className="flex gap-3 p-6 pt-0">
					<button
						type="button"
						onClick={onCancel}
						className="flex-1 h-11 px-4 bg-transparent border border-border text-foreground rounded-lg font-medium hover:bg-muted/50 transition-colors"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}
