import {
	AbsoluteFill,
	interpolate,
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
					<svg
						width={Math.round(170 * (1061 / 303))}
						height={170}
						viewBox="0 0 1061 303"
						style={{ display: 'block', overflow: 'visible' }}
					>
						<g
							transform="translate(0 79.68) scale(9.1)"
							fill="none"
							stroke={colors.text}
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
						<path
							transform="translate(313 0)"
							fill={colors.text}
							d="M192.877 257.682C192.877 263.287 191.783 268.551 189.596 273.473C187.545 278.395 184.674 282.701 180.982 286.393C177.428 289.947 173.189 292.818 168.268 295.006C163.482 297.057 158.287 298.082 152.682 298.082H44.1953C38.7266 298.082 33.5312 297.057 28.6094 295.006C23.6875 292.818 19.3809 289.947 15.6895 286.393C12.1348 282.701 9.26367 278.395 7.07617 273.473C5.02539 268.551 4 263.287 4 257.682V120.074C4 114.469 5.02539 109.205 7.07617 104.283C9.26367 99.3613 12.1348 95.123 15.6895 91.5684C19.3809 87.877 23.6875 85.0059 28.6094 82.9551C33.5312 80.7676 38.7266 79.6738 44.1953 79.6738H152.682C158.287 79.6738 163.482 80.7676 168.268 82.9551C173.189 85.0059 177.428 87.877 180.982 91.5684C184.674 95.123 187.545 99.3613 189.596 104.283C191.783 109.205 192.877 114.469 192.877 120.074V257.682ZM44.1953 120.074V257.682H152.682V120.074H44.1953ZM331.715 4V298.082H289.674V46.041H239.225V4H331.715ZM478.961 4V298.082H436.92V46.041H386.471V4H478.961ZM743.717 257.682C743.717 263.287 742.623 268.551 740.436 273.473C738.385 278.395 735.514 282.701 731.822 286.393C728.268 289.947 724.029 292.818 719.107 295.006C714.322 297.057 709.127 298.082 703.521 298.082H595.035C589.566 298.082 584.371 297.057 579.449 295.006C574.527 292.818 570.221 289.947 566.529 286.393C562.975 282.701 560.104 278.395 557.916 273.473C555.865 268.551 554.84 263.287 554.84 257.682V120.074C554.84 114.469 555.865 109.205 557.916 104.283C560.104 99.3613 562.975 95.123 566.529 91.5684C570.221 87.877 574.527 85.0059 579.449 82.9551C584.371 80.7676 589.566 79.6738 595.035 79.6738H703.521C709.127 79.6738 714.322 80.7676 719.107 82.9551C724.029 85.0059 728.268 87.877 731.822 91.5684C735.514 95.123 738.385 99.3613 740.436 104.283C742.623 109.205 743.717 114.469 743.717 120.074V257.682ZM595.035 120.074V257.682H703.521V120.074H595.035Z"
						/>
					</svg>
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
