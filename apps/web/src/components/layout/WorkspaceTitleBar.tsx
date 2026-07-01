import { memo, useCallback, useEffect } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useWorkspaceTabStore } from '@ottocode/web-sdk/stores';
import {
	OttoTabBar,
	TitleBar,
	TitleBarRightRailToggle,
	type WorkspaceTab,
} from '@ottocode/web-sdk/components';

/**
 * Agents | Otto tabs backed by routes: the active tab reflects the current
 * pathname and switching tabs navigates, so refreshes land on the same
 * workspace. Remembers the last visited session per tab so switching tabs
 * returns to that session instead of the new-session view.
 */
export const RoutedOttoTabs = memo(function RoutedOttoTabs() {
	const navigate = useNavigate();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const activeTab: WorkspaceTab = pathname.startsWith('/otto')
		? 'otto'
		: 'agents';
	const setLastSession = useWorkspaceTabStore((s) => s.setLastSession);

	useEffect(() => {
		const match = pathname.match(/^\/(otto|sessions)\/([^/]+)/);
		if (match?.[2]) {
			setLastSession(match[1] === 'otto' ? 'otto' : 'agents', match[2]);
		}
	}, [pathname, setLastSession]);

	const handleTabChange = useCallback(
		(tab: WorkspaceTab) => {
			const lastSessionId =
				useWorkspaceTabStore.getState().lastSessionByTab[tab];
			if (lastSessionId) {
				navigate({
					to: tab === 'otto' ? '/otto/$sessionId' : '/sessions/$sessionId',
					params: { sessionId: lastSessionId },
				});
				return;
			}
			navigate({ to: tab === 'otto' ? '/otto' : '/sessions' });
		},
		[navigate],
	);

	return (
		<OttoTabBar
			variant="titlebar"
			activeTab={activeTab}
			onTabChange={handleTabChange}
		/>
	);
});

/**
 * Web app title bar: sidebar toggle + Agents | Otto tabs on the left,
 * right rail toggle on the right. Tabs are backed by routes (/sessions vs /otto)
 * so refreshes land on the same workspace.
 */
export const WorkspaceTitleBar = memo(function WorkspaceTitleBar() {
	return (
		<TitleBar
			className="hidden md:flex"
			leading={<RoutedOttoTabs />}
			trailing={
				<div className="flex items-center gap-2">
					<TitleBarRightRailToggle />
				</div>
			}
		/>
	);
});
