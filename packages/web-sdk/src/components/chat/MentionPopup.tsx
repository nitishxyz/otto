import { useEffect, useMemo } from 'react';
import Fuse from 'fuse.js';
import {
	File,
	FileCode,
	FileJson,
	FileText,
	Image,
	Braces,
	FileType,
	Plus,
	Pencil,
	Sparkles,
	type LucideIcon,
} from 'lucide-react';

export interface MentionAgent {
	name: string;
	description?: string;
}

export interface MentionSkill {
	name: string;
	description?: string;
}

export interface MentionItem {
	type: 'agent' | 'skill' | 'file';
	value: string;
	description?: string;
}

interface MentionPopupProps {
	agents: MentionAgent[];
	skills?: MentionSkill[];
	files: string[];
	changedFiles?: Array<{
		path: string;
		status: string;
	}>;
	query: string;
	selectedIndex: number;
	onSelect: (value: string) => void;
	onEnterSelect: (value: string | undefined) => void;
	onClose: () => void;
}

const MAX_AGENT_RESULTS = 5;
const MAX_SKILL_RESULTS = 5;
const MAX_FILE_RESULTS = 20;

function getFileIcon(filePath: string): LucideIcon {
	const ext = filePath.split('.').pop()?.toLowerCase();

	switch (ext) {
		case 'ts':
		case 'tsx':
		case 'js':
		case 'jsx':
		case 'mjs':
		case 'cjs':
		case 'py':
		case 'rb':
		case 'go':
		case 'rs':
		case 'java':
		case 'c':
		case 'cpp':
		case 'h':
		case 'hpp':
			return FileCode;
		case 'json':
		case 'yaml':
		case 'yml':
		case 'toml':
			return FileJson;
		case 'md':
		case 'txt':
		case 'log':
			return FileText;
		case 'png':
		case 'jpg':
		case 'jpeg':
		case 'gif':
		case 'svg':
		case 'webp':
			return Image;
		case 'css':
		case 'scss':
		case 'sass':
		case 'less':
			return Braces;
		case 'html':
		case 'xml':
			return FileType;
		default:
			return File;
	}
}

function getGitStatusInfo(
	filePath: string,
	changedFilesMap: Map<string, string>,
) {
	const status = changedFilesMap.get(filePath);
	if (!status) {
		return null;
	}

	const icons: Record<
		string,
		{ icon: LucideIcon; label: string; className: string }
	> = {
		added: { icon: Plus, label: 'Added', className: 'text-green-500' },
		modified: { icon: Pencil, label: 'Modified', className: 'text-yellow-500' },
		untracked: { icon: Plus, label: 'Untracked', className: 'text-blue-500' },
	};

	return (
		icons[status] || {
			icon: Pencil,
			label: 'Modified',
			className: 'text-yellow-500',
		}
	);
}

function SectionLabel({ children }: { children: string }) {
	return (
		<div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 select-none">
			{children}
		</div>
	);
}

/**
 * Name-first matcher for agents/skills: prefix matches rank first, then
 * word-boundary matches (after a dash), then substring matches. Descriptions
 * are ignored so unrelated items don't pollute results.
 */
function matchByName<T extends { name: string }>(
	items: T[],
	query: string,
	limit: number,
): T[] {
	if (!query) return items.slice(0, limit);
	const q = query.toLowerCase();
	const ranked: Array<{ item: T; rank: number }> = [];
	for (const item of items) {
		const name = item.name.toLowerCase();
		let rank: number;
		if (name.startsWith(q)) rank = 0;
		else if (name.includes(`-${q}`)) rank = 1;
		else if (name.includes(q)) rank = 2;
		else continue;
		ranked.push({ item, rank });
	}
	ranked.sort(
		(a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name),
	);
	return ranked.slice(0, limit).map((r) => r.item);
}

export function MentionPopup({
	agents,
	skills = [],
	files,
	changedFiles = [],
	query,
	selectedIndex,
	onSelect,
	onEnterSelect,
	onClose,
}: MentionPopupProps) {
	const changedFilesMap = useMemo(
		() => new Map(changedFiles?.map((f) => [f.path, f.status]) || []),
		[changedFiles],
	);

	const agentResults = useMemo(
		() => matchByName(agents, query, MAX_AGENT_RESULTS),
		[agents, query],
	);

	const skillResults = useMemo(
		() => matchByName(skills, query, MAX_SKILL_RESULTS),
		[skills, query],
	);

	const fileFuse = useMemo(
		() =>
			new Fuse(
				files.map((f) => ({
					path: f,
					filename: f.split('/').pop() || f,
					normalized: f.replace(/[.\-_/]/g, ''),
				})),
				{
					keys: [
						{ name: 'filename', weight: 2 },
						{ name: 'normalized', weight: 1.5 },
						{ name: 'path', weight: 1 },
					],
					threshold: 0.3,
					distance: 200,
					ignoreLocation: true,
					includeScore: true,
				},
			),
		[files],
	);

	const fileResults = useMemo(() => {
		if (!query) {
			return files.slice(0, MAX_FILE_RESULTS);
		}
		const normalizedQuery = query.replace(/[.\-_/]/g, '');
		const searchResults = fileFuse.search(normalizedQuery);

		searchResults.sort((a, b) => {
			const scoreA = a.score ?? 1;
			const scoreB = b.score ?? 1;
			const scoreDiff = Math.abs(scoreA - scoreB);
			if (scoreDiff < 0.05) {
				const aChanged = changedFilesMap.has(a.item.path);
				const bChanged = changedFilesMap.has(b.item.path);
				if (aChanged && !bChanged) return -1;
				if (!aChanged && bChanged) return 1;
			}
			return scoreA - scoreB;
		});

		return searchResults.slice(0, MAX_FILE_RESULTS).map((r) => r.item.path);
	}, [fileFuse, query, files, changedFilesMap]);

	const items = useMemo<MentionItem[]>(
		() => [
			...agentResults.map<MentionItem>((agent) => ({
				type: 'agent',
				value: agent.name,
				description: agent.description,
			})),
			...skillResults.map<MentionItem>((skill) => ({
				type: 'skill',
				value: skill.name,
				description: skill.description,
			})),
			...fileResults.map<MentionItem>((path) => ({
				type: 'file',
				value: path,
			})),
		],
		[agentResults, skillResults, fileResults],
	);

	const effectiveIndex = items.length > 0 ? selectedIndex % items.length : 0;

	useEffect(() => {
		const element = document.getElementById(`mention-item-${effectiveIndex}`);
		element?.scrollIntoView({ block: 'nearest' });
	}, [effectiveIndex]);

	useEffect(() => {
		onEnterSelect(items[effectiveIndex]?.value);
	}, [items, effectiveIndex, onEnterSelect]);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest('[data-mention-popup]')) {
				onClose();
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [onClose]);

	if (items.length === 0) {
		return null;
	}

	const skillSectionOffset = agentResults.length;
	const fileSectionOffset = agentResults.length + skillResults.length;

	return (
		<div
			data-mention-popup
			className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-lg shadow-lg max-h-[300px] overflow-y-auto z-50 py-1"
		>
			{agentResults.length > 0 && (
				<>
					<SectionLabel>Agents</SectionLabel>
					{agentResults.map((agent, index) => (
						<button
							type="button"
							key={`agent-${agent.name}`}
							id={`mention-item-${index}`}
							onMouseDown={(e) => {
								e.preventDefault();
								onSelect(agent.name);
							}}
							className={`w-full text-left px-3 py-2 hover:bg-accent ${
								index === effectiveIndex ? 'bg-accent' : ''
							}`}
						>
							<div className="min-w-0 flex-1">
								<span className="font-mono text-sm">@{agent.name}</span>
								{agent.description && (
									<div className="text-xs text-muted-foreground truncate">
										{agent.description}
									</div>
								)}
							</div>
						</button>
					))}
				</>
			)}

			{skillResults.length > 0 && (
				<>
					<SectionLabel>Skills</SectionLabel>
					{skillResults.map((skill, index) => {
						const itemIndex = skillSectionOffset + index;
						return (
							<button
								type="button"
								key={`skill-${skill.name}`}
								id={`mention-item-${itemIndex}`}
								onMouseDown={(e) => {
									e.preventDefault();
									onSelect(skill.name);
								}}
								className={`w-full text-left px-3 py-2 hover:bg-accent ${
									itemIndex === effectiveIndex ? 'bg-accent' : ''
								}`}
							>
								<div className="flex items-start gap-2 w-full">
									<Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-1" />
									<div className="min-w-0 flex-1">
										<span className="font-mono text-sm">@{skill.name}</span>
										{skill.description && (
											<div className="text-xs text-muted-foreground truncate">
												{skill.description}
											</div>
										)}
									</div>
								</div>
							</button>
						);
					})}
				</>
			)}

			{fileResults.length > 0 && (
				<>
					{(agentResults.length > 0 || skillResults.length > 0) && (
						<SectionLabel>Files</SectionLabel>
					)}
					{fileResults.map((filePath, index) => {
						const itemIndex = fileSectionOffset + index;
						const Icon = getFileIcon(filePath);
						const status = getGitStatusInfo(filePath, changedFilesMap);
						return (
							<button
								type="button"
								key={`file-${filePath}`}
								id={`mention-item-${itemIndex}`}
								onMouseDown={(e) => {
									e.preventDefault();
									onSelect(filePath);
								}}
								className={`w-full text-left px-3 py-2 hover:bg-accent ${
									itemIndex === effectiveIndex ? 'bg-accent' : ''
								}`}
							>
								<div className="flex items-center gap-2 w-full">
									<Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
									<span className="font-mono text-sm flex-1 truncate">
										{filePath}
									</span>
									{status && (
										<span title={status.label}>
											<status.icon
												className={`w-3.5 h-3.5 flex-shrink-0 ${status.className}`}
											/>
										</span>
									)}
								</div>
							</button>
						);
					})}
				</>
			)}
		</div>
	);
}
