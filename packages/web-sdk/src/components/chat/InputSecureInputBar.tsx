import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { allowsEmptySecureInput } from '../../lib/secure-input-prompt';
import { useSecureInputStore } from '../../stores/secureInputStore';

interface InputSecureInputBarProps {
	sessionId: string;
}

export const InputSecureInputBar = memo(function InputSecureInputBar({
	sessionId,
}: InputSecureInputBarProps) {
	const pendingInputs = useSecureInputStore((s) => s.pendingInputs);
	const pending = pendingInputs[0];
	if (!pending) return null;
	return (
		<SecureInputDialog
			key={pending.promptId}
			sessionId={sessionId}
			promptId={pending.promptId}
			prompt={pending.prompt}
			inputKind={pending.inputKind}
			allowRemember={pending.allowRemember}
			allowEmpty={allowsEmptySecureInput(pending.prompt, pending.allowEmpty)}
		/>
	);
});

interface SecureInputDialogProps {
	sessionId: string;
	promptId: string;
	prompt: string;
	inputKind: 'password' | 'text';
	allowRemember: boolean;
	allowEmpty: boolean;
}

const SecureInputDialog = memo(function SecureInputDialog({
	sessionId,
	promptId,
	prompt,
	inputKind,
	allowRemember,
	allowEmpty,
}: SecureInputDialogProps) {
	const removePendingInput = useSecureInputStore((s) => s.removePendingInput);
	const [value, setValue] = useState('');
	const [remember, setRemember] = useState(allowRemember);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	const inputId = useId();

	const isSecret = inputKind === 'password';
	const showPrompt =
		!isSecret ||
		!/^(?:password|passphrase|pin|token|verification code)\s*:?$/i.test(
			prompt.trim(),
		);

	useEffect(() => {
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);

	const handleSubmit = useCallback(async () => {
		if (submitting || (!value && !allowEmpty)) return;
		setSubmitting(true);
		setError(null);
		try {
			await apiClient.submitSecureInput(
				sessionId,
				promptId,
				value,
				allowRemember ? remember : false,
			);
			removePendingInput(promptId);
			setValue('');
		} catch (err) {
			console.error('Failed to submit secure input:', err);
			setError(err instanceof Error ? err.message : 'Failed to send response');
			setSubmitting(false);
		}
	}, [
		allowRemember,
		allowEmpty,
		promptId,
		remember,
		removePendingInput,
		sessionId,
		submitting,
		value,
	]);

	const handleCancel = useCallback(async () => {
		if (submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			await apiClient.cancelSecureInput(sessionId, promptId);
			removePendingInput(promptId);
			setValue('');
		} catch (err) {
			console.error('Failed to cancel secure input:', err);
			setError(err instanceof Error ? err.message : 'Failed to cancel');
			setSubmitting(false);
		}
	}, [promptId, removePendingInput, sessionId, submitting]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			void handleCancel();
		};
		document.addEventListener('keydown', handleKeyDown, true);
		return () => document.removeEventListener('keydown', handleKeyDown, true);
	}, [handleCancel]);

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={showPrompt ? descriptionId : undefined}
			className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void handleSubmit();
				}}
				className="w-full max-w-sm rounded-lg border border-border bg-background shadow-lg"
			>
				<div className="flex items-start justify-between gap-3 border-b border-border p-3">
					<div className="flex min-w-0 items-start gap-2">
						<KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
						<div className="min-w-0">
							<h2
								id={titleId}
								className="text-sm font-semibold text-foreground"
							>
								{isSecret ? 'Password required' : 'Input required'}
							</h2>
							{showPrompt && (
								<p
									id={descriptionId}
									className="mt-0.5 break-words text-xs text-muted-foreground"
								>
									{prompt}
								</p>
							)}
						</div>
					</div>
					<button
						type="button"
						onClick={handleCancel}
						disabled={submitting}
						className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
						aria-label="Cancel request"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="flex flex-col gap-2.5 p-3">
					<div>
						<label htmlFor={inputId} className="sr-only">
							{isSecret ? 'Password or passphrase' : 'Response'}
						</label>
						<input
							id={inputId}
							ref={inputRef}
							type={isSecret ? 'password' : 'text'}
							value={value}
							onChange={(event) => setValue(event.target.value)}
							placeholder={
								isSecret
									? 'Password'
									: allowEmpty
										? 'Response (optional)'
										: 'Response'
							}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
						/>
					</div>

					{allowRemember && (
						<label className="flex cursor-pointer select-none items-center gap-2 text-xs text-foreground">
							<input
								type="checkbox"
								checked={remember}
								onChange={(event) => setRemember(event.target.checked)}
								className="h-3.5 w-3.5 rounded border-border"
							/>
							Remember 15 min
						</label>
					)}

					<p className="text-[11px] text-muted-foreground/80">
						Process only · not saved
					</p>

					{error && (
						<p className="break-words text-xs text-orange-500">{error}</p>
					)}
				</div>

				<div className="flex justify-end gap-2 border-t border-border p-3">
					<button
						type="button"
						onClick={handleCancel}
						disabled={submitting}
						className="rounded px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={submitting || (!value && !allowEmpty)}
						className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
					>
						{submitting
							? 'Sending…'
							: allowEmpty && !value
								? 'Continue'
								: 'Send'}
					</button>
				</div>
			</form>
		</div>
	);
});
