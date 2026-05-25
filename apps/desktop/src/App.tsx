import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { RouterProvider } from '@tanstack/react-router';
import { useTheme } from '@ottocode/web-sdk/hooks';
import { tauriBridge, type Project } from './lib/tauri-bridge';
import { tauriOnboarding } from './lib/tauri-onboarding';
import { router } from './router';
import './index.css';

const DEFAULT_FONT_FAMILY = 'IBM Plex Mono';
const DESKTOP_FONT_STORAGE_KEY = 'otto-desktop-font-family';

function applyDesktopFontFamily(fontFamily: string) {
	const trimmed = fontFamily.trim() || DEFAULT_FONT_FAMILY;
	document.documentElement.style.setProperty(
		'--otto-font-family',
		`"${trimmed.replace(/"/g, '\\"')}", "${DEFAULT_FONT_FAMILY}", monospace`,
	);
}

function App() {
	const [initialized, setInitialized] = useState(false);
	const [selectedProject, setSelectedProject] = useState<Project | null>(null);
	const { theme, setTheme, toggleTheme } = useTheme();

	useEffect(() => {
		const storedFontFamily = window.localStorage.getItem(
			DESKTOP_FONT_STORAGE_KEY,
		);
		if (storedFontFamily) {
			applyDesktopFontFamily(storedFontFamily);
		}

		const init = async () => {
			const initialPath = await tauriBridge.getInitialProject();
			const initialRemote = await tauriBridge.getInitialRemote();
			let nextRoute: '/onboarding' | '/projects' | '/sessions' = '/projects';

			try {
				const status = await tauriOnboarding.getStatus();

				if (!status.onboardingComplete) {
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
