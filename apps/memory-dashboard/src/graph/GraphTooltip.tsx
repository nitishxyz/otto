import { nodeTitle } from '../lib/memories.ts';
import { excerpt, hasMoreThanTitle, redactSecrets } from '../lib/text.ts';
import { ORIGIN_NAMES, scopeLabel, STATUS_NAMES } from '../lib/vocab.ts';
import type { GraphNode } from '../types.ts';

export function GraphTooltip({
	node,
	x,
	y,
}: {
	node: GraphNode;
	x: number;
	y: number;
}) {
	const title = nodeTitle(node);
	const content = node.content ? redactSecrets(node.content) : '';
	const scope = scopeLabel(node);
	return (
		<div className="graph-tooltip" style={{ left: x + 14, top: y + 14 }}>
			<div className="graph-tooltip-title">
				{node.kind === 'entity' ? `Topic: ${title}` : title}
			</div>
			{node.kind === 'memory' && hasMoreThanTitle(content, title) ? (
				<div className="graph-tooltip-body">{excerpt(content, 200)}</div>
			) : null}
			{node.kind === 'memory' ? (
				<div className="graph-tooltip-foot">
					<span className={`tone-${node.scope}`}>{scope.text}</span>
					{' \u00b7 '}
					{ORIGIN_NAMES[node.origin]}
					{node.status !== 'current'
						? ` \u00b7 ${STATUS_NAMES[node.status]}`
						: ''}
				</div>
			) : (
				<div className="graph-tooltip-foot">Click to see tagged memories</div>
			)}
		</div>
	);
}
