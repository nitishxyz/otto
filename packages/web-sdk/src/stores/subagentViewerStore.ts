import { create } from 'zustand';

export interface SubagentViewerInstance {
	childSessionId: string;
	agent: string;
	task: string;
	/** Monotonic focus counter used to derive z-order (higher = on top). */
	z: number;
}

export interface SubagentViewerPosition {
	x: number;
	y: number;
}

interface SubagentViewerState {
	/** Open viewers in opening order (stable for default cascade placement). */
	viewers: SubagentViewerInstance[];
	/** Persisted drag positions keyed by child session id (survives close/reopen). */
	positions: Record<string, SubagentViewerPosition>;
	nextZ: number;
	open: (args: { childSessionId: string; agent: string; task: string }) => void;
	close: (childSessionId: string) => void;
	closeAll: () => void;
	bringToFront: (childSessionId: string) => void;
	setPosition: (
		childSessionId: string,
		position: SubagentViewerPosition,
	) => void;
}

export const useSubagentViewerStore = create<SubagentViewerState>(
	(set, get) => ({
		viewers: [],
		positions: {},
		nextZ: 1,

		open: ({ childSessionId, agent, task }) => {
			const { viewers, nextZ } = get();
			const existing = viewers.find(
				(viewer) => viewer.childSessionId === childSessionId,
			);
			if (existing) {
				get().bringToFront(childSessionId);
				return;
			}
			set({
				viewers: [...viewers, { childSessionId, agent, task, z: nextZ }],
				nextZ: nextZ + 1,
			});
		},

		close: (childSessionId) =>
			set((state) => ({
				viewers: state.viewers.filter(
					(viewer) => viewer.childSessionId !== childSessionId,
				),
			})),

		closeAll: () => set({ viewers: [] }),

		bringToFront: (childSessionId) =>
			set((state) => {
				const target = state.viewers.find(
					(viewer) => viewer.childSessionId === childSessionId,
				);
				if (!target) return state;
				const maxZ = Math.max(...state.viewers.map((viewer) => viewer.z));
				if (target.z === maxZ) return state;
				return {
					viewers: state.viewers.map((viewer) =>
						viewer.childSessionId === childSessionId
							? { ...viewer, z: state.nextZ }
							: viewer,
					),
					nextZ: state.nextZ + 1,
				};
			}),

		setPosition: (childSessionId, position) =>
			set((state) => ({
				positions: { ...state.positions, [childSessionId]: position },
			})),
	}),
);
