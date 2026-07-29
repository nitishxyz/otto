import {
	NeoBox,
	NeoEyebrow,
	NeoReveal,
	NeoSection,
	cn,
	type NeoAccent,
} from '../../components/neopop';
import {
	FileEditIcon,
	GitBranchIcon,
	SearchIcon,
	SparkIcon,
	TerminalIcon,
} from './icons';

type UseCase = {
	title: string;
	body: string;
	cmd: string;
	tone: NeoAccent;
	icon: (p: { className?: string }) => React.ReactElement;
	wide?: boolean;
};

const USE_CASES: UseCase[] = [
	{
		title: 'Fix the bug you just described',
		body: 'Describe the symptom in plain English. otto finds the cause, patches the files, and runs your test suite to prove it worked.',
		cmd: 'otto ask "checkout total is off by the discount"',
		tone: 'blue',
		icon: SparkIcon,
		wide: true,
	},
	{
		title: 'Plan before it writes',
		body: 'A read-only planning mode that maps the change and shows you the approach first.',
		cmd: 'otto ask --agent plan "add SSO"',
		tone: 'yellow',
		icon: SearchIcon,
	},
	{
		title: 'Refactor across the repo',
		body: 'Rename, restructure, and migrate patterns over dozens of files in one pass.',
		cmd: 'otto ask "move api calls into a client"',
		tone: 'coral',
		icon: FileEditIcon,
	},
	{
		title: 'Review before you push',
		body: 'Walk the working diff, catch the thing you missed, and write the commit message.',
		cmd: 'otto ask "review my changes"',
		tone: 'lime',
		icon: GitBranchIcon,
	},
	{
		title: 'Find the work you did before',
		body: 'The research agent searches prior sessions and your current repo to bring old decisions and fixes back into context.',
		cmd: 'otto ask --agent research "where did we fix auth retries?"',
		tone: 'blue',
		icon: TerminalIcon,
		wide: true,
	},
];

const ICON_TILE: Record<NeoAccent, string> = {
	blue: 'bg-np-blue text-np-blue-on',
	lime: 'bg-np-lime text-np-lime-on',
	yellow: 'bg-np-yellow text-np-yellow-on',
	coral: 'bg-np-coral text-np-coral-on',
};

export function UseCasesSection() {
	return (
		<NeoSection id="use-cases" aria-labelledby="use-cases-title">
			<div className="py-16 sm:py-24">
				<NeoReveal>
					<NeoEyebrow>What you do with it</NeoEyebrow>
					<h2
						id="use-cases-title"
						className="np-title mt-4 max-w-[16ch] text-otto-text"
					>
						Real work, not autocomplete.
					</h2>
				</NeoReveal>

				<div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{USE_CASES.map((item, i) => {
						const Icon = item.icon;
						return (
							<NeoReveal
								key={item.title}
								delay={Math.min(i * 70, 280)}
								className={cn(item.wide && 'lg:col-span-2')}
							>
								<NeoBox
									elevation="md"
									interactive
									tone="surface"
									accent={item.tone}
									className="flex h-full flex-col gap-4 p-5 sm:p-6"
								>
									<span
										className={cn(
											'flex h-10 w-10 shrink-0 items-center justify-center',
											'border-2 border-otto-border rounded-[3px]',
											ICON_TILE[item.tone],
										)}
									>
										<Icon className="h-5 w-5" />
									</span>

									<div className="flex-1">
										<h3 className="text-[17px] font-semibold leading-snug tracking-tight text-otto-text">
											{item.title}
										</h3>
										<p className="mt-2 text-[13px] leading-relaxed text-otto-muted">
											{item.body}
										</p>
									</div>

									<code className="block overflow-x-auto whitespace-nowrap border-2 border-otto-border bg-otto-card px-2.5 py-1.5 text-[11px] text-otto-muted rounded-[3px]">
										<span className="select-none text-otto-dim">$ </span>
										{item.cmd}
									</code>
								</NeoBox>
							</NeoReveal>
						);
					})}
				</div>
			</div>
		</NeoSection>
	);
}
