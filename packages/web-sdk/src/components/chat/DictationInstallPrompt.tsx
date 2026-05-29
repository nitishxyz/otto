import { memo, useCallback, useMemo } from 'react';
import { Download, Mic, ShieldCheck } from 'lucide-react';
import { useDictationModels } from '../../hooks/useDictationModels';
import type { DictationModelState } from '../../lib/api-client';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { StableSpinner } from '../ui/StableSpinner';

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function progressPercent(model: DictationModelState): number {
	if (model.totalBytes <= 0) return 0;
	return Math.min(
		100,
		Math.round((model.progressBytes / model.totalBytes) * 100),
	);
}

interface DictationInstallPromptProps {
	isOpen: boolean;
	onClose: () => void;
	onReady: () => void;
}

export const DictationInstallPrompt = memo(function DictationInstallPrompt({
	isOpen,
	onClose,
	onReady,
}: DictationInstallPromptProps) {
	const {
		statusQuery,
		models,
		defaultModel,
		isAvailable,
		installModel,
		installMutation,
		installStreamError,
	} = useDictationModels();

	const model = useMemo(
		() =>
			models.find((item) => item.id === defaultModel) ??
			models.find((item) => item.recommended) ??
			models[0] ??
			null,
		[defaultModel, models],
	);

	const percent = model ? progressPercent(model) : 0;
	const isInstalling = model?.installing || installMutation.isPending;

	const handleInstallOrStart = useCallback(async () => {
		if (!model) return;
		if (model.installed) {
			onClose();
			onReady();
			return;
		}
		await installModel(model.id);
	}, [installModel, model, onClose, onReady]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={
				<div className="flex items-center gap-2">
					<Mic className="h-5 w-5 text-primary" />
					<span>Set up dictation</span>
				</div>
			}
			maxWidth="md"
		>
			<div className="space-y-4">
				<div>
					<p className="text-sm font-medium text-foreground">
						Voice input needs one local model.
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Download once, then record from the composer.
					</p>
				</div>

				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
					<span>Audio stays local. Manage models in Preferences.</span>
				</div>

				{statusQuery.isLoading ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<StableSpinner className="h-4 w-4" />
						Checking local dictation…
					</div>
				) : statusQuery.error ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
						{statusQuery.error instanceof Error
							? statusQuery.error.message
							: 'Failed to load dictation models'}
					</div>
				) : !isAvailable ? (
					<div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
						Local dictation is not available on this platform yet.
					</div>
				) : model ? (
					<div className="border-y border-border py-3">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="font-medium text-sm">{model.label}</span>
									{model.recommended ? (
										<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
											Recommended
										</span>
									) : null}
								</div>
								<div className="mt-1 text-xs text-muted-foreground">
									{formatBytes(model.sizeBytes)} ·{' '}
									{model.language === 'multi' ? 'Multilingual' : 'English'}
								</div>
							</div>
						</div>

						{model.installing ? (
							<div className="mt-3 space-y-2">
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>Downloading model…</span>
									<span>{percent}%</span>
								</div>
								<div className="h-2 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-primary transition-all"
										style={{ width: `${percent}%` }}
									/>
								</div>
							</div>
						) : null}

						{model.installStatus === 'error' ? (
							<div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
								{model.error ?? 'Model install failed'}
							</div>
						) : null}
					</div>
				) : (
					<div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
						No dictation models are available yet.
					</div>
				)}

				{installStreamError ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
						{installStreamError}
					</div>
				) : null}

				<div className="flex justify-end gap-2 pt-2">
					<Button
						type="button"
						variant="ghost"
						onClick={onClose}
						disabled={isInstalling}
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => void handleInstallOrStart()}
						disabled={!model || !isAvailable || isInstalling}
						className="gap-2"
					>
						{isInstalling ? (
							<StableSpinner className="h-4 w-4" />
						) : model?.installed ? (
							<Mic className="h-4 w-4" />
						) : (
							<Download className="h-4 w-4" />
						)}
						{isInstalling
							? 'Installing…'
							: model?.installed
								? 'Start recording'
								: 'Download model'}
					</Button>
				</div>
			</div>
		</Modal>
	);
});
