import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Globe2, RefreshCw } from 'lucide-react';
import { ProviderLogo } from '../common/ProviderLogo';
import { apiClient } from '../../lib/api-client';
import type { UsageStats } from '../../lib/api-client/usage';

interface UsageDashboardProps {
	onBack?: () => void;
}

function formatNumber(n: number): string {
	if (!Number.isFinite(n) || n === 0) return '0';
	if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return n.toLocaleString();
}

function formatUsd(n: number): string {
	if (!Number.isFinite(n) || n === 0) return '$0';
	if (n < 0.01) return `$${n.toFixed(4)}`;
	if (n < 1) return `$${n.toFixed(3)}`;
	if (n < 100) return `$${n.toFixed(2)}`;
	return `$${n.toFixed(0)}`;
}

function authLabel(t: string) {
	if (t === 'oauth') return 'oauth';
	if (t === 'subscription') return 'sub';
	if (t === 'wallet') return 'wallet';
	if (t === 'api') return 'api';
	return '—';
}

function authColor(t: string) {
	if (t === 'oauth') return 'text-emerald-400';
	if (t === 'subscription') return 'text-violet-400';
	if (t === 'wallet') return 'text-fuchsia-400';
	if (t === 'api') return 'text-sky-400';
	return 'text-muted-foreground';
}

/* ------------------------------------------------------------------ */
/* Daily activity chart                                                */
/* ------------------------------------------------------------------ */

type ChartTab = 'cost' | 'tokens';

function DailyChart({ data }: { data: UsageStats['daily'] }) {
	const [tab, setTab] = useState<ChartTab>('cost');
	const [hover, setHover] = useState<number | null>(null);

	const max = useMemo(() => {
		if (tab === 'tokens') {
			return data.reduce(
				(m, d) => Math.max(m, d.inputTokens + d.outputTokens),
				0,
			);
		}
		// For cost: include notional, so OAuth/sub days show their would-have-cost
		return data.reduce((m, d) => Math.max(m, d.notionalCostUsd), 0);
	}, [data, tab]);

	if (data.length === 0) {
		return (
			<div className="h-44 flex items-center justify-center text-xs text-muted-foreground">
				No activity yet
			</div>
		);
	}

	const focus = hover != null ? data[hover] : data[data.length - 1];

	const focusValue =
		tab === 'tokens'
			? formatNumber(focus.inputTokens + focus.outputTokens)
			: formatUsd(focus.notionalCostUsd);
	const focusSub =
		tab === 'tokens'
			? `${formatNumber(focus.inputTokens)} in · ${formatNumber(
					focus.outputTokens,
				)} out`
			: focus.costUsd > 0
				? `${formatUsd(focus.costUsd)} pay-as-you-go · ${formatUsd(
						focus.notionalCostUsd - focus.costUsd,
					)} via plans`
				: `${formatUsd(focus.notionalCostUsd)} via plans`;

	return (
		<div>
			<div className="flex items-baseline justify-between gap-4 mb-4">
				<div className="min-w-0">
					<div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
						{focus.date}
					</div>
					<div className="text-xl font-semibold tabular-nums mt-0.5 truncate">
						{focusValue}
					</div>
					<div className="text-[11px] text-muted-foreground tabular-nums mt-0.5 truncate">
						{focusSub}
					</div>
				</div>
				<div className="shrink-0 inline-flex p-0.5 rounded-md border border-border bg-muted/30 text-[11px]">
					<button
						type="button"
						onClick={() => setTab('cost')}
						className={`px-2.5 py-1 rounded transition-colors ${
							tab === 'cost'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'
						}`}
					>
						Cost
					</button>
					<button
						type="button"
						onClick={() => setTab('tokens')}
						className={`px-2.5 py-1 rounded transition-colors ${
							tab === 'tokens'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'
						}`}
					>
						Tokens
					</button>
				</div>
			</div>

			{tab === 'cost' ? (
				<CostChart data={data} max={max} hover={hover} onHover={setHover} />
			) : (
				<TokenChart data={data} max={max} hover={hover} onHover={setHover} />
			)}

			<div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
				<span>{data[0]?.date}</span>
				{tab === 'cost' ? (
					<span className="flex items-center gap-3">
						<Dot color="bg-sky-400" label="api" />
						<Dot color="bg-emerald-400/70" label="oauth" />
						<Dot color="bg-violet-400/70" label="sub" />
					</span>
				) : (
					<span className="flex items-center gap-3">
						<Dot color="bg-muted-foreground/60" label="input" />
						<Dot color="bg-foreground/80" label="output" />
					</span>
				)}
				<span>{data[data.length - 1]?.date}</span>
			</div>
		</div>
	);
}

interface SubChartProps {
	data: UsageStats['daily'];
	max: number;
	hover: number | null;
	onHover: (i: number | null) => void;
}

function CostChart({ data, max, hover, onHover }: SubChartProps) {
	return (
		<div
			role="img"
			aria-label="Daily cost chart"
			className="flex items-end gap-[3px] h-44 select-none"
			onMouseLeave={() => onHover(null)}
		>
			{data.map((d, i) => {
				// Bar = notional cost (what it would have cost on the API)
				// Within each bar, sky portion = actually paid, lighter portion = saved
				const notional = d.notionalCostUsd;
				const heightPct = max > 0 ? Math.max(2, (notional / max) * 100) : 2;
				const apiPct =
					notional > 0 ? (d.notionalByAuth.api / notional) * 100 : 0;
				const oauthPct =
					notional > 0 ? (d.notionalByAuth.oauth / notional) * 100 : 0;
				const subPct =
					notional > 0 ? (d.notionalByAuth.subscription / notional) * 100 : 0;
				const active = hover === i;
				return (
					<button
						type="button"
						key={d.date}
						onMouseEnter={() => onHover(i)}
						onFocus={() => onHover(i)}
						className="flex-1 h-full flex flex-col justify-end min-w-0 group cursor-default"
					>
						<div
							className={`w-full rounded-sm overflow-hidden flex flex-col-reverse transition-all ${
								active ? 'opacity-100' : 'opacity-90 group-hover:opacity-100'
							}`}
							style={{ height: `${heightPct}%` }}
						>
							{apiPct > 0 && (
								<div className="bg-sky-400" style={{ height: `${apiPct}%` }} />
							)}
							{oauthPct > 0 && (
								<div
									className="bg-emerald-400/70"
									style={{
										height: `${oauthPct}%`,
										backgroundImage:
											'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 4px)',
									}}
								/>
							)}
							{subPct > 0 && (
								<div
									className="bg-violet-400/70"
									style={{
										height: `${subPct}%`,
										backgroundImage:
											'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 4px)',
									}}
								/>
							)}
							{notional === 0 && d.messages > 0 && (
								<div className="bg-muted-foreground/30 h-full" />
							)}
						</div>
					</button>
				);
			})}
		</div>
	);
}

function TokenChart({ data, max, hover, onHover }: SubChartProps) {
	return (
		<div
			role="img"
			aria-label="Daily tokens chart"
			className="flex items-end gap-[3px] h-44 select-none"
			onMouseLeave={() => onHover(null)}
		>
			{data.map((d, i) => {
				const total = d.inputTokens + d.outputTokens;
				const heightPct = max > 0 ? Math.max(2, (total / max) * 100) : 2;
				const inputPct = total > 0 ? (d.inputTokens / total) * 100 : 0;
				const outputPct = total > 0 ? (d.outputTokens / total) * 100 : 0;
				const active = hover === i;
				return (
					<button
						type="button"
						key={d.date}
						onMouseEnter={() => onHover(i)}
						onFocus={() => onHover(i)}
						className="flex-1 h-full flex flex-col justify-end min-w-0 group cursor-default"
					>
						<div
							className={`w-full rounded-sm overflow-hidden flex flex-col-reverse transition-all ${
								active ? 'opacity-100' : 'opacity-90 group-hover:opacity-100'
							}`}
							style={{ height: `${heightPct}%` }}
						>
							{inputPct > 0 && (
								<div
									className="bg-muted-foreground/60"
									style={{ height: `${inputPct}%` }}
								/>
							)}
							{outputPct > 0 && (
								<div
									className="bg-foreground/80"
									style={{ height: `${outputPct}%` }}
								/>
							)}
						</div>
					</button>
				);
			})}
		</div>
	);
}
function Dot({ color, label }: { color: string; label: string }) {
	return (
		<span className="flex items-center gap-1">
			<span className={`size-1.5 rounded-full ${color}`} />
			<span>{label}</span>
		</span>
	);
}

/* ------------------------------------------------------------------ */
/* Auth split (kept — user liked this)                                 */
/* ------------------------------------------------------------------ */

function SplitRow({
	color,
	label,
	msgs,
	value,
	total,
}: {
	color: string;
	label: string;
	msgs: number;
	value: number;
	total: number;
}) {
	const pct = total > 0 ? (msgs / total) * 100 : 0;
	return (
		<div className="flex items-center gap-3 py-2">
			<span className="text-xs text-muted-foreground w-20 shrink-0">
				{label}
			</span>
			<div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
				<div
					className={`h-full ${color} transition-all duration-500`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="text-[11px] text-muted-foreground tabular-nums w-20 text-right shrink-0">
				{formatNumber(msgs)} msgs
			</span>
			<span className="text-sm font-medium tabular-nums w-20 text-right shrink-0 text-foreground">
				{formatUsd(value)}
			</span>
		</div>
	);
}

function AuthSplit({ stats }: { stats: UsageStats }) {
	const total =
		stats.totals.messagesByAuth.api +
		stats.totals.messagesByAuth.oauth +
		stats.totals.messagesByAuth.subscription;

	if (total === 0)
		return (
			<div className="text-xs text-muted-foreground">No activity yet.</div>
		);

	// Derive notional cost per bucket by summing providers' notionalCostUsd
	const notionalByAuth = { oauth: 0, api: 0, subscription: 0 };
	for (const p of stats.providers) {
		if (p.authType === 'oauth') notionalByAuth.oauth += p.notionalCostUsd;
		else if (p.authType === 'subscription' || p.authType === 'wallet')
			notionalByAuth.subscription += p.notionalCostUsd;
		else if (p.authType === 'api') notionalByAuth.api += p.notionalCostUsd;
	}

	const rows = [
		{
			key: 'api',
			color: 'bg-sky-400',
			label: 'API key',
			msgs: stats.totals.messagesByAuth.api,
			value: notionalByAuth.api,
		},
		{
			key: 'oauth',
			color: 'bg-emerald-400',
			label: 'OAuth',
			msgs: stats.totals.messagesByAuth.oauth,
			value: notionalByAuth.oauth,
		},
		{
			key: 'subscription',
			color: 'bg-violet-400',
			label: 'Subscription',
			msgs: stats.totals.messagesByAuth.subscription,
			value: notionalByAuth.subscription,
		},
	].sort((a, b) => b.value - a.value || b.msgs - a.msgs);

	return (
		<div className="space-y-0.5">
			{rows.map((r) => (
				<SplitRow
					key={r.key}
					total={total}
					color={r.color}
					label={r.label}
					msgs={r.msgs}
					value={r.value}
				/>
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Top usage list (combined providers + models)                        */
/* ------------------------------------------------------------------ */

function ProviderList({ providers }: { providers: UsageStats['providers'] }) {
	if (providers.length === 0) {
		return (
			<div className="py-10 text-center text-xs text-muted-foreground">
				No usage yet
			</div>
		);
	}
	return (
		<div className="divide-y divide-border/60">
			{providers.map((p) => (
				<div
					key={p.provider}
					className="flex items-center gap-3 py-2.5 px-1 hover:bg-muted/20 transition-colors"
				>
					<div className="size-7 shrink-0 rounded-md bg-muted/30 flex items-center justify-center text-muted-foreground">
						<ProviderLogo provider={p.provider} size={16} />
					</div>
					<div className="flex-1 min-w-0">
						<div className="text-sm text-foreground truncate capitalize">
							{p.provider}
						</div>
						<div className="text-[10px] text-muted-foreground tabular-nums">
							{formatNumber(p.messages)} msgs ·{' '}
							<span className={authColor(p.authType)}>
								{authLabel(p.authType)}
							</span>
						</div>
					</div>
					<div className="text-right tabular-nums shrink-0">
						<div className="text-sm font-medium text-foreground">
							{formatUsd(p.notionalCostUsd)}
						</div>
						<div className="text-[10px] text-muted-foreground">
							{formatNumber(p.inputTokens + p.outputTokens)} tok
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

function ModelList({ models }: { models: UsageStats['models'] }) {
	if (models.length === 0) {
		return (
			<div className="py-10 text-center text-xs text-muted-foreground">
				No model usage yet
			</div>
		);
	}
	return (
		<div className="divide-y divide-border/60">
			{models.slice(0, 12).map((m) => (
				<div
					key={`${m.provider}-${m.model}`}
					className="flex items-center gap-3 py-2.5 px-1 hover:bg-muted/20 transition-colors"
				>
					<div className="size-7 shrink-0 rounded-md bg-muted/30 flex items-center justify-center text-muted-foreground">
						<ProviderLogo provider={m.provider} size={14} />
					</div>
					<div className="flex-1 min-w-0">
						<div className="text-sm text-foreground truncate font-mono">
							{m.model}
						</div>
						<div className="text-[10px] text-muted-foreground tabular-nums">
							{formatNumber(m.messages)} msgs ·{' '}
							{formatNumber(m.inputTokens + m.outputTokens)} tok
						</div>
					</div>
					<div className="text-right tabular-nums shrink-0">
						<div className="text-sm font-medium text-foreground">
							{formatUsd(m.notionalCostUsd)}
						</div>
						<div className={`text-[10px] ${authColor(m.authType)}`}>
							{authLabel(m.authType)}
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Project list (global scope)                                         */
/* ------------------------------------------------------------------ */

function ProjectList({
	projects,
}: {
	projects: NonNullable<UsageStats['projects']>;
}) {
	if (projects.included.length === 0 && projects.unavailable.length === 0) {
		return (
			<div className="py-10 text-center text-xs text-muted-foreground">
				No projects registered yet
			</div>
		);
	}
	return (
		<div className="divide-y divide-border/60">
			{projects.included.map((p) => (
				<div
					key={p.id}
					className="flex items-center gap-3 py-2.5 px-1 hover:bg-muted/20 transition-colors"
				>
					<div className="flex-1 min-w-0">
						<div className="text-sm text-foreground truncate">{p.name}</div>
						<div className="text-[10px] text-muted-foreground tabular-nums truncate font-mono">
							{p.path}
						</div>
					</div>
					<div className="text-right tabular-nums shrink-0">
						<div className="text-sm font-medium text-foreground">
							{formatUsd(p.notionalCostUsd)}
						</div>
						<div className="text-[10px] text-muted-foreground">
							{formatNumber(p.messages)} msgs
						</div>
					</div>
				</div>
			))}
			{projects.unavailable.map((p) => (
				<div
					key={p.id}
					className="flex items-center gap-3 py-2.5 px-1 opacity-60"
					title={p.reason}
				>
					<AlertTriangle className="size-3.5 text-amber-400 shrink-0" />
					<div className="flex-1 min-w-0">
						<div className="text-sm text-foreground/80 truncate">{p.name}</div>
						<div className="text-[10px] text-muted-foreground truncate font-mono">
							{p.path} · {p.reason}
						</div>
					</div>
					<div className="text-[10px] text-amber-400 shrink-0">unavailable</div>
				</div>
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Card primitive                                                      */
/* ------------------------------------------------------------------ */

function Section({
	title,
	subtitle,
	right,
	children,
	className = '',
}: {
	title?: string;
	subtitle?: string;
	right?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section
			className={`rounded-2xl border border-border bg-card/60 backdrop-blur-sm ${className}`}
		>
			{(title || right) && (
				<header className="px-5 pt-4 pb-3 flex items-center justify-between gap-3">
					<div className="min-w-0">
						{title && (
							<h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
								{title}
							</h2>
						)}
						{subtitle && (
							<p className="text-xs text-muted-foreground/70 mt-0.5">
								{subtitle}
							</p>
						)}
					</div>
					{right}
				</header>
			)}
			<div className="px-5 pb-5">{children}</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export function UsageDashboard({ onBack }: UsageDashboardProps) {
	const [stats, setStats] = useState<UsageStats | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [scope, setScope] = useState<'project' | 'global'>('project');

	const fetchStats = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data =
				scope === 'global'
					? await apiClient.getGlobalUsageStats()
					: await apiClient.getUsageStats();
			setStats(data);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to load usage stats');
		} finally {
			setLoading(false);
		}
	}, [scope]);

	useEffect(() => {
		void fetchStats();
	}, [fetchStats]);

	const handleBack = useCallback(() => {
		if (onBack) return onBack();
		if (typeof window === 'undefined') return;
		if (window.history.length > 1) window.history.back();
		else window.location.assign('/');
	}, [onBack]);

	const projectName = useMemo(() => {
		if (scope === 'global') {
			const included = stats?.projects?.included.length ?? 0;
			const unavailable = stats?.projects?.unavailable.length ?? 0;
			const total = included + unavailable;
			if (total === 0) return 'all projects';
			return unavailable > 0
				? `${included} of ${total} projects`
				: `${total} project${total === 1 ? '' : 's'}`;
		}
		if (!stats?.project) return '';
		const parts = stats.project.split('/').filter(Boolean);
		return parts[parts.length - 1] ?? stats.project;
	}, [scope, stats?.project, stats?.projects]);

	const totalSpend = stats?.totals.costUsd ?? 0;
	const totalMessages = stats?.totals.messages ?? 0;
	const totalTokens =
		(stats?.totals.inputTokens ?? 0) + (stats?.totals.outputTokens ?? 0);

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
			{/* Header */}
			<header className="shrink-0 h-10 border-b border-border/60 bg-background/80 backdrop-blur">
				<div className="h-full max-w-5xl mx-auto px-6 flex items-center justify-between gap-3">
					<div className="flex items-center gap-2 min-w-0">
						<button
							type="button"
							onClick={handleBack}
							className="inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
							title="Back"
							aria-label="Back"
						>
							<ArrowLeft className="size-3.5" />
						</button>
						<div className="min-w-0 flex items-baseline gap-1.5 text-xs">
							<span className="text-muted-foreground/70 uppercase tracking-[0.1em] text-[10px]">
								Usage
							</span>
							<span className="text-muted-foreground/40">/</span>
							<span className="font-medium truncate text-foreground">
								{projectName || '—'}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-1.5">
						<div className="inline-flex p-0.5 rounded-md border border-border bg-muted/30 text-[11px]">
							<button
								type="button"
								onClick={() => setScope('project')}
								className={`px-2 py-0.5 rounded transition-colors ${
									scope === 'project'
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'
								}`}
							>
								Project
							</button>
							<button
								type="button"
								onClick={() => setScope('global')}
								className={`px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1 ${
									scope === 'global'
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground'
								}`}
							>
								<Globe2 className="size-3" />
								Global
							</button>
						</div>
						<button
							type="button"
							onClick={() => void fetchStats()}
							disabled={loading}
							className="inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
							title="Refresh"
							aria-label="Refresh"
						>
							<RefreshCw
								className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
							/>
						</button>
					</div>
				</div>
			</header>

			{/* Body */}
			<main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
				<div className="max-w-5xl mx-auto px-6 py-8 space-y-5">
					{error && (
						<div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
							{error}
						</div>
					)}

					{loading && !stats && (
						<div className="py-24 text-center text-xs text-muted-foreground">
							loading…
						</div>
					)}

					{stats && (
						<>
							{/* HERO — Token value at API rates is the headline */}
							<div className="rounded-2xl border border-border bg-gradient-to-br from-card to-card/40 px-6 py-7">
								<div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-6 md:gap-10 items-center">
									<div>
										<div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
											Token value · API rates
										</div>
										<div className="mt-2 text-5xl font-semibold tabular-nums tracking-tight">
											{formatUsd(stats.totals.notionalCostUsd)}
										</div>
										<div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
											all {formatNumber(stats.totals.messages)} msgs valued at
											catalog API pricing
										</div>
									</div>

									<div className="md:border-l md:border-border/60 md:pl-6">
										<div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
											API spend
										</div>
										<div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
											{formatUsd(totalSpend)}
										</div>
										<div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
											{formatNumber(stats.totals.messagesByAuth.api)}{' '}
											pay-as-you-go msgs
										</div>
									</div>

									<div className="md:border-l md:border-border/60 md:pl-6">
										<div className="text-[10px] uppercase tracking-[0.18em] text-emerald-400/80">
											OAuth · plan value
										</div>
										<div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-emerald-400">
											{formatUsd(
												stats.providers
													.filter((p) => p.authType === 'oauth')
													.reduce((s, p) => s + p.notionalCostUsd, 0),
											)}
										</div>
										<div className="mt-2 text-[11px] text-muted-foreground tabular-nums">
											{formatNumber(stats.totals.messagesByAuth.oauth)} msgs via
											plan subscriptions
										</div>
									</div>
								</div>

								<div className="mt-6 pt-5 border-t border-border/40 grid grid-cols-3 gap-6 text-[11px] text-muted-foreground">
									<div>
										<div className="uppercase tracking-[0.14em] text-muted-foreground/70">
											Messages
										</div>
										<div className="mt-1 text-sm text-foreground tabular-nums">
											{formatNumber(totalMessages)}{' '}
											<span className="text-muted-foreground/70">
												· {formatNumber(stats.totals.sessions)} sessions
											</span>
										</div>
									</div>
									<div>
										<div className="uppercase tracking-[0.14em] text-muted-foreground/70">
											Tokens
										</div>
										<div className="mt-1 text-sm text-foreground tabular-nums">
											{formatNumber(totalTokens)}{' '}
											<span className="text-muted-foreground/70">
												· {formatNumber(stats.totals.inputTokens)} in /{' '}
												{formatNumber(stats.totals.outputTokens)} out
											</span>
										</div>
									</div>
									<div>
										<div className="uppercase tracking-[0.14em] text-muted-foreground/70">
											Mix
										</div>
										<div className="mt-1 text-sm tabular-nums">
											<span className={authColor('api')}>
												{formatNumber(stats.totals.messagesByAuth.api)} api
											</span>
											{stats.totals.messagesByAuth.oauth > 0 && (
												<>
													<span className="text-muted-foreground/40"> · </span>
													<span className={authColor('oauth')}>
														{formatNumber(stats.totals.messagesByAuth.oauth)}{' '}
														oauth
													</span>
												</>
											)}
											{stats.totals.messagesByAuth.subscription > 0 && (
												<>
													<span className="text-muted-foreground/40"> · </span>
													<span className={authColor('subscription')}>
														{formatNumber(
															stats.totals.messagesByAuth.subscription,
														)}{' '}
														sub
													</span>
												</>
											)}
										</div>
									</div>
								</div>
							</div>

							{/* Auth split */}
							<Section
								title="How you're paying"
								subtitle="OAuth & Subscription are flat-rate · not per-token"
							>
								<AuthSplit stats={stats} />
							</Section>

							{/* Daily chart */}
							<Section title="Daily activity">
								<DailyChart data={stats.daily} />
							</Section>

							{/* Top providers + models */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-5">
								<Section title="By provider">
									<ProviderList providers={stats.providers} />
								</Section>
								<Section
									title="Top models"
									subtitle={
										stats.models.length > 12
											? `Showing 12 of ${stats.models.length}`
											: undefined
									}
								>
									<ModelList models={stats.models} />
								</Section>
							</div>

							{/* Projects (global scope only) */}
							{scope === 'global' && stats.projects && (
								<Section
									title="Projects"
									subtitle={
										stats.projects.unavailable.length > 0
											? `${stats.projects.included.length} included · ${stats.projects.unavailable.length} unavailable`
											: `${stats.projects.included.length} included`
									}
								>
									<ProjectList projects={stats.projects} />
								</Section>
							)}

							{stats.notes.missingPricing.length > 0 && (
								<div className="text-[10px] text-muted-foreground/70 text-center font-mono py-2">
									pricing missing for {stats.notes.missingPricing.length} model
									{stats.notes.missingPricing.length === 1 ? '' : 's'} · cost
									shown as $0
								</div>
							)}

							<div className="text-[10px] text-muted-foreground/60 text-center pt-2 pb-4">
								estimated from catalog pricing · generated{' '}
								{new Date(stats.generatedAt).toLocaleString()}
							</div>
						</>
					)}
				</div>
			</main>
		</div>
	);
}
