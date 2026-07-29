/**
 * Custom NeoPop illustrations for the "what it does" section.
 *
 * All geometry is hand-placed on integer coordinates: 2px hard edges, offset
 * shadow copies instead of blurs, and flat accent fills that resolve through
 * the `--np-*` tokens, so every drawing follows the page in both themes.
 */

const PANEL = 'fill-otto-bg stroke-otto-border';
const SHADOW = 'fill-np-shadow';

interface ArtProps {
	className?: string;
}

/** Step 1 — what you say, in your own words. */
export function AskIllustration({ className = 'h-full w-auto' }: ArtProps) {
	return (
		<svg
			viewBox="0 0 240 170"
			className={className}
			aria-hidden="true"
			focusable="false"
			strokeWidth="2"
			strokeLinejoin="round"
		>
			<polygon points="62,130 62,160 98,130" className={SHADOW} />
			<rect x="30" y="30" width="192" height="100" rx="3" className={SHADOW} />
			<rect x="24" y="24" width="192" height="100" rx="3" className={PANEL} />
			<polygon points="56,124 56,154 92,124" className={PANEL} />
			<rect x="58" y="122" width="32" height="4" className="fill-otto-bg" />

			<rect
				x="44"
				y="48"
				width="118"
				height="16"
				rx="2"
				className="fill-np-blue"
			/>
			<rect
				x="44"
				y="72"
				width="148"
				height="16"
				rx="2"
				className="fill-np-blue"
			/>
			<rect
				x="44"
				y="96"
				width="86"
				height="16"
				rx="2"
				className="fill-np-blue opacity-40"
			/>
		</svg>
	);
}

/** Teeth plus body for one gear; the caller draws the hub on top. */
function Gear({
	cx,
	cy,
	r,
	toothLength,
	toothWidth,
	className,
}: {
	cx: number;
	cy: number;
	r: number;
	toothLength: number;
	toothWidth: number;
	className: string;
}) {
	return (
		<g className={className}>
			{[0, 45, 90, 135].map((angle) => (
				<rect
					key={angle}
					x={cx - toothLength / 2}
					y={cy - toothWidth / 2}
					width={toothLength}
					height={toothWidth}
					rx="2"
					transform={`rotate(${angle} ${cx} ${cy})`}
				/>
			))}
			<circle cx={cx} cy={cy} r={r} />
		</g>
	);
}

/** Step 2 — otto turning the handle on your repo. */
export function WorksIllustration({ className = 'h-full w-auto' }: ArtProps) {
	return (
		<svg
			viewBox="0 0 240 170"
			className={className}
			aria-hidden="true"
			focusable="false"
			strokeWidth="2"
			strokeLinejoin="round"
		>
			<g transform="translate(6 6)" className="stroke-none">
				<Gear
					cx={100}
					cy={84}
					r={44}
					toothLength={110}
					toothWidth={24}
					className={SHADOW}
				/>
				<Gear
					cx={174}
					cy={128}
					r={28}
					toothLength={70}
					toothWidth={16}
					className={SHADOW}
				/>
			</g>

			<Gear
				cx={100}
				cy={84}
				r={44}
				toothLength={110}
				toothWidth={24}
				className="fill-np-blue stroke-otto-border"
			/>
			<circle cx="100" cy="84" r="15" className={PANEL} />

			<Gear
				cx={174}
				cy={128}
				r={28}
				toothLength={70}
				toothWidth={16}
				className="fill-np-yellow stroke-otto-border"
			/>
			<circle cx="174" cy="128" r="9" className={PANEL} />
		</svg>
	);
}

/** Step 3 — the finished job, checked. */
export function DoneIllustration({ className = 'h-full w-auto' }: ArtProps) {
	return (
		<svg
			viewBox="0 0 240 170"
			className={className}
			aria-hidden="true"
			focusable="false"
			strokeWidth="2"
			strokeLinejoin="round"
		>
			<path d="M66 32 h96 l30 30 v102 h-126 z" className={SHADOW} />
			<path d="M60 26 h96 l30 30 v102 h-126 z" className={PANEL} />
			<path d="M156 26 v30 h30" className="fill-none stroke-otto-border" />

			<rect
				x="78"
				y="76"
				width="88"
				height="14"
				rx="2"
				className="fill-otto-border opacity-40"
			/>
			<rect
				x="78"
				y="100"
				width="62"
				height="14"
				rx="2"
				className="fill-otto-border opacity-40"
			/>

			<rect x="140" y="106" width="62" height="62" rx="3" className={SHADOW} />
			<rect
				x="134"
				y="100"
				width="62"
				height="62"
				rx="3"
				className="fill-np-lime stroke-otto-border"
			/>
			<path
				d="M150 130 l12 13 l21 -27"
				className="fill-none stroke-np-lime-on"
				strokeWidth="7"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/** A stack of files, one open with a line removed and lines added. */
export function EditsIllustration({ className = 'h-auto w-full' }: ArtProps) {
	return (
		<svg
			viewBox="0 0 320 200"
			className={className}
			aria-hidden="true"
			focusable="false"
			strokeWidth="2"
			strokeLinejoin="round"
		>
			<rect x="102" y="24" width="180" height="130" rx="3" className={SHADOW} />
			<rect
				x="96"
				y="18"
				width="180"
				height="130"
				rx="3"
				className="fill-otto-card stroke-otto-border"
			/>
			<rect
				x="78"
				y="32"
				width="180"
				height="130"
				rx="3"
				className="fill-otto-surface stroke-otto-border"
			/>
			<rect x="60" y="46" width="180" height="130" rx="3" className={PANEL} />

			<rect
				x="76"
				y="70"
				width="20"
				height="20"
				rx="2"
				className="fill-np-coral stroke-otto-border"
			/>
			<rect x="80" y="78" width="12" height="4" className="fill-np-coral-on" />
			<rect
				x="106"
				y="74"
				width="96"
				height="12"
				rx="2"
				className="fill-np-coral opacity-35"
			/>

			<rect
				x="76"
				y="100"
				width="20"
				height="20"
				rx="2"
				className="fill-np-lime stroke-otto-border"
			/>
			<rect x="80" y="108" width="12" height="4" className="fill-np-lime-on" />
			<rect x="84" y="104" width="4" height="12" className="fill-np-lime-on" />
			<rect
				x="106"
				y="104"
				width="114"
				height="12"
				rx="2"
				className="fill-np-lime opacity-40"
			/>

			<rect
				x="76"
				y="130"
				width="20"
				height="20"
				rx="2"
				className="fill-np-lime stroke-otto-border"
			/>
			<rect x="80" y="138" width="12" height="4" className="fill-np-lime-on" />
			<rect x="84" y="134" width="4" height="12" className="fill-np-lime-on" />
			<rect
				x="106"
				y="134"
				width="72"
				height="12"
				rx="2"
				className="fill-np-lime opacity-40"
			/>
		</svg>
	);
}

/** A run finishing: every row ticked, then one big pass badge. */
export function ChecksIllustration({ className = 'h-auto w-full' }: ArtProps) {
	return (
		<svg
			viewBox="0 0 320 200"
			className={className}
			aria-hidden="true"
			focusable="false"
			strokeWidth="2"
			strokeLinejoin="round"
		>
			<rect x="66" y="42" width="190" height="140" rx="3" className={SHADOW} />
			<rect x="60" y="36" width="190" height="140" rx="3" className={PANEL} />
			<path d="M60 39 h190 v21 h-190 z" className="fill-otto-card" />
			<path d="M60 60 h190" className="stroke-otto-border" />
			<circle cx="76" cy="49" r="3.5" className="fill-otto-dim" />
			<circle cx="90" cy="49" r="3.5" className="fill-otto-dim" />
			<circle cx="104" cy="49" r="3.5" className="fill-otto-dim" />

			{[76, 106, 136].map((y, i) => (
				<g key={y}>
					<rect
						x="78"
						y={y}
						width="18"
						height="18"
						rx="2"
						className="fill-np-lime stroke-otto-border"
					/>
					<path
						d={`M83 ${y + 9} l4 4 l8 -9`}
						className="fill-none stroke-np-lime-on"
						strokeWidth="3"
						strokeLinecap="round"
					/>
					<rect
						x="106"
						y={y + 3}
						width={[92, 66, 108][i]}
						height="12"
						rx="2"
						className="fill-otto-border opacity-40"
					/>
				</g>
			))}

			<rect
				x="198"
				y="130"
				width="64"
				height="64"
				rx="3"
				className="fill-np-lime stroke-otto-border"
			/>
			<path
				d="M214 162 l12 13 l21 -27"
				className="fill-none stroke-np-lime-on"
				strokeWidth="7"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/** otto in the middle, wired to the other things you already use. */
export function ConnectIllustration({ className = 'h-auto w-full' }: ArtProps) {
	return (
		<svg
			viewBox="0 0 320 200"
			className={className}
			aria-hidden="true"
			focusable="false"
			strokeWidth="2"
			strokeLinejoin="round"
		>
			<g className="fill-none stroke-otto-border">
				<path d="M52 62 V100 H128" />
				<path d="M272 66 V100 H192" />
				<path d="M48 142 V116 H128" />
				<path d="M270 140 V116 H192" />
			</g>

			<rect x="134" y="74" width="64" height="64" rx="3" className={SHADOW} />
			<rect
				x="128"
				y="68"
				width="64"
				height="64"
				rx="3"
				className="fill-np-blue stroke-otto-border"
			/>
			<rect
				x="142"
				y="84"
				width="36"
				height="7"
				rx="2"
				className="fill-np-blue-on"
			/>
			<rect
				x="142"
				y="97"
				width="36"
				height="7"
				rx="2"
				className="fill-np-blue-on"
			/>
			<rect
				x="142"
				y="110"
				width="22"
				height="7"
				rx="2"
				className="fill-np-blue-on opacity-60"
			/>

			<rect
				x="30"
				y="26"
				width="44"
				height="36"
				rx="3"
				className="fill-np-lime stroke-otto-border"
			/>
			<rect
				x="250"
				y="30"
				width="44"
				height="36"
				rx="3"
				className="fill-np-coral stroke-otto-border"
			/>
			<rect
				x="26"
				y="142"
				width="44"
				height="36"
				rx="3"
				className="fill-np-yellow stroke-otto-border"
			/>
			<rect
				x="248"
				y="140"
				width="44"
				height="36"
				rx="3"
				className="fill-otto-surface stroke-otto-border"
			/>
			<path
				d="M264 158 h12 M270 152 v12"
				className="stroke-otto-dim"
				strokeLinecap="round"
			/>
		</svg>
	);
}
