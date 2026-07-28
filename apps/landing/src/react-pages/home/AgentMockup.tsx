import { useEffect, useState } from 'react';
import { NeoBadge, NeoBox, cn } from '../../components/neopop';
import { ProviderLogo } from '../../components/ProviderLogo';
import {
	CheckIcon,
	FileEditIcon,
	GitBranchIcon,
	SearchIcon,
	TerminalIcon,
} from './icons';

type Step = {
	tool: string;
	detail: string;
	icon: (p: { className?: string }) => React.ReactElement;
	tone: string;
};

const STEPS: Step[] = [
	{
		tool: 'search',
		detail: 'checkout flow · 6 matches',
		icon: SearchIcon,
		tone: 'text-np-blue',
	},
	{
		tool: 'apply_patch',
		detail: 'cart/total.ts · +18 −4',
		icon: FileEditIcon,
		tone: 'text-np-coral',
	},
	{
		tool: 'terminal',
		detail: 'bun test · 24 passed',
		icon: TerminalIcon,
		tone: 'text-otto-muted',
	},
	{
		tool: 'git_status',
		detail: '2 files changed · ready to review',
		icon: GitBranchIcon,
		tone: 'text-np-blue',
	},
];

const TOTAL = STEPS.length + 2;

function prefersReducedMotion() {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Static-first mockup of an otto session.
 *
 * Renders the completed transcript during SSR so the markup is meaningful
 * without JavaScript, then replays it as an animation on the client. Visitors
 * who prefer reduced motion keep the static finished state.
 */
export function AgentMockup() {
	const [step, setStep] = useState(TOTAL);

	useEffect(() => {
		if (prefersReducedMotion()) return;
		setStep(0);
		const id = setInterval(() => setStep((s) => (s < TOTAL ? s + 1 : s)), 650);
		return () => clearInterval(id);
	}, []);

	return (
		<NeoBox
			elevation="lg"
			tone="surface"
			className="overflow-hidden"
			aria-label="Example otto coding session"
		>
			<div className="flex items-center gap-3 border-b-2 border-otto-border bg-otto-card px-3 py-2.5 sm:px-4">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<span className="hidden h-2.5 w-2.5 shrink-0 bg-np-coral sm:block" />
					<span className="hidden h-2.5 w-2.5 shrink-0 bg-np-yellow sm:block" />
					<span className="hidden h-2.5 w-2.5 shrink-0 bg-np-lime sm:block" />
					<span className="truncate pl-0 text-[12px] font-medium text-otto-text sm:pl-2">
						fix-checkout-tax
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-2 text-[11px] text-otto-muted">
					<span className="hidden sm:inline">$0.0041</span>
					<span className="hidden sm:inline text-otto-dim">·</span>
					<ProviderLogo
						provider="anthropic"
						size={13}
						className="text-[#cc785c]"
					/>
					<span className="hidden truncate sm:inline">claude-sonnet-4</span>
				</div>
			</div>

			<div className="min-h-[300px] space-y-3 px-3 py-4 sm:min-h-[340px] sm:px-5">
				{step >= 1 && (
					<div className="flex justify-end animate-fade-in">
						<p className="max-w-[85%] border-2 border-otto-border bg-otto-card px-3 py-2 text-[13px] leading-relaxed text-otto-text rounded-[3px]">
							discount is applied after tax on checkout — fix it and add a
							regression test
						</p>
					</div>
				)}

				{step >= 2 && (
					<div className="animate-fade-in pt-1">
						<NeoBadge tone="blue" size="sm">
							build
						</NeoBadge>
					</div>
				)}

				<ol className="space-y-0">
					{STEPS.map((s, i) => {
						if (step < i + 3) return null;
						const Icon = s.icon;
						return (
							<li
								key={s.tool}
								className="flex animate-fade-in items-center gap-2.5 border-b border-otto-border py-2 last:border-b-0"
							>
								<Icon className={cn('h-3.5 w-3.5 shrink-0', s.tone)} />
								<span className="shrink-0 text-[12px] font-semibold text-otto-text">
									{s.tool}
								</span>
								<span className="min-w-0 truncate text-[12px] text-otto-dim">
									{s.detail}
								</span>
							</li>
						);
					})}
				</ol>

				{step >= TOTAL && (
					<div className="flex animate-fade-in items-start gap-2.5 pt-1">
						<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border-2 border-otto-border bg-np-lime text-np-lime-on rounded-[3px]">
							<CheckIcon className="h-3 w-3" />
						</span>
						<p className="text-[13px] leading-relaxed text-otto-text">
							Moved the discount above the tax line in{' '}
							<code className="border border-otto-border bg-otto-card px-1 py-0.5 text-[11px]">
								cart/total.ts
							</code>{' '}
							and added a regression test. 24 tests pass.
						</p>
					</div>
				)}
			</div>

			<div className="border-t-2 border-otto-border bg-otto-card px-3 py-2.5 sm:px-4">
				<div className="flex items-center gap-2">
					<span className="text-[12px] text-otto-dim">Ask otto anything…</span>
					<span className="ml-auto flex h-7 w-7 items-center justify-center border-2 border-otto-border bg-otto-text text-otto-bg rounded-[3px]">
						<svg
							aria-hidden="true"
							className="h-3.5 w-3.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="m5 12 7-7 7 7" />
							<path d="M12 19V5" />
						</svg>
					</span>
				</div>
			</div>
		</NeoBox>
	);
}
