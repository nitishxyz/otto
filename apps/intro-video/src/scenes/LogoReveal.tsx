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

export const LogoReveal: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const haloProgress = spring({
		frame,
		fps,
		config: { damping: 40, stiffness: 40 },
		delay: 0,
	});
	const haloScale = interpolate(haloProgress, [0, 1], [0.3, 1]);
	const haloPulse = interpolate(frame % 120, [0, 60, 120], [0.4, 0.7, 0.4], {
		extrapolateRight: 'clamp',
	});

	const iconProgress = spring({
		frame,
		fps,
		config: { damping: 10, mass: 1.2, stiffness: 80 },
		delay: 5,
	});
	const iconScale = interpolate(iconProgress, [0, 1], [0, 1.08]);
	const iconSettle = spring({
		frame,
		fps,
		config: { damping: 20, stiffness: 200 },
		delay: 25,
	});
	const finalIconScale = interpolate(iconSettle, [0, 1], [1.08, 1]);
	const computedIconScale = frame < 25 ? iconScale : finalIconScale;

	const shimmerX = interpolate(frame, [30, 80], [-400, 400], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});

	const wordmarkProgress = spring({
		frame: frame - 45,
		fps,
		config: { damping: 16, mass: 0.8, stiffness: 100 },
	});
	const wordmarkY = interpolate(wordmarkProgress, [0, 1], [50, 0]);

	const lineProgress = spring({
		frame: frame - 75,
		fps,
		config: { damping: 20, stiffness: 120 },
	});
	const lineWidth = interpolate(lineProgress, [0, 1], [0, 160]);

	const subProgress = spring({
		frame: frame - 95,
		fps,
		config: { damping: 16, stiffness: 100 },
	});
	const subY = interpolate(subProgress, [0, 1], [25, 0]);

	const floatY = Math.sin(frame * 0.04) * 4;

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
					background: `radial-gradient(circle, ${colors.accent}18, ${colors.accent}08 40%, transparent 70%)`,
					opacity: haloPulse * haloProgress,
					transform: `scale(${haloScale})`,
					filter: 'blur(60px)',
				}}
			/>

			<div
				style={{
					position: 'absolute',
					width: 400,
					height: 400,
					borderRadius: '50%',
					background: `radial-gradient(circle, rgba(147,51,234,0.06), transparent 70%)`,
					opacity: haloProgress * 0.5,
					transform: `translate(200px, -100px) scale(${haloScale})`,
					filter: 'blur(80px)',
				}}
			/>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: 28,
					transform: `translateY(${floatY}px)`,
				}}
			>
				<div
					style={{
						transform: `scale(${computedIconScale})`,
						opacity: iconProgress,
						position: 'relative',
					}}
				>
					<div
						style={{
							position: 'absolute',
							inset: -20,
							borderRadius: 40,
							background: `linear-gradient(135deg, ${colors.accent}15, transparent, ${colors.accent}10)`,
							filter: 'blur(20px)',
							opacity: iconProgress,
						}}
					/>

					<div
						style={{
							position: 'relative',
							overflow: 'hidden',
							borderRadius: 30,
							padding: 0,
						}}
					>
						<svg
							width={200}
							height={200}
							viewBox="0 0 24 24"
							fill="none"
							stroke={colors.text}
							strokeWidth={1.75}
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ display: 'block', overflow: 'visible' }}
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

						<div
							style={{
								position: 'absolute',
								top: 0,
								left: shimmerX,
								width: 80,
								height: '100%',
								background:
									'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
								transform: 'skewX(-20deg)',
							}}
						/>
					</div>
				</div>

				<div
					style={{
						opacity: wordmarkProgress,
						transform: `translateY(${wordmarkY}px)`,
					}}
				>
					<Img
						src={staticFile('otto-wordmark.svg')}
						style={{ width: Math.round(80 * (171 / 55)), height: 80 }}
					/>
				</div>

				<div
					style={{
						height: 2,
						width: lineWidth * 1.3,
						background: `linear-gradient(90deg, transparent, ${colors.accent}, transparent)`,
						borderRadius: 1,
					}}
				/>

				<div
					style={{
						fontSize: 24,
						color: colors.dim,
						opacity: subProgress,
						transform: `translateY(${subY}px)`,
						letterSpacing: '0.2em',
						textTransform: 'uppercase' as const,
						fontWeight: 500,
					}}
				>
					AI Coding Assistant
				</div>
			</div>
		</AbsoluteFill>
	);
};
