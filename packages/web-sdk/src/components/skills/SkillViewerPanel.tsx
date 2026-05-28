import { memo, useEffect } from 'react';
import { X } from 'lucide-react';
import { useSkillsStore } from '../../stores/skillsStore';
import { useSkillDetail, useSkillFileContent } from '../../hooks/useSkills';
import { Button } from '../ui/Button';
import { CodeMirrorViewer } from '../ui/CodeMirrorViewer';
import { ViewerStatusBar } from '../workspace/ViewerStatusBar';

interface SkillViewerPanelProps {
	mode?: 'overlay' | 'pane';
	open?: boolean;
	skillName?: string | null;
	file?: string | null;
	onClose?: () => void;
}

export const SkillViewerPanel = memo(function SkillViewerPanel({
	mode = 'overlay',
	open,
	skillName,
	file,
	onClose,
}: SkillViewerPanelProps = {}) {
	const storeIsViewerOpen = useSkillsStore((s) => s.isViewerOpen);
	const storeViewingFile = useSkillsStore((s) => s.viewingFile);
	const storeSelectedSkill = useSkillsStore((s) => s.selectedSkill);
	const storeCloseViewer = useSkillsStore((s) => s.closeViewer);
	const isViewerOpen = open ?? storeIsViewerOpen;
	const viewingFile = file !== undefined ? file : storeViewingFile;
	const selectedSkill = skillName ?? storeSelectedSkill;
	const closeViewer = onClose ?? storeCloseViewer;

	const { data: skillDetail } = useSkillDetail(selectedSkill);
	const { data: fileData, isLoading: fileLoading } = useSkillFileContent(
		selectedSkill,
		viewingFile,
	);

	const isMainFile = viewingFile === null;
	const content = isMainFile ? skillDetail?.content : fileData?.content;
	const isLoading = isMainFile ? !skillDetail : fileLoading;
	const displayPath = isMainFile ? 'SKILL.md' : (viewingFile ?? '');

	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;
			if (
				(e.key === 'Escape' || (e.key === 'q' && !isInInput)) &&
				isViewerOpen
			) {
				closeViewer();
			}
		};

		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, [isViewerOpen, closeViewer]);

	if (!isViewerOpen || !selectedSkill) return null;

	return (
		<div
			className={
				mode === 'pane'
					? 'h-full w-full bg-transparent flex flex-col'
					: 'absolute inset-0 bg-background z-50 flex flex-col animate-in slide-in-from-left duration-300'
			}
		>
			{mode !== 'pane' && (
				<div className="h-12 border-b border-sidebar-border px-2.5 flex items-center gap-2 shrink-0 bg-sidebar-accent/40">
					<Button
						variant="ghost"
						size="icon"
						onClick={closeViewer}
						title="Close viewer (ESC)"
						className="h-8 w-8"
					>
						<X className="size-[17px]" />
					</Button>
					<div className="flex-1 flex items-center gap-2 min-w-0">
						<span className="text-[13px] text-muted-foreground flex-shrink-0">
							{selectedSkill}
						</span>
						<span className="text-[13px] text-muted-foreground">/</span>
						<span
							className="text-[13px] font-medium text-foreground font-mono truncate"
							title={displayPath}
						>
							{displayPath}
						</span>
					</div>
					<span className="text-[12px] text-muted-foreground pr-1">file</span>
				</div>
			)}

			<div className="flex-1 min-h-0">
				{isLoading ? (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Loading...
					</div>
				) : content ? (
					<CodeMirrorViewer content={content} path={displayPath} />
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						Unable to load file
					</div>
				)}
			</div>
			<ViewerStatusBar
				tone="neutral"
				label={selectedSkill}
				path={displayPath}
			/>
		</div>
	);
});
