import { CheckCircle2, Circle, ArrowRight, XCircle } from 'lucide-react';
import type { RendererProps } from './types';

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface TodoItem {
	step: string;
	status: TodoStatus;
}

interface TodosResult {
	items?: TodoItem[];
	note?: string;
}

function isTodoStatus(status: unknown): status is TodoStatus {
	return (
		status === 'pending' ||
		status === 'in_progress' ||
		status === 'completed' ||
		status === 'cancelled'
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeTodoItems(rawItems: unknown): TodoItem[] | null {
	if (!Array.isArray(rawItems)) return null;
	const items = rawItems.flatMap((item): TodoItem[] => {
		if (typeof item === 'string') {
			const step = item.trim();
			return step ? [{ step, status: 'pending' }] : [];
		}
		const record = asRecord(item);
		if (!record || typeof record.step !== 'string') return [];
		const step = record.step.trim();
		if (!step) return [];
		return [
			{
				step,
				status: isTodoStatus(record.status) ? record.status : 'pending',
			},
		];
	});
	return items.length > 0 ? items : null;
}

function getTodosResult(
	contentJson: RendererProps['contentJson'],
): TodosResult {
	const result = asRecord(contentJson.result);
	const args = asRecord(contentJson.args);
	const sources = [
		{ rawItems: result?.items, note: result?.note },
		{ rawItems: args?.todos, note: args?.note },
	];

	for (const source of sources) {
		const items = normalizeTodoItems(source.rawItems);
		if (items) {
			return {
				items,
				note: typeof source.note === 'string' ? source.note : undefined,
			};
		}
	}

	return { items: [] };
}

export function TodosRenderer({ contentJson }: RendererProps) {
	const result = getTodosResult(contentJson);
	const items = result.items || [];
	const note = result.note;

	return (
		<div className="text-[12px]">
			<div className="bg-blue-500/10 border border-blue-500/30 dark:bg-blue-500/5 dark:border-blue-500/20 rounded-lg p-3 space-y-2">
				{note && (
					<div className="text-blue-700 dark:text-blue-300 text-sm font-medium mb-3">
						{note}
					</div>
				)}
				<div className="space-y-1.5">
					{items.map((item, idx) => (
						<div key={`${item.step}-${idx}`} className="flex items-start gap-2">
							{item.status === 'completed' && (
								<CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300 flex-shrink-0 mt-0.5" />
							)}
							{item.status === 'in_progress' && (
								<ArrowRight className="h-4 w-4 text-blue-700 dark:text-blue-300 flex-shrink-0 mt-0.5 animate-pulse" />
							)}
							{item.status === 'pending' && (
								<Circle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
							)}
							{item.status === 'cancelled' && (
								<XCircle className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
							)}
							<span
								className={`text-sm ${
									item.status === 'completed'
										? 'text-muted-foreground line-through'
										: item.status === 'in_progress'
											? 'text-foreground'
											: item.status === 'cancelled'
												? 'text-muted-foreground/50 line-through'
												: 'text-muted-foreground/80'
								}`}
							>
								{item.step}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
