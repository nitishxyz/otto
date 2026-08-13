import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { OverlayPortal } from './OverlayPortal';

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title?: string | React.ReactNode;
	children: ReactNode;
	showCloseButton?: boolean;
	closeOnBackdropClick?: boolean;
	closeOnEscape?: boolean;
	maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
	position?: 'fixed' | 'absolute';
}

const maxWidthClasses = {
	sm: 'max-w-sm',
	md: 'max-w-md',
	lg: 'max-w-lg',
	xl: 'max-w-xl',
	'2xl': 'max-w-2xl',
	'3xl': 'max-w-3xl',
	'4xl': 'max-w-4xl',
	'5xl': 'max-w-5xl',
};

export function Modal({
	isOpen,
	onClose,
	title,
	children,
	showCloseButton = true,
	closeOnBackdropClick = true,
	closeOnEscape = true,
	maxWidth = 'md',
	position = 'fixed',
}: ModalProps) {
	useEffect(() => {
		if (!isOpen || !closeOnEscape) return;

		const handleEscape = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;
			if (e.key === 'Escape' || (e.key === 'q' && !isInInput)) {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};

		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, [isOpen, closeOnEscape, onClose]);

	useEffect(() => {
		if (!isOpen) return;

		const handleNativeBack = (event: Event) => {
			const customEvent = event as CustomEvent<{ handled?: boolean }>;
			if (!customEvent.detail || customEvent.detail.handled) return;
			customEvent.detail.handled = true;
			event.preventDefault();
			onClose();
		};

		window.addEventListener('otto:native-back', handleNativeBack);
		return () =>
			window.removeEventListener('otto:native-back', handleNativeBack);
	}, [isOpen, onClose]);

	useEffect(() => {
		if (isOpen) {
			// Prevent body scroll when modal is open
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	}, [isOpen]);

	if (!isOpen) return null;

	const handleBackdropClick = (e: React.MouseEvent<HTMLElement>) => {
		if (closeOnBackdropClick && e.target === e.currentTarget) {
			onClose();
		}
	};

	const overlayPositionClass = position === 'absolute' ? 'absolute' : 'fixed';

	const overlay = (
		<>
			{/* Backdrop */}
			<button
				type="button"
				data-native-overlay-root="true"
				className={`${overlayPositionClass} inset-0 bg-black/50 backdrop-blur-sm z-[9999] cursor-default`}
				onClick={handleBackdropClick}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						handleBackdropClick(
							e as unknown as React.MouseEvent<HTMLDivElement>,
						);
					}
				}}
				aria-label="Close modal"
			/>

			{/* Modal Container */}
			<div
				data-native-overlay-root="true"
				className={`${overlayPositionClass} top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-full ${maxWidthClasses[maxWidth]} max-h-[calc(100dvh-2rem)] px-4 flex`}
			>
				<div className="bg-background border border-border rounded-lg shadow-lg max-h-full w-full flex flex-col overflow-hidden">
					{/* Header */}
					{(title || showCloseButton) && (
						<div className="flex flex-shrink-0 items-center justify-between p-4 border-b border-border">
							{title && (
								<div className="text-lg font-semibold text-foreground">
									{title}
								</div>
							)}
							{showCloseButton && (
								<button
									type="button"
									onClick={onClose}
									className="text-muted-foreground hover:text-foreground transition-colors ml-auto"
									aria-label="Close"
								>
									<X className="h-5 w-5" />
								</button>
							)}
						</div>
					)}

					{/* Content */}
					<div className="p-6 overflow-y-auto">{children}</div>
				</div>
			</div>
		</>
	);

	// `absolute` positioning is opt-in and scoped to the caller's container, so it
	// must stay in place. Viewport overlays are portalled out of the tree to keep
	// them clear of ancestors that establish a containing block (`contain`,
	// `transform`, `filter`, container queries).
	if (position === 'absolute') return overlay;

	return <OverlayPortal>{overlay}</OverlayPortal>;
}
