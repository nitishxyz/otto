import {
	NeoBox,
	NeoEyebrow,
	NeoReveal,
	NeoSection,
	type NeoAccent,
} from '../../components/neopop';
import {
	AskIllustration,
	ChecksIllustration,
	ConnectIllustration,
	DoneIllustration,
	EditsIllustration,
	WorksIllustration,
} from './HowIllustrations';

type Art = (p: { className?: string }) => React.ReactElement;

const STEPS: { label: string; art: Art }[] = [
	{ label: 'You ask', art: AskIllustration },
	{ label: 'otto works', art: WorksIllustration },
	{ label: "It's done", art: DoneIllustration },
];

const CARDS: { title: string; line: string; tone: NeoAccent; art: Art }[] = [
	{
		title: 'It changes the files',
		line: 'Across the whole project, not one line at a time.',
		tone: 'coral',
		art: EditsIllustration,
	},
	{
		title: 'It checks its own work',
		line: 'Runs your tests and shows you what passed.',
		tone: 'lime',
		art: ChecksIllustration,
	},
	{
		title: 'It plugs into your stuff',
		line: 'Your tools, your rules, the model you already pay for.',
		tone: 'yellow',
		art: ConnectIllustration,
	},
];

function StepArrow({ left }: { left: string }) {
	return (
		<span
			aria-hidden="true"
			style={{ left }}
			className="absolute top-1/2 hidden h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[3px] border-2 border-otto-border bg-otto-bg sm:flex"
		>
			<svg
				viewBox="0 0 24 24"
				className="h-3.5 w-3.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="3"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<title>then</title>
				<path d="m9 5 7 7-7 7" />
			</svg>
		</span>
	);
}

/** Illustration-led overview: three steps across the top, then three cards. */
export function UseCasesSection() {
	return (
		<NeoSection id="use-cases" aria-labelledby="use-cases-title">
			<div className="py-16 sm:py-24">
				<NeoReveal>
					<NeoEyebrow>What it does</NeoEyebrow>
					<h2
						id="use-cases-title"
						className="np-title mt-4 max-w-[16ch] text-otto-text"
					>
						Real work, not autocomplete.
					</h2>
				</NeoReveal>

				<NeoReveal delay={70}>
					<NeoBox
						tone="surface"
						elevation="md"
						className="mt-10 overflow-hidden"
					>
						<div className="np-grid-bg relative bg-otto-card">
							<div className="grid grid-cols-1 divide-y-2 divide-otto-border sm:grid-cols-3 sm:divide-x-2 sm:divide-y-0">
								{STEPS.map((step) => {
									const Art = step.art;
									return (
										<div
											key={step.label}
											className="flex flex-col items-center gap-4 px-6 py-8"
										>
											<div className="flex h-[124px] w-full items-center justify-center">
												<Art className="h-full w-auto" />
											</div>
											<p className="np-eyebrow text-otto-dim">{step.label}</p>
										</div>
									);
								})}
							</div>
							<StepArrow left="33.3333%" />
							<StepArrow left="66.6666%" />
						</div>

						<div className="np-edge-t flex flex-col gap-2 px-5 py-5 sm:flex-row sm:items-baseline sm:justify-between sm:px-7">
							<h3 className="text-[17px] font-semibold tracking-tight text-otto-text">
								You ask. It builds. You get it back done.
							</h3>
							<p className="text-[13px] text-otto-muted">
								Plain words in, finished work out.
							</p>
						</div>
					</NeoBox>
				</NeoReveal>

				<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
					{CARDS.map((card, i) => {
						const Art = card.art;
						return (
							<NeoReveal key={card.title} delay={120 + i * 60}>
								<NeoBox
									tone="surface"
									accent={card.tone}
									elevation="md"
									interactive
									className="flex h-full flex-col overflow-hidden"
								>
									<div className="np-grid-bg np-edge-b bg-otto-card px-5 py-6">
										<Art className="h-auto w-full" />
									</div>
									<div className="flex flex-1 flex-col gap-1.5 p-5">
										<h3 className="text-[15px] font-semibold tracking-tight text-otto-text">
											{card.title}
										</h3>
										<p className="text-[13px] leading-relaxed text-otto-muted">
											{card.line}
										</p>
									</div>
								</NeoBox>
							</NeoReveal>
						);
					})}
				</div>
			</div>
		</NeoSection>
	);
}
