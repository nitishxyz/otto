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
import { ConnectedProjectPicker } from './components/ConnectedProjectPicker';
import { ProjectPicker } from './components/ProjectPicker';
import { DesktopSettings } from './components/DesktopSettings';
import { Workspace } from './components/Workspace';
import { OttoRouterLoader } from './components/OttoRouterLoader';
import type { MachineBootstrap, Project, ServerInfo } from './lib/tauri-bridge';
import { DesktopThemeContext, type DesktopThemeContextValue } from './theme';

export interface DesktopRouterContext extends DesktopThemeContextValue {
	initialized: boolean;
	machine: MachineBootstrap | null;
	daemon: ServerInfo | null;
	selectedProject: Project | null;
	onSelectProject: (project: Project) => void;
	onBackToProjects: () => void | Promise<void>;
	onOnboardingComplete: () => void;
	onStartDaemon: () => Promise<void>;
	onStopDaemon: () => Promise<void>;
	onRestartDaemon: () => Promise<void>;
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

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: 'settings',
	component: SettingsRouteComponent,
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

const looperRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: 'looper',
	component: EmptyRouteComponent,
});

const looperSessionDetailRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: 'looper/$sessionId',
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
	settingsRoute,
	workspaceRoute.addChildren([
		sessionsRoute,
		sessionDetailRoute,
		looperRoute,
		looperSessionDetailRoute,
		dashboardRoute,
	]),
]);

const defaultRouterContext: DesktopRouterContext = {
	initialized: false,
	machine: null,
	daemon: null,
	selectedProject: null,
	theme: 'otto-dark',
	setTheme: () => {},
	toggleTheme: () => {},
	onSelectProject: () => {},
	onBackToProjects: () => {},
	onOnboardingComplete: () => {},
	onStartDaemon: async () => {},
	onStopDaemon: async () => {},
	onRestartDaemon: async () => {},
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
			<div
				className="min-h-screen flex items-center justify-center cursor-default select-none"
				data-tauri-drag-region
			>
				<OttoRouterLoader />
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
	const { machine, onSelectProject } = rootRoute.useRouteContext();
	if (machine) {
		return (
			<ConnectedProjectPicker
				machine={machine}
				onSelectProject={onSelectProject}
			/>
		);
	}
	return <ProjectPicker onSelectProject={onSelectProject} />;
}

function SettingsRouteComponent() {
	const { daemon, onStartDaemon, onStopDaemon, onRestartDaemon } =
		rootRoute.useRouteContext();
	return (
		<DesktopSettings
			daemon={daemon}
			onStartDaemon={onStartDaemon}
			onStopDaemon={onStopDaemon}
			onRestartDaemon={onRestartDaemon}
		/>
	);
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
	const isLooperView = matches.some(
		(match) =>
			match.routeId === looperRoute.id ||
			match.routeId === looperSessionDetailRoute.id,
	);
	const sessionId = dashboardOpen
		? (matchedSessionId ?? lastSessionIdRef.current)
		: matchedSessionId;

	useEffect(() => {
		if (matchedSessionId) {
			lastSessionIdRef.current = matchedSessionId;
			return;
		}
		if (!dashboardOpen) {
			lastSessionIdRef.current = undefined;
		}
	}, [matchedSessionId, dashboardOpen]);

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
			view={isLooperView ? 'looper' : 'agents'}
			dashboardOpen={dashboardOpen}
			onCloseDashboard={handleCloseDashboard}
		/>
	);
}

function EmptyRouteComponent() {
	return null;
}
