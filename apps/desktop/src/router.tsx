import { useEffect, useRef } from 'react';
import {
	Navigate,
	Outlet,
	createHashHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	useMatches,
	useNavigate,
} from '@tanstack/react-router';
import { NativeOnboarding } from './components/onboarding/NativeOnboarding';
import { ProjectPicker } from './components/ProjectPicker';
import { Workspace } from './components/Workspace';
import { SetuLoader } from './components/SetuLoader';
import type { Project } from './lib/tauri-bridge';
import { DesktopThemeContext, type DesktopThemeContextValue } from './theme';

export interface DesktopRouterContext extends DesktopThemeContextValue {
	initialized: boolean;
	selectedProject: Project | null;
	onSelectProject: (project: Project) => void;
	onBackToProjects: () => void | Promise<void>;
	onOnboardingComplete: () => void;
}

const rootRoute = createRootRouteWithContext<DesktopRouterContext>()({
	component: RootRouteComponent,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: () => <Navigate to="/projects" replace />,
});

const onboardingRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: 'onboarding',
	component: OnboardingRouteComponent,
});

const projectsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: 'projects',
	component: ProjectsRouteComponent,
});

const workspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: 'workspace',
	component: WorkspaceRouteComponent,
});

const sessionsRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: 'sessions',
	component: EmptyRouteComponent,
});

const sessionDetailRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: 'sessions/$sessionId',
	component: EmptyRouteComponent,
});

const dashboardRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: 'dashboard',
	component: EmptyRouteComponent,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	onboardingRoute,
	projectsRoute,
	workspaceRoute.addChildren([
		sessionsRoute,
		sessionDetailRoute,
		dashboardRoute,
	]),
]);

const defaultRouterContext: DesktopRouterContext = {
	initialized: false,
	selectedProject: null,
	theme: 'dark',
	setTheme: () => {},
	toggleTheme: () => {},
	onSelectProject: () => {},
	onBackToProjects: () => {},
	onOnboardingComplete: () => {},
};

export const router = createRouter({
	routeTree,
	history: createHashHistory(),
	context: defaultRouterContext,
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

function RootRouteComponent() {
	const { initialized, theme, setTheme, toggleTheme } =
		rootRoute.useRouteContext();

	if (!initialized) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<SetuLoader />
			</div>
		);
	}

	return (
		<DesktopThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
			<Outlet />
		</DesktopThemeContext.Provider>
	);
}

function OnboardingRouteComponent() {
	const { onOnboardingComplete } = rootRoute.useRouteContext();
	return <NativeOnboarding onComplete={onOnboardingComplete} />;
}

function ProjectsRouteComponent() {
	const { onSelectProject } = rootRoute.useRouteContext();
	return <ProjectPicker onSelectProject={onSelectProject} />;
}

function WorkspaceRouteComponent() {
	const { selectedProject, onBackToProjects } = rootRoute.useRouteContext();
	const navigate = useNavigate();
	const matches = useMatches();
	const lastSessionIdRef = useRef<string | undefined>(undefined);
	const activeMatch = matches.find((match) => {
		const params = match.params as { sessionId?: unknown };
		return typeof params.sessionId === 'string';
	});
	const activeParams = activeMatch?.params as
		| { sessionId?: unknown }
		| undefined;
	const matchedSessionId =
		typeof activeParams?.sessionId === 'string'
			? activeParams.sessionId
			: undefined;
	const dashboardOpen = matches.some(
		(match) => match.routeId === dashboardRoute.id,
	);
	const sessionId = matchedSessionId ?? lastSessionIdRef.current;

	useEffect(() => {
		if (matchedSessionId) {
			lastSessionIdRef.current = matchedSessionId;
		}
	}, [matchedSessionId]);

	if (!selectedProject) {
		return <Navigate to="/projects" replace />;
	}

	const handleCloseDashboard = () => {
		const nextSessionId = lastSessionIdRef.current;
		if (nextSessionId) {
			navigate({
				to: '/sessions/$sessionId',
				params: { sessionId: nextSessionId },
			});
			return;
		}
		navigate({ to: '/sessions' });
	};

	return (
		<Workspace
			key={selectedProject.path}
			project={selectedProject}
			onBack={onBackToProjects}
			sessionId={sessionId}
			dashboardOpen={dashboardOpen}
			onCloseDashboard={handleCloseDashboard}
		/>
	);
}

function EmptyRouteComponent() {
	return null;
}
