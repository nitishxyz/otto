import { useCallback, useState } from 'react';
import { api } from '../api.ts';
import type { GraphNode, MemoryDetailResponse } from '../types.ts';

export interface DetailState {
	id: string;
	data: MemoryDetailResponse | null;
	loading: boolean;
	error: string | null;
}

/** Selected node plus its `/api/memories/:id` detail (topics need no fetch). */
export function useMemoryDetail(lookup: (id: string) => GraphNode | undefined) {
	const [detail, setDetail] = useState<DetailState | null>(null);

	const select = useCallback(
		(id: string | null) => {
			if (!id) {
				setDetail(null);
				return;
			}
			if (lookup(id)?.kind === 'entity') {
				setDetail({ id, data: null, loading: false, error: null });
				return;
			}
			setDetail({ id, data: null, loading: true, error: null });
			api
				.memory(id)
				.then((data) => {
					setDetail((prev) =>
						prev?.id === id ? { id, data, loading: false, error: null } : prev,
					);
				})
				.catch((error: unknown) => {
					setDetail((prev) =>
						prev?.id === id
							? {
									id,
									data: null,
									loading: false,
									error: error instanceof Error ? error.message : 'unavailable',
								}
							: prev,
					);
				});
		},
		[lookup],
	);

	return { detail, select };
}
