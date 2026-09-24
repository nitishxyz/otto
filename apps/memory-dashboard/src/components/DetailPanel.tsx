import { useState } from 'react';
import { memoryFacets, nodeTitle } from '../lib/memories.ts';
import {
	fullDate,
	hasMoreThanTitle,
	redactSecrets,
	timeAgo,
} from '../lib/text.ts';
import {
	agentPhrase,
	ORIGIN_NAMES,
	pluralize,
	relationPhrase,
	STATUS_NAMES,
	scopeLabel,
} from '../lib/vocab.ts';
import type { GraphNode, MemoryDetailResponse } from '../types.ts';
import { Lineage } from './Lineage.tsx';

export interface DetailPanelProps {
	nodeId: string;
	fallback: GraphNode | null;
	detail: MemoryDetailResponse | null;
	loading: boolean;
	error: string | null;
	now: number;
	/** Memories tagged with the topic, when the selection is a topic. */
	topicMembers?: readonly GraphNode[];
	onClose: () => void;
	onSelect: (id: string) => void;
}

const UPDATED_THRESHOLD_MS = 60_000;

export function DetailPanel(props: DetailPanelProps) {
	const { detail, fallback, loading, error, now } = props;
	const node = detail?.memory ?? fallback;
	return (
		<section className="detail" aria-label="Memory details">
			<button
				type="button"
				className="detail-close"
				onClick={props.onClose}
				aria-label="Close details"
				title="Close (Esc)"
			>
				{'\u00d7'}
			</button>
			{node?.kind === 'entity' ? (
				<TopicBody
					topic={node}
					members={props.topicMembers ?? []}
					onSelect={props.onSelect}
				/>
			) : node ? (
				<MemoryBody
					node={node}
					detail={detail}
					now={now}
					onSelect={props.onSelect}
				/>
			) : null}
			{loading && !node ? (
				<div className="detail-loading">{'Loading\u2026'}</div>
			) : null}
			{error ? (
				<div className="detail-error">
					Couldn't load the full details. ({error})
				</div>
			) : null}
		</section>
	);
}

function MemoryBody({
	node,
	detail,
	now,
	onSelect,
}: {
	node: GraphNode;
	detail: MemoryDetailResponse | null;
	now: number;
	onSelect: (id: string) => void;
}) {
	const title = nodeTitle(node);
	const content = redactSecrets(node.content ?? '');
	const scope = scopeLabel(node);
	const facets = detail
		? memoryFacets({
				nodes: [detail.memory, ...detail.neighbors],
				edges: detail.edges,
			}).get(node.id)
		: undefined;
	const via = agentPhrase(node.source?.agent);
	const sourceParts = [
		facets?.source ? redactSecrets(facets.source) : null,
		via,
	].filter((part): part is string => Boolean(part));
	if (sourceParts.length === 0 && node.source?.sessionId) {
		sourceParts.push('A chat session');
	}
	const created = Date.parse(node.createdAt);
	const updated = Date.parse(node.updatedAt);
	const wasUpdated = updated - created > UPDATED_THRESHOLD_MS;
	const lineage = detail?.lineage ?? [];

	return (
		<>
			<div className="detail-chips">
				<span className={`chip tone-${node.scope}`} title={scope.title}>
					{scope.text}
				</span>
				{node.status !== 'current' ? (
					<span className={`chip status-${node.status}`}>
						{STATUS_NAMES[node.status]}
					</span>
				) : null}
			</div>
			<h2 className="detail-title">{title}</h2>
			{hasMoreThanTitle(content, title) ? (
				<p className="detail-content">{content}</p>
			) : null}
			{facets && facets.topics.length > 0 ? (
				<div className="tags">
					{facets.topics.map((topic) => (
						<span className="tag" key={topic}>
							{topic}
						</span>
					))}
				</div>
			) : null}
			<dl className="detail-meta">
				<Row label="Applies to" value={scope.text} title={scope.title} />
				<Row label="How" value={ORIGIN_NAMES[node.origin]} />
				{sourceParts.length > 0 ? (
					<Row label="Source" value={sourceParts.join(' \u00b7 ')} />
				) : null}
				<Row
					label="When"
					value={`Remembered ${timeAgo(node.createdAt, now)}${
						wasUpdated ? ` \u00b7 updated ${timeAgo(node.updatedAt, now)}` : ''
					}`}
					title={fullDate(node.createdAt)}
				/>
			</dl>
			<div className="detail-actions">
				<CopyButton text={content || title} />
			</div>
			{detail ? (
				<>
					<Lineage
						lineage={lineage}
						currentId={detail.memory.id}
						now={now}
						onSelect={onSelect}
					/>
					<Related
						detail={detail}
						skip={new Set(lineage.length > 1 ? lineage.map((n) => n.id) : [])}
						onSelect={onSelect}
					/>
				</>
			) : null}
		</>
	);
}

function Row({
	label,
	value,
	title,
}: {
	label: string;
	value: string;
	title?: string;
}) {
	return (
		<div className="detail-row">
			<dt>{label}</dt>
			<dd title={title}>{value}</dd>
		</div>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const copy = () => {
		void navigator.clipboard
			?.writeText(text)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {});
	};
	return (
		<button type="button" className="ghost-button" onClick={copy}>
			{copied ? 'Copied' : 'Copy text'}
		</button>
	);
}

function Related({
	detail,
	skip,
	onSelect,
}: {
	detail: MemoryDetailResponse;
	skip: ReadonlySet<string>;
	onSelect: (id: string) => void;
}) {
	const selfId = detail.memory.id;
	const related = detail.neighbors.flatMap((neighbor) => {
		if (neighbor.kind !== 'memory' || skip.has(neighbor.id)) return [];
		const edge = detail.edges.find(
			(e) =>
				(e.from === selfId && e.to === neighbor.id) ||
				(e.to === selfId && e.from === neighbor.id),
		);
		const phrase = edge
			? relationPhrase(edge.type, edge.from === selfId)
			: 'Related';
		return [{ neighbor, phrase }];
	});
	if (related.length === 0) return null;
	return (
		<section className="detail-section">
			<h3 className="section-title">Related memories</h3>
			<ul className="related-list">
				{related.map(({ neighbor, phrase }) => (
					<li key={neighbor.id}>
						<button
							type="button"
							className="related"
							onClick={() => onSelect(neighbor.id)}
						>
							<span
								className={`related-rel rel-${phrase.split(' ')[0].toLowerCase()}`}
							>
								{phrase}
							</span>
							<span className="related-label">{nodeTitle(neighbor)}</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

function TopicBody({
	topic,
	members,
	onSelect,
}: {
	topic: GraphNode;
	members: readonly GraphNode[];
	onSelect: (id: string) => void;
}) {
	return (
		<>
			<div className="detail-chips">
				<span className="chip">Topic</span>
			</div>
			<h2 className="detail-title">{topic.label}</h2>
			<p className="detail-note">
				{pluralize(members.length, 'memory is', 'memories are')} tagged with
				this topic.
			</p>
			<ul className="related-list">
				{members.map((member) => (
					<li key={member.id}>
						<button
							type="button"
							className="related"
							onClick={() => onSelect(member.id)}
						>
							<span className="related-label">{nodeTitle(member)}</span>
						</button>
					</li>
				))}
			</ul>
		</>
	);
}
