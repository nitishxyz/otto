import { memo, useEffect, useRef } from 'react';
import {
	type MemoryFacets,
	type MemorySection,
	nodeTitle,
} from '../lib/memories.ts';
import {
	excerpt,
	fullDate,
	hasMoreThanTitle,
	redactSecrets,
	timeAgo,
} from '../lib/text.ts';
import { ORIGIN_NAMES, pluralize, STATUS_NAMES } from '../lib/vocab.ts';
import type { GraphNode } from '../types.ts';

export interface MemoryListProps {
	sections: MemorySection[];
	facets: ReadonlyMap<string, MemoryFacets>;
	selectedId: string | null;
	flashIds: ReadonlySet<string>;
	focus: { ids: string[]; key: number } | null;
	now: number;
	onSelect: (id: string) => void;
}

export function MemoryList(props: MemoryListProps) {
	const { sections, focus } = props;
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const id = focus?.ids[0];
		if (!id || !rootRef.current) return;
		const target = rootRef.current.querySelector<HTMLElement>(
			`[data-id="${CSS.escape(id)}"]`,
		);
		target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}, [focus]);

	return (
		<div className="list-view" ref={rootRef}>
			{sections.map((section) => (
				<section className="list-section" key={section.key}>
					<h2 className="list-section-title" title={section.hint}>
						<i className={`tone-dot tone-dot-${section.tone}`} />
						{section.title}
						<span className="list-section-count">
							{section.memories.length}
						</span>
					</h2>
					<ul className="cards">
						{section.memories.map((memory) => (
							<li key={memory.id}>
								<MemoryCard
									memory={memory}
									facets={props.facets.get(memory.id)}
									selected={memory.id === props.selectedId}
									flash={props.flashIds.has(memory.id)}
									now={props.now}
									onSelect={props.onSelect}
								/>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

const MemoryCard = memo(function MemoryCard({
	memory,
	facets,
	selected,
	flash,
	now,
	onSelect,
}: {
	memory: GraphNode;
	facets: MemoryFacets | undefined;
	selected: boolean;
	flash: boolean;
	now: number;
	onSelect: (id: string) => void;
}) {
	const title = nodeTitle(memory);
	const content = redactSecrets(memory.content ?? '');
	const classes = ['card', `card-${memory.status}`];
	if (selected) classes.push('selected');
	if (flash) classes.push('flash');
	return (
		<button
			type="button"
			className={classes.join(' ')}
			data-id={memory.id}
			onClick={() => onSelect(memory.id)}
			aria-pressed={selected}
		>
			<span className="card-title">{title}</span>
			{hasMoreThanTitle(content, title) ? (
				<span className="card-body">{excerpt(content, 240)}</span>
			) : null}
			<span className="card-meta">
				<span className={`origin origin-${memory.origin}`}>
					{ORIGIN_NAMES[memory.origin]}
				</span>
				<span title={fullDate(memory.updatedAt)}>
					{timeAgo(memory.updatedAt, now)}
				</span>
				{memory.scope === 'session' ? <span>One chat only</span> : null}
				{memory.status !== 'current' ? (
					<span className={`status status-${memory.status}`}>
						{STATUS_NAMES[memory.status]}
					</span>
				) : null}
				{facets && facets.links > 0 ? (
					<span>{pluralize(facets.links, 'link', 'links')}</span>
				) : null}
				{facets?.topics.map((topic) => (
					<span className="tag" key={topic}>
						{topic}
					</span>
				))}
			</span>
		</button>
	);
});
