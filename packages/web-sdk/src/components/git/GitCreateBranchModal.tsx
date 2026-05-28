import { useEffect, useId, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useCreateGitBranch } from '../../hooks/useGit';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { StableSpinner } from '../ui/StableSpinner';

interface GitCreateBranchModalProps {
	isOpen: boolean;
	onClose: () => void;
	currentBranch?: string;
	startPoint?: string;
	defaultName?: string;
	onCreated?: (branchName: string, checkedOut: boolean) => void;
}

const INVALID_BRANCH_PATTERN = /[\s~^:?*[\]\\]/;

function sanitizeBranchName(name: string) {
	return name.trim();
}

function isValidBranchName(name: string) {
	const trimmed = sanitizeBranchName(name);
	if (!trimmed) return false;
	if (INVALID_BRANCH_PATTERN.test(trimmed)) return false;
	if (trimmed.startsWith('-') || trimmed.endsWith('/')) return false;
	if (trimmed.includes('..')) return false;
	return true;
}

export function GitCreateBranchModal({
	isOpen,
	onClose,
	currentBranch,
	startPoint,
	defaultName = '',
	onCreated,
}: GitCreateBranchModalProps) {
	const inputId = useId();
	const createBranch = useCreateGitBranch();
	const [name, setName] = useState(defaultName);
	const [checkout, setCheckout] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (isOpen) {
			setName(defaultName);
			setCheckout(true);
			setError(null);
			requestAnimationFrame(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			});
		}
	}, [isOpen, defaultName]);

	const base = startPoint ?? currentBranch ?? 'HEAD';
	const trimmed = sanitizeBranchName(name);
	const valid = isValidBranchName(name);

	const handleSubmit = async () => {
		if (!valid) {
			setError('Enter a valid branch name (no spaces or special characters)');
			return;
		}

		setError(null);

		try {
			const result = await createBranch.mutateAsync({
				name: trimmed,
				startPoint,
				checkout,
			});
			onCreated?.(result.branch, result.checkedOut);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create branch');
		}
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			maxWidth="md"
			title={
				<div className="flex items-center gap-2">
					<GitBranch className="h-5 w-5 text-primary" />
					<span>Create branch</span>
				</div>
			}
		>
			<div className="space-y-4">
				<div className="space-y-1.5">
					<label
						htmlFor={inputId}
						className="text-xs font-medium text-muted-foreground"
					>
						Branch name
					</label>
					<input
						id={inputId}
						ref={inputRef}
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && valid && !createBranch.isPending) {
								e.preventDefault();
								handleSubmit();
							}
						}}
						placeholder="feature/my-branch"
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						className="w-full text-sm px-3 py-2 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
					/>
				</div>

				<div className="text-xs text-muted-foreground">
					Creating from{' '}
					<span className="font-medium text-foreground">{base}</span>
				</div>

				<label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
					<input
						type="checkbox"
						checked={checkout}
						onChange={(e) => setCheckout(e.target.checked)}
						className="w-3.5 h-3.5 rounded border-border"
					/>
					Switch to new branch after creating
				</label>

				{error && (
					<div className="text-xs text-orange-500 break-words">{error}</div>
				)}

				<div className="flex justify-end gap-2 pt-2">
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={handleSubmit}
						disabled={!valid || createBranch.isPending}
						className="gap-1.5"
					>
						{createBranch.isPending ? (
							<>
								<StableSpinner size="sm" title="Creating branch" />
								Creating...
							</>
						) : (
							<>
								<GitBranch className="h-3.5 w-3.5" />
								{checkout ? 'Create & switch' : 'Create'}
							</>
						)}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
