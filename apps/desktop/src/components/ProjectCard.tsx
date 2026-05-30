import { useState } from 'react';
import { Star, X, Link, MessageCircle } from 'lucide-react';
import type { Project } from '../lib/tauri-bridge';
import { formatTimeAgo } from '../utils/format-time';

export function ProjectCard({
	project,
	pinned,
	onSelect,
	onTogglePin,
	onRemove,
}: {
	project: Project;
	pinned: boolean;
	onSelect: () => void;
	onTogglePin: () => void;
	onRemove: () => void;
}) {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			className="group relative flex items-center gap-3.5 px-4 py-3.5 rounded-lg transition-all duration-150 cursor-pointer w-full text-left hover:bg-muted/50"
			onClick={onSelect}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div className="w-9 h-9 rounded-md bg-muted/80 flex items-center justify-center flex-shrink-0">
				{project.kind === 'general' ? (
					<MessageCircle className="w-4 h-4 text-muted-foreground" />
				) : project.remoteUrl ? (
					<Link className="w-4 h-4 text-muted-foreground" />
				) : (
					<svg
						className="w-4 h-4 text-muted-foreground"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
					</svg>
				)}
			</div>

			<div className="flex-1 min-w-0">
				<div className="text-sm font-medium text-foreground truncate leading-snug">
					{project.name}
				</div>
				<div className="text-[13px] text-muted-foreground/70 truncate">
					{project.kind === 'general'
						? 'General workspace'
						: project.remoteUrl || project.path}
				</div>
			</div>

			<div className="flex items-center gap-1 flex-shrink-0">
				{hovered ? (
					<>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onTogglePin();
							}}
							className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
							title={pinned ? 'Unpin' : 'Pin'}
						>
							<Star
								className={`w-3.5 h-3.5 ${pinned ? 'fill-yellow-500 text-yellow-500' : ''}`}
							/>
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onRemove();
							}}
							className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10 transition-colors"
							title="Remove"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					</>
				) : (
					<span className="text-xs text-muted-foreground/50 tabular-nums">
						{formatTimeAgo(project.lastOpened)}
					</span>
				)}
			</div>
		</button>
	);
}
