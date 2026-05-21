import { memo, useMemo, useState } from 'react';
import {
	ArrowRight,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Circle,
	ListTodo,
	XCircle,
} from 'lucide-react';
import { useTodoStore, type TodoItem } from '../../stores/todoStore';

interface InputTodosBarProps {
	sessionId: string;
}

function TodoIcon({ status }: { status: TodoItem['status'] }) {
	if (status === 'completed') {
		return (
			<CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
		);
	}
	if (status === 'in_progress') {
		return (
			<ArrowRight className="h-3.5 w-3.5 text-foreground flex-shrink-0 animate-pulse" />
		);
	}
	if (status === 'cancelled') {
		return (
			<XCircle className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
		);
	}
	return <Circle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
}

function todoTextClass(status: TodoItem['status'], isCurrent = false) {
	if (status === 'completed') return 'text-muted-foreground line-through';
	if (isCurrent) return 'text-foreground';
	if (status === 'in_progress') return 'text-foreground';
	if (status === 'cancelled') {
		return 'text-muted-foreground/50 line-through';
	}
	return 'text-muted-foreground/80';
}

function TodoRow({
	item,
	isCurrent,
	className,
}: {
	item: TodoItem;
	isCurrent?: boolean;
	className?: string;
}) {
	return (
		<div
			className={`flex items-center gap-2 min-w-0 px-3 py-2 ${
				isCurrent ? 'bg-muted/50' : ''
			} ${className ?? ''}`}
		>
			<TodoIcon status={item.status} />
			<span
				className={`text-xs truncate ${todoTextClass(item.status, isCurrent)}`}
			>
				{item.step}
			</span>
		</div>
	);
}

function TodoInline({
	item,
	isCurrent,
	className,
}: {
	item: TodoItem;
	isCurrent?: boolean;
	className?: string;
}) {
	return (
		<span className={`flex items-center gap-1.5 min-w-0 ${className ?? ''}`}>
			<TodoIcon status={item.status} />
			<span
				className={`text-xs truncate ${todoTextClass(item.status, isCurrent)}`}
			>
				{item.step}
			</span>
		</span>
	);
}

function pickVisibleTodo(items: TodoItem[]) {
	return (
		items.find((item) => item.status === 'in_progress') ??
		items.find((item) => item.status === 'pending') ??
		items[0]
	);
}

function getTodoKey(item: TodoItem, index?: number) {
	return `${index ?? 'current'}-${item.status}-${item.step}`;
}

function shouldHighlightTodo(
	item: TodoItem,
	itemKey: string,
	visibleTodoKey: string,
) {
	return (
		itemKey === visibleTodoKey &&
		(item.status === 'in_progress' || item.status === 'pending')
	);
}

export const InputTodosBar = memo(function InputTodosBar({
	sessionId,
}: InputTodosBarProps) {
	const snapshot = useTodoStore((state) => state.todosBySession[sessionId]);
	const [isExpanded, setIsExpanded] = useState(false);
	const items = snapshot?.items ?? [];
	const hasTodos = items.length > 0;
	const visibleTodo = useMemo(() => pickVisibleTodo(items), [items]);
	const completedCount = items.filter(
		(item) => item.status === 'completed',
	).length;
	const visibleTodoKey = visibleTodo ? getTodoKey(visibleTodo) : 'none';
	const canExpand = items.length > 1 || Boolean(snapshot?.note);

	return (
		<div
			className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
			style={{
				gridTemplateRows: hasTodos ? '1fr' : '0fr',
				opacity: hasTodos ? 1 : 0,
			}}
		>
			<div className="overflow-hidden">
				<div className="border border-border border-b-0 bg-card rounded-t-xl overflow-hidden -mb-1 pb-2">
					<div
						className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '0fr' : '1fr',
							opacity: isExpanded ? 0 : 1,
						}}
					>
						<div className="overflow-hidden">
							<button
								type="button"
								aria-expanded={isExpanded}
								aria-label={canExpand ? 'Expand todos' : 'Todos'}
								disabled={!canExpand}
								onClick={() => canExpand && setIsExpanded(true)}
								className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
									canExpand ? 'hover:bg-muted cursor-pointer' : 'cursor-default'
								}`}
							>
								<ListTodo className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
								<span className="text-xs font-medium text-foreground flex-shrink-0">
									Todos
								</span>
								{visibleTodo && (
									<>
										<span className="h-3 w-px bg-border flex-shrink-0" />
										<TodoInline
											key={visibleTodoKey}
											item={visibleTodo}
											isCurrent={shouldHighlightTodo(
												visibleTodo,
												visibleTodoKey,
												visibleTodoKey,
											)}
											className="flex-1 animate-in fade-in slide-in-from-top-1 duration-200"
										/>
									</>
								)}
								<span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">
									{completedCount}/{items.length} done
								</span>
								{canExpand && (
									<ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
								)}
							</button>
						</div>
					</div>

					<div
						className="grid transition-[grid-template-rows,opacity] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '1fr' : '0fr',
							opacity: isExpanded ? 1 : 0,
						}}
					>
						<div className="overflow-hidden">
							<button
								type="button"
								aria-expanded={isExpanded}
								aria-label="Collapse todos"
								onClick={() => setIsExpanded(false)}
								className="flex w-full items-center gap-2 px-3 py-2 border-b border-border text-left transition-colors hover:bg-muted"
							>
								<ListTodo className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
								<span className="text-xs font-medium text-foreground">
									Todos
								</span>
								<span className="text-[11px] text-muted-foreground ml-auto">
									{completedCount}/{items.length} done
								</span>
								<ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
							</button>
							{snapshot?.note && (
								<div className="px-3 py-2 text-xs text-muted-foreground border-b border-border animate-in fade-in slide-in-from-top-1 duration-200">
									{snapshot.note}
								</div>
							)}
							<div className="divide-y divide-border">
								{items.map((item, index) => {
									const itemKey = getTodoKey(item, index);
									return (
										<TodoRow
											key={itemKey}
											item={item}
											isCurrent={shouldHighlightTodo(
												item,
												itemKey,
												visibleTodoKey,
											)}
											className="animate-in fade-in slide-in-from-top-1 duration-200"
										/>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
});
