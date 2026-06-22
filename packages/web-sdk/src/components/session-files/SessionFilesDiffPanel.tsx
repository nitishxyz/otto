import { useEffect, useMemo, memo } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSessionFilesStore } from '../../stores/sessionFilesStore';
import type { SessionFileOperation } from '../../types/api';
import { Button } from '../ui/Button';
import {
	CodeMirrorViewer,
	type CodeMirrorLineTone,
} from '../ui/CodeMirrorViewer';
import {
	ViewerStatusBar,
	countPatchTextChanges,
	normalizeChangeCount,
} from '../workspace/ViewerStatusBar';

function isSessionPatchSeparatorLine(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.length > 0 && /^=+$/.test(trimmed);
}

function isSessionPatchMetadataLine(line: string): boolean {
	if (line.startsWith('@@')) return true;
	if (isSessionPatchSeparatorLine(line)) return true;
	if (line.startsWith('*** ')) return true;
	return (
		line.startsWith('diff --git ') ||
		line.startsWith('index ') ||
		line.startsWith('--- ') ||
		line.startsWith('+++ ') ||
		line.startsWith('new file mode ') ||
		line.startsWith('deleted file mode ') ||
		line.startsWith('old mode ') ||
		line.startsWith('new mode ') ||
		line.startsWith('similarity index ') ||
		line.startsWith('dissimilarity index ') ||
		line.startsWith('rename from ') ||
		line.startsWith('rename to ') ||
		line.startsWith('copy from ') ||
		line.startsWith('copy to ')
	);
}

function parseHunkHeader(
	line: string,
): { oldStart: number; newStart: number } | null {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
	if (!match) return null;
	return {
		oldStart: Number.parseInt(match[1], 10),
		newStart: Number.parseInt(match[2], 10),
	};
}

function normalizePatchPath(path: string): string {
	return path
		.trim()
		.replace(/^a\//, '')
		.replace(/^b\//, '')
		.replace(/^\.\//, '')
		.replace(/\/+/g, '/')
		.replace(/\/+$/, '');
}

function patchPathsMatch(left: string, right: string): boolean {
	const normalizedLeft = normalizePatchPath(left);
	const normalizedRight = normalizePatchPath(right);
	return (
		normalizedLeft === normalizedRight ||
		normalizedLeft.endsWith(`/${normalizedRight}`) ||
		normalizedRight.endsWith(`/${normalizedLeft}`)
	);
}

function pathFromUnifiedHeader(line: string): string | null {
	const match = /^(?:---|\+\+\+)\s+(.+)$/.exec(line);
	if (!match) return null;
	const path = match[1].trim().split(/\s+/)[0] ?? '';
	return path === '/dev/null' ? null : normalizePatchPath(path);
}

function createRawPatchDisplay(patch: string) {
	return {
		content: patch,
		lineNumbers: new Map<number, string>(),
		lineTones: new Map<number, CodeMirrorLineTone>(),
	};
}

function buildSessionPatchDisplay(patch: string): {
	content: string;
	lineNumbers: Map<number, string>;
	lineTones: Map<number, CodeMirrorLineTone>;
} {
	return createRawPatchDisplay(patch);
}

function buildDiffDisplayFromLines(lines: string[]): {
	content: string;
	lineNumbers: Map<number, string>;
	lineTones: Map<number, CodeMirrorLineTone>;
} | null {
	const contentLines: string[] = [];
	const lineNumbers = new Map<number, string>();
	const lineTones = new Map<number, CodeMirrorLineTone>();
	let oldLine: number | null = null;
	let newLine: number | null = null;
	let sawDiffLine = false;

	for (const line of lines) {
		const hunk = parseHunkHeader(line);
		if (hunk) {
			oldLine = hunk.oldStart;
			newLine = hunk.newStart;
			continue;
		}

		if (isSessionPatchMetadataLine(line)) continue;

		const lineNumber = contentLines.length + 1;

		contentLines.push(line);
		if (line.startsWith('+') && !line.startsWith('+++')) {
			sawDiffLine = true;
			if (newLine !== null) {
				lineNumbers.set(lineNumber, String(newLine));
				newLine += 1;
			}
			lineTones.set(lineNumber, 'add');
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			sawDiffLine = true;
			if (oldLine !== null) {
				lineNumbers.set(lineNumber, String(oldLine));
				oldLine += 1;
			}
			lineTones.set(lineNumber, 'remove');
		} else if (oldLine !== null && newLine !== null) {
			lineNumbers.set(lineNumber, String(newLine));
			oldLine += 1;
			newLine += 1;
		}
	}
	if (!sawDiffLine && contentLines.length === 0) return null;

	return {
		content: contentLines.join('\n'),
		lineNumbers,
		lineTones,
	};
}

function buildUnifiedPatchDisplay(patch: string, filePath: string) {
	const selectedLines: string[] = [];
	const lines = patch.split('\n');
	let currentFileMatches = false;
	let sawUnifiedFileHeader = false;

	for (const line of lines) {
		if (line.startsWith('diff --git ')) {
			currentFileMatches = false;
			continue;
		}
		const headerPath = pathFromUnifiedHeader(line);
		if (headerPath) {
			sawUnifiedFileHeader = true;
			if (patchPathsMatch(headerPath, filePath)) currentFileMatches = true;
			continue;
		}
		if (!currentFileMatches && sawUnifiedFileHeader) continue;
		if (currentFileMatches) selectedLines.push(line);
	}

	return selectedLines.length > 0
		? buildDiffDisplayFromLines(selectedLines)
		: null;
}

function buildEnvelopedPatchDisplay(patch: string, filePath: string) {
	const outputLines: string[] = [];
	const lines = patch.split('\n');
	let currentMatches = false;
	let mode: 'diff' | 'add' | 'find' | 'with' | 'unsupported' | null = null;
	let unsupportedForTarget = false;

	for (const line of lines) {
		const fileDirective = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
		if (fileDirective) {
			currentMatches = patchPathsMatch(fileDirective[2], filePath);
			mode =
				fileDirective[1] === 'Update'
					? 'diff'
					: fileDirective[1] === 'Add'
						? 'add'
						: 'unsupported';
			if (currentMatches && mode === 'unsupported') unsupportedForTarget = true;
			continue;
		}

		const replaceDirective = /^\*\*\* Replace in: (.+)$/.exec(line);
		if (replaceDirective) {
			currentMatches = patchPathsMatch(replaceDirective[1], filePath);
			mode = null;
			continue;
		}

		const lineDirective =
			/^\*\*\* (?:Delete Lines in|Replace Lines in|Insert Before in|Insert After in): (.+)$/.exec(
				line,
			);
		if (lineDirective) {
			currentMatches = patchPathsMatch(lineDirective[1], filePath);
			mode = 'unsupported';
			if (currentMatches) unsupportedForTarget = true;
			continue;
		}

		if (!currentMatches) continue;

		if (line === '*** Find:') {
			mode = 'find';
			continue;
		}
		if (line === '*** With:') {
			mode = 'with';
			continue;
		}
		if (line.startsWith('*** ')) continue;

		if (mode === 'unsupported') continue;
		if (mode === 'find') {
			outputLines.push(`-${line}`);
			continue;
		}
		if (mode === 'with') {
			outputLines.push(`+${line}`);
			continue;
		}
		if (mode === 'add') {
			outputLines.push(line.startsWith('+') ? line : `+${line}`);
			continue;
		}
		outputLines.push(line);
	}

	if (unsupportedForTarget && outputLines.length === 0) return null;
	return outputLines.length > 0 ? buildDiffDisplayFromLines(outputLines) : null;
}

function buildSessionPatchDisplayForFile(patch: string, filePath: string) {
	const unifiedDisplay = buildUnifiedPatchDisplay(patch, filePath);
	if (unifiedDisplay) return unifiedDisplay;
	const envelopedDisplay = buildEnvelopedPatchDisplay(patch, filePath);
	if (envelopedDisplay) return envelopedDisplay;
	return buildSessionPatchDisplay(patch);
}

function FullHeightDiffView({
	patch,
	filePath,
}: {
	patch: string;
	filePath: string;
}) {
	const display = useMemo(
		() => buildSessionPatchDisplayForFile(patch, filePath),
		[patch, filePath],
	);

	return (
		<CodeMirrorViewer
			content={display.content}
			path={filePath}
			lineTones={display.lineTones}
			lineNumberFormatter={(lineNumber) =>
				display.lineNumbers.get(lineNumber) ?? ''
			}
			disableMarkdownSyntax
		/>
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

			<div className="flex-1 overflow-auto min-h-0">
				{patchContent ? (
					<FullHeightDiffView patch={patchContent} filePath={selectedFile} />
				) : (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						No diff content available
					</div>
				)}
			</div>
			{(() => {
				const summary = selectedOperation.artifact?.summary;
				const summaryCount = summary
					? normalizeChangeCount({
							additions: summary.additions,
							removals: summary.deletions,
						})
					: undefined;
				const patchCount = summaryCount
					? undefined
					: countPatchTextChanges(patchContent ?? undefined, selectedFile);
				const operation = selectedOperation.operation;
				const tone =
					operation === 'write' || operation === 'create' ? 'write' : 'patch';
				const label =
					operation === 'write'
						? 'Write'
						: operation === 'create'
							? 'Create'
							: operation === 'patch'
								? 'Patch'
								: operation;
				return (
					<ViewerStatusBar
						tone={tone}
						label={typeof label === 'string' ? label : 'Change'}
						path={selectedFile}
						changeCount={summaryCount ?? patchCount}
					/>
				);
			})()}
		</div>
	);
});
