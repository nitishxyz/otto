import { memo, useMemo, useState, type ReactNode } from 'react';
import {
	AppWindow,
	FolderDot,
	Globe2,
	Play,
	RefreshCw,
	Search,
	ShieldCheck,
	X,
} from 'lucide-react';
import { useBuildMiniApp, useMiniApps } from '../../hooks/useMiniApps';
import type { MiniAppSummary } from '../../lib/api-client';
import { resolveMiniAppPreviewUrl } from '../../lib/mini-app-preview';
import { useAppsStore } from '../../stores/appsStore';
import { useViewerTabsStore } from '../../stores/viewerTabsStore';
import { Button } from '../ui/Button';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';

function ScopeSection({
	title,
	icon,
	apps,
	onOpen,
	buildingKey,
}: {
	title: string;
	icon: ReactNode;
	apps: MiniAppSummary[];
	onOpen: (app: MiniAppSummary) => void;
	buildingKey: string | null;
}) {
	if (apps.length === 0) return null;
	return (
		<section>
			<div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
				{icon}
				{title}
			</div>
			<div className="space-y-1 px-2">
				{apps.map((app) => {
					const key = `${app.scope}:${app.id}`;
					const isBuilding = buildingKey === key;
					return (
						<button
							type="button"
							key={key}
							onClick={() => onOpen(app)}
							disabled={isBuilding}
							className="group w-full rounded-lg border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-sidebar-border hover:bg-accent disabled:cursor-wait"
						>
							<div className="flex items-start gap-2.5">
								<div className="mt-0.5 rounded-md bg-purple-500/10 p-1.5 text-purple-600 dark:text-purple-300">
									<AppWindow className="h-3.5 w-3.5" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate text-[13px] font-medium text-foreground">
										{app.name}
									</div>
									{app.description && (
										<div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
											{app.description}
										</div>
									)}
									<div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground/80">
										<span>rev {app.revisionId}</span>
										{app.capabilities.length > 0 && (
											<>
												<span>·</span>
												<ShieldCheck className="h-2.5 w-2.5" />
												<span>{app.capabilities.length}</span>
											</>
										)}
									</div>
								</div>
								<div className="mt-1 text-muted-foreground transition-colors group-hover:text-foreground">
									{isBuilding ? (
										<StableSpinner size="xs" title={`Building ${app.name}`} />
									) : (
										<Play className="h-3.5 w-3.5" />
									)}
								</div>
							</div>
						</button>
					);
				})}
			</div>
		</section>
	);
}

export const AppsSidebar = memo(function AppsSidebar() {
	const isExpanded = useAppsStore((state) => state.isExpanded);
	return isExpanded ? <AppsSidebarContent /> : null;
});

const AppsSidebarContent = memo(function AppsSidebarContent() {
	const collapseSidebar = useAppsStore((state) => state.collapseSidebar);
	const [searchQuery, setSearchQuery] = useState('');
	const { data, isLoading, isFetching, refetch, error } = useMiniApps();
	const buildApp = useBuildMiniApp();
	const apps = data?.apps ?? [];
	const filtered = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return apps;
		return apps.filter(
			(app) =>
				app.name.toLowerCase().includes(query) ||
				app.id.toLowerCase().includes(query) ||
				(app.description ?? '').toLowerCase().includes(query),
		);
	}, [apps, searchQuery]);
	const projectApps = filtered.filter((app) => app.scope === 'project');
	const globalApps = filtered.filter((app) => app.scope === 'global');
	const buildingKey = buildApp.variables
		? `${buildApp.variables.scope}:${buildApp.variables.appId}`
		: null;

	const openApp = (app: MiniAppSummary) => {
		buildApp.mutate(
			{ scope: app.scope, appId: app.id },
			{
				onSuccess: (result) => {
					const url = resolveMiniAppPreviewUrl(result.previewPath);
					if (!url) return;
					useViewerTabsStore.getState().openMiniAppTab({
						appId: result.app.id,
						title: result.app.name,
						url,
						revisionId: result.app.revisionId,
					});
				},
			},
		);
	};

	return (
		<div className="flex h-full w-full min-w-80 flex-col border-l border-sidebar-border sidebar-fade-in">
			<SidebarHeader
				icon={<AppWindow className="size-[15px]" />}
				title="Apps"
				onClose={collapseSidebar}
			/>

			<div className="border-b border-sidebar-border/60 px-2 py-2">
				<div className="relative">
					<Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						type="text"
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="Search apps..."
						className="h-8 w-full rounded-md border border-sidebar-border/60 bg-muted/40 pl-7 pr-7 text-[12px] outline-none placeholder:text-muted-foreground focus:border-foreground/20"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery('')}
							className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Clear app search"
						>
							<X className="h-3 w-3" />
						</button>
					)}
				</div>
			</div>
			{buildApp.error && (
				<div className="border-b border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-300">
					{buildApp.error instanceof Error
						? buildApp.error.message
						: 'Failed to build Mini App'}
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto pb-3">
				{isLoading ? (
					<div className="flex h-full items-center justify-center">
						<StableSpinner title="Loading apps" />
					</div>
				) : error ? (
					<div className="p-4 text-center text-xs text-red-600 dark:text-red-300">
						{error instanceof Error ? error.message : 'Failed to load apps'}
					</div>
				) : apps.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center p-5 text-center">
						<div className="mb-3 rounded-2xl border border-dashed border-sidebar-border p-3">
							<AppWindow className="h-7 w-7 text-muted-foreground/50" />
						</div>
						<h3 className="text-sm font-medium">No saved apps yet</h3>
						<p className="mt-1 max-w-[230px] text-xs leading-5 text-muted-foreground">
							Ask Otto to build a reusable Mini App, or save one under{' '}
							<code className="rounded bg-muted px-1 text-[10px]">
								.otto/apps
							</code>
							.
						</p>
					</div>
				) : filtered.length === 0 ? (
					<div className="p-5 text-center text-xs text-muted-foreground">
						No apps match “{searchQuery}”.
					</div>
				) : (
					<>
						<ScopeSection
							title="Project"
							icon={<FolderDot className="h-3 w-3" />}
							apps={projectApps}
							onOpen={openApp}
							buildingKey={buildApp.isPending ? buildingKey : null}
						/>
						<ScopeSection
							title="Global"
							icon={<Globe2 className="h-3 w-3" />}
							apps={globalApps}
							onOpen={openApp}
							buildingKey={buildApp.isPending ? buildingKey : null}
						/>
					</>
				)}
			</div>

			<div className="flex h-12 items-center justify-between gap-2 border-t border-border px-3 text-xs text-muted-foreground">
				<span>
					{apps.length} {apps.length === 1 ? 'app' : 'apps'}
				</span>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => refetch()}
					disabled={isFetching}
					title="Refresh apps"
					className="h-6 w-6"
				>
					{isFetching ? (
						<StableSpinner size="xs" title="Refreshing apps" />
					) : (
						<RefreshCw className="h-3 w-3" />
					)}
				</Button>
			</div>
		</div>
	);
});
