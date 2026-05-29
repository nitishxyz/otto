import { memo, useMemo, useState } from 'react';
import {
	Sparkles,
	FolderDot,
	Laptop,
	Globe,
	FileText,
	FileCode,
	RefreshCw,
	Search,
	X,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { SidebarHeader } from '../ui/SidebarHeader';
import { StableSpinner } from '../ui/StableSpinner';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { useSkillsStore } from '../../stores/skillsStore';
import {
	useSkills,
	useSkillDetail,
	useSkillFiles,
	useUpdateSkillsConfig,
} from '../../hooks/useSkills';

const SCOPE_ICONS: Record<string, typeof FolderDot> = {
	cwd: FolderDot,
	parent: FolderDot,
	repo: FolderDot,
	user: Laptop,
	system: Globe,
};

const SCOPE_LABELS: Record<string, string> = {
	cwd: 'Project',
	parent: 'Parent',
	repo: 'Repository',
	user: 'User',
	system: 'System',
};

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SkillsSidebar = memo(function SkillsSidebar() {
	const isExpanded = useSkillsStore((s) => s.isExpanded);
	const collapseSidebar = useSkillsStore((s) => s.collapseSidebar);
	const skills = useSkillsStore((s) => s.skills);
	const globalEnabled = useSkillsStore((s) => s.globalEnabled);
	const totalCount = useSkillsStore((s) => s.totalCount);
	const enabledCount = useSkillsStore((s) => s.enabledCount);
	const selectedSkill = useSkillsStore((s) => s.selectedSkill);
	const selectSkill = useSkillsStore((s) => s.selectSkill);
	const openViewer = useSkillsStore((s) => s.openViewer);
	const viewingFile = useSkillsStore((s) => s.viewingFile);
	const [searchQuery, setSearchQuery] = useState('');

	const { isLoading, isFetching, refetch } = useSkills();
	const updateSkillsConfig = useUpdateSkillsConfig();
	const { data: skillDetail } = useSkillDetail(selectedSkill);
	const { data: skillFilesData } = useSkillFiles(selectedSkill);
	const skillFiles = skillFilesData?.files ?? [];

	const filteredSkills = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return skills;
		return skills.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				(s.description ?? '').toLowerCase().includes(q),
		);
	}, [skills, searchQuery]);

	const groupedSkills = useMemo(() => {
		const groups = new Map<string, typeof skills>();
		for (const skill of filteredSkills) {
			const list = groups.get(skill.scope) ?? [];
			list.push(skill);
			groups.set(skill.scope, list);
		}
		return groups;
	}, [filteredSkills]);

	if (!isExpanded) return null;

	return (
		<div className="w-full min-w-80 border-l border-sidebar-border sidebar-fade-in flex flex-col h-full">
			<SidebarHeader
				icon={<Sparkles className="size-[15px]" />}
				title="Skills"
				onClose={collapseSidebar}
			>
				<ToggleSwitch
					checked={globalEnabled}
					loading={updateSkillsConfig.isPending}
					onChange={() =>
						updateSkillsConfig.mutate({ enabled: !globalEnabled })
					}
				/>
			</SidebarHeader>

			{!selectedSkill && totalCount > 0 && (
				<div className="px-2 py-2 border-b border-sidebar-border/60">
					<div className="relative">
						<Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search skills..."
							className="w-full h-8 pl-7 pr-7 text-[12px] bg-muted/40 border border-sidebar-border/60 rounded-md outline-none focus:border-foreground/20 placeholder:text-muted-foreground"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery('')}
								className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
								title="Clear search"
							>
								<X className="w-3 h-3" />
							</button>
						)}
					</div>
				</div>
			)}

			{selectedSkill && skillDetail ? (
				<div className="flex-1 overflow-y-auto">
					<div className="p-3 border-b border-border">
						<button
							type="button"
							onClick={() => selectSkill(null)}
							className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							← Back to list
						</button>
					</div>
					<div className="px-3 py-3 border-b border-border">
						<h3 className="font-medium text-sm mb-1">{skillDetail.name}</h3>
						<p className="text-xs text-muted-foreground mb-2">
							{skillDetail.description}
						</p>
						<div className="flex items-center gap-2">
							<span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
								{SCOPE_LABELS[skillDetail.scope] ?? skillDetail.scope}
							</span>
							{skillDetail.license && (
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
									{skillDetail.license}
								</span>
							)}
						</div>
					</div>

					<div className="py-1">
						<div className="flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
							Files
						</div>
						<button
							type="button"
							onClick={() => openViewer(null)}
							className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors ${
								viewingFile === null ? 'bg-accent' : ''
							}`}
						>
							<div className="flex items-center gap-2">
								<FileText className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
								<span className="text-sm font-mono truncate flex-1">
									SKILL.md
								</span>
							</div>
						</button>
						{skillFiles.map((file) => (
							<button
								type="button"
								key={file.relativePath}
								onClick={() => openViewer(file.relativePath)}
								className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors ${
									viewingFile === file.relativePath ? 'bg-accent' : ''
								}`}
							>
								<div className="flex items-center gap-2">
									<FileCode className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
									<span className="text-sm font-mono truncate flex-1">
										{file.relativePath}
									</span>
									<span className="text-[10px] text-muted-foreground flex-shrink-0">
										{formatSize(file.size)}
									</span>
								</div>
							</button>
						))}
					</div>
				</div>
			) : (
				<div className="flex-1 overflow-y-auto">
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<StableSpinner
								className="text-muted-foreground"
								title="Loading skills"
							/>
						</div>
					) : totalCount === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center p-4">
							<Sparkles className="w-12 h-12 text-muted-foreground/30 mb-4" />
							<h3 className="text-sm font-medium mb-2">No skills found</h3>
							<p className="text-xs text-muted-foreground max-w-[220px]">
								Create skills in{' '}
								<code className="text-[10px] bg-muted px-1 rounded">
									.otto/skills/ or .agents/skills/
								</code>{' '}
								or{' '}
								<code className="text-[10px] bg-muted px-1 rounded">
									~/.config/otto/skills/ or ~/.agents/skills/
								</code>
							</p>
						</div>
					) : !globalEnabled ? (
						<div className="flex flex-col items-center justify-center h-full text-center p-4">
							<Sparkles className="w-12 h-12 text-muted-foreground/30 mb-4" />
							<h3 className="text-sm font-medium mb-2">Skills are disabled</h3>
							<p className="text-xs text-muted-foreground max-w-[220px]">
								Turn the skills toggle on to make discovered skills available.
							</p>
						</div>
					) : skills.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center p-4">
							<Sparkles className="w-12 h-12 text-muted-foreground/30 mb-4" />
							<h3 className="text-sm font-medium mb-2">
								All skills are disabled
							</h3>
							<p className="text-xs text-muted-foreground max-w-[220px]">
								Enable individual skills or turn all skills back on.
							</p>
						</div>
					) : filteredSkills.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center p-4">
							<Sparkles className="w-12 h-12 text-muted-foreground/30 mb-4" />
							<h3 className="text-sm font-medium mb-2">No matches</h3>
							<p className="text-xs text-muted-foreground max-w-[220px]">
								No skills match "{searchQuery}".
							</p>
						</div>
					) : (
						<div className="py-1">
							{['cwd', 'parent', 'repo', 'user', 'system'].map((scope) => {
								const scopeSkills = groupedSkills.get(scope);
								if (!scopeSkills?.length) return null;
								const ScopeIcon = SCOPE_ICONS[scope] ?? Globe;
								return (
									<div key={scope}>
										<div className="flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
											<ScopeIcon className="w-3 h-3" />
											{SCOPE_LABELS[scope] ?? scope}
										</div>
										{scopeSkills.map((skill) => (
											<div
												role="button"
												tabIndex={0}
												key={`${skill.scope}-${skill.name}`}
												onClick={() => selectSkill(skill.name)}
												onKeyDown={(event) => {
													if (event.key !== 'Enter' && event.key !== ' ') return;
													event.preventDefault();
													selectSkill(skill.name);
												}}
												className={`w-full cursor-pointer text-left px-3 py-2 hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
													selectedSkill === skill.name ? 'bg-accent' : ''
												}`}
											>
												<div className="flex items-start gap-2">
													<FileText className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
													<div className="min-w-0 flex-1">
														<div className="text-sm font-medium truncate">
															{skill.name}
														</div>
														<div className="text-xs text-muted-foreground truncate">
															{skill.description}
														</div>
													</div>
													<div
														onPointerDown={(event) => event.stopPropagation()}
														onClick={(event) => event.stopPropagation()}
														onKeyDown={(event) => event.stopPropagation()}
													>
														<ToggleSwitch
															checked={skill.enabled !== false}
															loading={updateSkillsConfig.isPending}
															onChange={() =>
																updateSkillsConfig.mutate({
																	items: {
																		[skill.name]: {
																			enabled: skill.enabled === false,
																		},
																	},
																})
															}
														/>
													</div>
												</div>
											</div>
										))}
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}

			<div className="h-12 px-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<Sparkles className="w-3 h-3 flex-shrink-0" />
					<span className="truncate">
						{enabledCount}/{totalCount} {totalCount === 1 ? 'skill' : 'skills'}
					</span>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => refetch()}
					title="Refresh skills"
					className="h-6 w-6 flex-shrink-0"
					disabled={isFetching}
				>
					{isFetching ? (
						<StableSpinner size="xs" title="Refreshing skills" />
					) : (
						<RefreshCw className="w-3 h-3" />
					)}
				</Button>
			</div>
		</div>
	);
});
