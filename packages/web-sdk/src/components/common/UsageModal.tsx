import { memo, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { useUsageStore } from '../../stores/usageStore';
import { ProviderLogo } from './ProviderLogo';
import type { UsageWindow } from '../../types/api';

function formatTimeRemaining(resetsAt: string | null): string {
	if (!resetsAt) return 'Unknown';
	const now = Date.now();
	const reset = new Date(resetsAt).getTime();
	const diff = reset - now;
	if (diff <= 0) return 'Now';
	const days = Math.floor(diff / 86_400_000);
	const hours = Math.floor((diff % 86_400_000) / 3_600_000);
	const minutes = Math.floor((diff % 3_600_000) / 60_000);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function windowLabel(seconds: number): string {
	if (seconds <= 18000) return '5 Hour';
	if (seconds <= 86400) return '24 Hour';
	if (seconds > 1209600) return 'Monthly';
	return '7 Day';
}

function UsageBar({
	label,
	window: w,
}: {
	label: string;
	window: UsageWindow;
}) {
	const percent = Math.min(w.usedPercent, 100);
	const barColor =
		percent >= 90
			? 'bg-red-500'
			: percent >= 70
				? 'bg-amber-500'
				: 'bg-blue-500';

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-sm">
				<span className="text-muted-foreground">{label}</span>
				<div className="flex items-center gap-2">
					<span className="font-medium text-foreground">
						{Math.round(percent)}%
					</span>
					{w.resetsAt && (
						<span className="text-xs text-muted-foreground">
							resets in {formatTimeRemaining(w.resetsAt)}
						</span>
					)}
				</div>
			</div>
			<div className="h-2 rounded-full bg-muted overflow-hidden">
				<div
					className={`h-full rounded-full transition-all duration-500 ${barColor}`}
					style={{ width: `${percent}%` }}
				/>
			</div>
		</div>
	);
}

export const UsageModal = memo(function UsageModal() {
	const isOpen = useUsageStore((s) => s.isModalOpen);
	const provider = useUsageStore((s) => s.modalProvider);
	const closeModal = useUsageStore((s) => s.closeModal);
	const usage = useUsageStore((s) =>
		provider ? s.usage[provider] : undefined,
	);

	const title = useMemo(
		() => (
			<div className="flex items-center gap-2">
				{provider && <ProviderLogo provider={provider} size={20} />}
				<span>Usage & Limits</span>
			</div>
		),
		[provider],
	);

	if (!usage) return null;

	return (
		<Modal isOpen={isOpen} onClose={closeModal} title={title} maxWidth="sm">
			<div className="space-y-5">
				{usage.limitReached && (
					<div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20">
						<span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
						<span className="text-sm text-red-600 dark:text-red-400 font-medium">
							Rate limit reached
						</span>
					</div>
				)}

				{usage.primaryWindow && (
					<UsageBar
						label={`${windowLabel(usage.primaryWindow.windowSeconds)} Usage`}
						window={usage.primaryWindow}
					/>
				)}

				{usage.secondaryWindow && (
					<UsageBar
						label={`${windowLabel(usage.secondaryWindow.windowSeconds)} Usage`}
						window={usage.secondaryWindow}
					/>
				)}

				{usage.sonnetWindow && usage.sonnetWindow.usedPercent > 0 && (
					<UsageBar
						label="Sonnet (7 Day)"
						window={{
							usedPercent: usage.sonnetWindow.usedPercent,
							windowSeconds: 604800,
							resetsAt: usage.sonnetWindow.resetsAt,
						}}
					/>
				)}

				{usage.extraUsage?.is_enabled && (
					<div className="pt-2 border-t border-border space-y-1">
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Extra Credits</span>
							<span className="font-medium text-foreground">
								${usage.extraUsage.used_credits.toFixed(2)} / $
								{usage.extraUsage.monthly_limit}
							</span>
						</div>
					</div>
				)}

				{usage.credits?.has_credits && (
					<div className="pt-2 border-t border-border space-y-1">
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Credits</span>
							<span className="font-medium text-foreground">
								{usage.credits.balance !== null
									? `$${usage.credits.balance.toFixed(2)}`
									: 'Available'}
							</span>
						</div>
					</div>
				)}

				{usage.planType && (
					<div className="pt-2 border-t border-border">
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Plan</span>
							<span className="font-medium text-foreground capitalize">
								{usage.planType}
							</span>
						</div>
					</div>
				)}
			</div>
		</Modal>
	);
});
