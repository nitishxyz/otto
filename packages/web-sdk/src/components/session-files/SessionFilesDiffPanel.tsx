import { useEffect, useMemo, memo } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSessionFilesStore } from '../../stores/sessionFilesStore';
import type { SessionFileOperation } from '../../types/api';
import { Button } from '../ui/Button';
import {
	CodeMirrorViewer,
	type CodeMirrorLineTone,
} from '../ui/CodeMirrorViewer';

function transformToUnifiedDiff(patch: string): string {
	const lines = patch.split('\n');
	const result: string[] = [];
	let addCount = 0;
	let removeCount = 0;
	const diffLines: string[] = [];

	for (const line of lines) {
		if (
			line.startsWith('*** Begin Patch') ||
			line.startsWith('*** End Patch') ||
			line.startsWith('*** Update File:') ||
			line.startsWith('*** Add File:') ||
			line.startsWith('*** Delete File:')
		) {
			if (diffLines.length > 0) {
				result.push(`@@ -1,${removeCount} +1,${addCount} @@`);
				result.push(...diffLines);
				diffLines.length = 0;
				addCount = 0;
				removeCount = 0;
			}
			result.push(line);
			continue;
		}

		if (line.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/)) {
			if (diffLines.length > 0) {
				result.push(`@@ -1,${removeCount} +1,${addCount} @@`);
				result.push(...diffLines);
				diffLines.length = 0;
				addCount = 0;
				removeCount = 0;
			}
			result.push(line);
			continue;
		}

		if (line.startsWith('@@')) {
			result.push(line);
			continue;
		}

		if (line.startsWith('+')) {
			addCount++;
			diffLines.push(line);
		} else if (line.startsWith('-')) {
			removeCount++;
			diffLines.push(line);
		} else if (line.startsWith(' ') || line.startsWith('\t')) {
			addCount++;
			removeCount++;
			diffLines.push(line.startsWith('\t') ? ` ${line}` : line);
		} else if (line.trim() === '') {
			diffLines.push(' ');
			addCount++;
			removeCount++;
		} else {
			addCount++;
			removeCount++;
			diffLines.push(` ${line}`);
		}
	}

	if (diffLines.length > 0) {
		result.push(`@@ -1,${removeCount} +1,${addCount} @@`);
		result.push(...diffLines);
	}

	return result.join('\n');
}

function getPatchLineTones(patch: string): Map<number, CodeMirrorLineTone> {
	const tones = new Map<number, CodeMirrorLineTone>();
	const lines = patch.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const lineNumber = index + 1;
		if (line.startsWith('@@')) {
			tones.set(lineNumber, 'primary');
		} else if (line.startsWith('+') && !line.startsWith('+++')) {
			tones.set(lineNumber, 'add');
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			tones.set(lineNumber, 'remove');
		}
	}
	return tones;
}

function FullHeightDiffView({
	patch,
	filePath,
}: {
	patch: string;
	filePath: string;
}) {
	return (
		<div className="bg-card/60 border border-border rounded-lg overflow-hidden h-full">
			<CodeMirrorViewer
				content={patch}
				path={filePath}
				lineTones={getPatchLineTones(patch)}
			/>
		</div>
	);
}

function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface SessionFilesDiffPanelProps {
	mode?: 'overlay' | 'pane';
	open?: boolean;
	file?: string | null;
	operations?: SessionFileOperation[];
	operationIndex?: number;
	onOperationIndexChange?: (index: number) => void;
	onClose?: () => void;
}

export const SessionFilesDiffPanel = memo(function SessionFilesDiffPanel({
	mode = 'overlay',
	open,
	file,
	operations,
	operationIndex,
	onOperationIndexChange,
	onClose,
}: SessionFilesDiffPanelProps = {}) {
	const storeIsDiffOpen = useSessionFilesStore((state) => state.isDiffOpen);
	const storeSelectedFile = useSessionFilesStore((state) => state.selectedFile);
	const storeAllOperations = useSessionFilesStore(
		(state) => state.allOperations,
	);
	const storeSelectedOperationIndex = useSessionFilesStore(
		(state) => state.selectedOperationIndex,
	);
	const storeSelectOperation = useSessionFilesStore(
		(state) => state.selectOperation,
	);
	const storeCloseDiff = useSessionFilesStore((state) => state.closeDiff);
	const isDiffOpen = open ?? storeIsDiffOpen;
	const selectedFile = file ?? storeSelectedFile;
	const allOperations = operations ?? storeAllOperations;
	const selectedOperationIndex = operationIndex ?? storeSelectedOperationIndex;
	const selectOperation = onOperationIndexChange ?? storeSelectOperation;
	const closeDiff = onClose ?? storeCloseDiff;

	const selectedOperation = allOperations[selectedOperationIndex];

	const patchContent = useMemo(() => {
		if (!selectedOperation || !selectedFile) return null;

		let rawPatch: string | null = null;

		if (selectedOperation.artifact?.patch) {
			rawPatch = selectedOperation.artifact.patch;
		} else if (selectedOperation.patch) {
			rawPatch = selectedOperation.patch;
		} else if (selectedOperation.content) {
			const contentLines = selectedOperation.content.split('\n');
			rawPatch = `*** Add File: ${selectedFile}\n${contentLines.map((line) => `+${line}`).join('\n')}`;
		}

		if (!rawPatch) return null;

		const hasProperHunkHeader = /@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(
			rawPatch,
		);
		if (!hasProperHunkHeader) {
			return transformToUnifiedDiff(rawPatch);
		}

		return rawPatch;
	}, [selectedOperation, selectedFile]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInInput =
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable;

			if ((e.key === 'Escape' || (e.key === 'q' && !isInInput)) && isDiffOpen) {
				closeDiff();
			}

			if (!isInInput && isDiffOpen && allOperations.length > 1) {
				if (e.key === 'ArrowLeft' || e.key === '[') {
					e.preventDefault();
					selectOperation(Math.max(0, selectedOperationIndex - 1));
				} else if (e.key === 'ArrowRight' || e.key === ']') {
					e.preventDefault();
					selectOperation(
						Math.min(allOperations.length - 1, selectedOperationIndex + 1),
					);
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [
		isDiffOpen,
		closeDiff,
		allOperations.length,
		selectedOperationIndex,
		selectOperation,
	]);

	if (!isDiffOpen || !selectedFile || !selectedOperation) return null;

	const hasMultipleOps = allOperations.length > 1;

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
						onClick={closeDiff}
						title="Close diff viewer (ESC)"
						className="h-8 w-8"
					>
						<X className="size-[17px]" />
					</Button>
					<div className="flex-1 flex items-center gap-2 min-w-0">
						<span
							className="text-[13px] font-medium text-foreground font-mono truncate"
							title={selectedFile}
						>
							{selectedFile}
						</span>
						<span className="text-[12px] px-1.5 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0 capitalize">
							{selectedOperation.operation}
						</span>
						{selectedOperation.artifact?.summary && (
							<div className="flex items-center gap-1 text-[12px] flex-shrink-0">
								<span className="text-green-500">
									+{selectedOperation.artifact.summary.additions}
								</span>
								<span className="text-red-500">
									-{selectedOperation.artifact.summary.deletions}
								</span>
							</div>
						)}
					</div>

					{hasMultipleOps && (
						<div className="flex items-center gap-1 shrink-0">
							<Button
								variant="ghost"
								size="icon"
								onClick={() =>
									selectOperation(Math.max(0, selectedOperationIndex - 1))
								}
								disabled={selectedOperationIndex === 0}
								title="Previous operation (←)"
								className="h-8 w-8"
							>
								<ChevronLeft className="size-[17px]" />
							</Button>
							<span className="text-[11px] text-muted-foreground min-w-[50px] text-center">
								{selectedOperationIndex + 1} / {allOperations.length}
							</span>
							<Button
								variant="ghost"
								size="icon"
								onClick={() =>
									selectOperation(
										Math.min(
											allOperations.length - 1,
											selectedOperationIndex + 1,
										),
									)
								}
								disabled={selectedOperationIndex === allOperations.length - 1}
								title="Next operation (→)"
								className="h-8 w-8"
							>
								<ChevronRight className="size-[17px]" />
							</Button>
						</div>
					)}
				</div>
			)}

			{hasMultipleOps && (
				<div className="border-b border-border px-2 py-1.5 flex gap-1.5 overflow-x-auto shrink-0">
					{allOperations.map((op, idx) => (
						<button
							type="button"
							key={op.toolCallId}
							onClick={() => selectOperation(idx)}
							className={`px-2 py-1 text-[11px] rounded-md flex items-center gap-1.5 shrink-0 transition-colors ${
								idx === selectedOperationIndex
									? 'bg-primary text-primary-foreground'
									: 'bg-muted hover:bg-muted/80 text-muted-foreground'
							}`}
						>
							<span className="capitalize">{op.operation}</span>
							<span className="opacity-70">
								{formatTimestamp(op.timestamp)}
							</span>
							{op.artifact?.summary && (
								<span className="opacity-70">
									+{op.artifact.summary.additions}/-
									{op.artifact.summary.deletions}
								</span>
							)}
						</button>
					))}
				</div>
			)}

			<div className="flex-1 overflow-hidden p-4">
				{patchContent ? (
					<FullHeightDiffView patch={patchContent} filePath={selectedFile} />
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						No diff content available
					</div>
				)}
			</div>
		</div>
	);
});
