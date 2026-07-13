import {
	AbsoluteFill,
	interpolate,
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
					<svg
						width={Math.round(80 * (748 / 303))}
						height={80}
						viewBox="0 0 748 303"
						fill={colors.text}
					>
						<path d="M192.877 257.682C192.877 263.287 191.783 268.551 189.596 273.473C187.545 278.395 184.674 282.701 180.982 286.393C177.428 289.947 173.189 292.818 168.268 295.006C163.482 297.057 158.287 298.082 152.682 298.082H44.1953C38.7266 298.082 33.5312 297.057 28.6094 295.006C23.6875 292.818 19.3809 289.947 15.6895 286.393C12.1348 282.701 9.26367 278.395 7.07617 273.473C5.02539 268.551 4 263.287 4 257.682V120.074C4 114.469 5.02539 109.205 7.07617 104.283C9.26367 99.3613 12.1348 95.123 15.6895 91.5684C19.3809 87.877 23.6875 85.0059 28.6094 82.9551C33.5312 80.7676 38.7266 79.6738 44.1953 79.6738H152.682C158.287 79.6738 163.482 80.7676 168.268 82.9551C173.189 85.0059 177.428 87.877 180.982 91.5684C184.674 95.123 187.545 99.3613 189.596 104.283C191.783 109.205 192.877 114.469 192.877 120.074V257.682ZM44.1953 120.074V257.682H152.682V120.074H44.1953ZM331.715 4V298.082H289.674V46.041H239.225V4H331.715ZM478.961 4V298.082H436.92V46.041H386.471V4H478.961ZM743.717 257.682C743.717 263.287 742.623 268.551 740.436 273.473C738.385 278.395 735.514 282.701 731.822 286.393C728.268 289.947 724.029 292.818 719.107 295.006C714.322 297.057 709.127 298.082 703.521 298.082H595.035C589.566 298.082 584.371 297.057 579.449 295.006C574.527 292.818 570.221 289.947 566.529 286.393C562.975 282.701 560.104 278.395 557.916 273.473C555.865 268.551 554.84 263.287 554.84 257.682V120.074C554.84 114.469 555.865 109.205 557.916 104.283C560.104 99.3613 562.975 95.123 566.529 91.5684C570.221 87.877 574.527 85.0059 579.449 82.9551C584.371 80.7676 589.566 79.6738 595.035 79.6738H703.521C709.127 79.6738 714.322 80.7676 719.107 82.9551C724.029 85.0059 728.268 87.877 731.822 91.5684C735.514 95.123 738.385 99.3613 740.436 104.283C742.623 109.205 743.717 114.469 743.717 120.074V257.682ZM595.035 120.074V257.682H703.521V120.074H595.035Z" />
					</svg>
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
