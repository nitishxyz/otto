import { useEffect, useState } from 'react';
import { api } from '../api.ts';

const EMPTY: ReadonlySet<string> = new Set();

/** Debounced `/api/search`; `ids` is null while there is no query. */
export function useSearch(
	query: string,
	projectId: string | null,
): { ids: ReadonlySet<string> | null } {
	const [ids, setIds] = useState<ReadonlySet<string> | null>(null);

	useEffect(() => {
		const q = query.trim();
		if (!q) {
			setIds(null);
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const res = await api.search(
					q,
					projectId ?? undefined,
					controller.signal,
				);
				setIds(new Set((res.nodes ?? []).map((node) => node.id)));
			} catch {
				if (!controller.signal.aborted) setIds(EMPTY);
			}
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query, projectId]);

	return { ids };
}
