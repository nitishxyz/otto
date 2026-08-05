/** Appends a final dictation transcript without breaking Markdown blocks. */
export function appendDictationTranscript(
	base: string,
	transcript: string,
): string {
	if (!transcript) return base;
	if (!base) return transcript;
	if (/^(?:- |\d+\. )/.test(transcript)) {
		return `${base.trimEnd()}\n\n${transcript}`;
	}
	return `${base}${/\s$/.test(base) ? '' : ' '}${transcript}`;
}
