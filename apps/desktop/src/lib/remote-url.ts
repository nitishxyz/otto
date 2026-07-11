const SHARE_QUERY_PARAM = 'share';

/** Separates a project-share credential from a desktop remote API URL. */
export function normalizeDesktopRemoteUrl(apiUrl: string): {
	apiUrl: string;
	shareToken?: string;
} {
	const url = new URL(apiUrl);
	const shareToken =
		url.searchParams.get(SHARE_QUERY_PARAM)?.trim() || undefined;
	url.searchParams.delete(SHARE_QUERY_PARAM);
	return { apiUrl: url.toString(), shareToken };
}
