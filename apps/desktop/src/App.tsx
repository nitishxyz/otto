import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { RouterProvider } from '@tanstack/react-router';
import {
	tauriBridge,
	type MachineBootstrap,
	type Project,
} from './lib/tauri-bridge';
import { tauriOnboarding } from './lib/tauri-onboarding';
import { loadAuthorizedMachineProjects } from './lib/machine-api';
import { configureDesktopSdk, configureMachineSdk } from './lib/sdk-client';
import { router } from './router';
import { useNativeDesktopTheme } from './theme';
import './index.css';

function App() {
	const [initialized, setInitialized] = useState(false);
	const [selectedProject, setSelectedProject] = useState<Project | null>(null);
	const [machine, setMachine] = useState<MachineBootstrap | null>(null);
	const [daemonError, setDaemonError] = useState<string | null>(null);
	const [startupAttempt, setStartupAttempt] = useState(0);
	const { theme, setTheme, toggleTheme } = useNativeDesktopTheme();

	useEffect(() => {
		void startupAttempt;
		const init = async () => {
			setDaemonError(null);
			try {
				const daemon = await tauriBridge.ensureDesktopDaemon();
				configureDesktopSdk(daemon.url, daemon);
			} catch (cause) {
				setDaemonError(
					cause instanceof Error
						? cause.message
						: 'The local Otto daemon did not start.',
				);
				return;
			}
			const machineBootstrap = await tauriBridge.getMachineBootstrap();
			const initialPath = await tauriBridge.getInitialProject();
			const initialRemote = await tauriBridge.getInitialRemote();
			let nextRoute: '/onboarding' | '/projects' | '/sessions' = '/projects';

			if (!machineBootstrap) {
				try {
					const status = await tauriOnboarding.getStatus();
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

	useEffect(() => {
		if (!machine || !selectedProject?.projectId) return;
		const renewOnFocus = async () => {
			try {
				const access = await loadAuthorizedMachineProjects(machine);
				if (access.status !== 'ready') return;
				const project = access.projects.find(
					(candidate) => candidate.id === selectedProject.projectId,
				);
				if (!project) return;
				configureMachineSdk(
					access.apiUrl,
					project.id,
					project.path,
					access.ownerSession,
					access.ownerSessionExpiresAt,
				);
				setSelectedProject((current) =>
					current
						? {
								...current,
								machineOwnerSession: access.ownerSession,
								machineOwnerSessionExpiresAt: access.ownerSessionExpiresAt,
							}
						: current,
				);
			} catch {
				// Existing session remains usable; projects retry surfaces renewal errors.
			}
		};
		window.addEventListener('focus', renewOnFocus);
		return () => window.removeEventListener('focus', renewOnFocus);
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
		setSelectedProject(null);
		await router.navigate({ to: '/projects' });
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
				selectedProject,
				theme,
				setTheme,
				toggleTheme,
				onSelectProject: handleSelectProject,
				onBackToProjects: handleBack,
				onOnboardingComplete: handleOnboardingComplete,
			}}
		/>
	);
}

export default App;
