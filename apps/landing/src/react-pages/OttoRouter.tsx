import { useEffect, useState, useRef } from 'react';

import { Reveal } from '../components/Reveal';
import { TerminalBlock } from '../components/TerminalBlock';
import { ProviderLogo } from '../components/ProviderLogo';

function OttoRouterMark({ className = 'w-6 h-6' }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 2v7.5" />
			<path d="m19 5-5.23 5.23" />
			<path d="M22 12h-7.5" />
			<path d="m19 19-5.23-5.23" />
			<path d="M12 14.5V22" />
			<path d="M10.23 13.77 5 19" />
			<path d="M9.5 12H2" />
			<path d="M10.23 10.23 5 5" />
			<circle cx="12" cy="12" r="2.5" />
		</svg>
	);
}

const MODELS = [
	{
		provider: 'openai',
		label: 'OpenAI',
		endpoint: '/v1/responses',
		models: [
			{ id: 'gpt-5', label: 'GPT-5', input: 1.25, output: 10 },
			{ id: 'gpt-5-chat-latest', label: 'GPT-5 Chat', input: 1.25, output: 10 },
			{ id: 'gpt-5-codex', label: 'GPT-5 Codex', input: 1.25, output: 10 },
			{ id: 'gpt-5-mini', label: 'GPT-5 Mini', input: 0.25, output: 2 },
			{ id: 'gpt-5-nano', label: 'GPT-5 Nano', input: 0.05, output: 0.4 },
			{ id: 'gpt-5-pro', label: 'GPT-5 Pro', input: 15, output: 120 },
			{ id: 'gpt-5.1', label: 'GPT-5.1', input: 1.25, output: 10 },
			{
				id: 'gpt-5.1-chat-latest',
				label: 'GPT-5.1 Chat',
				input: 1.25,
				output: 10,
			},
			{ id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', input: 1.25, output: 10 },
			{
				id: 'gpt-5.1-codex-max',
				label: 'GPT-5.1 Codex Max',
				input: 1.25,
				output: 10,
			},
			{
				id: 'gpt-5.1-codex-mini',
				label: 'GPT-5.1 Codex Mini',
				input: 0.25,
				output: 2,
			},
			{ id: 'gpt-5.2', label: 'GPT-5.2', input: 1.75, output: 14 },
			{
				id: 'gpt-5.2-chat-latest',
				label: 'GPT-5.2 Chat',
				input: 1.75,
				output: 14,
			},
			{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', input: 1.75, output: 14 },
			{ id: 'gpt-5.2-pro', label: 'GPT-5.2 Pro', input: 21, output: 168 },
			{ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', input: 1.75, output: 14 },
			{
				id: 'gpt-5.3-codex-spark',
				label: 'GPT-5.3 Codex Spark',
				input: 1.75,
				output: 14,
			},
		],
	},
	{
		provider: 'anthropic',
		label: 'Anthropic',
		endpoint: '/v1/messages',
		models: [
			{
				id: 'claude-sonnet-4-6',
				label: 'Claude Sonnet 4.6',
				input: 3,
				output: 15,
			},
			{
				id: 'claude-sonnet-4-5',
				label: 'Claude Sonnet 4.5',
				input: 3,
				output: 15,
			},
			{
				id: 'claude-sonnet-4-5-20250929',
				label: 'Claude Sonnet 4.5 (20250929)',
				input: 3,
				output: 15,
			},
			{
				id: 'claude-sonnet-4-0',
				label: 'Claude Sonnet 4',
				input: 3,
				output: 15,
			},
			{
				id: 'claude-sonnet-4-20250514',
				label: 'Claude Sonnet 4 (20250514)',
				input: 3,
				output: 15,
			},
			{ id: 'claude-opus-4-6', label: 'Claude Opus 4.6', input: 5, output: 25 },
			{ id: 'claude-opus-4-5', label: 'Claude Opus 4.5', input: 5, output: 25 },
			{
				id: 'claude-opus-4-5-20251101',
				label: 'Claude Opus 4.5 (20251101)',
				input: 5,
				output: 25,
			},
			{
				id: 'claude-opus-4-1',
				label: 'Claude Opus 4.1',
				input: 15,
				output: 75,
			},
			{
				id: 'claude-opus-4-1-20250805',
				label: 'Claude Opus 4.1 (20250805)',
				input: 15,
				output: 75,
			},
			{ id: 'claude-opus-4-0', label: 'Claude Opus 4', input: 15, output: 75 },
			{
				id: 'claude-opus-4-20250514',
				label: 'Claude Opus 4 (20250514)',
				input: 15,
				output: 75,
			},
			{
				id: 'claude-haiku-4-5',
				label: 'Claude Haiku 4.5',
				input: 1,
				output: 5,
			},
			{
				id: 'claude-haiku-4-5-20251001',
				label: 'Claude Haiku 4.5 (20251001)',
				input: 1,
				output: 5,
			},
			{
				id: 'claude-3-5-haiku-latest',
				label: 'Claude Haiku 3.5',
				input: 0.8,
				output: 4,
			},
			{
				id: 'claude-3-5-haiku-20241022',
				label: 'Claude Haiku 3.5 (20241022)',
				input: 0.8,
				output: 4,
			},
			{
				id: 'claude-3-5-sonnet-20241022',
				label: 'Claude Sonnet 3.5 v2',
				input: 3,
				output: 15,
			},
			{
				id: 'claude-3-5-sonnet-20240620',
				label: 'Claude Sonnet 3.5',
				input: 3,
				output: 15,
			},
		],
	},
	{
		provider: 'google',
		label: 'Google',
		endpoint: '/v1/chat/completions',
		models: [
			{
				id: 'gemini-3.1-pro-preview',
				label: 'Gemini 3.1 Pro Preview',
				input: 2,
				output: 12,
			},
			{
				id: 'gemini-3.1-pro-preview-customtools',
				label: 'Gemini 3.1 Pro Custom Tools',
				input: 2,
				output: 12,
			},
			{
				id: 'gemini-3-pro-preview',
				label: 'Gemini 3 Pro Preview',
				input: 2,
				output: 12,
			},
			{
				id: 'gemini-3-flash-preview',
				label: 'Gemini 3 Flash Preview',
				input: 0.5,
				output: 3,
			},
		],
	},
	{
		provider: 'kimi',
		label: 'Kimi',
		endpoint: '/v1/chat/completions',
		models: [
			{ id: 'kimi-k2.5', label: 'Kimi K2.5', input: 0.6, output: 3 },
			{
				id: 'kimi-k2-thinking',
				label: 'Kimi K2 Thinking',
				input: 0.6,
				output: 2.5,
			},
			{
				id: 'kimi-k2-thinking-turbo',
				label: 'Kimi K2 Thinking Turbo',
				input: 1.15,
				output: 8,
			},
			{
				id: 'kimi-k2-turbo-preview',
				label: 'Kimi K2 Turbo',
				input: 2.4,
				output: 10,
			},
			{
				id: 'kimi-k2-0905-preview',
				label: 'Kimi K2 0905',
				input: 0.6,
				output: 2.5,
			},
			{
				id: 'kimi-k2-0711-preview',
				label: 'Kimi K2 0711',
				input: 0.6,
				output: 2.5,
			},
		],
	},
	{
		provider: 'zai',
		label: 'Zai',
		endpoint: '/v1/chat/completions',
		models: [
			{ id: 'glm-5', label: 'GLM-5', input: 1, output: 3.2 },
			{ id: 'glm-4.7', label: 'GLM-4.7', input: 0.6, output: 2.2 },
			{ id: 'glm-4.7-flash', label: 'GLM-4.7 Flash', input: 0, output: 0 },
		],
	},
	{
		provider: 'minimax',
		label: 'MiniMax',
		endpoint: '/v1/messages',
		models: [
			{ id: 'MiniMax-M2.5', label: 'MiniMax-M2.5', input: 0.3, output: 1.2 },
			{ id: 'MiniMax-M2.1', label: 'MiniMax-M2.1', input: 0.3, output: 1.2 },
		],
	},
];

function FlowDiagram() {
	const ref = useRef<HTMLDivElement>(null);
	const [step, setStep] = useState(-1);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const obs = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting) {
					let i = 0;
					const interval = setInterval(() => {
						setStep(i);
						i++;
						if (i >= 5) clearInterval(interval);
					}, 500);
					obs.disconnect();
					return () => clearInterval(interval);
				}
			},
			{ threshold: 0.3 },
		);
		obs.observe(el);
		return () => obs.disconnect();
	}, []);

	const steps = [
		{
			num: '01',
			label: 'request',
			color: 'text-blue-600 dark:text-blue-400',
			text: 'Client sends API request with wallet signature headers',
		},
		{
			num: '02',
			label: 'auth',
			color: 'text-purple-600 dark:text-purple-400',
			text: 'Solana wallet signature verified via ed25519',
		},
		{
			num: '03',
			label: 'balance',
			color: 'text-amber-600 dark:text-amber-400',
			text: 'USDC balance checked — returns 402 if below $0.05',
		},
		{
			num: '04',
			label: 'proxy',
			color: 'text-otto-muted',
			text: 'Request forwarded to provider API unchanged',
		},
		{
			num: '05',
			label: 'bill',
			color: 'text-green-600 dark:text-green-400',
			text: 'Usage metered per-token, cost deducted from balance',
		},
	];

	return (
		<div
			ref={ref}
			className="bg-otto-surface border border-otto-border rounded-lg overflow-hidden"
		>
			<div className="h-10 border-b border-otto-border bg-otto-surface/95 flex items-center px-4 gap-2">
				<div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
				<div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
				<div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
				<span className="ml-2 text-[10px] text-otto-dim font-medium">
					request lifecycle
				</span>
			</div>
			<div className="p-5 font-mono text-xs space-y-3">
				{steps.map((s, i) => (
					<div
						key={s.num}
						className={`flex items-start gap-3 transition-all duration-500 ${
							i <= step ? 'opacity-100' : 'opacity-0 translate-y-2'
						}`}
					>
						<span className={`${s.color} font-medium shrink-0 w-5`}>
							{s.num}
						</span>
						<span className={`${s.color} font-medium shrink-0 w-16`}>
							{s.label}
						</span>
						<span className="text-otto-dim">{s.text}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function MppMockup() {
	const [phase, setPhase] = useState<
		'request' | '402' | 'sign' | 'topup' | 'success'
	>('request');
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const obs = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting) {
					const steps: Array<typeof phase> = [
						'request',
						'402',
						'sign',
						'topup',
						'success',
					];
					let i = 0;
					const interval = setInterval(() => {
						setPhase(steps[i]);
						i++;
						if (i >= steps.length) clearInterval(interval);
					}, 800);
					obs.disconnect();
					return () => clearInterval(interval);
				}
			},
			{ threshold: 0.3 },
		);
		obs.observe(el);
		return () => obs.disconnect();
	}, []);

	const phaseIndex = ['request', '402', 'sign', 'topup', 'success'].indexOf(
		phase,
	);

	return (
		<div
			ref={ref}
			className="bg-otto-surface border border-otto-border rounded-lg overflow-hidden"
		>
			<div className="h-10 border-b border-otto-border bg-otto-surface/95 flex items-center px-4 gap-2">
				<div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
				<div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
				<div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
				<span className="ml-2 text-[10px] text-otto-dim font-medium">
					MPP payment flow
				</span>
			</div>
			<div className="p-4 space-y-2 min-h-[200px] font-mono text-xs">
				{phaseIndex >= 0 && (
					<div className="animate-fade-in flex items-center gap-2">
						<span className="text-blue-600 dark:text-blue-400">→</span>
						<span className="text-otto-muted">POST /v1/messages</span>
						<span className="text-otto-dim">claude-sonnet-4-5</span>
					</div>
				)}
				{phaseIndex >= 1 && (
					<div className="animate-fade-in flex items-center gap-2">
						<span className="text-amber-600 dark:text-amber-400">←</span>
						<span className="text-amber-600 dark:text-amber-300 font-medium">
							402
						</span>
						<span className="text-otto-dim">
							Payment Required — balance: $0.00
						</span>
					</div>
				)}
				{phaseIndex >= 2 && (
					<div className="animate-fade-in flex items-center gap-2">
						<span className="text-purple-600 dark:text-purple-400">⚡</span>
						<span className="text-otto-muted">Signing USDC transfer...</span>
						<span className="text-otto-dim">$5.00</span>
					</div>
				)}
				{phaseIndex >= 3 && (
					<div className="animate-fade-in flex items-center gap-2">
						<span className="text-green-600 dark:text-green-400">→</span>
						<span className="text-otto-muted">POST /v1/topup</span>
						<span className="text-green-600 dark:text-green-300 font-medium">
							credited $5.00
						</span>
					</div>
				)}
				{phaseIndex >= 4 && (
					<div className="animate-fade-in">
						<div className="flex items-center gap-2">
							<span className="text-green-600 dark:text-green-400">✓</span>
							<span className="text-otto-muted">
								Retrying original request...
							</span>
							<span className="text-green-600 dark:text-green-300 font-medium">
								200 OK
							</span>
						</div>
						<div className="mt-1.5 pl-4 text-otto-dim">
							cost: $0.0041 · balance: $4.9959
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function PolarFlowMockup() {
	return (
		<div className="bg-otto-surface border border-otto-border rounded-lg overflow-hidden">
			<div className="h-10 border-b border-otto-border bg-otto-surface/95 flex items-center px-4 gap-2">
				<div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
				<div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
				<div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
				<span className="ml-2 text-[10px] text-otto-dim font-medium">
					fiat top-up via polar
				</span>
			</div>
			<div className="p-4 space-y-2 min-h-[200px] font-mono text-xs">
				<div className="flex items-center gap-2">
					<span className="text-blue-600 dark:text-blue-400">→</span>
					<span className="text-otto-muted">POST /v1/topup/polar</span>
					<span className="text-otto-dim">amount: $25.00</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-green-600 dark:text-green-400">←</span>
					<span className="text-otto-muted">checkoutUrl:</span>
					<span className="text-blue-600 dark:text-blue-400 underline truncate">
						checkout.polar.sh/...
					</span>
				</div>
				<div className="flex items-center gap-2 pt-1">
					<span className="text-purple-600 dark:text-purple-400">⚡</span>
					<span className="text-otto-muted">
						User completes payment on Polar
					</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-green-600 dark:text-green-400">⚡</span>
					<span className="text-otto-muted">Webhook:</span>
					<span className="text-otto-dim">order.paid</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-green-600 dark:text-green-400">✓</span>
					<span className="text-green-600 dark:text-green-300 font-medium">
						credited $25.00
					</span>
					<span className="text-otto-dim">· balance: $25.00</span>
				</div>
			</div>
		</div>
	);
}

function FeatureCard({
	title,
	desc,
	children,
}: {
	title: string;
	desc: string;
	children: React.ReactNode;
}) {
	return (
		<div className="bg-otto-bg p-5 sm:p-6 h-full">
			<div className="flex items-center gap-2.5 mb-2">
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-otto-surface border border-otto-border">
					{children}
				</div>
				<span className="text-sm font-medium">{title}</span>
			</div>
			<p className="text-otto-dim text-xs leading-relaxed">{desc}</p>
		</div>
	);
}

function ModelTable({ group }: { group: (typeof MODELS)[number] }) {
	const [expanded, setExpanded] = useState(false);
	const visibleModels = expanded ? group.models : group.models.slice(0, 5);
	const hasMore = group.models.length > 5;

	return (
		<div className="bg-otto-surface border border-otto-border rounded-lg overflow-hidden">
			<div className="flex items-center justify-between px-5 py-3 border-b border-otto-border">
				<div className="flex items-center gap-2.5">
					<ProviderLogo
						provider={group.provider}
						size={16}
						className="text-otto-text"
					/>
					<span className="text-sm font-medium">{group.label}</span>
					<span className="text-[10px] text-otto-dim bg-otto-bg px-1.5 py-0.5 rounded border border-otto-border">
						{group.models.length} models
					</span>
				</div>
				<code className="text-[10px] text-otto-dim hidden sm:block">
					{group.endpoint}
				</code>
			</div>
			<div className="divide-y divide-otto-border">
				{visibleModels.map((m) => (
					<div
						key={m.id}
						className="flex items-center justify-between px-5 py-2.5"
					>
						<div className="min-w-0">
							<span className="text-sm text-otto-text font-medium">
								{m.label}
							</span>
							<span className="text-[10px] text-otto-dim ml-2 hidden sm:inline">
								{m.id}
							</span>
						</div>
						<div className="flex items-center gap-4 text-xs text-otto-dim shrink-0 ml-4">
							{m.input === 0 && m.output === 0 ? (
								<span className="text-green-600 dark:text-green-400 font-medium">
									free
								</span>
							) : (
								<>
									<span>
										${m.input}
										<span className="text-otto-dim/60">/M in</span>
									</span>
									<span>
										${m.output}
										<span className="text-otto-dim/60">/M out</span>
									</span>
								</>
							)}
						</div>
					</div>
				))}
			</div>
			{hasMore && (
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="w-full px-5 py-2 text-[10px] text-otto-dim hover:text-otto-muted border-t border-otto-border transition-colors"
				>
					{expanded ? 'Show less' : `Show all ${group.models.length} models`}
				</button>
			)}
		</div>
	);
}

function HeroMockup() {
	const [step, setStep] = useState(0);
	const maxSteps = 8;

	useEffect(() => {
		const t = setInterval(
			() => setStep((s) => (s < maxSteps ? s + 1 : s)),
			550,
		);
		return () => clearInterval(t);
	}, []);

	return (
		<div className="bg-otto-surface border border-otto-border rounded-lg overflow-hidden shadow-2xl shadow-black/10 dark:shadow-black/50">
			<div className="h-12 border-b border-otto-border bg-otto-surface/95 flex items-center justify-between px-5">
				<div className="flex items-center gap-2 text-sm text-otto-muted min-w-0 flex-1 mr-4">
					<OttoRouterMark className="w-4 h-4 flex-shrink-0 text-purple-600 dark:text-purple-400" />
					<span className="text-otto-text font-medium truncate text-xs">
						api.ottorouter.org
					</span>
				</div>
				<div className="flex-shrink-0 flex items-center gap-3 sm:gap-5 text-xs text-otto-muted">
					<div className="flex items-center gap-1.5">
						<svg
							className="w-3.5 h-3.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<line x1="12" x2="12" y1="2" y2="22" />
							<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
						</svg>
						<span className="font-medium text-otto-text">4.9959</span>
					</div>
					<div className="hidden sm:flex items-center gap-2">
						<ProviderLogo
							provider="anthropic"
							size={14}
							className="text-[#cc785c]"
						/>
						<span className="font-medium text-otto-text truncate max-w-32">
							claude-sonnet-4-5
						</span>
					</div>
				</div>
			</div>

			<div className="px-5 py-4 font-mono text-xs">
				{step >= 1 && (
					<div className="term-line-enter">
						<div className="flex items-center gap-2 pb-3">
							<span className="text-blue-600 dark:text-blue-400 shrink-0 inline-flex w-4 justify-center">
								→
							</span>
							<div>
								<span className="text-otto-muted">POST</span>
								<span className="text-otto-dim"> /v1/messages</span>
								<span className="text-otto-dim/50 ml-2">claude-sonnet-4-5</span>
							</div>
						</div>
					</div>
				)}
				{step >= 2 && (
					<div className="term-line-enter">
						<div className="flex items-center gap-2 pb-3">
							<span className="text-purple-600 dark:text-purple-400 shrink-0 inline-flex w-4 justify-center">
								⚿
							</span>
							<div>
								<span className="text-purple-600 dark:text-purple-400 font-medium">
									auth
								</span>
								<span className="text-otto-dim"> wallet verified</span>
								<span className="text-otto-dim/50 ml-1">ed25519</span>
							</div>
						</div>
					</div>
				)}
				{step >= 3 && (
					<div className="term-line-enter">
						<div className="flex items-center gap-2 pb-3">
							<span className="text-green-600 dark:text-green-400 shrink-0 inline-flex w-4 justify-center">
								◉
							</span>
							<div>
								<span className="text-green-600 dark:text-green-400 font-medium">
									balance
								</span>
								<span className="text-otto-dim"> $4.9959</span>
								<span className="text-green-600 dark:text-green-400 ml-1">
									✓
								</span>
							</div>
						</div>
					</div>
				)}
				{step >= 4 && (
					<div className="term-line-enter">
						<div className="flex items-center gap-2 pb-3">
							<span className="text-otto-muted shrink-0 inline-flex w-4 justify-center">
								↗
							</span>
							<div>
								<span className="text-otto-muted">proxy</span>
								<span className="text-otto-dim"> → api.anthropic.com</span>
							</div>
						</div>
					</div>
				)}
				{step >= 5 && (
					<div className="term-line-enter">
						<div className="flex items-center gap-2 pb-3">
							<span className="text-green-600 dark:text-green-400 shrink-0 inline-flex w-4 justify-center">
								←
							</span>
							<div>
								<span className="text-green-600 dark:text-green-300 font-medium">
									200
								</span>
								<span className="text-otto-dim"> streaming response</span>
							</div>
						</div>
					</div>
				)}
				{step >= 6 && (
					<div className="term-line-enter">
						<div className="pl-6 text-otto-text leading-relaxed pb-3">
							The key insight is that reactive systems must handle backpressure
							gracefully. When a downstream consumer can't keep up with the
							producer...
						</div>
					</div>
				)}
				{step >= 7 && (
					<div className="term-line-enter">
						<div className="flex items-center gap-2 pt-1 pb-3">
							<span className="text-otto-dim shrink-0 inline-flex w-4 justify-center">
								:
							</span>
							<div>
								<span className="text-otto-dim">ottorouter</span>
								<span className="text-otto-text ml-1">
									{
										'{"cost":"$0.0041","balance":"$4.9918","tokens":{"in":24,"out":156}}'
									}
								</span>
							</div>
						</div>
					</div>
				)}
				{step >= 8 && (
					<div className="term-line-enter">
						<div className="flex items-center gap-3 pt-2 border-t border-otto-border mt-2 pb-1">
							<div className="flex items-center gap-1.5">
								{[
									'anthropic',
									'openai',
									'google',
									'kimi',
									'zai',
									'minimax',
								].map((p) => (
									<ProviderLogo
										key={p}
										provider={p}
										size={14}
										className="text-otto-dim opacity-60"
									/>
								))}
							</div>
							<span className="text-otto-dim text-[10px]">
								50+ models · 6 providers · one wallet
							</span>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export function OttoRouter() {
	return (
		<main className="overflow-hidden">
			<section className="relative min-h-[100dvh] flex flex-col items-center justify-center px-6 pt-20 pb-16">
				<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(139,92,246,0.08),transparent)]" />

				<div className="relative z-10 w-full max-w-3xl mx-auto">
					<Reveal>
						<div className="text-center mb-10 sm:mb-14">
							<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-6">
								by ottocode
							</p>
							<div className="mb-6 flex items-center justify-center">
								<OttoRouterMark className="w-12 h-12 sm:w-16 sm:h-16 text-[#9333ea]" />
							</div>
							<h1 className="text-5xl sm:text-7xl font-bold mb-6 tracking-tight">
								OttoRouter
							</h1>
							<p className="text-otto-text text-lg sm:text-xl font-medium mb-3">
								Your wallet is your API key.
							</p>
							<p className="text-otto-muted text-sm max-w-lg mx-auto mb-8">
								AI inference proxy on Solana.
								<br />
								Pay for frontier models with USDC or credit card.
							</p>
							<div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
								<a
									href="/docs/ottorouter"
									className="px-5 py-2.5 bg-otto-text text-otto-bg text-sm font-medium rounded-sm hover:opacity-80 transition-colors"
								>
									Get Started
								</a>
								<a
									href="/docs/ottorouter/integration"
									className="px-5 py-2.5 border border-otto-border text-otto-muted text-sm rounded-sm hover:border-otto-border-light hover:text-otto-text transition-colors"
								>
									Integration Guide
								</a>
							</div>
						</div>
					</Reveal>

					<Reveal delay={200}>
						<HeroMockup />
					</Reveal>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[900px] mx-auto">
					<Reveal>
						<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
							How it works
						</p>
						<h2 className="text-2xl sm:text-3xl font-bold mb-4 max-w-md">
							Pure passthrough proxy
						</h2>
						<p className="text-otto-muted text-sm mb-12 max-w-lg">
							OttoRouter forwards requests unchanged to native provider APIs.
							Full feature parity — streaming, tool calling, caching, vision,
							extended thinking.
						</p>
					</Reveal>

					<Reveal delay={100}>
						<FlowDiagram />
					</Reveal>

					<Reveal delay={150}>
						<div className="mt-8">
							<TerminalBlock
								title="architecture"
								copyText="Client → OttoRouter Router → OpenAI / Anthropic / Google / Kimi / Zai / MiniMax"
							>
								<div className="space-y-1">
									<div>
										<span className="text-blue-700 dark:text-blue-400">
											Client
										</span>
										<span className="text-otto-dim">
											{' '}
											→ wallet auth + request body
										</span>
									</div>
									<div>
										<span className="text-otto-dim">{'  '}↓</span>
									</div>
									<div>
										<span className="text-purple-700 dark:text-purple-400">
											OttoRouter Router
										</span>
										<span className="text-otto-dim">
											{' '}
											— auth, balance check, billing
										</span>
									</div>
									<div>
										<span className="text-otto-dim">{'  '}↓</span>
									</div>
									<div>
										<span className="text-green-700 dark:text-green-400">
											Provider APIs
										</span>
										<span className="text-otto-dim">
											{' '}
											— OpenAI, Anthropic, Google, Kimi, Zai, MiniMax
										</span>
									</div>
								</div>
							</TerminalBlock>
						</div>
					</Reveal>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[1100px] mx-auto">
					<Reveal>
						<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
							Payments
						</p>
						<h2 className="text-2xl sm:text-3xl font-bold mb-4 max-w-md">
							Two ways to pay
						</h2>
						<p className="text-otto-muted text-sm mb-16 max-w-lg">
							Top up with USDC on Solana via MPP (Micropayment Protocol), or pay
							with a credit card through Polar. Same balance, your choice.
						</p>
					</Reveal>

					<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
						<Reveal delay={60}>
							<div>
								<div className="flex items-center gap-3 mb-4">
									<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-500/10 border border-purple-500/20">
										<svg
											className="w-4 h-4 text-purple-600 dark:text-purple-400"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<circle cx="12" cy="12" r="10" />
											<line x1="12" y1="8" x2="12" y2="16" />
											<line x1="8" y1="12" x2="16" y2="12" />
										</svg>
									</div>
									<div>
										<h3 className="text-sm font-semibold text-otto-text">
											USDC on Solana
										</h3>
										<p className="text-[10px] text-otto-dim">
											MPP protocol · instant settlement
										</p>
									</div>
								</div>
								<MppMockup />
								<div className="mt-4 grid grid-cols-2 gap-3">
									<div className="p-3 bg-otto-surface border border-otto-border rounded-lg">
										<div className="text-[10px] text-otto-dim uppercase tracking-wider mb-1">
											Min Top-up
										</div>
										<div className="text-sm font-medium text-otto-text">
											$5.00
										</div>
									</div>
									<div className="p-3 bg-otto-surface border border-otto-border rounded-lg">
										<div className="text-[10px] text-otto-dim uppercase tracking-wider mb-1">
											Options
										</div>
										<div className="text-sm font-medium text-otto-text">
											$5 · $10 · $25 · $50
										</div>
									</div>
								</div>
							</div>
						</Reveal>

						<Reveal delay={120}>
							<div>
								<div className="flex items-center gap-3 mb-4">
									<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10 border border-blue-500/20">
										<svg
											className="w-4 h-4 text-blue-600 dark:text-blue-400"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<rect width="20" height="14" x="2" y="5" rx="2" />
											<line x1="2" y1="10" x2="22" y2="10" />
										</svg>
									</div>
									<div>
										<h3 className="text-sm font-semibold text-otto-text">
											Credit Card via Polar
										</h3>
										<p className="text-[10px] text-otto-dim">
											fiat payments · webhook confirmed
										</p>
									</div>
								</div>
								<PolarFlowMockup />
								<div className="mt-4 grid grid-cols-2 gap-3">
									<div className="p-3 bg-otto-surface border border-otto-border rounded-lg">
										<div className="text-[10px] text-otto-dim uppercase tracking-wider mb-1">
											Min Top-up
										</div>
										<div className="text-sm font-medium text-otto-text">
											$5.00
										</div>
									</div>
									<div className="p-3 bg-otto-surface border border-otto-border rounded-lg">
										<div className="text-[10px] text-otto-dim uppercase tracking-wider mb-1">
											Max Top-up
										</div>
										<div className="text-sm font-medium text-otto-text">
											$500.00
										</div>
									</div>
								</div>
							</div>
						</Reveal>
					</div>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[1100px] mx-auto">
					<Reveal>
						<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
							Features
						</p>
						<h2 className="text-2xl sm:text-3xl font-bold mb-16 max-w-sm">
							Full provider parity
						</h2>
					</Reveal>

					<div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-otto-border rounded-lg overflow-hidden">
						<Reveal delay={0}>
							<FeatureCard
								title="Wallet Auth"
								desc="Sign requests with your Solana wallet. No API keys, no accounts — just cryptographic signatures."
							>
								<svg
									className="w-3.5 h-3.5 text-otto-text"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
									<path d="M7 11V7a5 5 0 0 1 10 0v4" />
								</svg>
							</FeatureCard>
						</Reveal>
						<Reveal delay={40}>
							<FeatureCard
								title="Streaming"
								desc="Full SSE streaming with real-time cost tracking injected as stream comments."
							>
								<svg
									className="w-3.5 h-3.5 text-otto-text"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M21 12a9 9 0 1 1-6.219-8.56" />
								</svg>
							</FeatureCard>
						</Reveal>
						<Reveal delay={80}>
							<FeatureCard
								title="Prompt Caching"
								desc="Anthropic cache_control and OpenAI cached tokens — billed at reduced rates automatically."
							>
								<svg
									className="w-3.5 h-3.5 text-otto-text"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M12 2v4" />
									<path d="m16.24 7.76-2.12 2.12" />
									<path d="M20 12h-4" />
									<path d="m16.24 16.24-2.12-2.12" />
									<path d="M12 20v-4" />
									<path d="m7.76 16.24 2.12-2.12" />
									<path d="M4 12h4" />
									<path d="m7.76 7.76 2.12 2.12" />
								</svg>
							</FeatureCard>
						</Reveal>
						<Reveal delay={120}>
							<FeatureCard
								title="Tool Calling"
								desc="Native tool/function calling for all providers. Request bodies forwarded unchanged."
							>
								<svg
									className="w-3.5 h-3.5 text-otto-text"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9" />
									<path d="M17.64 15 22 10.64" />
									<path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" />
								</svg>
							</FeatureCard>
						</Reveal>
						<Reveal delay={160}>
							<FeatureCard
								title="Vision & Multimodal"
								desc="Image inputs, PDF analysis, and multimodal prompts work exactly as with native APIs."
							>
								<svg
									className="w-3.5 h-3.5 text-otto-text"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
									<circle cx="12" cy="12" r="3" />
								</svg>
							</FeatureCard>
						</Reveal>
						<Reveal delay={200}>
							<FeatureCard
								title="Extended Thinking"
								desc="Claude thinking mode and OpenAI reasoning models work out of the box. Full chain-of-thought support."
							>
								<svg
									className="w-3.5 h-3.5 text-otto-text"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
								</svg>
							</FeatureCard>
						</Reveal>
					</div>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[1100px] mx-auto">
					<Reveal>
						<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
							Models
						</p>
						<h2 className="text-2xl sm:text-3xl font-bold mb-4 max-w-sm">
							Every frontier model
						</h2>
						<p className="text-otto-muted text-sm mb-4 max-w-lg">
							Access {MODELS.reduce((acc, g) => acc + g.models.length, 0)}+
							models across {MODELS.length} providers. Transparent per-token
							pricing with a flat 0.5% markup.
						</p>
						<p className="text-otto-dim text-xs mb-16 max-w-lg">
							Prices shown are base rates per 1M tokens. Live pricing at{' '}
							<code className="text-[10px] bg-otto-surface px-1.5 py-0.5 rounded border border-otto-border">
								/v1/models
							</code>
						</p>
					</Reveal>

					<div className="space-y-6">
						{MODELS.map((group, gi) => (
							<Reveal key={group.provider} delay={gi * 60}>
								<ModelTable group={group} />
							</Reveal>
						))}
					</div>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[900px] mx-auto">
					<Reveal>
						<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
							Integration
						</p>
						<h2 className="text-2xl sm:text-3xl font-bold mb-4 max-w-sm">
							Three lines to start
						</h2>
						<p className="text-otto-muted text-sm mb-10 max-w-md">
							Works with AI SDK, otto CLI, or raw HTTP. The SDK handles wallet
							auth and MPP payment flows automatically.
						</p>
					</Reveal>

					<Reveal delay={80}>
						<TerminalBlock
							title="ai-sdk"
							copyText={`import { createOttoRouter } from "@ottorouter/ai-sdk";
import { generateText } from "ai";

const ottorouter = createOttoRouter({
		auth: { privateKey: process.env.OTTOROUTER_PRIVATE_KEY! },
});

const { text } = await generateText({
		model: ottorouter.model("claude-sonnet-4-6"),
		prompt: "Hello",
});`}
						>
							<span className="text-purple-700 dark:text-purple-400">
								import
							</span>
							<span className="text-otto-text"> {'{ createOttoRouter }'} </span>
							<span className="text-purple-700 dark:text-purple-400">from</span>
							<span className="text-green-700 dark:text-green-400">
								{' '}
								"@ottorouter/ai-sdk"
							</span>
							<span className="text-otto-dim">;</span>
							<br />
							<span className="text-purple-700 dark:text-purple-400">
								import
							</span>
							<span className="text-otto-text"> {'{ generateText }'} </span>
							<span className="text-purple-700 dark:text-purple-400">from</span>
							<span className="text-green-700 dark:text-green-400"> "ai"</span>
							<span className="text-otto-dim">;</span>
							<br />
							<br />
							<span className="text-purple-700 dark:text-purple-400">
								const
							</span>
							<span className="text-blue-700 dark:text-blue-400">
								{' '}
								ottorouter{' '}
							</span>
							<span className="text-otto-text">= </span>
							<span className="text-yellow-700 dark:text-yellow-300">
								createOttoRouter
							</span>
							<span className="text-otto-text">(</span>
							<span className="text-otto-text">{'{'}</span>
							<br />
							<span className="text-otto-text">
								{'  '}auth: {'{ '}privateKey: process.env.
							</span>
							<span className="text-blue-700 dark:text-blue-400">
								OTTOROUTER_PRIVATE_KEY
							</span>
							<span className="text-otto-text">! {'}'}</span>
							<span className="text-otto-dim">,</span>
							<br />
							<span className="text-otto-text">{'}'});</span>
							<br />
							<br />
							<span className="text-purple-700 dark:text-purple-400">
								const
							</span>
							<span className="text-otto-text"> {'{ text }'} = </span>
							<span className="text-purple-700 dark:text-purple-400">
								await
							</span>
							<span className="text-yellow-700 dark:text-yellow-300">
								{' '}
								generateText
							</span>
							<span className="text-otto-text">(</span>
							<span className="text-otto-text">{'{'}</span>
							<br />
							<span className="text-otto-text">{'  '}model: ottorouter.</span>
							<span className="text-yellow-700 dark:text-yellow-300">
								model
							</span>
							<span className="text-otto-text">(</span>
							<span className="text-green-700 dark:text-green-400">
								"claude-sonnet-4-6"
							</span>
							<span className="text-otto-text">),</span>
							<br />
							<span className="text-otto-text">{'  '}prompt: </span>
							<span className="text-green-700 dark:text-green-400">
								"Hello"
							</span>
							<span className="text-otto-dim">,</span>
							<br />
							<span className="text-otto-text">{'}'});</span>
						</TerminalBlock>
					</Reveal>

					<Reveal delay={120}>
						<div className="mt-8">
							<TerminalBlock
								title="otto cli"
								copyText={`otto auth login ottorouter
		otto ask "hello" --provider ottorouter --model claude-sonnet-4-6`}
							>
								<div>
									<span className="text-otto-dim">$</span>
									<span className="text-otto-text">
										{' '}
										otto auth login ottorouter
									</span>
								</div>
								<div className="mt-1">
									<span className="text-otto-dim">$</span>
									<span className="text-otto-text"> otto ask </span>
									<span className="text-green-700 dark:text-green-400">
										"hello"
									</span>
									<span className="text-otto-text"> --provider </span>
									<span className="text-blue-700 dark:text-blue-400">
										ottorouter
									</span>
									<span className="text-otto-text"> --model </span>
									<span className="text-blue-700 dark:text-blue-400">
										claude-sonnet-4-6
									</span>
								</div>
							</TerminalBlock>
						</div>
					</Reveal>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[900px] mx-auto">
					<Reveal>
						<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
							Cost Tracking
						</p>
						<h2 className="text-2xl sm:text-3xl font-bold mb-4 max-w-sm">
							Real-time billing
						</h2>
						<p className="text-otto-muted text-sm mb-10 max-w-md">
							Every request returns exact costs. Non-streaming via headers,
							streaming via SSE comments.
						</p>
					</Reveal>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<Reveal delay={60}>
							<div className="bg-otto-surface border border-otto-border rounded-lg p-5">
								<div className="text-xs font-medium text-otto-text mb-3">
									Non-Streaming
								</div>
								<div className="font-mono text-xs space-y-1.5 text-otto-muted">
									<div>
										<span className="text-otto-dim">x-cost-usd:</span>{' '}
										<span className="text-green-600 dark:text-green-400">
											0.00001234
										</span>
									</div>
									<div>
										<span className="text-otto-dim">x-balance-remaining:</span>{' '}
										<span className="text-green-600 dark:text-green-400">
											4.99998766
										</span>
									</div>
								</div>
								<p className="text-[10px] text-otto-dim mt-3">
									Response headers
								</p>
							</div>
						</Reveal>
						<Reveal delay={100}>
							<div className="bg-otto-surface border border-otto-border rounded-lg p-5">
								<div className="text-xs font-medium text-otto-text mb-3">
									Streaming
								</div>
								<div className="font-mono text-[11px] text-otto-muted break-all">
									<span className="text-otto-dim">: ottorouter </span>
									<span className="text-otto-text">
										{
											'{"cost_usd":"0.0041","balance_remaining":"4.9959","input_tokens":20,"output_tokens":11}'
										}
									</span>
								</div>
								<p className="text-[10px] text-otto-dim mt-3">
									SSE comment at stream end
								</p>
							</div>
						</Reveal>
					</div>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[1100px] mx-auto">
					<Reveal>
						<p className="text-otto-dim text-xs uppercase tracking-[0.2em] mb-4">
							API
						</p>
						<h2 className="text-2xl sm:text-3xl font-bold mb-16 max-w-sm">
							Endpoints
						</h2>
					</Reveal>

					<Reveal delay={60}>
						<div className="bg-otto-surface border border-otto-border rounded-lg overflow-hidden">
							<div className="divide-y divide-otto-border">
								{[
									{
										method: 'GET',
										path: '/v1/models',
										auth: false,
										desc: 'List models with pricing',
									},
									{
										method: 'GET',
										path: '/v1/balance',
										auth: true,
										desc: 'Check wallet balance',
									},
									{
										method: 'POST',
										path: '/v1/topup/:amount',
										auth: true,
										desc: 'Top up via MPP USDC payment',
									},
									{
										method: 'POST',
										path: '/v1/topup/polar',
										auth: true,
										desc: 'Top up via credit card (Polar)',
									},
									{
										method: 'POST',
										path: '/v1/messages',
										auth: true,
										desc: 'Anthropic Messages API',
									},
									{
										method: 'POST',
										path: '/v1/responses',
										auth: true,
										desc: 'OpenAI Responses API',
									},
									{
										method: 'POST',
										path: '/v1/chat/completions',
										auth: true,
										desc: 'Google / Kimi / Zai',
									},
								].map((ep) => (
									<div
										key={ep.path}
										className="flex items-center gap-4 px-5 py-3"
									>
										<span
											className={`text-xs font-medium w-12 shrink-0 ${
												ep.method === 'GET'
													? 'text-blue-600 dark:text-blue-400'
													: 'text-green-600 dark:text-green-400'
											}`}
										>
											{ep.method}
										</span>
										<code className="text-xs text-otto-text font-medium min-w-0 shrink-0">
											{ep.path}
										</code>
										{ep.auth && (
											<span className="text-[10px] text-otto-dim bg-otto-bg px-1.5 py-0.5 rounded border border-otto-border shrink-0">
												auth
											</span>
										)}
										<span className="text-xs text-otto-dim ml-auto text-right hidden sm:block">
											{ep.desc}
										</span>
									</div>
								))}
							</div>
						</div>
					</Reveal>

					<Reveal delay={100}>
						<div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-4 p-6 bg-otto-surface border border-otto-border rounded-lg">
							<div className="flex-1">
								<h3 className="text-sm font-semibold text-otto-text mb-1">
									Base URL
								</h3>
								<code className="text-xs text-otto-muted">
									https://api.ottorouter.org
								</code>
							</div>
							<a
								href="/docs/ottorouter"
								className="shrink-0 px-5 py-2.5 text-sm font-medium bg-otto-text text-otto-bg rounded-sm hover:opacity-90 transition-opacity"
							>
								Full API docs →
							</a>
						</div>
					</Reveal>
				</div>
			</section>

			<section className="py-28 sm:py-36 px-6 border-t border-otto-border">
				<div className="max-w-[600px] mx-auto text-center">
					<Reveal>
						<div className="mb-5 flex items-center justify-center">
							<OttoRouterMark className="w-8 h-8 text-[#9333ea]" />
						</div>
						<h2 className="text-2xl sm:text-3xl font-bold mb-4">
							Start building with OttoRouter
						</h2>
						<p className="text-otto-muted text-sm mb-10 max-w-md mx-auto">
							One Solana wallet. Every frontier model. Pay only for what you
							use.
						</p>
						<div className="flex flex-wrap items-center justify-center gap-3">
							<a
								href="/docs/ottorouter"
								className="px-5 py-2.5 bg-otto-text text-otto-bg text-sm font-medium rounded-sm hover:opacity-80 transition-colors"
							>
								Documentation
							</a>
							<a
								href="/docs/ottorouter/integration"
								className="px-5 py-2.5 border border-otto-border text-otto-muted text-sm rounded-sm hover:border-otto-border-light hover:text-otto-text transition-colors"
							>
								Integration Guide
							</a>
							<a
								href="/docs/ottorouter/payments"
								className="px-5 py-2.5 border border-otto-border text-otto-muted text-sm rounded-sm hover:border-otto-border-light hover:text-otto-text transition-colors"
							>
								Payment Details
							</a>
						</div>
					</Reveal>
				</div>
			</section>
		</main>
	);
}
