import { useState, useEffect } from 'react';
import {
	tauri,
	type ProjectState,
	type OttoTeamConfig,
	type SshKeyInfo,
} from '../lib/tauri';
import { useStore } from '../store';
import { ArrowLeft, Download, Plus, KeyRound, User, Check } from 'lucide-react';

export function AddProject() {
	const selectedTeam = useStore((s) => s.selectedTeam);
	const projects = useStore((s) => s.projects);
	const addProject = useStore((s) => s.addProject);
	const setView = useStore((s) => s.setView);

	const [repoUrl, setRepoUrl] = useState('');
	const [exportAfter, setExportAfter] = useState(true);
	const [sshMode, setSshMode] = useState<'team' | 'personal'>('team');
	const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
	const [selectedKey, setSelectedKey] = useState('');
	const [hostGitName, setHostGitName] = useState('');
	const [hostGitEmail, setHostGitEmail] = useState('');
	const [sshPassphrase, setSshPassphrase] = useState('');
	const [devPorts, setDevPorts] = useState('auto');
	const [showPortConfig, setShowPortConfig] = useState(false);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	const team = selectedTeam;
	const repoName = repoUrl.split('/').pop()?.replace('.git', '') || '';

	useEffect(() => {
		if (sshMode === 'personal') {
			tauri.listSshKeys().then((keys) => {
				setSshKeys(keys);
				if (keys.length > 0 && !selectedKey) {
					setSelectedKey(keys[0].name);
				}
			});
			tauri.getHostGitConfig().then(([name, email]) => {
				if (name) setHostGitName(name);
				if (email) setHostGitEmail(email);
			});
		}
	}, [sshMode, selectedKey]);

	if (!team) return null;

	const handleAdd = async () => {
		if (!repoUrl) {
			setError('Repository URL is required');
			return;
		}
		if (!repoUrl.startsWith('git@')) {
			setError('Use SSH URL format: git@github.com:org/repo.git');
			return;
		}
		if (sshMode === 'personal' && !selectedKey) {
			setError('Select an SSH key');
			return;
		}

		setLoading(true);
		setError('');

		try {
			const trackedPorts = projects.map((p) => p.apiPort);
			const apiPort = await tauri.findAvailablePort(trackedPorts);
			const name = repoUrl.split('/').pop()?.replace('.git', '') || 'project';

			const project: ProjectState = {
				id: `${name}-${apiPort}`,
				repo: repoUrl,
				containerName: `otto-${name}-${apiPort}`,
				apiPort,
				webPort: apiPort + 1,
				status: 'stopped',
				image: 'oven/bun:1.4.0-debian',
				devPorts,
				gitName:
					sshMode === 'personal' ? hostGitName || team.gitName : team.gitName,
				gitEmail:
					sshMode === 'personal'
						? hostGitEmail || team.gitEmail
						: team.gitEmail,
				sshMode,
				sshKeyName: sshMode === 'personal' ? selectedKey : undefined,
				sshPassphrase: sshMode === 'personal' ? sshPassphrase : undefined,
			};

			if (exportAfter && sshMode === 'team') {
				const config: OttoTeamConfig = {
					version: 1,
					repo: repoUrl,
					key: team.encryptedKey,
					cipher: 'aes-256-cbc-pbkdf2',
					gitName: team.gitName,
					gitEmail: team.gitEmail,
					image: project.image ?? '',
					devPorts: project.devPorts ?? '',
				};
				await tauri.saveOttoFile(config, `${name}.otto`);
			}

			await addProject(project);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to add project');
		}
		setLoading(false);
	};

	return (
		<div className="px-4 pb-4 space-y-4">
			<button
				type="button"
				onClick={() => setView('projects')}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<ArrowLeft size={12} />
				Back
			</button>

			<div className="space-y-3">
				<div className="text-sm font-medium">Add Repository</div>
				<div className="text-xs text-muted-foreground">
					Add a repo for {team.name}. Make sure the SSH key has access to this
					repo on GitHub.
				</div>

				<div className="space-y-1.5">
					<label className="text-xs text-muted-foreground block">
						Repository URL (SSH)
						<input
							type="text"
							value={repoUrl}
							onChange={(e) => setRepoUrl(e.target.value)}
							placeholder="git@github.com:org/repo.git"
							className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring mt-1.5"
						/>
					</label>
				</div>

				<div className="space-y-1.5">
					<span className="text-xs text-muted-foreground">SSH keys</span>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => setSshMode('team')}
							className={`flex-1 flex items-center gap-2 p-2.5 rounded-md border text-xs transition-colors ${
								sshMode === 'team'
									? 'border-primary bg-primary/5 text-foreground'
									: 'border-border text-muted-foreground hover:bg-accent/50'
							}`}
						>
							<KeyRound size={14} />
							<div className="text-left">
								<div className="font-medium">Team key</div>
								<div className="text-[10px] text-muted-foreground">
									Encrypted deploy key
								</div>
							</div>
						</button>
						<button
							type="button"
							onClick={() => setSshMode('personal')}
							className={`flex-1 flex items-center gap-2 p-2.5 rounded-md border text-xs transition-colors ${
								sshMode === 'personal'
									? 'border-primary bg-primary/5 text-foreground'
									: 'border-border text-muted-foreground hover:bg-accent/50'
							}`}
						>
							<User size={14} />
							<div className="text-left">
								<div className="font-medium">My keys</div>
								<div className="text-[10px] text-muted-foreground">
									Mount ~/.ssh
								</div>
							</div>
						</button>
					</div>
				</div>

				{sshMode === 'personal' && (
					<div className="space-y-1.5">
						<span className="text-xs text-muted-foreground">Select key</span>
						{sshKeys.length === 0 ? (
							<div className="text-xs text-muted-foreground p-2 rounded bg-secondary">
								No SSH keys found in ~/.ssh/
							</div>
						) : (
							<div className="space-y-1">
								{sshKeys.map((key) => (
									<button
										type="button"
										key={key.name}
										onClick={() => setSelectedKey(key.name)}
										className={`w-full flex items-center gap-2 p-2 rounded-md border text-xs text-left transition-colors ${
											selectedKey === key.name
												? 'border-primary bg-primary/5'
												: 'border-border hover:bg-accent/50'
										}`}
									>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="font-mono font-medium">
													{key.name}
												</span>
												<span className="text-[10px] text-muted-foreground px-1 py-0.5 rounded bg-secondary">
													{key.keyType}
												</span>
												{key.hasPassphrase && (
													<span className="text-[10px] text-yellow-500 px-1 py-0.5 rounded bg-yellow-500/10">
														passphrase
													</span>
												)}
											</div>
											{key.publicKey && (
												<div className="text-[10px] text-muted-foreground truncate mt-0.5">
													{key.publicKey}
												</div>
											)}
										</div>
										{selectedKey === key.name && (
											<Check size={14} className="text-primary shrink-0" />
										)}
									</button>
								))}
							</div>
						)}
					</div>
				)}

				{sshMode === 'personal' &&
					selectedKey &&
					sshKeys.find((k) => k.name === selectedKey)?.hasPassphrase && (
						<div className="space-y-1.5">
							<label className="text-xs text-muted-foreground block">
								Key passphrase
								<input
									type="password"
									value={sshPassphrase}
									onChange={(e) => setSshPassphrase(e.target.value)}
									placeholder="Enter passphrase for this key"
									className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring mt-1.5"
								/>
							</label>
							<div className="text-[10px] text-muted-foreground">
								Passphrase will be used once to unlock the key inside the
								container.
							</div>
						</div>
					)}

				<div className="space-y-1.5">
					<button
						type="button"
						onClick={() => setShowPortConfig(!showPortConfig)}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
					>
						<span>{showPortConfig ? '▾' : '▸'}</span>
						<span>Port forwarding</span>
						<span className="text-[10px] px-1 py-0.5 rounded bg-secondary">
							{devPorts === 'auto' ? 'auto' : 'custom'}
						</span>
					</button>
					{showPortConfig && (
						<div className="space-y-2 pl-3 border-l-2 border-border">
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setDevPorts('auto')}
									className={`px-2 py-1 text-xs rounded-md border transition-colors ${
										devPorts === 'auto'
											? 'border-primary bg-primary/5 text-foreground'
											: 'border-border text-muted-foreground hover:bg-accent/50'
									}`}
								>
									Auto
								</button>
								<button
									type="button"
									onClick={() => {
										if (devPorts === 'auto') {
											setDevPorts('3000, 5173, 8080');
										}
									}}
									className={`px-2 py-1 text-xs rounded-md border transition-colors ${
										devPorts !== 'auto'
											? 'border-primary bg-primary/5 text-foreground'
											: 'border-border text-muted-foreground hover:bg-accent/50'
									}`}
								>
									Custom
								</button>
							</div>
							{devPorts === 'auto' ? (
								<div className="text-[10px] text-muted-foreground">
									10-port dynamic range (apiPort + 10–19). Add specific ports
									via Custom.
								</div>
							) : (
								<>
									<input
										type="text"
										value={devPorts}
										onChange={(e) => setDevPorts(e.target.value)}
										placeholder="3000, 5173, 8080-8090"
										className="w-full px-2 py-1.5 text-xs font-mono rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
									/>
									<div className="text-[10px] text-muted-foreground">
										Comma-separated ports or ranges (e.g. 3000, 5173, 8080-8090)
									</div>
								</>
							)}
						</div>
					)}
				</div>

				{repoName && (
					<div className="rounded-md border border-border bg-card p-3 space-y-1">
						<div className="text-xs text-muted-foreground">Container</div>
						<div className="text-sm font-mono">otto-{repoName}</div>
						<div className="text-xs text-muted-foreground mt-1">SSH</div>
						<div className="text-sm">
							{sshMode === 'personal'
								? selectedKey
									? `~/.ssh/${selectedKey}`
									: 'No key selected'
								: 'Team deploy key'}
						</div>
					</div>
				)}

				{sshMode === 'team' && (
					<label className="flex items-center gap-2 text-sm cursor-pointer">
						<input
							type="checkbox"
							checked={exportAfter}
							onChange={(e) => setExportAfter(e.target.checked)}
							className="rounded border-border"
						/>
						<span className="text-xs text-muted-foreground">
							Export .otto file for team sharing
						</span>
					</label>
				)}

				{error && <div className="text-xs text-destructive">{error}</div>}

				<button
					type="button"
					onClick={handleAdd}
					disabled={
						loading || !repoUrl || (sshMode === 'personal' && !selectedKey)
					}
					className="w-full py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
				>
					{exportAfter && sshMode === 'team' ? (
						<Download size={14} />
					) : (
						<Plus size={14} />
					)}
					{loading
						? 'Adding...'
						: exportAfter && sshMode === 'team'
							? 'Add & Export .otto'
							: 'Add Project'}
				</button>
			</div>
		</div>
	);
}
