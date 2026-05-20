import { getCurrentWindow } from '@tauri-apps/api/window';
import { useState } from 'react';

export function WindowControls() {
	const [isMaximized, setIsMaximized] = useState(false);
	const win = getCurrentWindow();

	const handleMinimize = () => win.minimize();
	const handleMaximize = async () => {
		const maximized = await win.isMaximized();
		if (maximized) {
			await win.unmaximize();
			setIsMaximized(false);
		} else {
			await win.maximize();
			setIsMaximized(true);
		}
	};
	const handleClose = () => win.close();

	return (
		<div className="flex items-center gap-0 ml-2">
			<button
				type="button"
				onClick={handleMinimize}
				className="w-12 h-12 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
			>
				<svg
					width="12"
					height="1"
					viewBox="0 0 12 1"
					fill="currentColor"
					role="img"
					aria-label="Minimize"
				>
					<rect width="12" height="1" />
				</svg>
			</button>
			<button
				type="button"
				onClick={handleMaximize}
				className="w-12 h-12 flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
			>
				{isMaximized ? (
					<svg
						width="12"
						height="12"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1"
						role="img"
						aria-label="Restore"
					>
						<rect x="2" y="0" width="8" height="8" rx="0.5" />
						<rect x="0" y="2" width="8" height="8" rx="0.5" />
					</svg>
				) : (
					<svg
						width="12"
						height="12"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1"
						role="img"
						aria-label="Maximize"
					>
						<rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
					</svg>
				)}
			</button>
			<button
				type="button"
				onClick={handleClose}
				className="w-12 h-12 flex items-center justify-center text-muted-foreground hover:bg-[#e81123] hover:text-white transition-colors"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 10 10"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.2"
					role="img"
					aria-label="Close"
				>
					<line x1="0" y1="0" x2="10" y2="10" />
					<line x1="10" y1="0" x2="0" y2="10" />
				</svg>
			</button>
		</div>
	);
}
