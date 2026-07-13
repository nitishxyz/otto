import { memo } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { OttoMark } from './OttoOIcon';

type StatusType = 'loading' | 'success' | 'error';

interface StatusIndicatorProps {
	status: StatusType;
	label?: string;
	sublabel?: string;
	size?: 'sm' | 'md' | 'lg';
}

const sizeConfig = {
	sm: { ring: 48, icon: 20, iconSize: 16 },
	md: { ring: 72, icon: 32, iconSize: 24 },
	lg: { ring: 96, icon: 40, iconSize: 32 },
};

export const StatusIndicator = memo(function StatusIndicator({
	status,
	label,
	sublabel,
	size = 'md',
}: StatusIndicatorProps) {
	const { ring, icon, iconSize } = sizeConfig[size];

	const ringStyle: React.CSSProperties = {
		position: 'relative',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: ring,
		height: ring,
	};

	const baseRingStyle: React.CSSProperties = {
		content: '""',
		position: 'absolute',
		inset: 0,
		borderRadius: '50%',
	};

	const getBorderColor = () => {
		if (status === 'success') return 'rgb(34, 197, 94)';
		if (status === 'error') return 'rgb(239, 68, 68)';
		return 'currentColor';
	};

	return (
		<div className="flex flex-col items-center justify-center gap-5">
			<div style={ringStyle}>
				<div
					style={{
						...baseRingStyle,
						border: '2px solid hsl(var(--muted))',
					}}
				/>
				{status === 'loading' && (
					<div
						className="animate-spin"
						style={{
							...baseRingStyle,
							border: '2px solid transparent',
							borderTopColor: 'hsl(var(--foreground))',
							animation: 'spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite',
						}}
					/>
				)}
				{status === 'success' && (
					<div
						style={{
							...baseRingStyle,
							border: `2px solid ${getBorderColor()}`,
							opacity: 0.3,
						}}
					/>
				)}
				{status === 'error' && (
					<div
						style={{
							...baseRingStyle,
							border: `2px solid ${getBorderColor()}`,
							opacity: 0.3,
						}}
					/>
				)}
				<div style={{ position: 'relative', zIndex: 1 }}>
					{status === 'loading' && (
						<OttoMark size={icon} className="text-foreground" label="otto" />
					)}
					{status === 'success' && (
						<CheckCircle
							className="text-green-500"
							style={{ width: iconSize, height: iconSize }}
						/>
					)}
					{status === 'error' && (
						<XCircle
							className="text-red-500"
							style={{ width: iconSize, height: iconSize }}
						/>
					)}
				</div>
			</div>
			{label && (
				<div className="flex flex-col items-center gap-1">
					<span className="text-sm font-medium text-foreground">{label}</span>
					{sublabel && (
						<span className="text-xs text-muted-foreground">{sublabel}</span>
					)}
				</div>
			)}
		</div>
	);
});
