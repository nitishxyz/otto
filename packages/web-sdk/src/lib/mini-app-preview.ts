import { getRuntimeApiBaseUrl, getRuntimeProjectContext } from './config';

const PROJECT_PREVIEW_PATH =
	/^\/v1\/mini-apps\/[a-z0-9-]+\/revisions\/[a-f0-9]{12}\/$/;
const SCOPED_PREVIEW_PATH =
	/^\/v1\/mini-apps\/(?:global|projects\/[^/]+)\/[a-z0-9-]+\/revisions\/[a-f0-9]{12}\/$/;

export function resolveMiniAppPreviewUrl(previewPath: string): string | null {
	if (typeof window === 'undefined') return null;
	if (
		!PROJECT_PREVIEW_PATH.test(previewPath) &&
		!SCOPED_PREVIEW_PATH.test(previewPath)
	) {
		return null;
	}
	const context = getRuntimeProjectContext();
	const projectPath =
		PROJECT_PREVIEW_PATH.test(previewPath) && context?.projectId
			? previewPath.replace(
					'/v1/mini-apps/',
					`/v1/mini-apps/projects/${encodeURIComponent(context.projectId)}/`,
				)
			: previewPath;
	const baseUrl = getRuntimeApiBaseUrl() || window.location.origin;
	const url = new URL(projectPath, baseUrl);
	if (
		PROJECT_PREVIEW_PATH.test(previewPath) &&
		!context?.projectId &&
		context?.projectRoot
	) {
		url.searchParams.set('project', context.projectRoot);
	}
	return url.toString();
}
