import { memo, useMemo, useState } from 'react';
import { type FeedItem, groupFeed, type LabelLookup } from '../lib/feed.ts';
import { fullDate, shortAgo } from '../lib/text.ts';
import type { MemoryEvent } from '../types.ts';

export interface ActivityFeedProps {
	events: readonly MemoryEvent[];
	labels: ReadonlyMap<string, string>;
	now: number;
	activeId: string | null;
	onFocus: (event: MemoryEvent) => void;
	/** Start with quiet events (empty lookups) visible. Defaults to false. */
	initialShowAll?: boolean;
}

export const ActivityFeed = memo(function ActivityFeed({
	events,
	labels,
	now,
	activeId,
	onFocus,
	initialShowAll = false,
}: ActivityFeedProps) {
	const [showAll, setShowAll] = useState(initialShowAll);
	const { groups, hiddenCount } = useMemo(() => {
		const labelOf: LabelLookup = (id) => labels.get(id);
		return groupFeed(events, { now, showAll, labelOf });
	}, [events, labels, now, showAll]);
	const visible = groups.reduce((sum, group) => sum + group.items.length, 0);

	return (
		<aside className="feed" aria-label="Recent activity">
			<div className="feed-head">
				<h2>Recent activity</h2>
				{hiddenCount > 0 || showAll ? (
					<button
						type="button"
						className="link-button"
						onClick={() => setShowAll((value) => !value)}
					>
						{showAll ? 'Show less' : `Show all (${hiddenCount} hidden)`}
					</button>
				) : null}
			</div>
			<div className="feed-scroll">
				{visible === 0 ? (
					<p className="feed-empty">
						{events.length === 0
							? 'When Otto remembers or uses something, it will show up here.'
							: 'Only lookups that found nothing so far.'}
					</p>
				) : null}
				{groups.map((group) => (
					<section className="feed-group" key={group.key}>
						<h3 className="feed-group-title">{group.title}</h3>
						<ol className="feed-list">
							{group.items.map((item) => (
								<EventRow
									key={item.event.id}
									item={item}
									now={now}
									active={item.event.id === activeId}
									onFocus={onFocus}
								/>
							))}
						</ol>
					</section>
				))}
			</div>
		</aside>
	);
});

const EventRow = memo(function EventRow({
	item,
	now,
	active,
	onFocus,
}: {
	item: FeedItem;
	now: number;
	active: boolean;
	onFocus: (event: MemoryEvent) => void;
}) {
	const { event } = item;
	const clickable = event.memoryIds.length > 0;
	const classes = ['event', `event-${item.tone}`];
	if (active) classes.push('active');
	if (item.quiet) classes.push('quiet');
	return (
		<li className={classes.join(' ')}>
			<button
				type="button"
				className="event-button"
				onClick={() => onFocus(event)}
				disabled={!clickable}
				title={clickable ? 'Show on the page' : undefined}
			>
				<i className="event-mark" aria-hidden="true" />
				<span className="event-text">
					<span className="event-verb">{item.verb}</span>{' '}
					<span className="event-subject">{item.subject}</span>
					{item.note || item.via ? (
						<span className="event-note">
							{[item.note, item.via].filter(Boolean).join(' \u00b7 ')}
						</span>
					) : null}
				</span>
				<time
					className="event-time"
					dateTime={event.at}
					title={fullDate(event.at)}
				>
					{shortAgo(event.at, now)}
				</time>
			</button>
		</li>
	);
});
