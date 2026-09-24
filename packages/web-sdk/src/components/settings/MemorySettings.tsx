import { memo, useCallback } from 'react';
import { ArrowRight, BookMarked } from 'lucide-react';
import {
	useMemoryConfig,
	useUpdateMemoryConfig,
} from '../../hooks/useMemoryConfig';
import type { MemoryConfigUpdate } from '../../lib/api-client/memory';
import { toast } from '../../stores/toastStore';
import { ProviderLogo } from '../common/ProviderLogo';
import { StableSpinner } from '../ui/StableSpinner';

interface SwitchRowProps {
	label: string;
	description?: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
}

const SwitchRow = memo(function SwitchRow({
	label,
	description,
	checked,
	disabled,
	onChange,
}: SwitchRowProps) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-4 py-2 text-sm">
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium text-foreground">{label}</div>
				{description ? (
					<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
					checked ? 'bg-primary' : 'bg-muted'
				}`}
			>
				<span
					className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
						checked ? 'translate-x-6' : 'translate-x-1'
					} ${checked ? 'bg-primary-foreground' : 'bg-foreground'}`}
				/>
			</button>
		</div>
	);
});

interface TypeSafeSetupPromptProps {
	onOpenJudgeSettings?: () => void;
}

const TypeSafeSetupPrompt = memo(function TypeSafeSetupPrompt({
	onOpenJudgeSettings,
}: TypeSafeSetupPromptProps) {
	return (
		<div className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
			<div className="flex items-center gap-2">
				<ProviderLogo
					provider="typesafe"
					size={14}
					className="shrink-0 text-foreground"
				/>
				<span className="text-sm font-medium text-foreground">
					TypeSafe is not configured
				</span>
			</div>
			<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
				Memory still works with keyword-only recall and explicit{' '}
				<span className="font-mono">remember</span> calls. TypeSafe is needed to
				rank recalled memories by relevance and to capture durable preferences
				automatically.
			</p>
			{onOpenJudgeSettings ? (
				<button
					type="button"
					onClick={onOpenJudgeSettings}
					className="mt-2 inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
				>
					Set up TypeSafe
					<ArrowRight className="h-3 w-3" />
				</button>
			) : null}
		</div>
	);
});

interface MemorySettingsProps {
	/** Navigates to the judge (TypeSafe provider) settings. */
	onOpenJudgeSettings?: () => void;
}

export const MemorySettings = memo(function MemorySettings({
	onOpenJudgeSettings,
}: MemorySettingsProps) {
	const { data, isLoading, error } = useMemoryConfig();
	const update = useUpdateMemoryConfig();

	const apply = useCallback(
		(patch: MemoryConfigUpdate) => {
			update.mutate(patch, {
				onError: (err) => {
					toast.error(
						err instanceof Error
							? err.message
							: 'Failed to update memory settings',
					);
				},
			});
		},
		[update],
	);

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
				<StableSpinner size="sm" title="Loading" />
				Loading memory settings
			</div>
		);
	}
	if (error || !data) {
		return (
			<p className="py-3 text-xs text-destructive">
				{error instanceof Error
					? error.message
					: 'Failed to load memory settings'}
			</p>
		);
	}

	const { settings, typesafe } = data;
	const pending = update.isPending;
	const typesafeReady = typesafe.configured;

	return (
		<div className="divide-y divide-border/60">
			<div className="py-2">
				<div className="flex items-center gap-2">
					<BookMarked className="h-3.5 w-3.5 shrink-0 text-foreground" />
					<span className="text-sm font-medium text-foreground">
						Shared memory
					</span>
				</div>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					Durable preferences and project decisions stored in one user-local
					database shared by Otto and external MCP agents. Project memories stay
					scoped to this repository; global memories apply everywhere.
				</p>
				<div className="mt-2 flex items-center gap-2 text-xs">
					<span
						className={`inline-block h-1.5 w-1.5 rounded-full ${
							!settings.enabled
								? 'bg-muted-foreground/50'
								: typesafeReady
									? 'bg-green-500'
									: 'bg-amber-500'
						}`}
					/>
					<span className="text-muted-foreground">
						{!settings.enabled
							? 'Disabled'
							: typesafeReady
								? 'Active (TypeSafe ranking)'
								: 'Active (keyword-only recall)'}
					</span>
				</div>
				{data.path ? (
					<p
						className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70"
						title={data.path}
					>
						{data.path}
					</p>
				) : null}
			</div>

			{settings.enabled && !typesafeReady ? (
				<TypeSafeSetupPrompt onOpenJudgeSettings={onOpenJudgeSettings} />
			) : null}

			<SwitchRow
				label="Enable memory"
				description="Turn off to skip recall, capture, and the memory tools for every turn."
				checked={settings.enabled}
				disabled={pending}
				onChange={(checked) => apply({ enabled: checked })}
			/>
			<SwitchRow
				label="Recall into context"
				description="Search memory for each user message and supply up to three matches as untrusted context."
				checked={settings.recall}
				disabled={pending || !settings.enabled}
				onChange={(checked) => apply({ recall: checked })}
			/>
			<SwitchRow
				label="Automatic capture"
				description={
					typesafeReady
						? 'Save literal, durable user statements from each main turn after a TypeSafe durability check.'
						: 'Requires TypeSafe. Explicit saves via the remember tool still work.'
				}
				checked={settings.autoCapture}
				disabled={pending || !settings.enabled || !typesafeReady}
				onChange={(checked) => apply({ autoCapture: checked })}
			/>
		</div>
	);
});
