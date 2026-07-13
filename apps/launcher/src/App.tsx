import { useEffect } from 'react';
import { useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useStore } from './store';
import { useUpdate } from './hooks/useUpdate';
import { Welcome } from './components/Welcome';
import { TeamSetup } from './components/TeamSetup';
import { ProjectList } from './components/ProjectList';
import { AddProject } from './components/AddProject';
import { ImportDialog } from './components/ImportDialog';
import { PasswordPrompt } from './components/PasswordPrompt';
import { SetupProgress } from './components/SetupProgress';
import { handleTitleBarDrag } from './utils/title-bar';
import { ShipWheel } from 'lucide-react';

function App() {
	const view = useStore((s) => s.view);
	const dockerOk = useStore((s) => s.dockerOk);
	const init = useStore((s) => s.init);

	useEffect(() => {
		init();
	}, [init]);

	const update = useUpdate();
	const [appVersion, setAppVersion] = useState<string | null>(null);
	useEffect(() => {
		getVersion()
			.then(setAppVersion)
			.catch(() => {});
	}, []);

	if (view === 'loading') {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-muted-foreground text-sm">Loading...</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background text-foreground">
			<div
				className="h-10 flex items-center px-4 select-none cursor-default"
				onMouseDown={handleTitleBarDrag}
				data-tauri-drag-region
				role="toolbar"
			>
				<span className="text-xs font-semibold tracking-wider text-muted-foreground flex-1 flex items-center justify-center gap-1.5">
					<ShipWheel size={13} aria-hidden="true" />
					otto launcher
				</span>
				{appVersion && (
					<span className="text-[10px] text-muted-foreground/50">
						v{appVersion}
					</span>
				)}
			</div>

			{update.available && (
				<div className="mx-4 mb-2 p-3 rounded-md bg-primary/10 border border-primary/20 text-sm flex items-center justify-between">
					<span>
						{update.downloaded
							? `Update v${update.version} ready to install`
							: update.downloading
								? `Downloading update v${update.version}... ${update.progress}%`
								: `Update v${update.version} available`}
					</span>
					{update.downloaded ? (
						<button
							type="button"
							className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
							onClick={update.applyUpdate}
						>
							Restart
						</button>
					) : !update.downloading ? (
						<button
							type="button"
							className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
							onClick={update.downloadUpdate}
						>
							Update
						</button>
					) : null}
				</div>
			)}

			{!dockerOk && (
				<div className="mx-4 mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm">
					Docker Engine is not reachable. Make sure Docker Desktop is running
					(or on Windows, enable "Expose daemon on tcp://localhost:2375" in
					Docker Desktop settings, or set the DOCKER_HOST environment variable).
				</div>
			)}

			{view === 'welcome' && <Welcome />}
			{view === 'team-setup' && <TeamSetup />}
			{view === 'projects' && <ProjectList />}
			{view === 'add-project' && <AddProject />}
			{view === 'import' && <ImportDialog />}
			{view === 'password-prompt' && <PasswordPrompt />}
			{view === 'setup' && <SetupProgress />}
		</div>
	);
}

export default App;
