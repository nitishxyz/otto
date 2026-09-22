import { memo, useEffect, useRef, useState } from 'react';
import { Key, LogOut, Settings2, X } from 'lucide-react';
import {
	useJudgeConfig,
	useUpdateJudgeConfig,
} from '../../../hooks/useJudgeConfig';
import { useSettingsStore } from '../../../stores/settingsStore';
import { toast } from '../../../stores/toastStore';
import { ProviderLogo } from '../../common/ProviderLogo';

/**
 * Providers-page card for the TypeSafe judge model. It is not a chat
 * provider, so it lives in its own section rather than the model list.
 */
export const JudgeProviderCard = memo(function JudgeProviderCard() {
	const { data } = useJudgeConfig();
	const update = useUpdateJudgeConfig();
	const openPreferences = useSettingsStore((s) => s.openPreferences);
	const [adding, setAdding] = useState(false);
	const [keyInput, setKeyInput] = useState('');
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (adding) inputRef.current?.focus();
	}, [adding]);

	if (!data) return null;
	const { credential, settings } = data;
	const configured = credential.configured;
	const active = configured && settings.enabled;

	const save = () => {
		const key = keyInput.trim();
		if (!key) return;
		update.mutate(
			{ apiKey: key },
			{
				onSuccess: () => {
					setAdding(false);
					setKeyInput('');
					toast.success('TypeSafe key saved');
				},
				onError: (err) =>
					toast.error(
						err instanceof Error ? err.message : 'Failed to save key',
					),
			},
		);
	};

	const remove = () => {
		update.mutate(
			{ apiKey: '' },
			{
				onSuccess: () => toast.success('TypeSafe key removed'),
				onError: (err) =>
					toast.error(
						err instanceof Error ? err.message : 'Failed to remove key',
					),
			},
		);
	};

	return (
		<div className="mt-10">
			<div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
				<div>
					<h2 className="font-semibold text-foreground">Judge Model</h2>
					<p className="text-xs text-muted-foreground mt-0.5">
						Not a chat model. Classifies MCP tools for approval and pre-loads
						the tools each request needs.
					</p>
				</div>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
				{adding ? (
					<div className="flex items-center gap-2 p-3 bg-card border border-ring rounded-xl overflow-hidden">
						<div className="shrink-0 flex items-center">
							<ProviderLogo provider="typesafe" size={18} />
						</div>
						<input
							ref={inputRef}
							type="password"
							value={keyInput}
							onChange={(e) => setKeyInput(e.target.value)}
							placeholder="TypeSafe API key..."
							className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground text-foreground"
							onKeyDown={(e) => {
								if (e.key === 'Enter') save();
								if (e.key === 'Escape') {
									setAdding(false);
									setKeyInput('');
								}
							}}
						/>
						<button
							type="button"
							onClick={save}
							disabled={!keyInput.trim() || update.isPending}
							className="shrink-0 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-50"
						>
							Add
						</button>
						<button
							type="button"
							onClick={() => {
								setAdding(false);
								setKeyInput('');
							}}
							className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground"
						>
							<X className="w-4 h-4" />
						</button>
					</div>
				) : (
					<div className="flex items-center justify-between p-3 bg-card border border-border hover:border-border/80 rounded-xl transition-colors gap-2">
						<div className="flex items-center gap-3 min-w-0">
							<ProviderLogo provider="typesafe" size={20} />
							<div className="min-w-0">
								<div className="flex items-center gap-2 font-medium text-foreground truncate">
									TypeSafe
									{configured ? (
										<span
											className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${
												active
													? 'bg-green-500/10 text-green-500'
													: 'bg-muted text-muted-foreground'
											}`}
										>
											<span
												className={`h-1.5 w-1.5 rounded-full ${
													active ? 'bg-green-500' : 'bg-muted-foreground/60'
												}`}
											/>
											{active ? 'Active' : 'Disabled'}
										</span>
									) : null}
								</div>
								<div className="text-xs text-muted-foreground">
									{configured
										? credential.source === 'env'
											? `From ${credential.envVar}`
											: `${settings.model} · stored key`
										: 'Jev · typed decisions with calibrated confidence'}
								</div>
							</div>
						</div>
						<div className="flex items-center gap-1 shrink-0">
							<button
								type="button"
								onClick={() => openPreferences('automation')}
								className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
								title="Judge settings"
							>
								<Settings2 className="w-3.5 h-3.5" />
							</button>
							{credential.source === 'env' ? null : configured ? (
								<button
									type="button"
									onClick={remove}
									disabled={update.isPending}
									className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
									title="Remove key"
								>
									<LogOut className="w-3.5 h-3.5" />
								</button>
							) : (
								<button
									type="button"
									onClick={() => setAdding(true)}
									className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
								>
									<Key className="w-3.5 h-3.5" />
									API
								</button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
});
