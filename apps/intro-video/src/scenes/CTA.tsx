import {
	AbsoluteFill,
	Img,
	interpolate,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
	spring,
} from 'remotion';
import { colors, font } from '../theme';

export const CTA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const logoProgress = spring({
		frame,
		fps,
		config: { damping: 10, mass: 0.8, stiffness: 160 },
		delay: 5,
	});
	const logoScale = interpolate(logoProgress, [0, 1], [0, 1]);
	const logoRotate = interpolate(logoProgress, [0, 1], [-90, 0]);

	const headlineProgress = spring({
		frame: frame - 20,
		fps,
		config: { damping: 16, mass: 0.7, stiffness: 140 },
	});
	const headlineY = interpolate(headlineProgress, [0, 1], [60, 0]);

	const cmdProgress = spring({
		frame: frame - 40,
		fps,
		config: { damping: 14, mass: 0.6, stiffness: 180 },
	});
	const cmdScale = interpolate(cmdProgress, [0, 1], [0.7, 1]);

	const altProgress = spring({
		frame: frame - 60,
		fps,
		config: { damping: 20, stiffness: 120 },
	});
	const altX = interpolate(altProgress, [0, 1], [80, 0]);

	const ghProgress = spring({
		frame: frame - 80,
		fps,
		config: { damping: 22, stiffness: 100 },
	});
	const ghY = interpolate(ghProgress, [0, 1], [40, 0]);

	const glowPulse = interpolate(Math.sin(frame * 0.05), [-1, 1], [0.25, 0.6]);

	return (
		<AbsoluteFill
			style={{
				backgroundColor: colors.bg,
				justifyContent: 'center',
				alignItems: 'center',
				fontFamily: font.sans,
			}}
		>
			<div
				style={{
					position: 'absolute',
					width: 800,
					height: 800,
					borderRadius: '50%',
					background: `radial-gradient(circle, ${colors.accent}12, transparent 55%)`,
					opacity: glowPulse,
					filter: 'blur(100px)',
				}}
			/>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: 40,
				}}
			>
				<div
					style={{
						opacity: logoProgress,
						transform: `scale(${logoScale}) rotate(${logoRotate}deg)`,
					}}
				>
					<Img
						src={staticFile('otto-wordmark.svg')}
						style={{
							display: 'block',
							width: Math.round(170 * (171 / 55)),
							height: 170,
						}}
					/>
				</div>

				<div
					style={{
						fontSize: 56,
						fontWeight: 700,
						color: colors.text,
						opacity: headlineProgress,
						transform: `translateY(${headlineY}px)`,
					}}
				>
					Get started in seconds.
				</div>

				<div
					style={{
						background: colors.card,
						color: colors.muted,
						border: `1px solid ${colors.border}`,
						padding: '6px 16px',
						borderRadius: 9999,
						fontSize: 17,
						fontWeight: 600,
						letterSpacing: '0.08em',
						textTransform: 'uppercase' as const,
						opacity: headlineProgress,
					}}
				>
					Now in Beta
				</div>

				<div
					style={{
						background: colors.text,
						color: colors.bg,
						padding: '18px 36px',
						borderRadius: 12,
						fontSize: 24,
						fontWeight: 500,
						fontFamily: font.mono,
						opacity: cmdProgress,
						transform: `scale(${cmdScale})`,
						letterSpacing: '0.01em',
					}}
				>
					curl -fsSL https://install.ottocode.io | sh
				</div>

				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 10,
						opacity: altProgress,
						transform: `translateX(${altX}px)`,
					}}
				>
					<div style={{ fontSize: 22, color: colors.dim }}>
						or install the desktop app from
					</div>
					<div
						style={{
							fontSize: 26,
							fontWeight: 600,
							color: colors.accent,
						}}
					>
						ottocode.io
					</div>
				</div>

				<div
					style={{
						marginTop: 12,
						display: 'flex',
						alignItems: 'center',
						gap: 12,
						opacity: ghProgress,
						transform: `translateY(${ghY}px)`,
					}}
				>
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke={colors.muted}
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
						<path d="M9 18c-4.51 2-5-2-7-2" />
					</svg>
					<span style={{ fontSize: 24, color: colors.muted, fontWeight: 500 }}>
						github.com/nitishxyz/otto
					</span>
				</div>
			</div>
		</AbsoluteFill>
	);
};
