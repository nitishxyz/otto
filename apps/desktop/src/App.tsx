import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { RouterProvider } from '@tanstack/react-router';
import {
	tauriBridge,
	type CliSelectionInfo,
	type MachineBootstrap,
	type Project,
	type ServerInfo,
} from './lib/tauri-bridge';
import { loadAuthorizedMachineProjects } from './lib/machine-api';
import { configureDesktopSdk, configureMachineSdk } from './lib/sdk-client';
import { router } from './router';
import { useNativeDesktopTheme } from './theme';
import {
	apiClient,
	ownerRenewalDelay,
	renewOwnerSession,
	setOwnerRenewalHandler,
} from '@ottocode/web-sdk/lib';
import { useViewerTabsStore } from '@ottocode/web-sdk/stores';
import './index.css';

function App() {
	const [initialized, setInitialized] = useState(false);
	const [selectedProject, setSelectedProject] = useState<Project | null>(null);
	const [machine, setMachine] = useState<MachineBootstrap | null>(null);
	const [daemon, setDaemon] = useState<ServerInfo | null>(null);
	const [cliSelection, setCliSelection] = useState<CliSelectionInfo | null>(
		null,
	);
	const [daemonError, setDaemonError] = useState<string | null>(null);
	const [startupAttempt, setStartupAttempt] = useState(0);
	const { theme, setTheme, toggleTheme } = useNativeDesktopTheme(
		daemon !== null,
	);
	const ownerExpiryRef = useRef<number | undefined>(undefined);
	ownerExpiryRef.current = selectedProject?.machineOwnerSessionExpiresAt;

	useEffect(() => {
		void startupAttempt;
		const init = async () => {
			setDaemonError(null);
			try {
				const daemonInfo = await tauriBridge.ensureDesktopDaemon();
				configureDesktopSdk(daemonInfo.url, daemonInfo);
				setDaemon(daemonInfo);
			} catch (cause) {
				setDaemonError(
					cause instanceof Error
						? cause.message
						: 'The local Otto daemon did not start.',
				);
				return;
			}
			void tauriBridge
				.getCliSelection()
				.then(setCliSelection)
				.catch(() => {});
			const [machineBootstrap, initialPath, initialRemote] = await Promise.all([
				tauriBridge.getMachineBootstrap(),
				tauriBridge.getInitialProject(),
				tauriBridge.getInitialRemote(),
			]);
			let nextRoute: '/onboarding' | '/projects' | '/sessions' = '/projects';

			if (!machineBootstrap) {
				try {
					const status = await apiClient.getAuthStatus();
					const hasAnyProvider = Object.values(status.providers).some(
						(provider) => provider.configured,
					);

					if (!hasAnyProvider) {
						nextRoute = '/onboarding';
					}
				} catch {
					nextRoute = '/onboarding';
				}
			}

			let nextProject: Project | null = null;

			if (nextRoute !== '/onboarding' && initialRemote) {
				const [remoteUrl, remoteName] = initialRemote;
				nextProject = {
					path: remoteName,
					name: remoteName,
					lastOpened: new Date().toISOString(),
					pinned: false,
					kind: 'remote',
					remoteUrl,
				};
				nextRoute = '/sessions';
			} else if (nextRoute !== '/onboarding' && initialPath) {
				const name = initialPath.split('/').pop() || initialPath;
				nextProject = {
					path: initialPath,
					name,
					lastOpened: new Date().toISOString(),
					pinned: false,
					kind: 'local',
				};
				nextRoute = '/sessions';
			}

			flushSync(() => {
				setMachine(machineBootstrap);
				setSelectedProject(nextProject);
				setInitialized(true);
			});
			await router.navigate({ to: nextRoute, replace: true });
		};

		init();
	}, [startupAttempt]);

	// Report the open project (or picker state) to the Rust window registry so
	// repeated machine-open requests reuse idle pickers instead of focusing a
	// window that is busy with another project.
	useEffect(() => {
		if (!machine) return;
		void tauriBridge
			.setMachineWindowProject(selectedProject?.projectId ?? null)
			.catch(() => {});
	}, [machine, selectedProject?.projectId]);

	useEffect(() => {
		if (!machine || !selectedProject?.projectId) return;
		let timer: number | undefined;
		let cancelled = false;
		let expiresAt = ownerExpiryRef.current;
		let failureCount = 0;
		const schedule = (delay: number) => {
			if (cancelled) return;
			if (timer !== undefined) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				void renewOwnerSession().catch(() => {});
			}, delay);
		};
		const renew = async () => {
			try {
				const access = await loadAuthorizedMachineProjects(machine, true);
				if (access.status !== 'ready') throw new Error(access.message);
				const project = access.projects.find(
					(candidate) => candidate.id === selectedProject.projectId,
				);
				if (!project) throw new Error('Remote project is no longer available.');
				if (cancelled) throw new Error('Owner reconnect was cancelled.');
				configureMachineSdk(
					access.apiUrl,
					project.id,
					project.path,
					access.ownerSession,
					access.ownerSessionExpiresAt,
				);
				expiresAt = access.ownerSessionExpiresAt;
				failureCount = 0;
				setSelectedProject((current) =>
					current?.projectId === project.id
						? {
								...current,
								machineOwnerSession: access.ownerSession,
								machineOwnerSessionExpiresAt: access.ownerSessionExpiresAt,
							}
						: current,
				);
				schedule(ownerRenewalDelay(expiresAt));
				return { token: access.ownerSession, expiresAt };
			} catch (error) {
				if (!cancelled) {
					failureCount += 1;
					schedule(Math.min(5_000 * 2 ** (failureCount - 1), 60_000));
				}
				throw error;
			}
		};
		setOwnerRenewalHandler(renew);
		if (expiresAt) {
			schedule(ownerRenewalDelay(expiresAt));
		}
		const renewOnWake = () => {
			if (expiresAt && ownerRenewalDelay(expiresAt) === 0) {
				void renewOwnerSession().catch(() => {});
			}
		};
		window.addEventListener('focus', renewOnWake);
		window.addEventListener('online', renewOnWake);
		document.addEventListener('visibilitychange', renewOnWake);
		return () => {
			cancelled = true;
			window.removeEventListener('focus', renewOnWake);
			window.removeEventListener('online', renewOnWake);
			document.removeEventListener('visibilitychange', renewOnWake);
			if (timer !== undefined) window.clearTimeout(timer);
			setOwnerRenewalHandler(null);
		};
	}, [machine, selectedProject?.projectId]);

	const handleSelectProject = (project: Project) => {
		const updatedProject = {
			...project,
			lastOpened: new Date().toISOString(),
		};
		if (
			machine &&
			updatedProject.remoteUrl &&
			updatedProject.projectId &&
			updatedProject.machineOwnerSession &&
			updatedProject.machineOwnerSessionExpiresAt
		) {
			configureMachineSdk(
				updatedProject.remoteUrl,
				updatedProject.projectId,
				updatedProject.path,
				updatedProject.machineOwnerSession,
				updatedProject.machineOwnerSessionExpiresAt,
			);
		}
		flushSync(() => {
			setSelectedProject(updatedProject);
		});
		router.navigate({ to: '/sessions' }).catch(() => {});
	};

	const handleBack = async () => {
		useViewerTabsStore.getState().closeAllTabs();
		setSelectedProject(null);
		await router.navigate({ to: '/projects' });
	};

	const handleStartDaemon = async () => {
		const daemonInfo = await tauriBridge.ensureDesktopDaemon();
		configureDesktopSdk(daemonInfo.url, daemonInfo);
		setDaemon(daemonInfo);
	};

	const handleStopDaemon = async () => {
		await tauriBridge.stopDesktopDaemon();
		setDaemon(null);
	};

	const handleRestartDaemon = async () => {
		await tauriBridge.stopDesktopDaemon();
		setDaemon(null);
		await handleStartDaemon();
	};

	const handleUpdateInstalledCli = async () => {
		const selection = await tauriBridge.updateInstalledCli();
		flushSync(() => setCliSelection(selection));
		await router.invalidate();
	};

	const handleOnboardingComplete = () => {
		flushSync(() => {
			setInitialized(true);
		});
		router.navigate({ to: '/projects', replace: true }).catch(() => {});
	};

	if (daemonError) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
				<div className="max-w-sm text-center">
					<p className="text-sm font-medium">Local daemon unavailable</p>
					<p className="mt-2 text-xs text-muted-foreground">{daemonError}</p>
					<button
						type="button"
						onClick={() => setStartupAttempt((attempt) => attempt + 1)}
						className="mt-4 h-8 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	return (
		<RouterProvider
			router={router}
			context={{
				initialized,
				machine,
				daemon,
				cliSelection,
				selectedProject,
				theme,
				setTheme,
				toggleTheme,
				onSelectProject: handleSelectProject,
				onBackToProjects: handleBack,
				onOnboardingComplete: handleOnboardingComplete,
				onStartDaemon: handleStartDaemon,
				onStopDaemon: handleStopDaemon,
				onRestartDaemon: handleRestartDaemon,
				onUpdateInstalledCli: handleUpdateInstalledCli,
			}}
		/>
	);
}

export default App;
