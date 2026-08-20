import { create } from 'zustand';
import {
	tauri,
	openUrl,
	type TeamState,
	type ProjectState,
	type OttoTeamConfig,
} from './lib/tauri';

export type View =
	| 'loading'
	| 'welcome'
	| 'team-setup'
	| 'projects'
	| 'add-project'
	| 'import'
	| 'password-prompt'
	| 'setup';

interface LauncherStore {
	view: View;
	teams: TeamState[];
	projects: ProjectState[];
	dockerOk: boolean;
	selectedTeam: TeamState | null;
	setupProject: ProjectState | null;
	setupPassword: string;
	importConfig: OttoTeamConfig | null;

	setView: (view: View) => void;
	init: () => Promise<void>;
	persist: () => Promise<void>;
	refreshStatuses: () => Promise<void>;

	addTeam: (team: TeamState) => Promise<void>;
	deleteTeam: (team: TeamState) => Promise<void>;
	selectTeam: (team: TeamState | null) => void;

	addProject: (project: ProjectState) => Promise<void>;
	removeProject: (projectId: string) => Promise<void>;
	updateProjectStatus: (projectId: string, status: string) => void;

	importProject: (
		project: ProjectState,
		password: string,
		config: OttoTeamConfig,
	) => Promise<void>;

	startSetup: (project: ProjectState) => Promise<void>;
	finishSetup: () => Promise<void>;
	setSetupPassword: (password: string) => void;
	setImportConfig: (config: OttoTeamConfig | null) => void;

	handleAction: (projectId: string, action: string) => Promise<void>;

	teamProjects: () => ProjectState[];
	encryptedKeyForSetup: () => string;
}

export const useStore = create<LauncherStore>((set, get) => ({
	view: 'loading',
	teams: [],
	projects: [],
	dockerOk: true,
	selectedTeam: null,
	setupProject: null,
	setupPassword: '',
	importConfig: null,

	setView: (view) => set({ view }),

	persist: async () => {
		const { teams, projects } = get();
		await tauri.saveState({ teams, projects });
	},

	init: async () => {
		const available = await tauri.dockerAvailable();
		set({ dockerOk: available });

		try {
			const state = await tauri.loadState();
			set({ teams: state.teams ?? [], projects: state.projects ?? [] });

			if (state.projects?.length > 0) {
				await get().refreshStatuses();
			}
		} catch {
			// fresh state
		}
		set({ view: 'welcome' });
	},

	refreshStatuses: async () => {
		const { projects } = get();
		const updated = await Promise.all(
			projects.map(async (p) => {
				try {
					const running = await tauri.containerRunning(p.containerName);
					return { ...p, status: running ? 'running' : 'stopped' };
				} catch {
					return { ...p, status: 'stopped' };
				}
			}),
		);
		set({ projects: updated });
	},

	addTeam: async (team) => {
		const { teams, projects } = get();
		const updated = [...teams, team];
		set({ teams: updated, selectedTeam: team, view: 'projects' });
		await tauri.saveState({ teams: updated, projects });
	},

	deleteTeam: async (team) => {
		const { teams, projects } = get();
		const tp = projects.filter((p) => p.teamId === team.id);
		for (const p of tp) {
			try {
				await tauri.containerStop(p.containerName);
			} catch {}
			try {
				await tauri.containerRemove(p.containerName);
			} catch {}
		}
		const remainingTeams = teams.filter((t) => t.id !== team.id);
		const remainingProjects = projects.filter((p) => p.teamId !== team.id);
		set({ teams: remainingTeams, projects: remainingProjects });
		await tauri.saveState({
			teams: remainingTeams,
			projects: remainingProjects,
		});
	},

	selectTeam: (team) => {
		set({ selectedTeam: team, view: team ? 'projects' : 'welcome' });
		get().refreshStatuses();
	},

	addProject: async (project) => {
		const { teams, projects, selectedTeam } = get();
		if (selectedTeam) {
			project.teamId = selectedTeam.id;
		}
		const updated = [...projects, project];
		set({ projects: updated, view: 'projects' });
		await tauri.saveState({ teams, projects: updated });
	},

	removeProject: async (projectId) => {
		const { teams, projects } = get();
		const project = projects.find((p) => p.id === projectId);
		if (project) {
			try {
				await tauri.containerRemove(project.containerName);
			} catch {}
		}
		const remaining = projects.filter((p) => p.id !== projectId);
		set({ projects: remaining });
		await tauri.saveState({ teams, projects: remaining });
	},

	updateProjectStatus: (projectId, status) => {
		const { projects } = get();
		set({
			projects: projects.map((p) =>
				p.id === projectId ? { ...p, status } : p,
			),
		});
	},

	importProject: async (project, password, config) => {
		const { teams, projects } = get();
		let updatedTeams = [...teams];
		let team = teams.find((t) => t.encryptedKey === config.key);
		if (!team) {
			const repoName =
				config.repo.split('/').pop()?.replace('.git', '') || 'imported';
			let publicKey = '';
			try {
				publicKey = await tauri.publicKeyFromEncrypted(config.key, password);
			} catch {}
			team = {
				id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				name: repoName,
				publicKey,
				encryptedKey: config.key,
				gitName: config.gitName,
				gitEmail: config.gitEmail,
			};
			updatedTeams = [...teams, team];
		}
		project.teamId = team.id;
		const updated = [...projects, project];
		set({
			teams: updatedTeams,
			projects: updated,
			selectedTeam: team,
			setupProject: project,
			setupPassword: password,
			view: 'setup',
		});
		await tauri.saveState({ teams: updatedTeams, projects: updated });
	},

	startSetup: async (project) => {
		const exists = await tauri.containerExists(project.containerName);
		if (exists || project.sshMode === 'personal') {
			set({ setupProject: project, setupPassword: '', view: 'setup' });
		} else {
			set({ setupProject: project, view: 'password-prompt' });
		}
	},

	finishSetup: async () => {
		set({ setupProject: null, setupPassword: '' });
		await get().refreshStatuses();
		const { selectedTeam } = get();
		set({ view: selectedTeam ? 'projects' : 'welcome' });
	},

	setSetupPassword: (password) => set({ setupPassword: password }),
	setImportConfig: (config) => set({ importConfig: config }),

	handleAction: async (projectId, action) => {
		const { projects, teams, selectedTeam } = get();
		const project = projects.find((p) => p.id === projectId);
		if (!project) return;

		const team = teams.find((t) => t.id === project.teamId) || selectedTeam;

		switch (action) {
			case 'start': {
				const exists = await tauri.containerExists(project.containerName);
				if (exists) {
					try {
						await tauri.containerStart(project.containerName);
					} catch {}
					set({ setupProject: project, setupPassword: '', view: 'setup' });
				} else {
					await get().startSetup(project);
				}
				return;
			}
			case 'stop':
				try {
					await tauri.containerStop(project.containerName);
				} catch {}
				break;
			case 'restart':
				await tauri.containerRestartOtto(
					project.containerName,
					`/workspace/${project.repo.split('/').pop()?.replace('.git', '')}`,
					project.apiPort,
				);
				break;
			case 'update':
				await tauri.containerUpdateOtto(project.containerName);
				break;
			case 'open':
				openUrl(`http://localhost:${project.webPort}`);
				return;
			case 'manage':
				set({ setupProject: project, view: 'setup' });
				return;
			case 'nuke':
				await get().removeProject(projectId);
				break;
			case 'export': {
				if (!team) return;
				const config = {
					version: 1,
					repo: project.repo,
					key: team.encryptedKey,
					cipher: 'aes-256-cbc-pbkdf2',
					gitName: team.gitName,
					gitEmail: team.gitEmail,
					image: project.image || 'oven/bun:1.4.0-debian',
					devPorts: project.devPorts || 'auto',
				};
				const name =
					project.repo.split('/').pop()?.replace('.git', '') || 'project';
				await tauri.saveOttoFile(config, `${name}.otto`);
				return;
			}
		}
		await get().refreshStatuses();
	},

	teamProjects: () => {
		const { projects, selectedTeam } = get();
		return selectedTeam
			? projects.filter((p) => p.teamId === selectedTeam.id)
			: [];
	},

	encryptedKeyForSetup: () => {
		const { setupProject, teams, selectedTeam } = get();
		if (setupProject?.teamId) {
			return (
				teams.find((t) => t.id === setupProject.teamId)?.encryptedKey || ''
			);
		}
		return selectedTeam?.encryptedKey || '';
	},
}));
