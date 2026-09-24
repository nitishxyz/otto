import { useState } from 'react';
import { EDGE_NAMES, SCOPE_NAMES } from '../lib/vocab.ts';
import type { EdgeType } from '../types.ts';
import { GraphCanvas, type GraphCanvasProps } from './GraphCanvas.tsx';
import type { GraphLegend } from './model.ts';
import { EDGE_SWATCH, ENTITY_COLOR, SCOPE_COLORS } from './theme.ts';

export interface GraphViewProps extends Omit<GraphCanvasProps, 'fitKey'> {
	legend: GraphLegend;
	edgeTypes: ReadonlySet<EdgeType>;
	showTopics: boolean;
	/** Changing this (e.g. switching project) re-fits the map. */
	resetKey: string;
	onToggleEdge: (type: EdgeType) => void;
	onToggleTopics: () => void;
}

export function GraphView(props: GraphViewProps) {
	const {
		legend,
		edgeTypes,
		showTopics,
		resetKey,
		onToggleEdge,
		onToggleTopics,
		...canvas
	} = props;
	const [fitCount, setFitCount] = useState(0);

	return (
		<div className="graph-view">
			<GraphCanvas {...canvas} fitKey={`${resetKey}#${fitCount}`} />
			<div className="graph-controls">
				<button
					type="button"
					className="ghost-button"
					onClick={() => setFitCount((count) => count + 1)}
					title="Fit everything in view (or double-click the map)"
				>
					Fit
				</button>
			</div>
			<section className="legend" aria-label="Map legend">
				<div className="legend-row">
					{legend.scopes.map((scope) => (
						<span className="legend-item" key={scope}>
							<i
								className="legend-dot"
								style={{ background: SCOPE_COLORS[scope] }}
							/>
							{scope === 'project' ? 'Project' : SCOPE_NAMES[scope]}
						</span>
					))}
					<span className="legend-item legend-muted">
						<i className="legend-dot legend-hollow" />
						Otto noticed
					</span>
				</div>
				{legend.edgeTypes.length > 0 ? (
					<div className="legend-row">
						{legend.edgeTypes.map((type) => (
							<button
								type="button"
								key={type}
								className={`legend-toggle${edgeTypes.has(type) ? ' on' : ''}`}
								aria-pressed={edgeTypes.has(type)}
								onClick={() => onToggleEdge(type)}
								title={
									edgeTypes.has(type) ? 'Hide these lines' : 'Show these lines'
								}
							>
								<i
									className={`legend-line legend-line-${type}`}
									style={
										type === 'contradicts'
											? undefined
											: { background: EDGE_SWATCH[type] }
									}
								/>
								{EDGE_NAMES[type]}
							</button>
						))}
					</div>
				) : null}
				{legend.topicCount > 0 ? (
					<div className="legend-row">
						<button
							type="button"
							className="legend-toggle on"
							aria-pressed={showTopics}
							onClick={onToggleTopics}
						>
							<i
								className="legend-diamond"
								style={{ background: ENTITY_COLOR }}
							/>
							{showTopics ? 'Hide topics' : 'Show topics'}
						</button>
					</div>
				) : null}
			</section>
			<div className="graph-hint">
				Drag to move · scroll to zoom · click a dot for details
			</div>
		</div>
	);
}
