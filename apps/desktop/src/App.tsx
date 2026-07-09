import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { RouterProvider } from '@tanstack/react-router';
import { tauriBridge, type Project } from './lib/tauri-bridge';
import { tauriOnboarding } from './lib/tauri-onboarding';
import { router } from './router';
import { useNativeDesktopTheme } from './theme';
import './index.css';

function App() {
	const [initialized, setInitialized] = useState(false);
	const [selectedProject, setSelectedProject] = useState<Project | null>(null);
	const { theme, setTheme, toggleTheme } = useNativeDesktopTheme();

	useEffect(() => {
		const init = async () => {
			const initialPath = await tauriBridge.getInitialProject();
			const initialRemote = await tauriBridge.getInitialRemote();
			let nextRoute: '/onboarding' | '/projects' | '/sessions' = '/projects';

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
				tauriBridge.saveRecentProject(nextProject).catch(() => {});
				nextRoute = '/sessions';
			}

			flushSync(() => {
				setSelectedProject(nextProject);
				setInitialized(true);
			});
			await router.navigate({ to: nextRoute, replace: true });
		};

		init();
	}, []);

	const handleSelectProject = (project: Project) => {
		const updatedProject = {
			...project,
			lastOpened: new Date().toISOString(),
		};
		tauriBridge.saveRecentProject(updatedProject).catch(() => {});
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

	return (
		<RouterProvider
			router={router}
			context={{
				initialized,
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
