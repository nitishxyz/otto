import { afterEach, describe, expect, test } from 'bun:test';
import { useAppsStore } from '../packages/web-sdk/src/stores/appsStore';
import { useGitStore } from '../packages/web-sdk/src/stores/gitStore';
import { useSkillsStore } from '../packages/web-sdk/src/stores/skillsStore';

describe('Apps panel store', () => {
	afterEach(() => {
		useAppsStore.getState().collapseSidebar();
		useGitStore.getState().collapseSidebar();
		useSkillsStore.getState().collapseSidebar();
	});

	test('opens exclusively over existing right-side panels', () => {
		useGitStore.getState().expandSidebar();
		expect(useGitStore.getState().isExpanded).toBe(true);

		useAppsStore.getState().expandSidebar();

		expect(useAppsStore.getState().isExpanded).toBe(true);
		expect(useGitStore.getState().isExpanded).toBe(false);
		expect(useSkillsStore.getState().isExpanded).toBe(false);
	});

	test('closes when another right-side panel opens', () => {
		useAppsStore.getState().expandSidebar();
		expect(useAppsStore.getState().isExpanded).toBe(true);

		useGitStore.getState().toggleSidebar();

		expect(useGitStore.getState().isExpanded).toBe(true);
		expect(useAppsStore.getState().isExpanded).toBe(false);
	});
});
