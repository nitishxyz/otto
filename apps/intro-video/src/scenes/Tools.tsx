import {
	AbsoluteFill,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
	spring,
} from 'remotion';
import { colors, font } from '../theme';

const TOOLS = [
	{ name: 'read', category: 'File System', color: colors.accent },
	{ name: 'write', category: 'File System', color: colors.emerald },
	{ name: 'shell', category: 'Shell', color: colors.muted },
	{ name: 'terminal', category: 'Shell', color: colors.muted },
	{ name: 'apply_patch', category: 'Editing', color: colors.purple },
	{ name: 'search', category: 'Search', color: colors.amber },
	{ name: 'glob', category: 'Search', color: colors.amber },
	{ name: 'git_status', category: 'Git', color: '#F97316' },
	{ name: 'git_diff', category: 'Git', color: '#F97316' },
	{ name: 'git_commit', category: 'Git', color: '#F97316' },
	{ name: 'websearch', category: 'Search', color: colors.accent },
	{ name: 'tree', category: 'File System', color: colors.accent },
];

export const Tools: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const titleProgress = spring({
		frame,
		fps,
		config: { damping: 16, mass: 0.8, stiffness: 120 },
		delay: 5,
	});
	const titleY = interpolate(titleProgress, [0, 1], [60, 0]);
	const titleRotate = interpolate(titleProgress, [0, 1], [-3, 0]);

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
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
				}}
			>
				<div
					style={{
						marginBottom: 48,
						textAlign: 'center' as const,
						opacity: titleProgress,
						transform: `translateY(${titleY}px) rotate(${titleRotate}deg)`,
					}}
				>
					<div
						style={{
							fontSize: 22,
							color: colors.dim,
							letterSpacing: '0.25em',
							textTransform: 'uppercase' as const,
							marginBottom: 16,
							fontFamily: font.mono,
							fontWeight: 500,
						}}
					>
						Built-in Tools
					</div>
					<div
						style={{
							fontSize: 72,
							fontWeight: 700,
							color: colors.text,
							letterSpacing: '-0.03em',
						}}
					>
						15+ tools. Zero config.
					</div>
				</div>

				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(4, 1fr)',
						gap: 18,
						maxWidth: 1100,
					}}
				>
					{TOOLS.map((tool, i) => {
						const row = Math.floor(i / 4);
						const col = i % 4;
						const delay = 15 + row * 12 + col * 5;
						const progress = spring({
							frame: frame - delay,
							fps,
							config: { damping: 12, mass: 0.4, stiffness: 280 },
						});
						const scale = interpolate(progress, [0, 1], [0.3, 1]);
						const rotate = interpolate(progress, [0, 1], [15, 0]);

						return (
							<div
								key={tool.name}
								style={{
									background: colors.surface,
									border: `2px solid ${colors.border}`,
									borderRadius: 16,
									padding: '28px 34px',
									display: 'flex',
									flexDirection: 'column',
									gap: 6,
									opacity: progress,
									transform: `scale(${scale}) rotate(${rotate}deg)`,
								}}
							>
								<span
									style={{
										fontSize: 26,
										fontWeight: 700,
										color: colors.text,
										fontFamily: font.mono,
									}}
								>
									{tool.name}
								</span>
								<span
									style={{ fontSize: 18, color: tool.color, fontWeight: 600 }}
								>
									{tool.category}
								</span>
							</div>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};
