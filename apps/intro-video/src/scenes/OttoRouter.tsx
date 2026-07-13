import {
	AbsoluteFill,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
	spring,
	Easing,
} from 'remotion';
import { colors, font } from '../theme';

const OttoRouterMark: React.FC<{ size: number; color: string }> = ({
	size,
	color,
}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke={color}
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		style={{ overflow: 'visible' }}
	>
		<circle cx="12" cy="12" r="8" />
		<path d="M12 2v7.5" />
		<path d="m19 5-5.23 5.23" />
		<path d="M22 12h-7.5" />
		<path d="m19 19-5.23-5.23" />
		<path d="M12 14.5V22" />
		<path d="M10.23 13.77 5 19" />
		<path d="M9.5 12H2" />
		<path d="M10.23 10.23 5 5" />
		<circle cx="12" cy="12" r="2.5" />
	</svg>
);

const PROVIDERS = ['Anthropic', 'OpenAI', 'Google', 'DeepSeek'];

export const OttoRouter: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const orbitAngle = interpolate(frame, [0, 300], [0, 360], {
		extrapolateRight: 'extend',
	});

	const markProgress = spring({
		frame: frame - 5,
		fps,
		config: { damping: 12, mass: 1.2, stiffness: 80 },
	});
	const markScale = interpolate(markProgress, [0, 1], [0, 1]);

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
					opacity: markProgress * 0.6,
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
							transform: `scale(${markScale})`,
							opacity: markProgress,
							position: 'relative',
							padding: 8,
						}}
					>
						<OttoRouterMark size={120} color={colors.accent} />
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
