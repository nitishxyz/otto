import { useKeyboard } from '@opentui/react';
import { useCallback, useRef, useState } from 'react';
import { useTheme } from '../theme.ts';
import type { PendingSecureInput } from '../types.ts';
import { ModalFrame } from './ModalFrame.tsx';

interface SecureInputBarProps {
	pendingInput: PendingSecureInput;
	onSubmit: (promptId: string, value: string) => Promise<void> | void;
	onCancel: (promptId: string) => Promise<void> | void;
}

export function SecureInputBar({
	pendingInput,
	onSubmit,
	onCancel,
}: SecureInputBarProps) {
	const { colors } = useTheme();
	const [value, setValue] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const valueRef = useRef(value);
	const submittingRef = useRef(submitting);
	valueRef.current = value;
	submittingRef.current = submitting;

	const submit = useCallback(async () => {
		if (submittingRef.current) return;
		setSubmitting(true);
		try {
			await onSubmit(pendingInput.promptId, valueRef.current);
			setValue('');
		} finally {
			setSubmitting(false);
		}
	}, [onSubmit, pendingInput.promptId]);

	const cancel = useCallback(async () => {
		if (submittingRef.current) return;
		setSubmitting(true);
		try {
			await onCancel(pendingInput.promptId);
			setValue('');
		} finally {
			setSubmitting(false);
		}
	}, [onCancel, pendingInput.promptId]);

	useKeyboard((key) => {
		if (submittingRef.current) return;
		if (key.name === 'return') {
			key.preventDefault();
			key.stopPropagation();
			void submit();
			return;
		}
		if (key.name === 'escape') {
			key.preventDefault();
			key.stopPropagation();
			void cancel();
			return;
		}
		if (key.name === 'backspace') {
			key.preventDefault();
			key.stopPropagation();
			setValue((prev) => prev.slice(0, -1));
			return;
		}
		if (key.ctrl || key.meta || key.super || key.hyper) return;
		const text = key.name === 'space' ? ' ' : key.sequence;
		if (!text || text.length !== 1 || text.charCodeAt(0) < 32) return;
		key.preventDefault();
		key.stopPropagation();
		setValue((prev) => `${prev}${text}`);
	});

	const displayedValue =
		pendingInput.inputKind === 'password'
			? '•'.repeat(Math.min(value.length, 32))
			: value;

	return (
		<ModalFrame
			title={
				pendingInput.inputKind === 'password'
					? 'Password required'
					: 'Input required'
			}
			size="sm"
			maxHeightRatio={0.5}
			footer="Enter send  ·  Esc cancel"
		>
			<box style={{ flexDirection: 'column', gap: 1, width: '100%' }}>
				<text fg={colors.fgMuted}>{pendingInput.prompt}</text>
				<box style={{ flexDirection: 'row', gap: 1, width: '100%' }}>
					<text fg={colors.yellow}>❯</text>
					<text fg={colors.fgBright}>{displayedValue}</text>
					{value.length === 0 && (
						<text fg={colors.fgDark}>
							{pendingInput.inputKind === 'password'
								? 'type secret…'
								: 'type response…'}
						</text>
					)}
					{submitting && <text fg={colors.blue}>sending…</text>}
				</box>
				<text fg={colors.fgDark}>
					Sent directly to the running process. Not added to chat history.
				</text>
			</box>
		</ModalFrame>
	);
}
