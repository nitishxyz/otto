import {
	AbsoluteFill,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
	spring,
	Easing,
} from 'remotion';
import { colors, font } from '../theme';

const OttoRouterBolt: React.FC<{ size: number; color: string }> = ({
	size,
	color,
}) => (
	<svg width={size} height={size} viewBox="0 0 100 100" fill={color}>
		<path d="M55.0151 11H45.7732C42.9871 11 41.594 11 40.5458 11.7564C39.4977 12.5128 39.0587 13.8349 38.1807 16.479L28.4934 45.6545C26.899 50.4561 26.1019 52.8569 27.2993 54.5162C28.4967 56.1754 31.0264 56.1754 36.0858 56.1754H38.1307C41.9554 56.1754 43.8677 56.1754 45.0206 57.2527C45.2855 57.5002 45.5155 57.7825 45.7043 58.092C46.5262 59.4389 46.1395 61.3117 45.3662 65.0574C42.291 79.9519 40.7534 87.3991 43.0079 88.8933C43.4871 89.2109 44.0292 89.4215 44.5971 89.5107C47.2691 89.9303 51.1621 83.398 58.9481 70.3336L70.7118 50.5949C72.8831 46.9517 73.9687 45.13 73.6853 43.639C73.5201 42.7697 73.0712 41.9797 72.4091 41.3927C71.2734 40.386 69.1528 40.386 64.9115 40.386C61.2258 40.386 59.3829 40.386 58.2863 39.5068C57.6438 38.9916 57.176 38.2907 56.9467 37.4998C56.5553 36.1498 57.2621 34.4479 58.6757 31.044L62.4033 22.0683C64.4825 17.0618 65.5221 14.5585 64.3345 12.7793C63.1468 11 60.4362 11 55.0151 11Z" />
	</svg>
);

const PROVIDERS = ['Anthropic', 'OpenAI', 'Google', 'DeepSeek'];

export const OttoRouter: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const orbitAngle = interpolate(frame, [0, 300], [0, 360], {
		extrapolateRight: 'extend',
	});

	const boltProgress = spring({
		frame: frame - 5,
		fps,
		config: { damping: 12, mass: 1.2, stiffness: 80 },
	});
	const boltScale = interpolate(boltProgress, [0, 1], [0, 1]);

	const ringProgress = interpolate(frame, [15, 50], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: Easing.out(Easing.quad),
	});

	const titleProgress = spring({
		frame: frame - 30,
		fps,
		config: { damping: 16, mass: 0.8, stiffness: 90 },
	});
	const titleY = interpolate(titleProgress, [0, 1], [50, 0]);

	const subProgress = spring({
		frame: frame - 50,
		fps,
		config: { damping: 20, stiffness: 80 },
	});
	const subY = interpolate(subProgress, [0, 1], [30, 0]);

	const tagProgress = spring({
		frame: frame - 70,
		fps,
		config: { damping: 14, stiffness: 160 },
	});

	const urlProgress = spring({
		frame: frame - 120,
		fps,
		config: { damping: 20, stiffness: 100 },
	});

	const floatY = Math.sin(frame * 0.025) * 4;

	const glowPulse = interpolate(Math.sin(frame * 0.06), [-1, 1], [0.3, 0.7]);

	return (
		<AbsoluteFill
			style={{
				backgroundColor: colors.bg,
				fontFamily: font.sans,
				overflow: 'hidden',
			}}
		>
			<div
				style={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					width: 1200,
					height: 1200,
					transform: 'translate(-50%, -50%)',
					borderRadius: '50%',
					background: `radial-gradient(circle, ${colors.accent}10, transparent 60%)`,
					filter: 'blur(100px)',
					opacity: boltProgress * 0.6,
				}}
			/>

			<div
				style={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: `translate(-50%, -50%) rotate(${orbitAngle}deg)`,
					width: 500,
					height: 500,
					borderRadius: '50%',
					border: `1px solid ${colors.accent}12`,
					opacity: ringProgress * 0.5,
				}}
			/>

			<div
				style={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: `translate(-50%, -50%) rotate(${-orbitAngle * 0.7}deg)`,
					width: 700,
					height: 700,
					borderRadius: '50%',
					border: `1px solid ${colors.accent}08`,
					opacity: ringProgress * 0.3,
				}}
			/>

			{PROVIDERS.map((name, i) => {
				const angle = (i / PROVIDERS.length) * 360 + orbitAngle * 0.4;
				const rad = (angle * Math.PI) / 180;
				const radius = 340;
				const x = Math.cos(rad) * radius;
				const y = Math.sin(rad) * radius;
				const provDelay = 60 + i * 12;
				const provProgress = spring({
					frame: frame - provDelay,
					fps,
					config: { damping: 14, stiffness: 140 },
				});

				return (
					<div
						key={name}
						style={{
							position: 'absolute',
							top: '50%',
							left: '50%',
							transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
							opacity: provProgress * 0.6,
							fontSize: 17,
							fontWeight: 600,
							color: colors.dim,
							letterSpacing: '0.05em',
							padding: '10px 20px',
							borderRadius: 20,
							background: `${colors.surface}CC`,
							border: `1px solid ${colors.border}80`,
							whiteSpace: 'nowrap' as const,
						}}
					>
						{name}
					</div>
				);
			})}

			<div
				style={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: `translate(-50%, -50%) translateY(${floatY}px)`,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: 28,
				}}
			>
				<div style={{ position: 'relative' }}>
					<div
						style={{
							position: 'absolute',
							inset: -40,
							borderRadius: '50%',
							background: `radial-gradient(circle, ${colors.accent}${Math.round(
								glowPulse * 30,
							)
								.toString(16)
								.padStart(2, '0')}, transparent 70%)`,
							filter: 'blur(24px)',
						}}
					/>
					<div
						style={{
							transform: `scale(${boltScale})`,
							opacity: boltProgress,
							position: 'relative',
						}}
					>
						<OttoRouterBolt size={130} color={colors.accent} />
					</div>
				</div>

				<div style={{ textAlign: 'center' as const }}>
					<div
						style={{
							fontSize: 96,
							fontWeight: 700,
							color: colors.text,
							opacity: titleProgress,
							transform: `translateY(${titleY}px)`,
							letterSpacing: '-0.03em',
							lineHeight: 1,
						}}
					>
						AI without API keys.
					</div>
					<div
						style={{
							fontSize: 28,
							color: colors.muted,
							maxWidth: 720,
							marginTop: 24,
							opacity: subProgress,
							transform: `translateY(${subY}px)`,
							lineHeight: 1.6,
						}}
					>
						One Solana wallet. Pay-per-token with USDC.
						<br />
						Every model, one proxy.
					</div>
				</div>

				<div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
					{['Solana Auth', 'USDC Pay-per-token', 'x402 Protocol'].map(
						(tag, i) => {
							const tagDelay = 75 + i * 10;
							const tp = spring({
								frame: frame - tagDelay,
								fps,
								config: { damping: 14, stiffness: 200 },
							});
							const ts = interpolate(tp, [0, 1], [0.8, 1]);
							return (
								<div
									key={tag}
									style={{
										opacity: tp * tagProgress,
										transform: `scale(${ts})`,
										padding: '12px 24px',
										borderRadius: 9999,
										background: `${colors.surface}`,
										border: `1px solid ${colors.border}`,
										fontSize: 18,
										fontWeight: 600,
										color: colors.muted,
										boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
									}}
								>
									{tag}
								</div>
							);
						},
					)}
				</div>

				<div
					style={{
						fontSize: 24,
						color: colors.accent,
						fontWeight: 600,
						opacity: urlProgress,
						transform: `translateY(${interpolate(urlProgress, [0, 1], [15, 0])}px)`,
						marginTop: 8,
					}}
				>
					ottorouter.org
				</div>
			</div>
		</AbsoluteFill>
	);
};
