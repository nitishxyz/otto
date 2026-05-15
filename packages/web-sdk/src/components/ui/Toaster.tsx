import { useEffect, useState } from 'react';
import {
	CheckCircle,
	XCircle,
	Loader2,
	CreditCard,
	ExternalLink,
} from 'lucide-react';
import {
	useToastStore,
	type Toast,
	type ToastType,
} from '../../stores/toastStore';
import { openUrl } from '../../lib/open-url';

const icons: Record<ToastType, React.ReactNode> = {
	default: <CreditCard className="h-4 w-4" />,
	success: <CheckCircle className="h-4 w-4 text-green-500" />,
	error: <XCircle className="h-4 w-4 text-red-500" />,
	loading: <Loader2 className="h-4 w-4 animate-spin" />,
};

function ToastItem({ toast }: { toast: Toast }) {
	const [isVisible, setIsVisible] = useState(false);
	const removeToast = useToastStore((s) => s.removeToast);

	useEffect(() => {
		requestAnimationFrame(() => setIsVisible(true));
	}, []);

	const handleDismiss = () => {
		setIsVisible(false);
		setTimeout(() => removeToast(toast.id), 150);
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: toast click-to-dismiss is supplementary
		<div
			className={`
				flex items-center gap-3 px-4 py-3
				bg-card border border-border rounded-lg shadow-lg
				transition-all duration-150 ease-out cursor-pointer
				hover:bg-accent/50
				${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
			`}
			onClick={handleDismiss}
			role="alert"
		>
			{icons[toast.type]}
			<span className="text-sm text-foreground">{toast.message}</span>
			{toast.action && (
				<button
					type="button"
					onClick={async (e) => {
						e.stopPropagation();
						if (toast.action?.onClick) {
							await toast.action.onClick();
						} else if (toast.action?.href) {
							openUrl(toast.action.href);
						}
						handleDismiss();
					}}
					className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline"
				>
					{toast.action.label}
					<ExternalLink className="h-3 w-3" />
				</button>
			)}
		</div>
	);
}

export function Toaster() {
	const toasts = useToastStore((s) => s.toasts);

	if (toasts.length === 0) return null;

	return (
		<div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
			{toasts.map((toast) => (
				<ToastItem key={toast.id} toast={toast} />
			))}
		</div>
	);
}
