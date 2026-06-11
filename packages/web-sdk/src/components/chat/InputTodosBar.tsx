import { memo, useEffect, useMemo, useState } from 'react';
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
import {
	INPUT_BAR_ATTACHED_CARD_CLASS,
	INPUT_BAR_GROUP_CLASS,
	inputBarWrapperProps,
} from './input-bar-chrome';

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
	if (isCurrent) return 'text-orange-600 dark:text-orange-300 font-medium';
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
				isCurrent
					? 'bg-orange-500/10 border-l-2 border-orange-500/70 pl-2.5'
					: ''
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

function AnimatedCurrentTodo({
	item,
	itemKey,
}: {
	item: TodoItem | undefined;
	itemKey: string;
}) {
	const [displayedItem, setDisplayedItem] = useState(item);
	const [displayedKey, setDisplayedKey] = useState(itemKey);
	const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle');

	useEffect(() => {
		if (displayedKey === itemKey) return;

		if (!displayedItem) {
			setDisplayedItem(item);
			setDisplayedKey(itemKey);
			setPhase('in');
			const frame = requestAnimationFrame(() => setPhase('idle'));
			return () => cancelAnimationFrame(frame);
		}

		setPhase('out');
		const timeout = setTimeout(() => {
			setDisplayedItem(item);
			setDisplayedKey(itemKey);
			setPhase('in');
			requestAnimationFrame(() => setPhase('idle'));
		}, 140);

		return () => clearTimeout(timeout);
	}, [displayedItem, displayedKey, item, itemKey]);

	if (!displayedItem) return null;

	const animationClass =
		phase === 'out'
			? 'opacity-0 -translate-y-1'
			: phase === 'in'
				? 'opacity-0 translate-y-1'
				: 'opacity-100 translate-y-0';

	return (
		<TodoInline
			key={displayedKey}
			item={displayedItem}
			isCurrent={shouldHighlightTodo(displayedItem, displayedKey, displayedKey)}
			className={`flex-1 transition-[opacity,transform] duration-150 ease-out ${animationClass}`}
		/>
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
	const visibleTodoIndex = visibleTodo ? items.indexOf(visibleTodo) : -1;
	const completedCount = items.filter(
		(item) => item.status === 'completed',
	).length;
	const visibleTodoKey = visibleTodo
		? getTodoKey(
				visibleTodo,
				visibleTodoIndex >= 0 ? visibleTodoIndex : undefined,
			)
		: 'none';
	const canExpand = items.length > 1 || Boolean(snapshot?.note);

	return (
		<div
			className={`${INPUT_BAR_GROUP_CLASS} grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out`}
			{...inputBarWrapperProps(hasTodos)}
			style={{
				gridTemplateRows: hasTodos ? '1fr' : '0fr',
				opacity: hasTodos ? 1 : 0,
				visibility: hasTodos ? 'visible' : 'hidden',
			}}
		>
			<div className="overflow-hidden">
				<div
					className={`border border-border bg-card overflow-hidden ${INPUT_BAR_ATTACHED_CARD_CLASS}`}
				>
					<div
						className="grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '0fr' : '1fr',
							opacity: isExpanded ? 0 : 1,
							visibility: isExpanded ? 'hidden' : 'inherit',
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
										<AnimatedCurrentTodo
											item={visibleTodo}
											itemKey={visibleTodoKey}
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
						className="grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out"
						style={{
							gridTemplateRows: isExpanded ? '1fr' : '0fr',
							opacity: isExpanded ? 1 : 0,
							visibility: isExpanded ? 'inherit' : 'hidden',
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
