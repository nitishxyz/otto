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
import { RemoteMachineSettings } from './components/RemoteMachineSettings';
import { Workspace } from './components/Workspace';
import { OttoRouterLoader } from './components/OttoRouterLoader';
import { useStartupMessage } from './hooks/useStartupMessage';
import type {
	CliSelectionInfo,
	MachineBootstrap,
	Project,
	ServerInfo,
	TunnelDevice,
} from './lib/tauri-bridge';
import { DesktopThemeContext, type DesktopThemeContextValue } from './theme';

export interface DesktopRouterContext extends DesktopThemeContextValue {
	initialized: boolean;
	machine: MachineBootstrap | null;
	daemon: ServerInfo | null;
	cliSelection: CliSelectionInfo | null;
	selectedProject: Project | null;
	onSelectProject: (project: Project) => void;
	onSelectMachine: (device: TunnelDevice) => Promise<void>;
	onLeaveMachine: () => Promise<void>;
	onBackToProjects: () => void | Promise<void>;
	onOnboardingComplete: () => void;
	onStartDaemon: () => Promise<void>;
	onStopDaemon: () => Promise<void>;
	onRestartDaemon: () => Promise<void>;
	onUpdateInstalledCli: () => Promise<void>;
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

const machineSettingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: 'machine-settings',
	component: MachineSettingsRouteComponent,
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
	machineSettingsRoute,
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
	cliSelection: null,
	selectedProject: null,
	theme: 'otto-dark',
	setTheme: () => {},
	toggleTheme: () => {},
	onSelectProject: () => {},
	onSelectMachine: async () => {},
	onLeaveMachine: async () => {},
	onBackToProjects: () => {},
	onOnboardingComplete: () => {},
	onStartDaemon: async () => {},
	onStopDaemon: async () => {},
	onRestartDaemon: async () => {},
	onUpdateInstalledCli: async () => {},
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
		return <StartupGate />;
	}

	return (
		<DesktopThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
			<Outlet />
		</DesktopThemeContext.Provider>
	);
}

function StartupGate() {
	const message = useStartupMessage();
	return (
		<div
			className="min-h-screen flex flex-col items-center justify-center gap-5 cursor-default select-none"
			data-tauri-drag-region
		>
			<OttoRouterLoader />
			<span
				aria-hidden="true"
				className="text-xs text-muted-foreground tracking-wide"
			>
				{message}
			</span>
		</div>
	);
}

function OnboardingRouteComponent() {
	const { onOnboardingComplete } = rootRoute.useRouteContext();
	return <NativeOnboarding onComplete={onOnboardingComplete} />;
}

function ProjectsRouteComponent() {
	const { daemon, machine, onSelectProject, onSelectMachine, onLeaveMachine } =
		rootRoute.useRouteContext();
	if (machine && daemon) {
		return (
			<ConnectedProjectPicker
				machine={machine}
				localDaemonUrl={daemon.url}
				onSelectProject={onSelectProject}
				onLeaveMachine={onLeaveMachine}
			/>
		);
	}
	return (
		<ProjectPicker
			onSelectProject={onSelectProject}
			onSelectMachine={onSelectMachine}
		/>
	);
}

function MachineSettingsRouteComponent() {
	const { daemon, machine } = rootRoute.useRouteContext();
	if (!machine || !daemon) return <Navigate to="/projects" replace />;
	return (
		<RemoteMachineSettings machine={machine} localDaemonUrl={daemon.url} />
	);
}

function SettingsRouteComponent() {
	const {
		daemon,
		cliSelection,
		onStartDaemon,
		onStopDaemon,
		onRestartDaemon,
		onUpdateInstalledCli,
	} = rootRoute.useRouteContext();
	return (
		<DesktopSettings
			daemon={daemon}
			cliSelection={cliSelection}
			onStartDaemon={onStartDaemon}
			onStopDaemon={onStopDaemon}
			onRestartDaemon={onRestartDaemon}
			onUpdateInstalledCli={onUpdateInstalledCli}
		/>
	);
}

function WorkspaceRouteComponent() {
	const { selectedProject, machine, onBackToProjects } =
		rootRoute.useRouteContext();
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
			machine={machine}
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
