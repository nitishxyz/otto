import { useState, useEffect, useRef, useCallback } from 'react';
import { tauri, openUrl } from '../lib/tauri';
import { parseDevPorts } from '../lib/ports';
import { useStore } from '../store';
import {
	Check,
	Circle,
	Loader2,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Square,
	RotateCcw,
	Play,
	Monitor,
} from 'lucide-react';
import { BackButton } from './shared';

const STEPS = [
	'Pulling image',
	'Installing system packages',
	'Setting up SSH',
	'Configuring git',
	'Cloning repo',
	'Starting otto',
];

function currentRunLogs(logText: string): string {
	const lastEntrypoint = logText.lastIndexOf('[1/5]');
	return lastEntrypoint >= 0 ? logText.slice(lastEntrypoint) : logText;
}

function parseStep(runLogs: string): number {
	const CONTAINER_STEPS = 5;
	for (let i = CONTAINER_STEPS - 1; i >= 0; i--) {
		const stepTag = `[${i + 1}/${CONTAINER_STEPS}]`;
		const idx = runLogs.lastIndexOf(stepTag);
		if (idx !== -1) {
			const afterTag = runLogs.slice(idx, idx + 50);
			if (afterTag.includes('Done') || afterTag.includes('Starting')) {
				return Math.min(i + 2, STEPS.length - 1);
			}
			return i + 1;
		}
	}
	return 1;
}

function isOttoReady(runLogs: string): boolean {
	return (
		runLogs.includes('Otto is ready!') ||
		runLogs.includes('Press Ctrl+C to stop') ||
		runLogs.includes('Also accessible at')
	);
}

export function SetupProgress() {
	const project = useStore((s) => s.setupProject);
	const password = useStore((s) => s.setupPassword);
	const encryptedKey = useStore((s) => s.encryptedKeyForSetup());
	const finishSetup = useStore((s) => s.finishSetup);
	const selectedTeam = useStore((s) => s.selectedTeam);
	const setView = useStore((s) => s.setView);

	const [currentStep, setCurrentStep] = useState(0);
	const [logs, setLogs] = useState('');
	const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
	const [error, setError] = useState('');
	const [done, setDone] = useState(false);
	const [containerRunning, setContainerRunning] = useState(false);
	const [settingUp, setSettingUp] = useState(false);
	const [consoleOpen, setConsoleOpen] = useState(true);
	const [hovered, setHovered] = useState(false);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [desktopInstalled, setDesktopInstalled] = useState(false);
	const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	const consoleRef = useRef<HTMLPreElement>(null);
	const startedRef = useRef(false);
	const stoppingRef = useRef(false);
	const graceRef = useRef(false);
	const prevLogsRef = useRef('');
	const repoName =
		project?.repo.split('/').pop()?.replace('.git', '') || 'project';
	const isPersonal = project?.sshMode === 'personal';

	const handleBack = () => {
		setView(selectedTeam ? 'projects' : 'welcome');
	};

	useEffect(() => {
		tauri
			.isDesktopInstalled()
			.then(setDesktopInstalled)
			.catch(() => {});
	}, []);

	const log = useCallback((msg: string) => {
		setConsoleLogs((prev) => [
			...prev,
			`[${new Date().toLocaleTimeString()}] ${msg}`,
		]);
	}, []);

	const startPolling = useCallback(() => {
		if (pollRef.current) clearInterval(pollRef.current);
		pollRef.current = setInterval(async () => {
			try {
				const logText = await tauri.containerLogs(project?.containerName, 100);
				setLogs(logText);

				const running = await tauri.containerRunning(project?.containerName);
				setContainerRunning(running);

				const runLogs = currentRunLogs(logText);

				if (running) {
					graceRef.current = false;
					setError('');
					setCurrentStep(parseStep(runLogs));

					if (isOttoReady(runLogs) && !done) {
						setDone(true);
						if (!consoleLogs.some((l) => l.includes('Otto is ready'))) {
							log('Otto is ready!');
						}
					}
					return;
				}

				setDone(false);

				if (stoppingRef.current || graceRef.current) {
					return;
				}

				const failMsg = runLogs.includes('Permission denied')
					? 'SSH authentication failed — key may be passphrase-protected'
					: runLogs.includes('fatal:')
						? 'Git clone failed — check SSH key and repo access'
						: 'Container exited unexpectedly';
				setError(failMsg);
				log(`FATAL: ${failMsg}`);
				if (pollRef.current) clearInterval(pollRef.current);
			} catch (err) {
				log(`Log poll: ${err instanceof Error ? err.message : err}`);
			}
		}, 2000);
	}, [project?.containerName, log, consoleLogs, done]);

	useEffect(() => {
		if (hovered) return;
		if (!consoleRef.current) return;
		const currentLogs = consoleLogs.join('\n') + logs;
		if (currentLogs !== prevLogsRef.current) {
			prevLogsRef.current = currentLogs;
			consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
		}
	}, [consoleLogs, logs, hovered]);

	useEffect(() => {
		if (startedRef.current) return;
		if (!project) return;
		startedRef.current = true;

		const run = async () => {
			const exists = await tauri.containerExists(project?.containerName);

			if (exists) {
				log(`Connecting to ${repoName}...`);
				const running = await tauri.containerRunning(project?.containerName);
				setContainerRunning(running);

				if (running) {
					const logText = await tauri.containerLogs(
						project?.containerName,
						100,
					);
					const runLogs = currentRunLogs(logText);
					const ready = isOttoReady(runLogs);
					setDone(ready);
					setCurrentStep(ready ? STEPS.length - 1 : parseStep(runLogs));
					log(ready ? 'Otto is ready' : 'Container is starting...');
				} else {
					log('Container is stopped');
				}
				startPolling();
				return;
			}

			log(`Starting setup for ${repoName}...`);
			log(`Container: ${project?.containerName}`);
			log(`Ports: API=${project?.apiPort} Web=${project?.webPort}`);
			log(
				`SSH mode: ${isPersonal ? 'personal (~/.ssh mounted)' : 'team deploy key'}`,
			);

			try {
				log(`Image: ${project?.image || 'oven/bun:1.4.0-debian'}`);
				log(`Repo: ${project?.repo}`);
				const imageName = project?.image || 'oven/bun:1.4.0-debian';
				setSettingUp(true);
				const hasImage = await tauri.imageExists(imageName);
				if (!hasImage) {
					setCurrentStep(0);
					log(`Pulling ${imageName}...`);
					await tauri.imagePull(imageName);
					log('Image pulled');
				} else {
					log('Image already available');
				}
				setCurrentStep(1);
				log('Creating container...');
				const id = await tauri.containerCreate({
					name: project?.containerName,
					repoUrl: project?.repo,
					repoDir: `/workspace/${repoName}`,
					encryptedKey: isPersonal ? '' : encryptedKey,
					password: isPersonal ? '' : password,
					gitName: project?.gitName || 'Team',
					gitEmail: project?.gitEmail || 'team@otto.dev',
					apiPort: project?.apiPort,
					devPorts: parseDevPorts(project?.devPorts, project?.apiPort),
					image: project?.image || 'oven/bun:1.4.0-debian',
					usePersonalSsh: isPersonal,
					sshKeyName: project?.sshKeyName || '',
					sshPassphrase: project?.sshPassphrase || '',
				});
				log(`Container created: ${id.slice(0, 12)}`);
				log('Polling container logs...');
				setContainerRunning(true);
				setSettingUp(false);
				startPolling();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				setSettingUp(false);
				setError(msg);
				log(`FATAL: ${msg}`);
			}
		};
		run();

		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [
		project,
		password,
		encryptedKey,
		repoName,
		isPersonal,
		log,
		startPolling,
	]);

	const handleAction = async (action: string) => {
		setActionLoading(action);
		setError('');
		try {
			switch (action) {
				case 'stop':
					stoppingRef.current = true;
					log('Stopping container...');
					await tauri.containerStop(project?.containerName);
					setContainerRunning(false);
					setDone(false);
					log('Container stopped');
					break;
				case 'start':
					stoppingRef.current = false;
					graceRef.current = false;
					log('Starting container...');
					await tauri.containerStart(project?.containerName);
					setContainerRunning(true);
					setDone(false);
					setCurrentStep(0);
					log('Container started');
					startPolling();
					break;
				case 'restart':
					stoppingRef.current = false;
					graceRef.current = true;
					log('Restarting container...');
					setDone(false);
					setCurrentStep(0);
					await tauri.containerRestartOtto(
						project?.containerName,
						`/workspace/${repoName}`,
						project?.apiPort,
					);
					setContainerRunning(true);
					log('Container restarted, waiting for otto...');
					startPolling();
					break;
				case 'update': {
					log('Updating otto CLI...');
					const result = await tauri.containerUpdateOtto(
						project?.containerName,
					);
					log(`Update: ${result}`);
					break;
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg);
			log(`Error: ${msg}`);
		}
		setActionLoading(null);
	};

	const status = error
		? 'error'
		: done
			? 'running'
			: containerRunning || settingUp
				? 'starting'
				: 'stopped';
	const showSteps = !done && (containerRunning || settingUp);

	if (!project) return null;

	return (
		<div className="flex flex-col h-[calc(100vh-2.5rem)]">
			<div className="flex-1 overflow-auto px-4 pb-4 space-y-4">
				<BackButton onClick={handleBack} />

				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div
							className={`w-2 h-2 rounded-full ${containerRunning ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
						/>
						<span className="text-sm font-medium">{repoName}</span>
					</div>
					<span className="text-xs text-muted-foreground">
						:{project?.webPort}
					</span>
				</div>

				{showSteps && (
					<div className="space-y-2">
						{STEPS.map((step, i) => (
							<div key={step} className="flex items-center gap-2">
								{i < currentStep ? (
									<Check size={14} className="text-green-500" />
								) : i === currentStep && status !== 'error' ? (
									<Loader2
										size={14}
										className="text-muted-foreground animate-spin"
									/>
								) : (
									<Circle size={14} className="text-muted-foreground/30" />
								)}
								<span
									className={`text-xs ${
										i <= currentStep
											? 'text-foreground'
											: 'text-muted-foreground/50'
									}`}
								>
									{step}
								</span>
							</div>
						))}
					</div>
				)}

				{error && (
					<div className="text-xs text-destructive p-2 rounded bg-destructive/10 border border-destructive/20">
						{error}
					</div>
				)}

				<div className="space-y-3">
					{done && containerRunning && (
						<div className="text-xs text-green-500">
							Otto is running at http://localhost:{project?.webPort}
						</div>
					)}
					{(containerRunning || settingUp) && !done && (
						<div className="text-xs text-yellow-500">
							Container is starting up...
						</div>
					)}

					<div className="flex flex-wrap gap-2">
						{containerRunning || settingUp ? (
							<>
								<button
									type="button"
									onClick={() =>
										openUrl(`http://localhost:${project?.webPort}`)
									}
									disabled={!done}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
								>
									<ExternalLink size={12} />
									Open Web UI
								</button>
								<button
									type="button"
									onClick={() => handleAction('stop')}
									disabled={!!actionLoading}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-accent transition-colors disabled:opacity-50"
								>
									{actionLoading === 'stop' ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<Square size={12} />
									)}
									Stop
								</button>
								<button
									type="button"
									onClick={() => handleAction('restart')}
									disabled={!!actionLoading}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-accent transition-colors disabled:opacity-50"
								>
									{actionLoading === 'restart' ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<RotateCcw size={12} />
									)}
									Restart
								</button>
								{desktopInstalled && (
									<button
										type="button"
										onClick={() =>
											tauri.openInDesktop(
												`http://localhost:${project?.apiPort}`,
												repoName,
											)
										}
										disabled={!done}
										className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-accent transition-colors disabled:opacity-50"
									>
										<Monitor size={12} />
										Open in Desktop
									</button>
								)}
							</>
						) : (
							<button
								type="button"
								onClick={() => handleAction('start')}
								disabled={!!actionLoading}
								className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
							>
								{actionLoading === 'start' ? (
									<Loader2 size={12} className="animate-spin" />
								) : (
									<Play size={12} />
								)}
								Start
							</button>
						)}
					</div>

					<button
						type="button"
						onClick={finishSetup}
						className="w-full py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary transition-colors"
					>
						Back to Projects
					</button>
				</div>
			</div>

			<div className="border-t border-border">
				<button
					type="button"
					onClick={() => setConsoleOpen(!consoleOpen)}
					className="w-full flex items-center justify-between px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
				>
					<span className="font-mono">Console</span>
					<div className="flex items-center gap-2">
						<span
							className={
								status === 'error'
									? 'text-destructive'
									: status === 'running'
										? 'text-green-500'
										: status === 'starting'
											? 'text-yellow-500'
											: 'text-muted-foreground'
							}
						>
							{status}
						</span>
						{consoleOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
					</div>
				</button>
				{consoleOpen && (
					<pre
						ref={consoleRef}
						onMouseEnter={() => setHovered(true)}
						onMouseLeave={() => setHovered(false)}
						className="px-4 pb-3 text-[10px] leading-4 font-mono text-muted-foreground overflow-auto max-h-36 whitespace-pre-wrap"
					>
						{consoleLogs.map((line, i) => (
							<div
								key={`${i}-${line.slice(0, 20)}`}
								className={
									line.includes('FATAL:') ||
									line.includes('ERROR:') ||
									line.includes('Error:')
										? 'text-destructive'
										: line.includes('ready') || line.includes('running')
											? 'text-green-500'
											: ''
								}
							>
								{line}
							</div>
						))}
						{logs && (
							<>
								<div className="border-t border-border/30 my-1" />
								<div className="text-muted-foreground/60">
									--- container logs ---
								</div>
								{logs}
							</>
						)}
					</pre>
				)}
			</div>
		</div>
	);
}
