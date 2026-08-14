import type { Message } from '../../types.ts';

export type ActivityTab = 'todos' | 'subagents' | 'shells' | 'terminals';

export type ActivityFocus = 'chat' | 'activity' | 'detail';

export interface ActivityTodo {
	step: string;
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface ActivityTodoSnapshot {
	todos: ActivityTodo[];
	note?: string;
}

export interface ActivitySubagent {
	id: string;
	parentSessionId: string;
	childSessionId: string;
	agent: string;
	task: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	summary: string | null;
	reported: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface ActivityShellJob {
	id: string;
	sessionId: string;
	messageId: string;
	callId?: string;
	command: string;
	cwd: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	detached: boolean;
	output: string;
	exitCode: number | null;
	result: unknown;
	reported: boolean;
	createdAt: number;
	updatedAt: number;
	completedAt: number | null;
}

export interface ActivityTerminal {
	id: string;
	pid: number;
	command: string;
	args: string[];
	cwd: string;
	purpose: string;
	createdBy: 'user' | 'llm';
	title: string;
	status: 'running' | 'exited';
	exitCode?: number;
	createdAt: string | Date;
	uptime: number;
}

export type ActivityDetail =
	| { kind: 'subagent'; id: string }
	| { kind: 'shell'; id: string }
	| { kind: 'terminal'; id: string };

export interface ActivityData {
	todos: ActivityTodoSnapshot | null;
	subagents: ActivitySubagent[];
	shells: ActivityShellJob[];
	terminals: ActivityTerminal[];
	loading: boolean;
	error: string | null;
	refresh: () => void;
}

export interface SubagentDetailData {
	messages: Message[];
	loading: boolean;
	error: string | null;
	hasOlderMessages: boolean;
	isLoadingOlderMessages: boolean;
	loadOlderMessages: () => Promise<boolean>;
}
