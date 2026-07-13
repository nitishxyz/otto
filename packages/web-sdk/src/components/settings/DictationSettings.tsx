import { memo } from 'react';
import { Download, Mic, RefreshCw, Trash2 } from 'lucide-react';
import { useDictationModels } from '../../hooks/useDictationModels';
import type { DictationModelState } from '../../lib/api-client';
import { Button } from '../ui/Button';
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

function modelStatusLabel(model: DictationModelState): string {
	if (model.installing) return `Downloading ${progressPercent(model)}%`;
	if (model.installed)
		return `Installed (${formatBytes(model.installedSizeBytes)})`;
	if (model.installStatus === 'error') return model.error ?? 'Install failed';
	return `${formatBytes(model.sizeBytes)} download`;
}

interface DictationModelRowProps {
	model: DictationModelState;
	isBusy: boolean;
	isDefault: boolean;
	onInstall: (modelId: string) => void;
	onRemove: (modelId: string) => void;
}

const DictationModelRow = memo(function DictationModelRow({
	model,
	isBusy,
	isDefault,
	onInstall,
	onRemove,
}: DictationModelRowProps) {
	const percent = progressPercent(model);
	const canInstall = !model.installed && !model.installing;
	const canRemove = model.installed && !model.installing;

	return (
		<div className="py-3 space-y-2">
			<div className="flex items-start gap-3">
				<div className="flex-1 min-w-0">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="text-sm font-medium truncate">{model.label}</span>
						{isDefault ? (
							<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
								Default
							</span>
						) : null}
						{model.recommended && !isDefault ? (
							<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
								Recommended
							</span>
						) : null}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{model.id} ·{' '}
						{model.language === 'multi' ? 'Multilingual' : 'English'}
					</div>
					<div
						className={`mt-1 text-xs ${model.installStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
					>
						{modelStatusLabel(model)}
					</div>
				</div>

				{canRemove ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => onRemove(model.id)}
						disabled={isBusy}
						aria-label={`Remove ${model.label}`}
						className="h-8 w-8"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				) : (
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => onInstall(model.id)}
						disabled={isBusy || !canInstall}
						className="gap-1.5"
					>
						{model.installing ? (
							<StableSpinner className="h-3.5 w-3.5" />
						) : (
							<Download className="h-3.5 w-3.5" />
						)}
						Install
					</Button>
				)}
			</div>

			{model.installing ? (
				<div className="h-1.5 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary transition-all"
						style={{ width: `${percent}%` }}
					/>
				</div>
			) : null}
		</div>
	);
});

interface DictationSettingsProps {
	embedded?: boolean;
}

export const DictationSettings = memo(function DictationSettings({
	embedded = false,
}: DictationSettingsProps) {
	const {
		statusQuery,
		models,
		isAvailable,
		defaultModel,
		installModel,
		removeModel,
		installMutation,
		removeMutation,
		installStreamError,
	} = useDictationModels();

	const isBusy = installMutation.isPending || removeMutation.isPending;

	if (embedded) {
		return (
			<section className="pt-4">
				<div className="flex items-center justify-between gap-2 pb-1">
					<h3
						className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60"
						title="Download a local model for on-device voice input."
					>
						Local Speech Models
					</h3>
					<button
						type="button"
						onClick={() => statusQuery.refetch()}
						disabled={statusQuery.isFetching}
						className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
						title="Refresh dictation status"
					>
						<RefreshCw
							className={`h-3 w-3 ${statusQuery.isFetching ? 'animate-spin' : ''}`}
						/>
					</button>
				</div>
				{statusQuery.isLoading ? (
					<div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
						<StableSpinner className="h-4 w-4" />
						Loading dictation models…
					</div>
				) : statusQuery.error ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
						{statusQuery.error instanceof Error
							? statusQuery.error.message
							: 'Failed to load dictation settings'}
					</div>
				) : !isAvailable ? (
					<p className="py-2 text-xs leading-relaxed text-muted-foreground">
						Local dictation is not available on this platform yet.
					</p>
				) : (
					<div>
						{installStreamError ? (
							<div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
								{installStreamError}
							</div>
						) : null}
						<div className="divide-y divide-border/60">
							{models.map((model) => (
								<DictationModelRow
									key={model.id}
									model={model}
									isBusy={isBusy}
									isDefault={model.id === defaultModel}
									onInstall={(modelId) => void installModel(modelId)}
									onRemove={(modelId) => void removeModel(modelId)}
								/>
							))}
						</div>
					</div>
				)}
			</section>
		);
	}

	return (
		<div className="border-b border-border">
			<div className="px-4 py-3 flex items-center gap-2 bg-muted/30">
				<Mic className="w-4 h-4 text-muted-foreground" />
				<span className="text-sm font-medium flex-1">Dictation</span>
				<button
					type="button"
					onClick={() => statusQuery.refetch()}
					disabled={statusQuery.isFetching}
					className="p-1 hover:bg-muted rounded transition-colors disabled:opacity-50"
					title="Refresh dictation status"
				>
					<RefreshCw
						className={`w-3.5 h-3.5 text-muted-foreground ${statusQuery.isFetching ? 'animate-spin' : ''}`}
					/>
				</button>
			</div>

			<div className="px-4 py-3 space-y-3">
				<p className="text-xs text-muted-foreground">
					Download a local speech model for voice input.
				</p>

				{statusQuery.isLoading ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<StableSpinner className="h-4 w-4" />
						Loading dictation models…
					</div>
				) : statusQuery.error ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
						{statusQuery.error instanceof Error
							? statusQuery.error.message
							: 'Failed to load dictation settings'}
					</div>
				) : !isAvailable ? (
					<div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
						Local dictation is not available on this platform yet.
					</div>
				) : (
					<div>
						{installStreamError ? (
							<div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
								{installStreamError}
							</div>
						) : null}

						<div className="divide-y divide-border/60">
							{models.map((model) => (
								<DictationModelRow
									key={model.id}
									model={model}
									isBusy={isBusy}
									isDefault={model.id === defaultModel}
									onInstall={(modelId) => void installModel(modelId)}
									onRemove={(modelId) => void removeModel(modelId)}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
});
