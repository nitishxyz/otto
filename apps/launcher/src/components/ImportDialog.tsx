import { useState, useCallback, useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
	tauri,
	type ProjectState,
	type OttoTeamConfig,
	type SshKeyInfo,
} from '../lib/tauri';
import { useStore } from '../store';
import { Upload, ArrowLeft, KeyRound, User, Check } from 'lucide-react';

export function ImportDialog() {
	const projects = useStore((s) => s.projects);
	const importProject = useStore((s) => s.importProject);
	const importConfig = useStore((s) => s.importConfig);
	const setImportConfig = useStore((s) => s.setImportConfig);
	const selectedTeam = useStore((s) => s.selectedTeam);
	const setView = useStore((s) => s.setView);

	const [config, setConfig] = useState<OttoTeamConfig | null>(
		importConfig ?? null,
	);
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [verifying, setVerifying] = useState(false);
	const [sshMode, setSshMode] = useState<'team' | 'personal'>('team');
	const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
	const [selectedKey, setSelectedKey] = useState('');
	const [hostGitName, setHostGitName] = useState('');
	const [hostGitEmail, setHostGitEmail] = useState('');
	const [sshPassphrase, setSshPassphrase] = useState('');

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

	const handleCancel = () => {
		setImportConfig(null);
		setView(selectedTeam ? 'projects' : 'welcome');
	};

	const handleFile = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;
			try {
				const content = await file.text();
				const parsed = await tauri.parseTeamConfig(content);
				setConfig(parsed);
				setError('');
			} catch (err) {
				setError(err instanceof Error ? err.message : 'Invalid config file');
			}
		},
		[],
	);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		getCurrentWebview()
			.onDragDropEvent(async (event) => {
				if (event.payload.type === 'drop') {
					const paths = event.payload.paths;
					const ottoFile = paths.find((p) => p.endsWith('.otto'));
					if (!ottoFile) return;
					try {
						const content = await readTextFile(ottoFile);
						const parsed = await tauri.parseTeamConfig(content);
						setConfig(parsed);
						setError('');
					} catch (err) {
						setError(
							err instanceof Error ? err.message : 'Invalid config file',
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
	}, []);

	const handleSubmit = async () => {
		if (!config || (sshMode === 'team' && !password)) return;
		setVerifying(true);
		setError('');

		try {
			if (sshMode === 'team') {
				const valid = await tauri.verifyPassword(config.key, password);
				if (!valid) {
					setError('Wrong password');
					setVerifying(false);
					return;
				}
			}

			const trackedPorts = projects.map((p) => p.apiPort);
			const apiPort = await tauri.findAvailablePort(trackedPorts);
			const repoName =
				config.repo.split('/').pop()?.replace('.git', '') || 'project';

			const project: ProjectState = {
				id: `${repoName}-${apiPort}`,
				repo: config.repo,
				containerName: `otto-${repoName}-${apiPort}`,
				apiPort,
				webPort: apiPort + 1,
				status: 'creating',
				image: config.image || 'oven/bun:1.4.0-debian',
				devPorts: config.devPorts || 'auto',
				gitName:
					sshMode === 'personal'
						? hostGitName || config.gitName
						: config.gitName,
				gitEmail:
					sshMode === 'personal'
						? hostGitEmail || config.gitEmail
						: config.gitEmail,
				sshMode,
				sshKeyName: sshMode === 'personal' ? selectedKey : undefined,
				sshPassphrase: sshMode === 'personal' ? sshPassphrase : undefined,
			};
			await importProject(
				project,
				sshMode === 'personal' ? '' : password,
				config,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Verification failed');
		}
		setVerifying(false);
	};

	return (
		<div className="px-4 pb-4 space-y-4">
			<button
				type="button"
				onClick={handleCancel}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<ArrowLeft size={12} />
				Back
			</button>

			{!config ? (
				<div className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 hover:border-muted-foreground/40 transition-colors">
					<Upload size={24} className="text-muted-foreground" />
					<span className="text-sm text-muted-foreground">
						Drop .otto file here
					</span>
					<label className="px-3 py-1.5 text-xs rounded bg-secondary hover:bg-accent cursor-pointer transition-colors">
						Browse
						<input
							type="file"
							accept=".otto"
							onChange={handleFile}
							className="hidden"
						/>
					</label>
				</div>
			) : (
				<div className="space-y-3">
					<div className="rounded-lg border border-border bg-card p-3 space-y-2">
						<div className="text-sm font-medium">
							{config.repo.split('/').pop()?.replace('.git', '')}
						</div>
						<div className="text-xs text-muted-foreground">{config.repo}</div>
						<div className="text-xs text-muted-foreground">
							{config.gitName} &lt;{config.gitEmail}&gt;
						</div>
					</div>

					<div className="space-y-1.5">
						<span className="text-xs text-muted-foreground">SSH keys</span>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setSshMode('team')}
								className={`flex-1 flex items-center gap-1.5 p-2 rounded-md border text-xs transition-colors ${
									sshMode === 'team'
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-border text-muted-foreground hover:bg-accent/50'
								}`}
							>
								<KeyRound size={12} />
								<span className="font-medium">Team key</span>
							</button>
							<button
								type="button"
								onClick={() => setSshMode('personal')}
								className={`flex-1 flex items-center gap-1.5 p-2 rounded-md border text-xs transition-colors ${
									sshMode === 'personal'
										? 'border-primary bg-primary/5 text-foreground'
										: 'border-border text-muted-foreground hover:bg-accent/50'
								}`}
							>
								<User size={12} />
								<span className="font-medium">My keys</span>
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
												</div>
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
							</div>
						)}

					{sshMode === 'team' && (
						<div className="space-y-1.5">
							<label className="text-xs text-muted-foreground block">
								Team password
								<input
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
									placeholder="Enter team password"
									className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring mt-1.5"
								/>
							</label>
						</div>
					)}

					{error && <div className="text-xs text-destructive">{error}</div>}

					<button
						type="button"
						onClick={handleSubmit}
						disabled={(sshMode === 'team' && !password) || verifying}
						className="w-full py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
					>
						{verifying ? 'Verifying...' : 'Start Setup'}
					</button>
				</div>
			)}
		</div>
	);
}
