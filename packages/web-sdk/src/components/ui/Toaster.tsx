import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, XCircle, Info, ExternalLink, X } from 'lucide-react';
import {
	useToastStore,
	type Toast,
	type ToastType,
} from '../../stores/toastStore';
import { openUrl } from '../../lib/open-url';
import { StableSpinner } from './StableSpinner';

const typeStyles: Record<
	ToastType,
	{ icon: React.ReactNode; accent: string; bar: string }
> = {
	default: {
		icon: <Info className="size-4 text-muted-foreground" />,
		accent: '',
		bar: 'bg-muted-foreground/40',
	},
	success: {
		icon: <CheckCircle className="size-4 text-emerald-400" />,
		accent: 'border-l-emerald-400',
		bar: 'bg-emerald-400/40',
	},
	error: {
		icon: <XCircle className="size-4 text-red-400" />,
		accent: 'border-l-red-400',
		bar: 'bg-red-400/40',
	},
	loading: {
		icon: <StableSpinner className="text-muted-foreground" title="Loading" />,
		accent: '',
		bar: '',
	},
};

const TOAST_PROGRESS_STYLE = `
@keyframes otto-toast-progress {
	from { transform: scaleX(1); }
	to { transform: scaleX(0); }
}
`;

const ToastItem = memo(function ToastItem({ toast }: { toast: Toast }) {
	const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
	const removeToast = useToastStore((s) => s.removeToast);

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			requestAnimationFrame(() => setPhase('visible'));
		});

		return () => cancelAnimationFrame(frame);
	}, []);

	const handleDismiss = useCallback(() => {
		setPhase('exit');
		setTimeout(() => removeToast(toast.id), 180);
	}, [removeToast, toast.id]);

	const runAction = useCallback(async () => {
		if (toast.action?.onClick) {
			await toast.action.onClick();
		} else if (toast.action?.href) {
			openUrl(toast.action.href);
		}
	}, [toast.action]);

	const handleToastClick = useCallback(async () => {
		if (toast.activateActionOnClick && toast.action) {
			await runAction();
		}
		handleDismiss();
	}, [handleDismiss, runAction, toast.action, toast.activateActionOnClick]);

	const handleDismissClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			e.stopPropagation();
			handleDismiss();
		},
		[handleDismiss],
	);

	const handleActionClick = useCallback(
		async (e: React.MouseEvent<HTMLButtonElement>) => {
			e.stopPropagation();
			await runAction();
			handleDismiss();
		},
		[handleDismiss, runAction],
	);

	const style = typeStyles[toast.type];
	const progressStyle = useMemo<React.CSSProperties>(
		() => ({
			animation: `otto-toast-progress ${toast.duration ?? 0}ms linear forwards`,
			transformOrigin: 'left',
		}),
		[toast.duration],
	);

	const transitionClass =
		phase === 'enter'
			? 'opacity-0 translate-y-2 scale-95'
			: phase === 'exit'
				? 'opacity-0 translate-y-1 scale-95'
				: 'opacity-100 translate-y-0 scale-100';
	const rowAlignmentClass =
		toast.type === 'loading' ? 'items-center' : 'items-start';
	const iconOffsetClass = toast.type === 'loading' ? '' : 'mt-px';

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: toast click-to-dismiss
		<div
			className={`
				relative overflow-hidden
				border border-border bg-card
				rounded-r-lg shadow-md
				transition-all duration-180 ease-out
				cursor-pointer group
				${style.accent ? `border-l-2 ${style.accent}` : ''}
				${transitionClass}
			`}
			onClick={handleToastClick}
			role="alert"
		>
			<div className={`flex ${rowAlignmentClass} gap-2.5 px-3 py-2.5`}>
				<span className={`${iconOffsetClass} shrink-0`}>{style.icon}</span>

				<div className="flex-1 min-w-0">
					<span className="text-[13px] leading-relaxed text-foreground">
						{toast.message}
					</span>
				</div>

				<button
					type="button"
					onClick={handleDismissClick}
					className="shrink-0 size-5 inline-flex items-center justify-center rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors opacity-0 group-hover:opacity-100 mt-px"
					aria-label="Dismiss"
				>
					<X className="size-3" />
				</button>
			</div>

			{toast.action && (
				<div className="flex items-center px-3 pb-2.5 pt-0 pl-[34px]">
					<button
						type="button"
						onClick={handleActionClick}
						className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors px-2.5 py-1 rounded-md"
					>
						{toast.action.label}
						<ExternalLink className="size-3" />
					</button>
				</div>
			)}

			{Number(toast.duration) > 0 && toast.type !== 'loading' && (
				<div className="h-px w-full bg-border/50">
					<div className={`h-full w-full ${style.bar}`} style={progressStyle} />
				</div>
			)}
		</div>
	);
});

export function Toaster() {
	const toasts = useToastStore((s) => s.toasts);

	if (toasts.length === 0) return null;

	return (
		<>
			<style>{TOAST_PROGRESS_STYLE}</style>
			<div className="fixed bottom-3 right-3 z-[9999] flex flex-col-reverse gap-1.5 w-[340px]">
				{toasts.map((toast) => (
					<ToastItem key={toast.id} toast={toast} />
				))}
			</div>
		</>
	);
}
