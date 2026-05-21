import { useEffect, useRef, useState } from 'react';
import {
	CheckCircle,
	XCircle,
	Loader2,
	Info,
	ExternalLink,
	X,
} from 'lucide-react';
import {
	useToastStore,
	type Toast,
	type ToastType,
} from '../../stores/toastStore';
import { openUrl } from '../../lib/open-url';

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
		icon: <Loader2 className="size-4 text-muted-foreground animate-spin" />,
		accent: '',
		bar: '',
	},
};

function ToastItem({ toast }: { toast: Toast }) {
	const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
	const [progress, setProgress] = useState(100);
	const removeToast = useToastStore((s) => s.removeToast);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => setPhase('visible'));
		});

		const duration = toast.duration;
		if (duration && duration > 0) {
			const start = Date.now();
			timerRef.current = setInterval(() => {
				const elapsed = Date.now() - start;
				const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
				setProgress(remaining);
				if (remaining <= 0 && timerRef.current) {
					clearInterval(timerRef.current);
				}
			}, 30);
		}

		return () => {
			if (timerRef.current) clearInterval(timerRef.current);
		};
	}, [toast.duration]);

	const handleDismiss = () => {
		setPhase('exit');
		setTimeout(() => removeToast(toast.id), 180);
	};

	const runAction = async () => {
		if (toast.action?.onClick) {
			await toast.action.onClick();
		} else if (toast.action?.href) {
			openUrl(toast.action.href);
		}
	};

	const handleToastClick = async () => {
		if (toast.activateActionOnClick && toast.action) {
			await runAction();
		}
		handleDismiss();
	};

	const style = typeStyles[toast.type];

	const transitionClass =
		phase === 'enter'
			? 'opacity-0 translate-y-2 scale-95'
			: phase === 'exit'
				? 'opacity-0 translate-y-1 scale-95'
				: 'opacity-100 translate-y-0 scale-100';

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
			<div className="flex items-start gap-2.5 px-3 py-2.5">
				<span className="mt-px shrink-0">{style.icon}</span>

				<div className="flex-1 min-w-0">
					<span className="text-[13px] leading-relaxed text-foreground">
						{toast.message}
					</span>
				</div>

				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						handleDismiss();
					}}
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
						onClick={async (e) => {
							e.stopPropagation();
							await runAction();
							handleDismiss();
						}}
						className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors px-2.5 py-1 rounded-md"
					>
						{toast.action.label}
						<ExternalLink className="size-3" />
					</button>
				</div>
			)}

			{Number(toast.duration) > 0 && toast.type !== 'loading' && (
				<div className="h-px w-full bg-border/50">
					<div
						className={`h-full ${style.bar}`}
						style={{
							width: `${progress}%`,
							transition: 'width 80ms linear',
						}}
					/>
				</div>
			)}
		</div>
	);
}

export function Toaster() {
	const toasts = useToastStore((s) => s.toasts);

	if (toasts.length === 0) return null;

	return (
		<div className="fixed bottom-3 right-3 z-[9999] flex flex-col-reverse gap-1.5 w-[340px]">
			{toasts.map((toast) => (
				<ToastItem key={toast.id} toast={toast} />
			))}
		</div>
	);
}
