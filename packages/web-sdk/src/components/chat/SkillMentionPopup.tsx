import { useEffect, useMemo } from 'react';
import Fuse from 'fuse.js';
import { Sparkles } from 'lucide-react';
import type { SkillSummary } from '../../lib/api-client/skills';

interface SkillMentionPopupProps {
	skills: SkillSummary[];
	query: string;
	selectedIndex: number;
	onSelect: (skill: string) => void;
	onEnterSelect: (skill: string | undefined) => void;
	onClose: () => void;
}

export function SkillMentionPopup({
	skills,
	query,
	selectedIndex,
	onSelect,
	onEnterSelect,
	onClose,
}: SkillMentionPopupProps) {
	const enabledSkills = useMemo(
		() => skills.filter((skill) => skill.enabled !== false),
		[skills],
	);

	const fuse = useMemo(
		() =>
			new Fuse(enabledSkills, {
				keys: [
					{ name: 'name', weight: 2 },
					{ name: 'description', weight: 1 },
				],
				threshold: 0.35,
				distance: 120,
				ignoreLocation: true,
				includeScore: true,
			}),
		[enabledSkills],
	);

	const results = useMemo(() => {
		if (!query) return enabledSkills.slice(0, 12);
		return fuse
			.search(query)
			.slice(0, 12)
			.map((result) => result.item);
	}, [enabledSkills, fuse, query]);

	useEffect(() => {
		const element = document.getElementById(`skill-item-${selectedIndex}`);
		element?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	useEffect(() => {
		onEnterSelect(results[selectedIndex]?.name);
	}, [results, selectedIndex, onEnterSelect]);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('[data-skill-mention-popup]')) {
				onClose();
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [onClose]);

	if (results.length === 0) {
		return (
			<div
				data-skill-mention-popup
				className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-lg shadow-lg z-50 p-3"
			>
				<span className="text-muted-foreground text-sm">No skills found</span>
			</div>
		);
	}

	return (
		<div
			data-skill-mention-popup
			className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-lg shadow-lg max-h-[300px] overflow-y-auto z-50"
		>
			{results.map((skill, index) => (
				<button
					type="button"
					key={`${skill.scope}-${skill.name}`}
					id={`skill-item-${index}`}
					onMouseDown={(e) => {
						e.preventDefault();
						onSelect(skill.name);
					}}
					className={`w-full text-left px-3 py-2 hover:bg-accent ${
						index === selectedIndex ? 'bg-accent' : ''
					}`}
				>
					<div className="flex items-start gap-2 w-full">
						<Sparkles className="w-4 h-4 flex-shrink-0 text-violet-500 mt-0.5" />
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2 min-w-0">
								<span className="font-mono text-sm truncate">
									${skill.name}
								</span>
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
									{skill.scope}
								</span>
							</div>
							{skill.description && (
								<div className="text-xs text-muted-foreground truncate">
									{skill.description}
								</div>
							)}
						</div>
					</div>
				</button>
			))}
		</div>
	);
}
