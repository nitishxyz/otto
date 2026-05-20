import { useEffect, useRef } from 'react';
import { Sun, Moon, ArrowDownToLine, RotateCw } from 'lucide-react';
import { useServer } from '../hooks/useServer';
import { useUpdate } from '../hooks/useUpdate';
import { usePlatform } from '../hooks/usePlatform';
import { useFullscreen } from '../hooks/useFullscreen';
import { handleTitleBarDrag } from '../utils/title-bar';
import type { Project } from '../lib/tauri-bridge';
import { tauriBridge } from '../lib/tauri-bridge';
import { SetuLoader } from './SetuLoader';
import { useDesktopTheme } from '../App';
import { WindowControls } from './WindowControls';
import { useVersion } from '../hooks/useVersion';
import { DesktopWorkspaceApp } from './workspace/DesktopWorkspaceApp';

function closeActiveWorkspaceOverlay() {
	const event = new CustomEvent('otto:native-back', {
		cancelable: true,
		detail: { handled: false },
	});
	window.dispatchEvent(event);
	return event.defaultPrevented;
}

export function Workspace({
	project,
	onBack,
}: {
	project: Project;
	onBack: () => void;
}) {
	const { server, loading, error, startServer, stopServer } = useServer();
	const startedRef = useRef(false);
	const platform = usePlatform();
	const isFullscreen = useFullscreen();
	const { theme, toggleTheme } = useDesktopTheme();
	const {
		available,
		version,
		downloading,
		downloaded,
		progress,
		downloadUpdate,
		applyUpdate,
		error: updateError,
	} = useUpdate();
	const appVersion = useVersion();
	const isRemote = !!project.remoteUrl;
	const workspaceApiUrl = isRemote
		? project.remoteUrl
		: server
			? `http://localhost:${server.port}`
			: null;

	const handleBack = async () => {
		if (closeActiveWorkspaceOverlay()) return;

		await stopServer();
		onBack();
	};

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;
		if (!isRemote) {
			startServer(project.path);
		}
	}, [project.path, isRemote, startServer]);

	return (
		<div className="h-screen flex flex-col bg-background">
			<div
				className="flex items-center gap-2 px-4 h-12 border-b border-border cursor-default select-none bg-background relative"
				onMouseDown={handleTitleBarDrag}
				data-tauri-drag-region
				role="toolbar"
			>
				<div
					className={`flex items-center gap-2 ${platform === 'macos' && !isFullscreen ? 'ml-20' : ''}`}
				>
					<button
						type="button"
						onClick={handleBack}
						className="w-8 h-8 flex items-center justify-center text-base text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
					>
						←
					</button>
				</div>
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
					<span className="font-medium text-foreground truncate text-base max-w-[40%]">
						{project.name}
					</span>
				</div>
				<div className="flex-1" />
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
				{updateError && (
					<span
						className="text-sm text-red-400 max-w-[200px] truncate"
						title={updateError}
					>
						⚠ {updateError}
					</span>
				)}
				{server && !isRemote && (
					<div className="flex items-center gap-1.5 text-sm">
						<span className="w-2.5 h-2.5 rounded-full bg-green-500" />
						<span className="text-muted-foreground">API {server.port}</span>
						{appVersion && (
							<span className="text-muted-foreground/50">· v{appVersion}</span>
						)}
					</div>
				)}
				{isRemote && (
					<div className="flex items-center gap-1.5 text-sm">
						<span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
						<span className="text-muted-foreground">Remote</span>
					</div>
				)}
				<button
					type="button"
					onClick={toggleTheme}
					className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
					title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
				>
					{theme === 'dark' ? (
						<Sun className="w-4 h-4" />
					) : (
						<Moon className="w-4 h-4" />
					)}
				</button>
				<button
					type="button"
					onClick={() => tauriBridge.createNewWindow()}
					className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
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
				</button>
				{platform === 'linux' && <WindowControls />}
			</div>

			<div className="flex-1 min-h-0 relative bg-background">
				{loading && (
					<div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
						<SetuLoader label="Starting server..." />
					</div>
				)}
				{error && !loading && (
					<div className="h-full flex items-center justify-center">
						<div className="text-center max-w-md">
							<div className="text-destructive mb-4">{error}</div>
							<button
								type="button"
								onClick={() => {
									startedRef.current = false;
									if (!isRemote) {
										startServer(project.path);
									}
								}}
								className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
							>
								Retry
							</button>
						</div>
					</div>
				)}
				{workspaceApiUrl && !error && (
					<DesktopWorkspaceApp
						key={`${workspaceApiUrl}:${project.path}`}
						apiUrl={workspaceApiUrl}
						project={project}
						theme={theme}
						onToggleTheme={toggleTheme}
					/>
				)}
			</div>
		</div>
	);
}
