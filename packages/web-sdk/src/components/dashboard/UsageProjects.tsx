import { AlertTriangle } from 'lucide-react';
import type { UsageStats } from '../../lib/api-client/usage';
import { cn, NEO_RADIUS } from './neopop';
import { formatNumber, formatUsd } from './format';
import { BreakdownList, type BreakdownItem } from './UsageBreakdown';

export interface UsageProjectsProps {
	projects: NonNullable<UsageStats['projects']>;
}

/** Global scope only: which registered project roots the totals came from. */
export function UsageProjects({ projects }: UsageProjectsProps) {
	const items: BreakdownItem[] = projects.included.map((project) => ({
		key: project.id,
		label: project.name,
		sublabel: project.path,
		value: project.notionalCostUsd,
		valueLabel: formatUsd(project.notionalCostUsd),
		metaLabel: `${formatNumber(project.messages)} msgs`,
		title: project.path,
	}));

	return (
		<div className="space-y-3">
			<BreakdownList
				items={items}
				limit={6}
				emptyLabel="No projects registered yet"
			/>
			{projects.unavailable.length > 0 && (
				<ul className="space-y-1.5">
					{projects.unavailable.map((project) => (
						<li
							key={project.id}
							title={project.reason}
							className={cn(
								'flex items-center gap-2.5 border-2 border-dashed px-2.5 py-2',
								'border-[rgb(var(--np-yellow-cast))]',
								NEO_RADIUS,
							)}
						>
							<AlertTriangle className="size-3.5 shrink-0 text-[rgb(var(--np-yellow))]" />
							<div className="min-w-0 flex-1">
								<p className="truncate text-[13px] leading-tight">
									{project.name}
								</p>
								<p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
									{project.path} · {project.reason}
								</p>
							</div>
							<span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[rgb(var(--np-yellow))]">
								unavailable
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
