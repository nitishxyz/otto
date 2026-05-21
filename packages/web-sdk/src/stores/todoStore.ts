import { create } from 'zustand';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
	step: string;
	status: TodoStatus;
}

export interface TodoSnapshot {
	items: TodoItem[];
	note?: string;
	updatedAt: number;
}

interface TodoState {
	todosBySession: Record<string, TodoSnapshot | undefined>;
	setSessionTodos: (
		sessionId: string,
		snapshot: Omit<TodoSnapshot, 'updatedAt'> | null,
	) => void;
	clearSessionTodos: (sessionId: string) => void;
}

export const useTodoStore = create<TodoState>((set) => ({
	todosBySession: {},

	setSessionTodos: (sessionId, snapshot) =>
		set((state) => ({
			todosBySession: {
				...state.todosBySession,
				[sessionId]: snapshot
					? {
							...snapshot,
							updatedAt: Date.now(),
						}
					: undefined,
			},
		})),

	clearSessionTodos: (sessionId) =>
		set((state) => ({
			todosBySession: {
				...state.todosBySession,
				[sessionId]: undefined,
			},
		})),
}));
