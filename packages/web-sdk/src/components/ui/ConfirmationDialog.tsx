import { useCallback } from 'react';
import { useConfirmationStore } from '../../stores/confirmationStore';
import { X, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ConfirmationDialog() {
	const isOpen = useConfirmationStore((state) => state.isOpen);
	return isOpen ? <ConfirmationDialogContent /> : null;
}

function ConfirmationDialogContent() {
	const {
		title,
		message,
		confirmLabel,
		cancelLabel,
		variant,
		onConfirm,
		onCancel,
		closeConfirmation,
	} = useConfirmationStore();

	const [isProcessing, setIsProcessing] = useState(false);

	const handleConfirm = useCallback(async () => {
		setIsProcessing(true);
		try {
			await onConfirm();
			closeConfirmation();
		} catch (error) {
			console.error('Confirmation action failed:', error);
			setIsProcessing(false);
		}
	}, [onConfirm, closeConfirmation]);

	const handleCancel = useCallback(() => {
		onCancel?.();
		closeConfirmation();
	}, [onCancel, closeConfirmation]);

	const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if (e.target === e.currentTarget && !isProcessing) {
			handleCancel();
		}
	};

	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (!isProcessing) {
				const target = e.target as HTMLElement;
				const isInInput =
					target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.isContentEditable;
				if (e.key === 'Escape' || (e.key === 'q' && !isInInput)) {
					e.preventDefault();
					handleCancel();
				}
				if (e.key === 'Enter') {
					e.preventDefault();
					handleConfirm();
				}
			}
		};

		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, [isProcessing, handleConfirm, handleCancel]);

	return (
		<div
			role="dialog"
			aria-modal="true"
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10050]"
			onClick={handleBackdropClick}
			onKeyDown={(e) => {
				const target = e.target as HTMLElement;
				const isInInput =
					target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.isContentEditable;
				if (
					(e.key === 'Escape' || (e.key === 'q' && !isInInput)) &&
					!isProcessing
				) {
					e.preventDefault();
					handleCancel();
				}
			}}
		>
			<div className="bg-background border border-border rounded-lg shadow-lg max-w-md w-full mx-4">
				<div className="flex items-center justify-between p-4 border-b border-border">
					<div className="flex items-center gap-2">
						{variant === 'destructive' && (
							<AlertCircle className="w-5 h-5 text-destructive" />
						)}
						<h2 className="text-lg font-semibold">{title}</h2>
					</div>
					<button
						type="button"
						onClick={handleCancel}
						disabled={isProcessing}
						className="p-1 hover:bg-muted rounded transition-colors disabled:opacity-50"
						aria-label="Close"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				<div className="p-4">
					<p className="text-muted-foreground">{message}</p>
				</div>

				<div className="flex items-center justify-end gap-3 p-4 border-t border-border">
					<button
						type="button"
						onClick={handleCancel}
						disabled={isProcessing}
						className="px-4 py-2 text-sm font-medium rounded transition-colors hover:bg-muted disabled:opacity-50"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={handleConfirm}
						disabled={isProcessing}
						className={`px-4 py-2 text-sm font-medium rounded transition-colors disabled:opacity-50 ${
							variant === 'destructive'
								? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
								: 'bg-primary text-primary-foreground hover:bg-primary/90'
						}`}
					>
						{isProcessing ? 'Processing...' : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
