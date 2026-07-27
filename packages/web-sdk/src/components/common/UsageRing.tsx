import { memo } from 'react';
import { useUsageStore } from '../../stores/usageStore';
import { useProviderUsage } from '../../hooks/useProviderUsage';
import { useAllModels } from '../../hooks/useConfig';
import { useOttoRouterBalance } from '../../hooks/useOttoRouterBalance';
import { Tooltip } from '../ui/Tooltip';

interface UsageRingProps {
	provider: string;
}

const SIZE = 22;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function getColor(percent: number): string {
	if (percent >= 90) return '#ef4444';
	if (percent >= 70) return '#f59e0b';
	return '#3b82f6';
}

export const UsageRing = memo(function UsageRing({ provider }: UsageRingProps) {
	const { data: allModels } = useAllModels();
	const providerAuthType = allModels?.[provider]?.authType;
	useProviderUsage(provider, providerAuthType);
	useOttoRouterBalance(provider === 'ottorouter' ? 'ottorouter' : undefined);

	const openModal = useUsageStore((s) => s.openModal);
	const usage = useUsageStore((s) =>
		provider ? s.usage[provider] : undefined,
	);

	if (!usage) return null;
	const percent = Math.max(
		0,
		Math.min(usage.primaryWindow?.usedPercent ?? 0, 100),
	);
	const windowSeconds = usage.primaryWindow?.windowSeconds ?? 18000;
	const windowLabel = windowSeconds > 1209600 ? 'mo' : '5h';
	const titleLabel = windowSeconds > 1209600 ? 'monthly' : '5h window';
	const dashOffset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
	const color = getColor(percent);
	const label = `Usage: ${Math.round(percent)}% (${titleLabel}) — Click for details`;

	return (
		<Tooltip content={label} side="bottom">
			<button
				type="button"
				onClick={() => openModal(provider)}
				className="relative flex items-center hover:opacity-80 transition-opacity cursor-pointer"
				aria-label={label}
			>
				<svg
					width={SIZE}
					height={SIZE}
					className="-rotate-90"
					aria-hidden="true"
				>
					<circle
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={RADIUS}
						fill="none"
						stroke="hsl(var(--muted))"
						strokeWidth={STROKE}
					/>
					<circle
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={RADIUS}
						fill="none"
						stroke={color}
						strokeWidth={STROKE}
						strokeDasharray={CIRCUMFERENCE}
						strokeDashoffset={dashOffset}
						strokeLinecap="round"
						className="transition-all duration-500"
					/>
				</svg>
				<span
					className="absolute inset-0 flex items-center justify-center rotate-0 font-medium text-muted-foreground"
					style={{ fontSize: 7 }}
				>
					{windowLabel}
				</span>
			</button>
		</Tooltip>
	);
});
