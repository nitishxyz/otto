import { memo } from 'react';
import { ArrowDownToLine, RotateCw } from 'lucide-react';
import {
	TitleBar,
	TitleBarButton,
	TitleBarRightRailToggle,
} from '@ottocode/web-sdk/components';
import { useUpdate } from '../../hooks/useUpdate';
import { usePlatform } from '../../hooks/usePlatform';
import { useFullscreen } from '../../hooks/useFullscreen';

import { handleTitleBarDrag } from '../../utils/title-bar';
import { tauriBridge } from '../../lib/tauri-bridge';
import { WindowControls } from '../WindowControls';

interface DesktopTitleBarProps {
	projectName: string;
	onBack: () => void | Promise<void>;
	isRemote: boolean;
	/** Machine/host name for the remote badge; falls back to "Remote". */
	remoteLabel?: string;
}

/**
 * Desktop app title bar: shared TitleBar composition (sidebar toggle,
 * right-rail toggle) plus desktop-specific content —
 * back button, update controls, and new-window button. Acts as the native
 * drag region.
 */
export const DesktopTitleBar = memo(function DesktopTitleBar({
	projectName,
	onBack,
	isRemote,
	remoteLabel,
}: DesktopTitleBarProps) {
	const platform = usePlatform();
	const isFullscreen = useFullscreen();
	const {
		available,
		version,
		downloading,
		downloaded,
		progress,
		downloadUpdate,
		applyUpdate,
	} = useUpdate();

	return (
		<TitleBar
			onMouseDown={handleTitleBarDrag}
			dragRegion
			leadingInset={platform === 'macos' && !isFullscreen}
			onBack={onBack}
			title={projectName}
			trailing={
				<>
					{available &&
						(downloaded ? (
							<button
								type="button"
								onClick={applyUpdate}
								className="h-7 px-3 flex items-center gap-1.5 text-sm font-medium bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors"
								title={`Restart to update to v${version}`}
							>
								<RotateCw className="w-4 h-4" />
								Restart
							</button>
						) : (
							<button
								type="button"
								onClick={downloadUpdate}
								disabled={downloading}
								className="h-7 px-3 flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-full hover:bg-blue-500 transition-colors disabled:opacity-60"
								title={`Update to v${version}`}
							>
								<ArrowDownToLine className="w-4 h-4" />
								{downloading ? `${progress}%` : 'Update'}
							</button>
						))}
					{isRemote && (
						<div className="flex items-center gap-1.5 text-sm">
							<span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
							<span className="text-muted-foreground truncate max-w-[12rem]">
								{remoteLabel?.trim() || 'Remote'}
							</span>
						</div>
					)}
					<TitleBarRightRailToggle />
					<TitleBarButton
						onClick={() => tauriBridge.createNewWindow()}
						title="New Window"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							aria-hidden="true"
						>
							<rect x="1" y="1" width="14" height="14" rx="2" />
							<line x1="8" y1="4.5" x2="8" y2="11.5" />
							<line x1="4.5" y1="8" x2="11.5" y2="8" />
						</svg>
					</TitleBarButton>
					{platform === 'linux' && <WindowControls />}
				</>
			}
		/>
	);
});
