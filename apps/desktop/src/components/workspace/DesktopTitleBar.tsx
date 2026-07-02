import { memo, useCallback, useEffect } from 'react';
import { ArrowDownToLine, RotateCw } from 'lucide-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useWorkspaceTabStore } from '@ottocode/web-sdk/stores';
import {
	LooperTabBar,
	TitleBar,
	TitleBarButton,
	TitleBarRightRailToggle,
	type WorkspaceTab,
} from '@ottocode/web-sdk/components';
import { useUpdate } from '../../hooks/useUpdate';
import { usePlatform } from '../../hooks/usePlatform';
import { useFullscreen } from '../../hooks/useFullscreen';

import { handleTitleBarDrag } from '../../utils/title-bar';
import { tauriBridge } from '../../lib/tauri-bridge';
import { WindowControls } from '../WindowControls';

/**
 * Agents | Looper tabs backed by the desktop router (/sessions vs /looper).
 * Must render inside the workspace QueryClientProvider. Remembers the last
 * visited session per tab so switching tabs returns to that session instead
 * of the landing.
 */
const DesktopRoutedLooperTabs = memo(function DesktopRoutedLooperTabs() {
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const activeTab: WorkspaceTab = pathname.startsWith('/looper')
		? 'looper'
		: 'agents';
	const setLastSession = useWorkspaceTabStore((s) => s.setLastSession);

	useEffect(() => {
		const match = pathname.match(/^\/(looper|sessions)\/([^/]+)/);
		if (match?.[2]) {
			setLastSession(match[1] === 'looper' ? 'looper' : 'agents', match[2]);
		}
	}, [pathname, setLastSession]);

	const handleTabChange = useCallback(
		(tab: WorkspaceTab) => {
			const lastSessionId =
				useWorkspaceTabStore.getState().lastSessionByTab[tab];
			if (lastSessionId) {
				navigate({
					to: tab === 'looper' ? '/looper/$sessionId' : '/sessions/$sessionId',
					params: { sessionId: lastSessionId },
				});
				return;
			}
			navigate({ to: tab === 'looper' ? '/looper' : '/sessions' });
		},
		[navigate],
	);

	return (
		<LooperTabBar
			variant="titlebar"
			activeTab={activeTab}
			onTabChange={handleTabChange}
		/>
	);
});

interface DesktopTitleBarProps {
	projectName: string;
	onBack: () => void | Promise<void>;
	isRemote: boolean;
	/** Hide the workspace tabs (e.g. while the server is still starting). */
	showTabs?: boolean;
}

/**
 * Desktop app title bar: shared TitleBar composition (sidebar toggle,
 * Agents | Looper tabs and right-rail toggle) plus desktop-specific content —
 * back button, update controls, and new-window button. Acts as the native
 * drag region.
 */
export const DesktopTitleBar = memo(function DesktopTitleBar({
	projectName,
	onBack,
	isRemote,
	showTabs = true,
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
			leading={showTabs ? <DesktopRoutedLooperTabs /> : undefined}
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
							<span className="text-muted-foreground">Remote</span>
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
