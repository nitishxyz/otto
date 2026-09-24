import { wordDiff } from '../lib/diff.ts';
import { flatten, fullDate, redactSecrets, timeAgo } from '../lib/text.ts';
import type { GraphNode } from '../types.ts';

/** Vertical "how this changed" timeline, oldest version first. */
export function Lineage({
	lineage,
	currentId,
	now,
	onSelect,
}: {
	lineage: readonly GraphNode[];
	currentId: string;
	now: number;
	onSelect: (id: string) => void;
}) {
	if (lineage.length <= 1) return null;
	const texts = lineage.map((version) =>
		flatten(redactSecrets(version.content ?? version.label)),
	);
	return (
		<section className="detail-section">
			<h3 className="section-title">
				How this changed
				<span className="section-sub">{lineage.length} versions</span>
			</h3>
			<ol className="timeline">
				{lineage.map((version, index) => {
					const isViewing = version.id === currentId;
					const isLatest = index === lineage.length - 1;
					const label =
						index === 0 ? 'First noted' : isLatest ? 'Latest' : 'Updated';
					const previous = index > 0 ? texts[index - 1] : undefined;
					const diff =
						previous !== undefined ? wordDiff(previous, texts[index]) : null;
					return (
						<li
							key={version.id}
							className={`timeline-item${isViewing ? ' viewing' : ''}`}
						>
							<span className={`timeline-dot${isLatest ? ' latest' : ''}`} />
							<button
								type="button"
								className="timeline-body"
								onClick={() => onSelect(version.id)}
								disabled={isViewing}
							>
								<span className="timeline-meta">
									<strong>{label}</strong>
									<span title={fullDate(version.createdAt)}>
										{timeAgo(version.createdAt, now)}
									</span>
									{isViewing ? (
										<span className="timeline-viewing">viewing</span>
									) : null}
								</span>
								<span className="timeline-text">
									{diff
										? diff.map((part, i) =>
												part.kind === 'same' ? (
													// biome-ignore lint/suspicious/noArrayIndexKey: static diff output
													<span key={i}>{part.text}</span>
												) : part.kind === 'added' ? (
													// biome-ignore lint/suspicious/noArrayIndexKey: static diff output
													<ins key={i}>{part.text}</ins>
												) : (
													// biome-ignore lint/suspicious/noArrayIndexKey: static diff output
													<del key={i}>{part.text}</del>
												),
											)
										: texts[index]}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</section>
	);
}
