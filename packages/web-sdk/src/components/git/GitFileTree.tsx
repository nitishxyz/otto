import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { GitFileStatus } from '../../types/api';
import { useFocusStore } from '../../stores/focusStore';
import { useGitStore, type GitTreeRow } from '../../stores/gitStore';
import { GitFileItem } from './GitFileItem';

interface GitFileTreeProps {
	sectionId: string;
	files: GitFileStatus[];
	staged: boolean;
	onToggleFolder: (paths: string[]) => void;
	showModifiedIndicator?: (file: GitFileStatus) => boolean;
}

interface TreeFileNode {
	type: 'file';
	name: string;
	path: string;
	file: GitFileStatus;
}

interface TreeFolderNode {
	type: 'folder';
	name: string;
	path: string;
	children: TreeNode[];
	files: GitFileStatus[];
}

type TreeNode = TreeFileNode | TreeFolderNode;

const INDENT_SIZE = 12;
const FILE_CARET_OFFSET = 32;

function getFileIndent(depth: number) {
	return depth === 0 ? 0 : FILE_CARET_OFFSET + (depth - 1) * INDENT_SIZE;
}

function createFolder(name: string, path: string): TreeFolderNode {
	return {
		type: 'folder',
		name,
		path,
		children: [],
		files: [],
	};
}

function buildTree(files: GitFileStatus[]): TreeNode[] {
	const root = createFolder('', '');
	const folders = new Map<string, TreeFolderNode>([['', root]]);

	files.forEach((file) => {
		const parts = file.path.split('/').filter(Boolean);
		let current = root;
		let currentPath = '';

		parts.slice(0, -1).forEach((part) => {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			let folder = folders.get(currentPath);
			if (!folder) {
				folder = createFolder(part, currentPath);
				folders.set(currentPath, folder);
				current.children.push(folder);
			}
			folder.files.push(file);
			current = folder;
		});

		current.children.push({
			type: 'file',
			name: parts.at(-1) ?? file.path,
			path: file.path,
			file,
		});
	});

	const sortNodes = (nodes: TreeNode[]) => {
		nodes.sort((a, b) => {
			if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		for (const node of nodes) {
			if (node.type === 'folder') sortNodes(node.children);
		}
	};

	sortNodes(root.children);
	return compactFolderChains(root.children);
}

function compactFolderChains(nodes: TreeNode[]): TreeNode[] {
	return nodes.map((node) => {
		if (node.type === 'file') return node;

		let compacted: TreeFolderNode = {
			...node,
			children: compactFolderChains(node.children),
		};

		let folderChildren = compacted.children.filter(
			(child) => child.type === 'folder',
		) as TreeFolderNode[];
		let fileChildren = compacted.children.filter(
			(child) => child.type === 'file',
		);

		while (folderChildren.length === 1 && fileChildren.length === 0) {
			const child = folderChildren[0];
			compacted = {
				type: 'folder',
				name: `${compacted.name}/${child.name}`,
				path: child.path,
				children: child.children,
				files: child.files,
			};

			folderChildren = compacted.children.filter(
				(grandchild) => grandchild.type === 'folder',
			) as TreeFolderNode[];
			fileChildren = compacted.children.filter(
				(grandchild) => grandchild.type === 'file',
			);
		}

		return compacted;
	});
}

function getInitialExpanded(nodes: TreeNode[]) {
	const expanded = new Set<string>();
	const visit = (node: TreeNode) => {
		if (node.type === 'folder') {
			expanded.add(node.path);
			node.children.forEach(visit);
		}
	};
	nodes.forEach(visit);
	return expanded;
}

function getNodeId(sectionId: string, node: TreeNode) {
	return `${sectionId}:${node.type}:${node.path}`;
}

function collectVisibleRows(
	nodes: TreeNode[],
	sectionId: string,
	staged: boolean,
	expanded: Set<string>,
	toggleExpanded: (path: string) => void,
): GitTreeRow[] {
	return nodes.flatMap((node): GitTreeRow[] => {
		if (node.type === 'file') {
			return [
				{
					id: getNodeId(sectionId, node),
					type: 'file',
					path: node.path,
					staged,
					status: node.file.status,
					actionPaths: [node.path],
					open: () => useGitStore.getState().openDiff(node.path, staged),
				},
			];
		}

		const row: GitTreeRow = {
			id: getNodeId(sectionId, node),
			type: 'folder',
			path: node.path,
			staged,
			actionPaths: node.files.map((file) => file.path),
			toggleExpanded: () => toggleExpanded(node.path),
		};

		return expanded.has(node.path)
			? [
					row,
					...collectVisibleRows(
						node.children,
						sectionId,
						staged,
						expanded,
						toggleExpanded,
					),
				]
			: [row];
	});
}

export function GitFileTree({
	sectionId,
	files,
	staged,
	onToggleFolder,
	showModifiedIndicator,
}: GitFileTreeProps) {
	const tree = useMemo(() => buildTree(files), [files]);
	const [expanded, setExpanded] = useState(() => getInitialExpanded(tree));
	const currentFocus = useFocusStore((state) => state.currentFocus);
	const gitFileIndex = useFocusStore((state) => state.gitFileIndex);
	const gitTreeRows = useGitStore((state) => state.gitTreeRows);
	const setGitTreeSectionRows = useGitStore(
		(state) => state.setGitTreeSectionRows,
	);

	useEffect(() => {
		const folderPaths = getInitialExpanded(tree);
		setExpanded((prev) => {
			const hasNewFolder = [...folderPaths].some((path) => !prev.has(path));
			return hasNewFolder ? new Set([...folderPaths, ...prev]) : prev;
		});
	}, [tree]);

	const toggleExpanded = useCallback((path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const visibleRows = useMemo(
		() => collectVisibleRows(tree, sectionId, staged, expanded, toggleExpanded),
		[tree, sectionId, staged, expanded, toggleExpanded],
	);

	useEffect(() => {
		setGitTreeSectionRows(sectionId, visibleRows);
		return () => setGitTreeSectionRows(sectionId, []);
	}, [sectionId, visibleRows, setGitTreeSectionRows]);

	const focusedRow =
		currentFocus === 'git' ? gitTreeRows[gitFileIndex] : undefined;
	const isRowFocused = (id: string) => focusedRow?.id === id;
	const scrollFocusedRow = (
		element: HTMLDivElement | null,
		focused: boolean,
	) => {
		if (element && focused) {
			element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	};

	const renderNode = (node: TreeNode, depth: number): ReactNode => {
		const rowId = getNodeId(sectionId, node);
		const focused = isRowFocused(rowId);

		if (node.type === 'file') {
			return (
				<div
					key={node.path}
					ref={(el) => scrollFocusedRow(el, focused)}
					className={focused ? 'ring-1 ring-inset ring-primary/40' : ''}
				>
					<GitFileItem
						file={node.file}
						staged={staged}
						displayPath={node.name}
						indent={getFileIndent(depth)}
						showModifiedIndicator={showModifiedIndicator?.(node.file) ?? false}
					/>
				</div>
			);
		}

		const isExpanded = expanded.has(node.path);
		return (
			<div key={node.path}>
				<div
					ref={(el) => scrollFocusedRow(el, focused)}
					className={`flex items-center gap-2 px-3 py-1.5 h-8 text-left hover:bg-muted/50 transition-colors group ${
						focused ? 'ring-1 ring-inset ring-primary/40 bg-muted/50' : ''
					}`}
				>
					<span
						style={{ width: depth * INDENT_SIZE }}
						className="flex-shrink-0"
					/>
					<button
						type="button"
						onClick={() => toggleExpanded(node.path)}
						className="p-0.5 -m-0.5 rounded hover:bg-muted transition-colors"
						aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.path}`}
					>
						{isExpanded ? (
							<ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
						) : (
							<ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
						)}
					</button>
					<input
						type="checkbox"
						checked={staged}
						onChange={() => onToggleFolder(node.files.map((file) => file.path))}
						className="w-4 h-4 rounded border-border flex-shrink-0"
						aria-label={`${staged ? 'Unstage' : 'Stage'} ${node.path}`}
					/>
					<button
						type="button"
						onClick={() => toggleExpanded(node.path)}
						className="flex items-center gap-2 flex-1 min-w-0 text-left"
						title={node.path}
					>
						<Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
						<span className="text-sm font-mono text-foreground truncate">
							{node.name}/
						</span>
					</button>
					<span className="text-[10px] text-muted-foreground flex-shrink-0">
						{node.files.length} {node.files.length === 1 ? 'file' : 'files'}
					</span>
				</div>
				{isExpanded &&
					node.children.map((child) => renderNode(child, depth + 1))}
			</div>
		);
	};

	return <div>{tree.map((node) => renderNode(node, 0))}</div>;
}
