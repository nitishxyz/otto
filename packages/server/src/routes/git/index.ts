import type { Hono } from 'hono';
import { registerStatusRoute } from './status.ts';
import { registerBranchRoute } from './branch.ts';
import { registerDiffRoute } from './diff.ts';
import { registerStagingRoutes } from './staging.ts';
import { registerCommitRoutes } from './commit.ts';
import { registerPushRoute } from './push.ts';
import { registerPullRoute } from './pull.ts';
import { registerRebaseRoute } from './rebase.ts';
import { registerInitRoute } from './init.ts';
import { registerRemoteRoutes } from './remote.ts';

export type { GitFile } from './types.ts';

export function registerGitRoutes(app: Hono) {
	registerStatusRoute(app);
	registerBranchRoute(app);
	registerDiffRoute(app);
	registerStagingRoutes(app);
	registerCommitRoutes(app);
	registerPushRoute(app);
	registerPullRoute(app);
	registerRebaseRoute(app);
	registerInitRoute(app);
	registerRemoteRoutes(app);
}
