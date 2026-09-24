export type EmptyKind = 'loading' | 'empty' | 'error' | 'nomatch';

export function EmptyState({
	kind,
	detail,
	onAction,
}: {
	kind: EmptyKind;
	detail?: string;
	onAction?: () => void;
}) {
	if (kind === 'loading') {
		return (
			<div className="empty">
				<p className="empty-sub">{'Loading memories\u2026'}</p>
			</div>
		);
	}
	if (kind === 'error') {
		return (
			<div className="empty">
				<h2 className="empty-title">Can't reach Otto's memory</h2>
				<p className="empty-sub">
					Make sure <code>otto memory dashboard</code> is still running.
				</p>
				{detail ? <p className="empty-detail">{detail}</p> : null}
				{onAction ? (
					<button type="button" className="primary-button" onClick={onAction}>
						Try again
					</button>
				) : null}
			</div>
		);
	}
	if (kind === 'nomatch') {
		return (
			<div className="empty">
				<h2 className="empty-title">Nothing matches</h2>
				<p className="empty-sub">
					No memories fit the current search or project.
				</p>
				{onAction ? (
					<button type="button" className="ghost-button" onClick={onAction}>
						Show everything
					</button>
				) : null}
			</div>
		);
	}
	return (
		<div className="empty">
			<div className="empty-mark" aria-hidden="true" />
			<h2 className="empty-title">Otto hasn't remembered anything yet</h2>
			<p className="empty-sub">
				As you work, useful facts, preferences and decisions will show up here,
				so Otto doesn't have to ask twice.
			</p>
			<p className="empty-hint">
				Try telling Otto: <q>Remember that I prefer Bun for scripts.</q>
			</p>
		</div>
	);
}
