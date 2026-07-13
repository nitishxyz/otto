import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

interface OGRequest {
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

interface PageOGRequest {
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

async function loadFont(): Promise<ArrayBuffer> {
	const response = await fetch(
		'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.0.8/files/ibm-plex-mono-latin-400-normal.woff',
	);
	return response.arrayBuffer();
}

const bgColor = '#09090b';
const fgColor = '#ffffff';
const mutedColor = '#a1a1aa';
const dimColor = '#71717a';
const cardColor = '#1c1c22';
const borderColor = '#3f3f46';
const accentColor = '#3b82f6';
const purpleColor = '#9333ea';

const OTTO_WORDMARK_PATH =
	'M192.877 257.682C192.877 263.287 191.783 268.551 189.596 273.473C187.545 278.395 184.674 282.701 180.982 286.393C177.428 289.947 173.189 292.818 168.268 295.006C163.482 297.057 158.287 298.082 152.682 298.082H44.1953C38.7266 298.082 33.5312 297.057 28.6094 295.006C23.6875 292.818 19.3809 289.947 15.6895 286.393C12.1348 282.701 9.26367 278.395 7.07617 273.473C5.02539 268.551 4 263.287 4 257.682V120.074C4 114.469 5.02539 109.205 7.07617 104.283C9.26367 99.3613 12.1348 95.123 15.6895 91.5684C19.3809 87.877 23.6875 85.0059 28.6094 82.9551C33.5312 80.7676 38.7266 79.6738 44.1953 79.6738H152.682C158.287 79.6738 163.482 80.7676 168.268 82.9551C173.189 85.0059 177.428 87.877 180.982 91.5684C184.674 95.123 187.545 99.3613 189.596 104.283C191.783 109.205 192.877 114.469 192.877 120.074V257.682ZM44.1953 120.074V257.682H152.682V120.074H44.1953ZM331.715 4V298.082H289.674V46.041H239.225V4H331.715ZM478.961 4V298.082H436.92V46.041H386.471V4H478.961ZM743.717 257.682C743.717 263.287 742.623 268.551 740.436 273.473C738.385 278.395 735.514 282.701 731.822 286.393C728.268 289.947 724.029 292.818 719.107 295.006C714.322 297.057 709.127 298.082 703.521 298.082H595.035C589.566 298.082 584.371 297.057 579.449 295.006C574.527 292.818 570.221 289.947 566.529 286.393C562.975 282.701 560.104 278.395 557.916 273.473C555.865 268.551 554.84 263.287 554.84 257.682V120.074C554.84 114.469 555.865 109.205 557.916 104.283C560.104 99.3613 562.975 95.123 566.529 91.5684C570.221 87.877 574.527 85.0059 579.449 82.9551C584.371 80.7676 589.566 79.6738 595.035 79.6738H703.521C709.127 79.6738 714.322 80.7676 719.107 82.9551C724.029 85.0059 728.268 87.877 731.822 91.5684C735.514 95.123 738.385 99.3613 740.436 104.283C742.623 109.205 743.717 114.469 743.717 120.074V257.682ZM595.035 120.074V257.682H703.521V120.074H595.035Z';

function ShipWheelMark({
	size = 32,
	color = fgColor,
}: {
	size?: number;
	color?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="otto mark"
		>
			<circle cx={12} cy={12} r={8} />
			<path d="M12 2v7.5" />
			<path d="m19 5-5.23 5.23" />
			<path d="M22 12h-7.5" />
			<path d="m19 19-5.23-5.23" />
			<path d="M12 14.5V22" />
			<path d="M10.23 13.77 5 19" />
			<path d="M9.5 12H2" />
			<path d="M10.23 10.23 5 5" />
			<circle cx={12} cy={12} r={2.5} />
		</svg>
	);
}

function OttoLogo({
	size = 32,
	color = fgColor,
}: {
	size?: number;
	color?: string;
}) {
	const width = Math.round(size * (1061 / 303));
	return (
		<svg
			width={width}
			height={size}
			viewBox="0 0 1061 303"
			role="img"
			aria-label="otto"
		>
			<g
				transform="translate(0 79.68) scale(9.1)"
				fill="none"
				stroke={color}
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx={12} cy={12} r={8} />
				<path d="M12 2v7.5" />
				<path d="m19 5-5.23 5.23" />
				<path d="M22 12h-7.5" />
				<path d="m19 19-5.23-5.23" />
				<path d="M12 14.5V22" />
				<path d="M10.23 13.77 5 19" />
				<path d="M9.5 12H2" />
				<path d="M10.23 10.23 5 5" />
				<circle cx={12} cy={12} r={2.5} />
			</g>
			<path transform="translate(313 0)" fill={color} d={OTTO_WORDMARK_PATH} />
		</svg>
	);
}

function OttoRouterLogo({ size = 32 }: { size?: number }) {
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: `${Math.round(size * 0.28)}px`,
			}}
		>
			<ShipWheelMark size={size} color={purpleColor} />
			<div
				style={{
					display: 'flex',
					fontSize: `${Math.round(size * 0.85)}px`,
					fontWeight: 600,
					color: fgColor,
					letterSpacing: '-0.02em',
				}}
			>
				OttoRouter
			</div>
		</div>
	);
}

function renderLandingOG() {
	return (
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				background: '#09090b',
				fontFamily: 'IBM Plex Mono',
				color: '#ffffff',
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<div
				style={{
					position: 'absolute',
					top: '-120px',
					right: '-120px',
					width: '500px',
					height: '500px',
					borderRadius: '50%',
					background:
						'radial-gradient(circle, rgba(59,130,246,0.12), transparent 70%)',
					display: 'flex',
				}}
			/>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					alignItems: 'center',
					flex: 1,
					padding: '60px',
					position: 'relative',
				}}
			>
				<OttoLogo size={80} />

				<div
					style={{
						fontSize: '36px',
						color: '#d4d4d8',
						marginTop: '36px',
						textAlign: 'center',
						lineHeight: 1.4,
						letterSpacing: '-0.01em',
						maxWidth: '800px',
						display: 'flex',
					}}
				>
					AI-powered coding assistant
				</div>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '16px',
						marginTop: '44px',
					}}
				>
					{['CLI', 'TUI', 'Desktop', 'Server', 'Embeddable'].map((label) => (
						<div
							key={label}
							style={{
								display: 'flex',
								alignItems: 'center',
								padding: '10px 24px',
								background: '#18181b',
								border: '1px solid #3f3f46',
								borderRadius: '8px',
								fontSize: '17px',
								color: '#d4d4d8',
								letterSpacing: '0.04em',
							}}
						>
							{label}
						</div>
					))}
				</div>
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
						fontSize: '18px',
						color: '#a1a1aa',
						display: 'flex',
						letterSpacing: '0.04em',
					}}
				>
					ottocode.io
				</div>
				<div
					style={{
						fontSize: '18px',
						color: '#a1a1aa',
						display: 'flex',
						letterSpacing: '0.04em',
					}}
				>
					open source
				</div>
			</div>
		</div>
	);
}

function renderOttoRouterOG(data: PageOGRequest) {
	const description =
		data.description || 'One key. Every model. Pay as you go.';

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
					top: '-120px',
					right: '-120px',
					width: '500px',
					height: '500px',
					borderRadius: '50%',
					background:
						'radial-gradient(circle, rgba(147,51,234,0.16), transparent 70%)',
					display: 'flex',
				}}
			/>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					alignItems: 'center',
					flex: 1,
					padding: '60px',
					position: 'relative',
				}}
			>
				<OttoRouterLogo size={80} />

				<div
					style={{
						fontSize: '36px',
						color: '#d4d4d8',
						marginTop: '36px',
						textAlign: 'center',
						lineHeight: 1.4,
						letterSpacing: '-0.01em',
						maxWidth: '800px',
						display: 'flex',
					}}
				>
					{description}
				</div>
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
						fontSize: '18px',
						color: mutedColor,
						display: 'flex',
						letterSpacing: '0.04em',
					}}
				>
					ottorouter.org
				</div>
				<div
					style={{
						fontSize: '18px',
						color: purpleColor,
						display: 'flex',
						letterSpacing: '0.04em',
					}}
				>
					an otto service
				</div>
			</div>
		</div>
	);
}

function renderDocsOG(data: PageOGRequest) {
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

function renderBlogOG(data: PageOGRequest) {
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

function renderShareOG(data: OGRequest) {
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

async function generateImage(element: JSX.Element): Promise<Buffer> {
	const font = await loadFont();

	const svg = await satori(element, {
		width: 1200,
		height: 630,
		fonts: [
			{
				name: 'IBM Plex Mono',
				data: font,
				weight: 400,
				style: 'normal',
			},
			{
				name: 'IBM Plex Mono',
				data: font,
				weight: 500,
				style: 'normal',
			},
			{
				name: 'IBM Plex Mono',
				data: font,
				weight: 600,
				style: 'normal',
			},
		],
	});

	const resvg = new Resvg(svg, {
		fitTo: {
			mode: 'width',
			value: 1200,
		},
	});
	const pngData = resvg.render();
	return Buffer.from(pngData.asPng());
}

async function main() {
	console.log('Generating OG image previews...\n');

	const landing = renderLandingOG();
	const landingBuf = await generateImage(landing);
	writeFileSync('preview-landing.png', landingBuf);
	console.log('✓ preview-landing.png');

	const ottorouter = renderOttoRouterOG({ type: 'ottorouter' });
	const ottorouterBuf = await generateImage(ottorouter);
	writeFileSync('preview-ottorouter.png', ottorouterBuf);
	console.log('✓ preview-ottorouter.png');

	const docs = renderDocsOG({
		type: 'docs',
		title: 'System Architecture',
		section: 'Architecture',
		description:
			'Understand the modular architecture powering otto across CLI, desktop, and embedded interfaces.',
	});
	const docsBuf = await generateImage(docs);
	writeFileSync('preview-docs.png', docsBuf);
	console.log('✓ preview-docs.png');

	const blog = renderBlogOG({
		type: 'blog',
		title: 'Introducing otto v1.0',
		description:
			'One tool, multiple interfaces. Open source AI coding assistant.',
		author: 'nitish',
		date: 'Mar 5, 2026',
	});
	const blogBuf = await generateImage(blog);
	writeFileSync('preview-blog.png', blogBuf);
	console.log('✓ preview-blog.png');

	const share = renderShareOG({
		title: 'Audit Solana program with detailed solutions',
		username: 'bat',
		model: 'claude-opus-4-20250514',
		provider: 'anthropic',
		messageCount: 42,
		inputTokens: 550900,
		outputTokens: 12300,
		createdAt: Date.now(),
		shareId: 'test-preview',
	});
	const shareBuf = await generateImage(share);
	writeFileSync('preview-share.png', shareBuf);
	console.log('✓ preview-share.png');

	console.log('\nDone! All previews generated.');
}

main().catch(console.error);
