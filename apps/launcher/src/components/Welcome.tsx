import { useState, useCallback, useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { tauri } from '../lib/tauri';
import { useStore } from '../store';
import { KeyRound, Upload, Plus, Trash2 } from 'lucide-react';

export function Welcome() {
	const teams = useStore((s) => s.teams);
	const projects = useStore((s) => s.projects);
	const selectTeam = useStore((s) => s.selectTeam);
	const deleteTeam = useStore((s) => s.deleteTeam);
	const setView = useStore((s) => s.setView);
	const setImportConfig = useStore((s) => s.setImportConfig);
	const refreshStatuses = useStore((s) => s.refreshStatuses);

	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		refreshStatuses();
	}, [refreshStatuses]);

	const [error, setError] = useState('');

	const handleImportFile = useCallback(
		async (content: string) => {
			try {
				const parsed = await tauri.parseTeamConfig(content);
				setError('');
				setImportConfig(parsed);
				setView('import');
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Invalid .otto file');
			}
		},
		[setImportConfig, setView],
	);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		getCurrentWebview()
			.onDragDropEvent(async (event) => {
				if (event.payload.type === 'enter' || event.payload.type === 'over') {
					setDragging(true);
				} else if (event.payload.type === 'leave') {
					setDragging(false);
				} else if (event.payload.type === 'drop') {
					setDragging(false);
					const paths = event.payload.paths;
					const ottoFile = paths.find((p) => p.endsWith('.otto'));
					if (!ottoFile) return;
					try {
						const content = await readTextFile(ottoFile);
						await handleImportFile(content);
					} catch (err) {
						setError(
							err instanceof Error ? err.message : 'Failed to read file',
						);
					}
				}
			})
			.then((fn) => {
				unlisten = fn;
			});
		return () => {
			unlisten?.();
		};
	}, [handleImportFile]);

	const teamProjects = (teamId: string) =>
		projects.filter((p) => p.teamId === teamId);
	const runningCount = (teamId: string) =>
		teamProjects(teamId).filter((p) => p.status === 'running').length;

	return (
		<div className="px-4 pb-4 space-y-4 min-h-[calc(100vh-40px)]">
			<div className="pt-4 text-center space-y-2">
				<div className="flex items-center justify-center">
					<img src="/otto-wordmark.svg" alt="otto" className="h-8 w-auto" />
				</div>
				<div className="text-xs text-muted-foreground">
					Team development environments
				</div>
			</div>

			{teams.length > 0 && (
				<div className="space-y-2">
					<div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
						Teams
					</div>
					{teams.map((team) => {
						const tp = teamProjects(team.id);
						const running = runningCount(team.id);
						return (
							<button
								type="button"
								key={team.id}
								onClick={() => selectTeam(team)}
								className="w-full p-4 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-left space-y-2"
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
											<KeyRound size={16} className="text-primary" />
										</div>
										<div>
											<div className="text-sm font-medium">{team.name}</div>
											<div className="text-xs text-muted-foreground">
												{team.gitName} &lt;{team.gitEmail}&gt;
											</div>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<div className="text-right">
											<div className="text-sm font-medium">{tp.length}</div>
											<div className="text-xs text-muted-foreground">
												{tp.length === 1 ? 'project' : 'projects'}
											</div>
										</div>
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												deleteTeam(team);
											}}
											className="p-1 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
											title="Delete team"
										>
											<Trash2 size={12} />
										</button>
									</div>
								</div>
								{running > 0 && (
									<div className="flex items-center gap-1.5 text-xs text-green-500">
										<div className="w-1.5 h-1.5 rounded-full bg-green-500" />
										{running} running
									</div>
								)}
							</button>
						);
					})}
				</div>
			)}

			<div className="space-y-2">
				<button
					type="button"
					onClick={() => setView('team-setup')}
					className="w-full p-4 border border-border rounded-lg flex items-center gap-3 hover:bg-accent/50 transition-colors text-left"
				>
					<div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
						<Plus size={20} className="text-primary" />
					</div>
					<div>
						<div className="text-sm font-medium">Create Team</div>
						<div className="text-xs text-muted-foreground">
							Generate deploy key and set up team identity
						</div>
					</div>
				</button>

				<div
					className={`w-full p-4 border-2 border-dashed rounded-lg flex items-center gap-3 transition-colors text-left ${
						dragging
							? 'border-primary bg-primary/5'
							: 'border-border hover:border-muted-foreground/40'
					}`}
				>
					<div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
						<Upload size={20} className="text-muted-foreground" />
					</div>
					<div className="flex-1">
						<div className="text-sm font-medium">
							{dragging ? 'Drop .otto file here' : 'Join Team'}
						</div>
						<div className="text-xs text-muted-foreground">
							Drag & drop a .otto file or{' '}
							<label className="text-primary cursor-pointer hover:underline">
								browse
								<input
									type="file"
									accept=".otto"
									onChange={async (e) => {
										const file = e.target.files?.[0];
										if (file) handleImportFile(await file.text());
									}}
									className="hidden"
								/>
							</label>
						</div>
					</div>
				</div>

				{error && <div className="text-xs text-destructive">{error}</div>}
			</div>
		</div>
	);
}
