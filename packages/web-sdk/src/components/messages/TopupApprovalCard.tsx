import { memo, useState } from 'react';
import { CreditCard, AlertCircle, X } from 'lucide-react';
import type { PendingTopupApproval } from '../../stores/topupApprovalStore';
import { apiClient } from '../../lib/api-client';
import { toast } from '../../stores/toastStore';
import { useOttoRouterStore } from '../../stores/ottorouterStore';
import { StableSpinner } from '../ui/StableSpinner';

interface TopupApprovalCardProps {
	pendingTopup: PendingTopupApproval;
	onMethodSelected: (method: 'fiat') => void;
	onCancel: () => void;
}

export const TopupApprovalCard = memo(function TopupApprovalCard({
	pendingTopup,
	onMethodSelected,
	onCancel,
}: TopupApprovalCardProps) {
	const [isProcessing, setIsProcessing] = useState(false);
	const [selectedMethod, setSelectedMethod] = useState<'fiat' | null>(null);
	const openTopupModal = useOttoRouterStore((s) => s.openTopupModal);
	const hasGoPlan = useOttoRouterStore((s) => !!s.subscription?.active);

	const handleSelectFiat = async () => {
		setSelectedMethod('fiat');
		// Open modal immediately - don't wait for API
		openTopupModal();
		// Tell server fiat was selected (this will gracefully pause the request)
		apiClient.selectTopupMethod(pendingTopup.sessionId, 'fiat').catch(() => {
			// Ignore errors - the server handles fiat selection gracefully
		});
		onMethodSelected('fiat');
	};

	const handleCancel = async () => {
		setIsProcessing(true);
		try {
			await apiClient.cancelTopup(pendingTopup.sessionId);
			onCancel();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to cancel');
			setIsProcessing(false);
		}
	};

	return (
		<div className="flex flex-col gap-3 py-2">
			<div className="flex items-center gap-2">
				<AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
				<span className="font-medium text-foreground text-sm">
					Insufficient Balance
				</span>
				<span className="text-amber-600 dark:text-amber-400 font-medium text-sm">
					payment required
				</span>
			</div>

			{hasGoPlan && (
				<p className="ml-6 text-xs text-muted-foreground">
					GO credits may not apply to this request. Add balance to continue.
				</p>
			)}

			<div className="ml-6 bg-muted/30 rounded-lg p-3 space-y-2 text-sm">
				<div className="flex justify-between">
					<span className="text-muted-foreground">Request cost</span>
					<span className="font-mono">
						~${pendingTopup.amountUsd.toFixed(4)}
					</span>
				</div>
				<div className="flex justify-between">
					<span className="text-muted-foreground">Current balance</span>
					<span className="font-mono">
						${pendingTopup.currentBalance.toFixed(4)}
					</span>
				</div>
			</div>

			<div className="ml-6 flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={handleCancel}
					disabled={isProcessing}
					title="Cancel request"
					className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
				>
					<X className="w-3 h-3" />
					Cancel
				</button>

				<button
					type="button"
					onClick={handleSelectFiat}
					disabled={isProcessing}
					title="Top up with card (min $5)"
					className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-violet-500 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-50"
				>
					{selectedMethod === 'fiat' && isProcessing ? (
						<StableSpinner size="xs" title="Opening checkout" />
					) : (
						<CreditCard className="w-3 h-3" />
					)}
					Top up with Card
					<span className="text-[10px] opacity-70">(min $5)</span>
				</button>
			</div>

			<p className="ml-6 text-xs text-muted-foreground">
				{selectedMethod === 'fiat'
					? 'Opening checkout...'
					: 'Top up with card to continue your request.'}
			</p>
		</div>
	);
});
