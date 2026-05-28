import type { Tool } from 'ai';
import { buildEditTool } from './edit.ts';
import { buildReadTool } from './read.ts';
import { buildMultiEditTool } from './multiedit.ts';
import { buildWriteTool } from './write.ts';
import { buildCopyIntoTool } from './copy-into.ts';
import { buildLsTool } from './ls.ts';
import { buildTreeTool } from './tree.ts';
import { buildPwdTool } from './pwd.ts';
import { buildCdTool } from './cd.ts';

export function buildFsTools(
	projectRoot: string,
): Array<{ name: string; tool: Tool }> {
	const out: Array<{ name: string; tool: Tool }> = [];
	out.push(buildReadTool(projectRoot));
	out.push(buildEditTool(projectRoot));
	out.push(buildMultiEditTool(projectRoot));
	out.push(buildWriteTool(projectRoot));
	out.push(buildCopyIntoTool(projectRoot));
	out.push(buildLsTool(projectRoot));
	out.push(buildTreeTool(projectRoot));
	out.push(buildPwdTool());
	out.push(buildCdTool());
	return out;
}
