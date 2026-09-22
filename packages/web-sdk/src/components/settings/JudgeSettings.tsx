import { memo, useCallback, useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Trash2 } from 'lucide-react';
import {
	useJudgeConfig,
	useUpdateJudgeConfig,
} from '../../hooks/useJudgeConfig';
import type { JudgeConfigUpdate } from '../../lib/api-client/judge';
import { toast } from '../../stores/toastStore';
import { ProviderLogo } from '../common/ProviderLogo';
import { StableSpinner } from '../ui/StableSpinner';

const SIGNUP_URL = 'https://typesafe.ai';

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

interface TextRowProps {
	label: string;
	value: string;
	placeholder?: string;
	hint?: string;
	disabled?: boolean;
	secret?: boolean;
	inputMode?: 'text' | 'numeric' | 'decimal';
	widthClass?: string;
	validate?: (draft: string) => string | null;
	onCommit: (value: string) => void;
}

const TextRow = memo(function TextRow({
	label,
	value,
	placeholder,
	hint,
	disabled,
	secret,
	inputMode = 'text',
	widthClass = 'w-44',
	validate,
	onCommit,
}: TextRowProps) {
	const [draft, setDraft] = useState(value);
	const [revealed, setRevealed] = useState(false);
	useEffect(() => setDraft(value), [value]);

	const trimmed = draft.trim();
	const error = validate ? validate(trimmed) : null;
	const hasChanges = trimmed !== value && !error;

	const commit = useCallback(() => {
		if (!hasChanges) return;
		onCommit(trimmed);
	}, [hasChanges, onCommit, trimmed]);

	return (
		<div className="space-y-1.5 py-2">
			<div className="flex min-w-0 items-center justify-between gap-3 text-sm">
				<span className="min-w-0 flex-1 truncate whitespace-nowrap font-medium text-foreground">
					{label}
				</span>
				<div
					className={`flex shrink-0 items-center gap-1 rounded border bg-muted px-2 py-1 text-xs font-mono transition-colors focus-within:border-primary ${
						error ? 'border-destructive/60' : 'border-border'
					}`}
				>
					<input
						type={secret && !revealed ? 'password' : 'text'}
						inputMode={inputMode}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								commit();
							}
							if (event.key === 'Escape') {
								setDraft(value);
								event.currentTarget.blur();
							}
						}}
						placeholder={placeholder}
						disabled={disabled}
						autoComplete="off"
						spellCheck={false}
						className={`${widthClass} bg-transparent text-right outline-none placeholder:text-muted-foreground/70 disabled:opacity-50`}
					/>
					{secret ? (
						<button
							type="button"
							onClick={() => setRevealed((v) => !v)}
							className="inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
							aria-label={revealed ? 'Hide key' : 'Show key'}
						>
							{revealed ? (
								<EyeOff className="h-3.5 w-3.5" />
							) : (
								<Eye className="h-3.5 w-3.5" />
							)}
						</button>
					) : null}
					<button
						type="button"
						onClick={commit}
						disabled={disabled || !hasChanges}
						className="inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
						aria-label={`Save ${label}`}
					>
						<Check className="h-4 w-4" />
					</button>
				</div>
			</div>
			{error ? (
				<p className="text-xs text-destructive">{error}</p>
			) : hint ? (
				<p className="text-xs text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
});

function validateThreshold(draft: string): string | null {
	if (!draft) return 'Required';
	const n = Number(draft);
	if (!Number.isFinite(n) || n < 0 || n > 1) return 'Enter a value from 0 to 1';
	return null;
}

function validateTimeout(draft: string): string | null {
	if (!draft) return 'Required';
	const n = Number(draft);
	if (!Number.isInteger(n) || n <= 0) return 'Enter a positive whole number';
	return null;
}

function validateBaseURL(draft: string): string | null {
	if (!draft) return null;
	try {
		const url = new URL(draft);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return 'Use an http(s) URL';
		}
		return null;
	} catch {
		return 'Enter a valid URL';
	}
}

export const JudgeSettings = memo(function JudgeSettings() {
	const { data, isLoading, error } = useJudgeConfig();
	const update = useUpdateJudgeConfig();

	const apply = useCallback(
		(patch: JudgeConfigUpdate, successMessage?: string) => {
			update.mutate(patch, {
				onSuccess: () => {
					if (successMessage) toast.success(successMessage);
				},
				onError: (err) => {
					toast.error(
						err instanceof Error
							? err.message
							: 'Failed to update judge settings',
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
				Loading judge settings
			</div>
		);
	}
	if (error || !data) {
		return (
			<p className="py-3 text-xs text-destructive">
				{error instanceof Error
					? error.message
					: 'Failed to load judge settings'}
			</p>
		);
	}

	const { settings, credential, defaults } = data;
	const pending = update.isPending;
	const active = settings.enabled && credential.configured;

	return (
		<div className="divide-y divide-border/60">
			<div className="py-2">
				<div className="flex items-center gap-2">
					<ProviderLogo
						provider="typesafe"
						size={14}
						className="shrink-0 text-foreground"
					/>
					<span className="text-sm font-medium text-foreground">TypeSafe</span>
				</div>
				<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
					A small judge model that answers typed questions. It classifies MCP
					tools so writes ask for approval, and pre-loads the MCP tools each
					request likely needs. Never appears as a chat model.
				</p>
				<div className="mt-2 flex items-center gap-2 text-xs">
					<span
						className={`inline-block h-1.5 w-1.5 rounded-full ${
							active
								? 'bg-green-500'
								: credential.configured
									? 'bg-muted-foreground/50'
									: 'bg-amber-500'
						}`}
					/>
					<span className="text-muted-foreground">
						{active
							? `Active (${credential.source === 'env' ? credential.envVar : 'stored key'})`
							: credential.configured
								? 'Disabled'
								: 'No credential'}
					</span>
				</div>
			</div>

			{credential.source === 'env' ? (
				<div className="py-2">
					<p className="text-xs text-muted-foreground">
						Using <span className="font-mono">{credential.envVar}</span> from
						the server environment. Unset it to manage the key here.
					</p>
				</div>
			) : (
				<div className="flex items-end gap-2">
					<div className="min-w-0 flex-1">
						<TextRow
							label="API key"
							value=""
							secret
							placeholder={credential.configured ? '••••••••' : 'ts_...'}
							hint={
								credential.configured
									? 'A key is stored. Paste a new one to replace it.'
									: `Get a key at ${SIGNUP_URL}, or set ${credential.envVar}.`
							}
							disabled={pending}
							onCommit={(value) => apply({ apiKey: value }, 'Judge key saved')}
						/>
					</div>
					{credential.configured ? (
						<button
							type="button"
							disabled={pending}
							onClick={() => apply({ apiKey: '' }, 'Judge key removed')}
							className="mb-[30px] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
							aria-label="Remove stored key"
							title="Remove stored key"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					) : null}
				</div>
			)}

			<SwitchRow
				label="Enable judge"
				description="Turn off to skip all judge calls without removing the credential."
				checked={settings.enabled}
				disabled={pending}
				onChange={(checked) => apply({ enabled: checked })}
			/>
			<SwitchRow
				label="Classify MCP tools"
				description="Tag each MCP tool as read-only or a write so writes prompt for approval. Cached per tool."
				checked={settings.mcp.classifyTools}
				disabled={pending || !settings.enabled}
				onChange={(checked) => apply({ mcp: { classifyTools: checked } })}
			/>
			<SwitchRow
				label="Pre-load MCP tools"
				description="Activate the MCP tools each request likely needs before the model's first step."
				checked={settings.mcp.preloadTools}
				disabled={pending || !settings.enabled}
				onChange={(checked) => apply({ mcp: { preloadTools: checked } })}
			/>
			<TextRow
				label="Pre-load threshold"
				value={String(settings.mcp.preloadThreshold)}
				inputMode="decimal"
				widthClass="w-16"
				placeholder={String(defaults.preloadThreshold)}
				hint="Minimum probability (0-1) for a tool to be pre-loaded. Lower loads more."
				disabled={pending || !settings.enabled || !settings.mcp.preloadTools}
				validate={validateThreshold}
				onCommit={(value) =>
					apply({ mcp: { preloadThreshold: Number(value) } })
				}
			/>

			<TextRow
				label="Base URL"
				value={settings.baseURL}
				placeholder={defaults.baseURL}
				hint="Point at a self-hosted instance or gateway."
				disabled={pending}
				validate={validateBaseURL}
				onCommit={(value) => apply({ baseURL: value || defaults.baseURL })}
			/>
			<TextRow
				label="Model"
				value={settings.model}
				widthClass="w-32"
				placeholder={defaults.model}
				disabled={pending}
				onCommit={(value) => apply({ model: value || defaults.model })}
			/>
			<TextRow
				label="Timeout (ms)"
				value={String(settings.timeoutMs)}
				inputMode="numeric"
				widthClass="w-20"
				placeholder={String(defaults.timeoutMs)}
				hint="Per-request cap. Pre-loading is additionally capped at 1.5s per turn."
				disabled={pending}
				validate={validateTimeout}
				onCommit={(value) => apply({ timeoutMs: Number(value) })}
			/>
		</div>
	);
});
