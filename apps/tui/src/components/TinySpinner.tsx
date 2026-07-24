import { memo, useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;

interface TinySpinnerProps {
	fg: string;
}

/** Minimal braille spinner. No external deps or renderable registration. */
export const TinySpinner = memo(function TinySpinner({ fg }: TinySpinnerProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setFrame((prev) => (prev + 1) % FRAMES.length);
		}, FRAME_MS);
		return () => clearInterval(timer);
	}, []);

	return <text fg={fg}>{FRAMES[frame]}</text>;
});
