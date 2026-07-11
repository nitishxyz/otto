import {
	FolderGit2,
	Monitor,
	RefreshCw,
	ShieldAlert,
	WifiOff,
} from 'lucide-react';
import { StableSpinner } from '@ottocode/web-sdk/components';
import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '../hooks/usePlatform';
import { loadAuthorizedMachineProjects } from '../lib/machine-api';
import { toConnectedProject } from '../lib/machine-project';
import type {
	MachineBootstrap,
	MachineProjectAccess,
	Project,
} from '../lib/tauri-bridge';
import { DesktopDragRegion } from './DesktopDragRegion';
import { OttoWordmark } from './Icons';
import { WindowControls } from './WindowControls';

export function ConnectedProjectPicker({
	machine,
	onSelectProject,
}: {
	machine: MachineBootstrap;
	onSelectProject: (project: Project) => void;
}) {
	const [access, setAccess] = useState<MachineProjectAccess | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const platform = usePlatform();
	const machineName = machine.name || machine.hostname || 'Otto machine';

	const loadProjects = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setAccess(await loadAuthorizedMachineProjects(machine));
		} catch (cause) {
			setError(String(cause));
		} finally {
			setLoading(false);
		}
	}, [machine]);

	useEffect(() => {
		loadProjects();
	}, [loadProjects]);

	const selectProject = (
		project: Extract<
			MachineProjectAccess,
			{ status: 'ready' }
		>['projects'][number],
		ready: Extract<MachineProjectAccess, { status: 'ready' }>,
	) => {
		onSelectProject(
			toConnectedProject(
				project,
				ready.apiUrl,
				ready.ownerSession,
				ready.ownerSessionExpiresAt,
			),
		);
	};

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
			<DesktopDragRegion className="relative flex h-12 shrink-0 cursor-default select-none items-center border-b border-border/50 px-4">
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<OttoWordmark height={16} className="text-foreground" />
				</div>
				<div className="ml-auto">
					{platform === 'linux' && <WindowControls />}
				</div>
			</DesktopDragRegion>

			<main className="flex flex-1 items-start justify-center overflow-y-auto px-6 pb-12 pt-16">
				<div className="w-full max-w-2xl">
					<div className="mb-8 flex items-center gap-4">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/50 bg-muted/50">
							<Monitor className="h-5 w-5 text-muted-foreground" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
								Connected machine
							</p>
							<h1 className="mt-1 truncate text-xl font-semibold text-foreground">
								{machineName}
							</h1>
							{machine.hostname && machine.name && (
								<p className="mt-0.5 truncate text-sm text-muted-foreground">
									{machine.hostname}
								</p>
							)}
						</div>
						<button
							type="button"
							onClick={loadProjects}
							disabled={loading}
							className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
						>
							{loading ? (
								<StableSpinner size="sm" title="Loading projects" />
							) : (
								<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
							)}
							Retry
						</button>
					</div>

					<div className="overflow-hidden rounded-xl border border-border/50 bg-card/50">
						{loading && (
							<output className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-muted-foreground">
								<StableSpinner
									size="sm"
									title="Authorizing and loading projects"
								/>
								Authorizing and loading projects...
							</output>
						)}
						{!loading && error && (
							<div className="px-6 py-10 text-center">
								<p className="text-sm font-medium text-foreground">
									Projects unavailable
								</p>
								<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
									{error}
								</p>
							</div>
						)}
						{!loading && access?.status === 'offline' && (
							<div className="px-6 py-10 text-center">
								<WifiOff className="mx-auto h-6 w-6 text-muted-foreground" />
								<p className="mt-3 text-sm font-medium text-foreground">
									Machine offline
								</p>
								<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
									{access.message}
								</p>
							</div>
						)}
						{!loading && access?.status === 'unavailable' && (
							<div className="px-6 py-10 text-center">
								<ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" />
								<p className="mt-3 text-sm font-medium text-foreground">
									Secure authorization unavailable
								</p>
								<p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
									{access.message}
								</p>
							</div>
						)}
						{!loading &&
							access?.status === 'ready' &&
							access.projects.length === 0 && (
								<div className="px-5 py-12 text-center text-sm text-muted-foreground">
									No projects are known on this machine.
								</div>
							)}
						{!loading &&
							access?.status === 'ready' &&
							access.projects.map((project, index) => (
								<button
									type="button"
									key={project.id}
									onClick={() => selectProject(project, access)}
									className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${index > 0 ? 'border-t border-border/30' : ''}`}
								>
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
										<FolderGit2 className="h-4 w-4 text-muted-foreground" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium text-foreground">
											{project.name}
										</div>
										<div className="truncate text-xs text-muted-foreground/60">
											{project.path}
										</div>
									</div>
								</button>
							))}
					</div>
				</div>
			</main>
		</div>
	);
}
