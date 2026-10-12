/** Only complete inline image bytes may become a data URL, never stream previews. */
export function getReadImageSource(result: unknown): string | undefined {
	if (!result || typeof result !== 'object') return undefined;
	const { mediaType, data, transmittedSize } = result as Record<
		string,
		unknown
	>;
	if (
		typeof mediaType !== 'string' ||
		!/^image\/[a-zA-Z0-9.+-]+$/.test(mediaType) ||
		typeof data !== 'string' ||
		!data.length ||
		data.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(data)
	) {
		return undefined;
	}
	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	const byteLength = (data.length / 4) * 3 - padding;
	if (typeof transmittedSize === 'number' && byteLength !== transmittedSize) {
		return undefined;
	}
	return `data:${mediaType};base64,${data}`;
}
