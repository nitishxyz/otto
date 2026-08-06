// Vite resolves the worker entry to a bundled URL; `type: 'module'` is required
// because `@pierre/diffs/worker/worker.js` is an ES module with bare imports.
import PierreWorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';
import type { PierreWorkerFactory } from '@ottocode/web-sdk/components';

export const createPierreWorker: PierreWorkerFactory = () =>
	new Worker(PierreWorkerUrl, { type: 'module' });
