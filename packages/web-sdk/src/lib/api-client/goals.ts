import {
	getSessionGoal as apiGetSessionGoal,
	createSessionGoal as apiCreateSessionGoal,
	updateGoal as apiUpdateGoal,
	addGoalTasks as apiAddGoalTasks,
	updateGoalTask as apiUpdateGoalTask,
	startGoal as apiStartGoal,
	listSessionSubagents as apiListSessionSubagents,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export type GoalTaskStatus =
	| 'pending'
	| 'in_progress'
	| 'done_pending'
	| 'completed'
	| 'blocked'
	| 'cancelled';

export type GoalStatus = 'active' | 'completed' | 'abandoned';

export type GoalTask = {
	id: string;
	goalId: string;
	position: number;
	content: string;
	status: GoalTaskStatus;
	note: string | null;
	createdAt: number;
	updatedAt: number;
};

export type Goal = {
	id: string;
	projectPath: string;
	sessionId: string | null;
	title: string;
	status: GoalStatus;
	startedAt: number | null;
	createdAt: number;
	updatedAt: number;
	tasks: GoalTask[];
};

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type Subagent = {
	id: string;
	parentSessionId: string;
	childSessionId: string;
	agent: string;
	task: string;
	status: SubagentStatus;
	summary: string | null;
	reported: boolean;
	createdAt: number;
	updatedAt: number;
};

export const goalsMixin = {
	async getSessionGoal(sessionId: string): Promise<{ goal: Goal | null }> {
		const response = await apiGetSessionGoal({ path: { sessionId } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { goal: Goal | null };
	},

	async createSessionGoal(
		sessionId: string,
		data: { title: string; tasks?: string[] },
	): Promise<{ goal: Goal }> {
		const response = await apiCreateSessionGoal({
			path: { sessionId },
			body: data,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { goal: Goal };
	},

	async updateGoal(
		goalId: string,
		data: { title?: string; status?: GoalStatus },
	): Promise<{ goal: Goal }> {
		const response = await apiUpdateGoal({
			path: { goalId },
			body: data,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { goal: Goal };
	},

	async addGoalTasks(goalId: string, tasks: string[]): Promise<{ goal: Goal }> {
		const response = await apiAddGoalTasks({
			path: { goalId },
			body: { tasks },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { goal: Goal };
	},

	async updateGoalTask(
		goalId: string,
		taskId: string,
		data: {
			content?: string;
			status?: GoalTaskStatus;
			note?: string | null;
		},
	): Promise<{ task: GoalTask }> {
		const response = await apiUpdateGoalTask({
			path: { goalId, taskId },
			body: data,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { task: GoalTask };
	},

	async startGoal(goalId: string): Promise<{ goal: Goal }> {
		const response = await apiStartGoal({ path: { goalId } });
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { goal: Goal };
	},

	async listSessionSubagents(
		sessionId: string,
		status?: SubagentStatus,
	): Promise<{ subagents: Subagent[] }> {
		const response = await apiListSessionSubagents({
			path: { sessionId },
			query: status ? { status } : undefined,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		return response.data as unknown as { subagents: Subagent[] };
	},
};
