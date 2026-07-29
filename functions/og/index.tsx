import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import {
	WORDMARK_ASCENDER_TOP,
	WORDMARK_HEIGHT,
	WORDMARK_LETTERS,
	WORDMARK_PAD,
	WORDMARK_WIDTH,
	WORDMARK_X_HEIGHT,
	type WordmarkLetter,
} from './wordmark';

export interface OGRequest {
	title: string;
	username: string;
	model: string;
	provider: string;
	messageCount: number;
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	tokenCount?: number;
	createdAt: number;
	shareId: string;
}

export interface PageOGRequest {
	type: 'landing' | 'docs' | 'blog' | 'ottorouter';
	title?: string;
	description?: string;
	section?: string;
	date?: string;
	author?: string;
}

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
	'claude-sonnet-4-20250514': { input: 3, output: 15 },
	'claude-opus-4-20250514': { input: 15, output: 75 },
	'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
	'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
	'gpt-4o': { input: 2.5, output: 10 },
	'gpt-4o-mini': { input: 0.15, output: 0.6 },
	'gpt-4-turbo': { input: 10, output: 30 },
	o1: { input: 15, output: 60 },
	'o1-mini': { input: 1.1, output: 4.4 },
	'o3-mini': { input: 1.1, output: 4.4 },
	'gemini-2.0-flash': { input: 0.1, output: 0.4 },
	'gemini-2.5-pro-preview-06-05': { input: 1.25, output: 10 },
	'gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.6 },
};

function estimateCost(
	model: string,
	inputTokens: number,
	outputTokens: number,
): number {
	const costs = MODEL_COSTS[model];
	if (!costs) return 0;
	return (
		(inputTokens / 1_000_000) * costs.input +
		(outputTokens / 1_000_000) * costs.output
	);
}

function formatDate(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

function formatCompactNumber(num: number): string {
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
	if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
	return num.toString();
}

export async function loadFonts(): Promise<{
	regular: ArrayBuffer;
	bold: ArrayBuffer;
}> {
	const [regular, bold] = await Promise.all([
		fetch(
			'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.0.8/files/ibm-plex-mono-latin-400-normal.woff',
		).then((r) => r.arrayBuffer()),
		fetch(
			'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.0.8/files/ibm-plex-mono-latin-700-normal.woff',
		).then((r) => r.arrayBuffer()),
	]);
	return { regular, bold };
}

export function satoriFonts(fonts: {
	regular: ArrayBuffer;
	bold: ArrayBuffer;
}) {
	return [
		{
			name: 'IBM Plex Mono',
			data: fonts.regular,
			weight: 400 as const,
			style: 'normal' as const,
		},
		{
			name: 'IBM Plex Mono',
			data: fonts.regular,
			weight: 500 as const,
			style: 'normal' as const,
		},
		{
			name: 'IBM Plex Mono',
			data: fonts.regular,
			weight: 600 as const,
			style: 'normal' as const,
		},
		{
			name: 'IBM Plex Mono',
			data: fonts.bold,
			weight: 700 as const,
			style: 'normal' as const,
		},
	];
}

const bgColor = '#09090b';
const fgColor = '#ffffff';
const mutedColor = '#a1a1aa';
const dimColor = '#71717a';
const cardColor = '#1c1c22';
const borderColor = '#3f3f46';
const accentColor = '#3b82f6';

/**
 * NeoPop tokens mirrored from `apps/landing/src/index.css`. The four accents
 * are brand colours and hold the same value in both themes; only the
 * structural tokens below are the dark-theme ones, since the card is dark.
 */
const np = {
	bg: '#09090b',
	card: '#1a1a1f',
	border: '#5c5c66',
	shadow: '#b2bbd1',
	text: '#fafafa',
	muted: '#a1a1aa',
	dim: '#71717a',
	blue: '#4865cc',
	lime: '#62ad8b',
	yellow: '#e9a21b',
	coral: '#c9403a',
	grid: 'rgba(92,92,102,0.13)',
};

/**
 * Shade each accent casts, matching `--np-*-cast`. Deep enough to separate
 * from the fill, so the extrusion reads as a solid offset rather than a blur.
 */
const npCast = {
	blue: '#283c8c',
	lime: '#346852',
	yellow: '#9e6a0c',
	coral: '#84241f',
};

/**
 * Per-letter palette, matching `POP_FILL` in `NeoOttoLogo`: the repeated `tt`
 * shares one colour so the pair reads as a unit, and the two `o`s bracket the
 * word with the primary blue and lime.
 */
const WORDMARK_FILL: Record<WordmarkLetter, string> = {
	o1: np.blue,
	t1: np.coral,
	t2: np.coral,
	o2: np.lime,
};

const WORDMARK_CAST: Record<WordmarkLetter, string> = {
	o1: npCast.blue,
	t1: npCast.coral,
	t2: npCast.coral,
	o2: npCast.lime,
};

/** Compact alias used by secondary OG-card surfaces. */
function OttoLogo({ size = 32 }: { size?: number }) {
	return <NeoWordmark height={size} depth={3} />;
}

/** Hairline grid plate matching the homepage `.np-grid-bg` treatment. */
function NeoGrid() {
	const columns = Array.from({ length: 26 }, (_, i) => (i + 1) * 44);
	const rows = Array.from({ length: 14 }, (_, i) => (i + 1) * 44);
	return (
		<div
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				width: '1200px',
				height: '630px',
				display: 'flex',
			}}
		>
			{columns.map((x) => (
				<div
					key={`c${x}`}
					style={{
						position: 'absolute',
						left: `${x}px`,
						top: 0,
						width: '1px',
						height: '630px',
						background: np.grid,
						display: 'flex',
					}}
				/>
			))}
			{rows.map((y) => (
				<div
					key={`r${y}`}
					style={{
						position: 'absolute',
						left: 0,
						top: `${y}px`,
						width: '1200px',
						height: '1px',
						background: np.grid,
						display: 'flex',
					}}
				/>
			))}
		</div>
	);
}

/**
 * The custom-drawn wordmark: every glyph painted twice, once as a hard offset
 * extrusion in a shade of its own fill and once as the front face. Unstroked
 * on both layers, so the extrusion stays a clean offset rather than a halo.
 */
function NeoWordmark({
	height = 88,
	depth = 5,
}: {
	height?: number;
	depth?: number;
}) {
	const viewWidth = WORDMARK_WIDTH + depth + WORDMARK_PAD * 2;
	const viewHeight = WORDMARK_HEIGHT + depth + WORDMARK_PAD * 2;
	const width = Math.round((height * viewWidth) / viewHeight);

	return (
		<svg
			width={width}
			height={height}
			viewBox={`${-WORDMARK_PAD} ${WORDMARK_ASCENDER_TOP - WORDMARK_PAD} ${viewWidth} ${viewHeight}`}
			role="img"
			aria-label="otto"
		>
			<g transform={`translate(${depth} ${depth})`} stroke="none">
				{WORDMARK_LETTERS.map((letter) => (
					<path
						key={`shade-${letter.key}`}
						d={letter.d}
						fill={WORDMARK_CAST[letter.key]}
						fillRule={letter.evenOdd ? 'evenodd' : 'nonzero'}
					/>
				))}
			</g>
			<g stroke="none">
				{WORDMARK_LETTERS.map((letter) => (
					<path
						key={`face-${letter.key}`}
						d={letter.d}
						fill={WORDMARK_FILL[letter.key]}
						fillRule={letter.evenOdd ? 'evenodd' : 'nonzero'}
					/>
				))}
			</g>
		</svg>
	);
}
/**
 * IBM Plex Mono metrics as fractions of the em: the x-height, and the gap
 * between the baseline and the bottom of a `line-height: 1` box. Both are used
 * to set `router` on the drawn mark's own baseline.
 */
const MONO_X_HEIGHT = 0.516;
const MONO_BASELINE_TO_BOTTOM = 0.125;

/**
 * The OttoRouter lockup: the drawn `otto` mark followed by `router` in the page
 * mono, sized to the mark's x-height and dropped onto its baseline so the two
 * halves read as one word rather than a mark beside a label.
 */
function NeoRouterWordmark({
	height = 96,
	depth = 3,
}: {
	height?: number;
	depth?: number;
}) {
	const viewHeight = WORDMARK_HEIGHT + depth + WORDMARK_PAD * 2;
	const unit = height / viewHeight;
	const fontSize = (WORDMARK_X_HEIGHT * unit) / MONO_X_HEIGHT;
	const baselineFromBottom = (depth + WORDMARK_PAD) * unit;

	return (
		<div style={{ display: 'flex', alignItems: 'flex-end' }}>
			<NeoWordmark height={height} depth={depth} />
			<div
				style={{
					display: 'flex',
					fontSize: `${fontSize}px`,
					fontWeight: 700,
					lineHeight: 1,
					letterSpacing: '-0.055em',
					color: np.text,
					marginLeft: `${height * 0.14}px`,
					marginBottom: `${baselineFromBottom - fontSize * MONO_BASELINE_TO_BOTTOM}px`,
				}}
			>
				router
			</div>
		</div>
	);
}

export function renderLandingOG() {
	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				background: np.bg,
				fontFamily: 'IBM Plex Mono',
				color: np.text,
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<NeoGrid />

			{/* Depth matches the hero's default, so the mark reads identically. */}
			<NeoWordmark height={120} depth={3} />

			<div
				style={{
					display: 'flex',
					marginTop: '36px',
					fontSize: '27px',
					color: np.muted,
					letterSpacing: '-0.01em',
				}}
			>
				You describe it. otto builds it.
			</div>

			{/* Tone bar — the NeoPop colour signature. */}
			<div
				style={{
					position: 'absolute',
					bottom: 0,
					left: 0,
					width: '1200px',
					height: '16px',
					display: 'flex',
				}}
			>
				<div style={{ display: 'flex', flex: 1, background: np.blue }} />
				<div style={{ display: 'flex', flex: 1, background: np.lime }} />
				<div style={{ display: 'flex', flex: 1, background: np.yellow }} />
				<div style={{ display: 'flex', flex: 1, background: np.coral }} />
			</div>
		</div>
	);
}
/** Claim chips, each filled in an accent and dropped in that accent's shade. */
const ROUTER_CHIPS = [
	{ label: 'one key', fill: np.blue, cast: npCast.blue, on: '#fafcff' },
	{ label: 'pay as you go', fill: np.lime, cast: npCast.lime, on: '#0d1f17' },
	{
		label: '0.5% flat fee',
		fill: np.yellow,
		cast: npCast.yellow,
		on: '#231b0c',
	},
];

export function renderOttoRouterOG(data: PageOGRequest) {
	const description =
		data.description ||
		'One balance for every great model. Top up once, pay for what you use.';

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				background: np.bg,
				fontFamily: 'IBM Plex Mono',
				color: np.text,
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<NeoGrid />

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					flex: 1,
					padding: '60px 60px 0',
				}}
			>
				<NeoRouterWordmark height={92} depth={3} />

				<div
					style={{
						display: 'flex',
						marginTop: '34px',
						maxWidth: '780px',
						fontSize: '26px',
						lineHeight: 1.35,
						color: np.muted,
						letterSpacing: '-0.01em',
						textAlign: 'center',
					}}
				>
					{description}
				</div>

				<div style={{ display: 'flex', marginTop: '38px' }}>
					{ROUTER_CHIPS.map((chip, index) => (
						<div
							key={chip.label}
							style={{
								display: 'flex',
								alignItems: 'center',
								height: '46px',
								padding: '0 20px',
								marginLeft: index === 0 ? '0px' : '18px',
								background: chip.fill,
								color: chip.on,
								border: `2px solid ${chip.cast}`,
								borderRadius: '3px',
								boxShadow: `4px 4px 0 0 ${chip.cast}`,
								fontSize: '17px',
								fontWeight: 700,
								letterSpacing: '0.12em',
								textTransform: 'uppercase',
							}}
						>
							{chip.label}
						</div>
					))}
				</div>
			</div>

			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					padding: '0 60px 44px',
					fontSize: '18px',
					letterSpacing: '0.04em',
				}}
			>
				<div style={{ display: 'flex', color: np.muted }}>ottorouter.org</div>
				<div style={{ display: 'flex', color: np.dim }}>an otto service</div>
			</div>

			{/* Tone bar — the NeoPop colour signature. */}
			<div
				style={{
					position: 'absolute',
					bottom: 0,
					left: 0,
					width: '1200px',
					height: '16px',
					display: 'flex',
				}}
			>
				<div style={{ display: 'flex', flex: 1, background: np.blue }} />
				<div style={{ display: 'flex', flex: 1, background: np.lime }} />
				<div style={{ display: 'flex', flex: 1, background: np.yellow }} />
				<div style={{ display: 'flex', flex: 1, background: np.coral }} />
			</div>
		</div>
	);
}

export function renderDocsOG(data: PageOGRequest) {
	const title = data.title || 'Documentation';
	const section = data.section || '';

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				background: bgColor,
				fontFamily: 'IBM Plex Mono',
				color: fgColor,
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<div
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					height: '4px',
					background: `linear-gradient(90deg, ${accentColor}, ${accentColor}80, transparent)`,
					display: 'flex',
				}}
			/>

			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					padding: '48px 60px 0',
				}}
			>
				<OttoLogo size={28} />
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						padding: '6px 16px',
						background: cardColor,
						border: `1px solid ${borderColor}`,
						borderRadius: '4px',
						fontSize: '13px',
						color: accentColor,
						letterSpacing: '0.08em',
					}}
				>
					DOCS
				</div>
			</div>

			<div
				style={{
					flex: 1,
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					padding: '0 60px',
				}}
			>
				{section && (
					<div
						style={{
							fontSize: '14px',
							color: accentColor,
							letterSpacing: '0.1em',
							marginBottom: '16px',
							display: 'flex',
						}}
					>
						{section.toUpperCase()}
					</div>
				)}

				<div
					style={{
						fontSize: '48px',
						fontWeight: 600,
						lineHeight: 1.2,
						color: fgColor,
						letterSpacing: '-0.02em',
						maxWidth: '900px',
						display: 'flex',
					}}
				>
					{title}
				</div>

				{data.description && (
					<div
						style={{
							fontSize: '18px',
							color: mutedColor,
							marginTop: '20px',
							lineHeight: 1.5,
							maxWidth: '750px',
							display: 'flex',
						}}
					>
						{data.description}
					</div>
				)}
			</div>

			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					padding: '0 60px 40px',
					borderTop: `1px solid ${borderColor}`,
					paddingTop: '24px',
					margin: '0 60px',
				}}
			>
				<div
					style={{
						fontSize: '14px',
						color: dimColor,
						display: 'flex',
						letterSpacing: '0.05em',
					}}
				>
					ottocode.io/docs
				</div>
			</div>
		</div>
	);
}

export function renderBlogOG(data: PageOGRequest) {
	const title = data.title || 'Blog';
	const date = data.date || '';
	const author = data.author || 'otto team';

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				background: bgColor,
				fontFamily: 'IBM Plex Mono',
				color: fgColor,
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<div
				style={{
					position: 'absolute',
					bottom: 0,
					right: 0,
					width: '500px',
					height: '500px',
					background: `radial-gradient(circle at bottom right, ${accentColor}10, transparent 70%)`,
					display: 'flex',
				}}
			/>

			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					padding: '48px 60px 0',
				}}
			>
				<OttoLogo size={28} />
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						padding: '6px 16px',
						background: cardColor,
						border: `1px solid ${borderColor}`,
						borderRadius: '4px',
						fontSize: '13px',
						color: mutedColor,
						letterSpacing: '0.08em',
					}}
				>
					BLOG
				</div>
			</div>

			<div
				style={{
					flex: 1,
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					padding: '0 60px',
				}}
			>
				<div
					style={{
						fontSize: '52px',
						fontWeight: 600,
						lineHeight: 1.2,
						color: fgColor,
						letterSpacing: '-0.02em',
						maxWidth: '950px',
						display: 'flex',
					}}
				>
					{title}
				</div>

				{data.description && (
					<div
						style={{
							fontSize: '20px',
							color: mutedColor,
							marginTop: '20px',
							lineHeight: 1.5,
							maxWidth: '750px',
							display: 'flex',
						}}
					>
						{data.description}
					</div>
				)}
			</div>

			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					padding: '0 60px 40px',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						fontSize: '15px',
						color: dimColor,
					}}
				>
					<span>{author}</span>
					{date && (
						<>
							<span style={{ margin: '0 16px', opacity: 0.5 }}>·</span>
							<span>{date}</span>
						</>
					)}
				</div>
				<div
					style={{
						fontSize: '14px',
						color: dimColor,
						display: 'flex',
						letterSpacing: '0.05em',
					}}
				>
					ottocode.io
				</div>
			</div>
		</div>
	);
}

export function renderShareOG(data: OGRequest) {
	const cost =
		data.inputTokens && data.outputTokens
			? estimateCost(data.model, data.inputTokens, data.outputTokens)
			: 0;

	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				background: bgColor,
				padding: '56px',
				fontFamily: 'IBM Plex Mono',
				color: fgColor,
			}}
		>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					marginBottom: '40px',
				}}
			>
				<OttoLogo size={24} />
				<div
					style={{
						fontSize: '16px',
						color: mutedColor,
						display: 'flex',
					}}
				>
					{data.model}
				</div>
			</div>

			<div
				style={{
					flex: 1,
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
				}}
			>
				<div
					style={{
						fontSize: '48px',
						fontWeight: 600,
						lineHeight: 1.2,
						color: fgColor,
						letterSpacing: '-0.02em',
						maxWidth: '1000px',
						display: 'flex',
					}}
				>
					{data.title}
				</div>
			</div>

			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'flex-end',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						fontSize: '16px',
						color: mutedColor,
					}}
				>
					<span>{data.username}</span>
					<span style={{ margin: '0 16px', opacity: 0.5 }}>·</span>
					<span>{data.messageCount} messages</span>
					<span style={{ margin: '0 16px', opacity: 0.5 }}>·</span>
					<span>{formatDate(data.createdAt)}</span>
				</div>

				{(data.inputTokens || data.tokenCount) && (
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							background: cardColor,
							padding: '14px 24px',
							borderRadius: '8px',
							fontSize: '18px',
						}}
					>
						{data.inputTokens && data.outputTokens ? (
							<>
								<span style={{ color: mutedColor, marginRight: '8px' }}>
									in
								</span>
								<span style={{ color: fgColor, fontWeight: 500 }}>
									{formatCompactNumber(data.inputTokens)}
								</span>
								<span
									style={{
										color: mutedColor,
										marginLeft: '24px',
										marginRight: '8px',
									}}
								>
									out
								</span>
								<span style={{ color: fgColor, fontWeight: 500 }}>
									{formatCompactNumber(data.outputTokens)}
								</span>
								{cost > 0 && (
									<>
										<span
											style={{
												color: mutedColor,
												marginLeft: '24px',
												marginRight: '4px',
											}}
										>
											$
										</span>
										<span style={{ color: fgColor, fontWeight: 500 }}>
											{cost.toFixed(2)}
										</span>
									</>
								)}
							</>
						) : (
							<>
								<span style={{ color: fgColor, fontWeight: 500 }}>
									{formatCompactNumber(data.tokenCount || 0)}
								</span>
								<span style={{ color: mutedColor, marginLeft: '8px' }}>
									tokens
								</span>
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

export const handler = async (event: {
	queryStringParameters?: Record<string, string>;
}) => {
	const params = event.queryStringParameters || {};
	const type = params.type as string | undefined;

	const fonts = await loadFonts();

	let element: JSX.Element;

	if (
		type === 'landing' ||
		type === 'docs' ||
		type === 'blog' ||
		type === 'ottorouter'
	) {
		const pageData: PageOGRequest = {
			type,
			title: params.title,
			description: params.description,
			section: params.sec || params.section,
			date: params.date,
			author: params.author,
		};

		if (type === 'landing') {
			element = renderLandingOG();
		} else if (type === 'ottorouter') {
			element = renderOttoRouterOG(pageData);
		} else if (type === 'docs') {
			element = renderDocsOG(pageData);
		} else {
			element = renderBlogOG(pageData);
		}
	} else {
		const data: OGRequest = {
			title: params.title || 'otto session',
			username: params.username || 'anonymous',
			model: params.model || 'unknown',
			provider: params.provider || 'unknown',
			messageCount: parseInt(params.messageCount || '0', 10),
			inputTokens: params.inputTokens
				? parseInt(params.inputTokens, 10)
				: undefined,
			outputTokens: params.outputTokens
				? parseInt(params.outputTokens, 10)
				: undefined,
			cachedTokens: params.cachedTokens
				? parseInt(params.cachedTokens, 10)
				: undefined,
			tokenCount: params.tokenCount
				? parseInt(params.tokenCount, 10)
				: undefined,
			createdAt: parseInt(params.createdAt || Date.now().toString(), 10),
			shareId: params.shareId || 'default',
		};
		element = renderShareOG(data);
	}

	const svg = await satori(element, {
		width: 1200,
		height: 630,
		fonts: satoriFonts(fonts),
	});

	const resvg = new Resvg(svg, {
		fitTo: {
			mode: 'width',
			value: 1200,
		},
	});
	const pngData = resvg.render();
	const pngBuffer = pngData.asPng();

	return {
		statusCode: 200,
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=86400',
		},
		body: Buffer.from(pngBuffer).toString('base64'),
		isBase64Encoded: true,
	};
};
