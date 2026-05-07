import type { Hono } from 'hono';
import { openApiRoute } from '../openapi/route.ts';
import {
	getSkill,
	getSkillFile,
	getSkillsConfig,
	listSkillFiles,
	listSkills,
	updateSkillsConfig,
	validateSkill,
	validateSkillNameRoute,
} from './skills/service.ts';
import {
	getSkillFileSpec,
	getSkillsConfigSpec,
	getSkillSpec,
	listSkillFilesSpec,
	listSkillsSpec,
	updateSkillsConfigSpec,
	validateSkillNameSpec,
	validateSkillSpec,
} from './skills/spec.ts';

function routeSpec(spec: unknown): Parameters<typeof openApiRoute>[1] {
	return spec as Parameters<typeof openApiRoute>[1];
}

export function registerSkillsRoutes(app: Hono) {
	openApiRoute(app, routeSpec(listSkillsSpec), listSkills);
	openApiRoute(app, routeSpec(getSkillsConfigSpec), getSkillsConfig);
	openApiRoute(app, routeSpec(updateSkillsConfigSpec), updateSkillsConfig);
	openApiRoute(app, routeSpec(getSkillSpec), getSkill);
	openApiRoute(app, routeSpec(listSkillFilesSpec), listSkillFiles);
	openApiRoute(app, routeSpec(getSkillFileSpec), getSkillFile);
	openApiRoute(app, routeSpec(validateSkillSpec), validateSkill);
	openApiRoute(app, routeSpec(validateSkillNameSpec), validateSkillNameRoute);
}
