import type { CSSProperties } from 'react';
import { cn, NEO_EDGE, NEO_RADIUS, NeoPanel } from './neopop';
import { UsageSection } from './UsageSection';

const BAR_HEIGHTS = [
	32, 48, 24, 64, 40, 72, 16, 56, 36, 80, 28, 44, 20, 60, 52, 12, 68, 76, 44,
	32, 50, 18, 66, 38, 58, 26, 70, 22, 46, 54,
].map((height, index) => ({ id: `bar-${index}`, height }));

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f'];
const TILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function Block({
	className,
	style,
}: {
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<div
			style={style}
			className={cn('animate-pulse bg-muted', NEO_RADIUS, className)}
		/>
	);
}

function SkeletonRows({ count = 6 }: { count?: number }) {
	return (
		<ul className="space-y-1">
			{ROWS.slice(0, count).map((row) => (
				<li key={row} className="px-2.5 py-2">
					<div className="flex items-center gap-2.5">
						<Block className="size-7 shrink-0" />
						<div className="flex-1 space-y-1.5">
							<Block className="h-3 w-24" />
							<Block className="h-2 w-36" />
						</div>
						<div className="space-y-1.5 text-right">
							<Block className="h-3 w-14" />
							<Block className="ml-auto h-2 w-10" />
						</div>
					</div>
					<Block className="ml-[38px] mt-2 h-2" />
				</li>
			))}
		</ul>
	);
}

export function UsageSkeleton() {
	return (
		<div className="space-y-4">
			<NeoPanel
				elevation="sm"
				className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:items-center md:p-6"
			>
				<div className="space-y-3">
					<Block className="h-3 w-40" />
					<Block className="h-11 w-52" />
					<Block className="h-3 w-64" />
				</div>
				<Block className="h-16 w-full" />
			</NeoPanel>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				{['a', 'b', 'c'].map((tile) => (
					<NeoPanel key={tile} elevation="sm" className="space-y-2.5 p-4">
						<Block className="h-3 w-24" />
						<Block className="h-6 w-28" />
						<Block className="h-2.5 w-36" />
					</NeoPanel>
				))}
			</div>

			<ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{TILES.map((tile) => (
					<li
						key={tile}
						className={cn(
							'space-y-2 bg-card px-3.5 py-3',
							NEO_RADIUS,
							NEO_EDGE,
						)}
					>
						<Block className="h-2.5 w-20" />
						<Block className="h-4 w-16" />
						<Block className="h-2 w-24" />
					</li>
				))}
			</ul>

			<UsageSection title="Daily activity">
				<div className="mb-5 flex items-start justify-between gap-3">
					<div className="space-y-2">
						<Block className="h-2.5 w-28" />
						<Block className="h-7 w-24" />
						<Block className="h-2.5 w-44" />
					</div>
					<Block className="h-8 w-44" />
				</div>
				<div className="flex h-48 items-end gap-1 sm:h-56">
					{BAR_HEIGHTS.map((bar) => (
						<Block
							key={bar.id}
							className="min-w-0 flex-1"
							style={{ height: `${bar.height}%` }}
						/>
					))}
				</div>
			</UsageSection>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<UsageSection title="How you're paying">
					<SkeletonRows count={3} />
				</UsageSection>
				<UsageSection title="By provider">
					<SkeletonRows />
				</UsageSection>
			</div>
		</div>
	);
}
