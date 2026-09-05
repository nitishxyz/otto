import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const mobileRoot = resolve(import.meta.dir, '../apps/mobile');

async function runMobile(source: string, env: Record<string, string> = {}) {
	const child = Bun.spawn([process.execPath, '--eval', source], {
		cwd: mobileRoot,
		env: {
			...process.env,
			EXPO_PUBLIC_ENV: '',
			EAS_PROJECT_ID: '',
			EXPO_OWNER: '',
			...env,
		},
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	return stdout;
}

describe('mobile foundation', () => {
	for (const environment of ['', 'dev', 'beta', 'prod']) {
		test(`isolates native identity for ${environment || 'default'}`, async () => {
			const config = JSON.parse(
				await runMobile(
					`console.log(JSON.stringify((await import('./app.config.ts')).default.expo));`,
					{ EXPO_PUBLIC_ENV: environment },
				),
			);
			expect(config.scheme).toBe(`ottocode${environment}`);
			expect(config.ios.bundleIdentifier).toBe(
				`com.ottocode.mobile${environment ? `.${environment}` : ''}`,
			);
			expect(config.android.package).toBe(config.ios.bundleIdentifier);
			expect(config.updates).toEqual({ enabled: false });
			expect(config.extra.eas).toBeUndefined();
			expect(config.owner).toBeUndefined();
			const buildPlugins = config.plugins.filter(
				(plugin: string | [string, unknown]) =>
					(Array.isArray(plugin) ? plugin[0] : plugin) ===
					'expo-build-properties',
			);
			expect(buildPlugins).toEqual([
				[
					'expo-build-properties',
					{
						ios: { deploymentTarget: '16.4' },
						android: { compileSdkVersion: 36 },
					},
				],
			]);
		});
	}

	test('only enables OTA for an explicitly configured project', async () => {
		const projectId = '00000000-0000-4000-8000-000000000000';
		const config = JSON.parse(
			await runMobile(
				`console.log(JSON.stringify((await import('./app.config.ts')).default.expo));`,
				{ EAS_PROJECT_ID: projectId, EXPO_OWNER: 'otto-test' },
			),
		);
		expect(config.updates.url).toBe(`https://u.expo.dev/${projectId}`);
		expect(config.updates.checkAutomatically).toBe('ON_ERROR_RECOVERY');
		expect(config.extra.eas.projectId).toBe(projectId);
		expect(config.owner).toBe('otto-test');
	});

	test('validates stored themes and falls back when native storage fails', async () => {
		await runMobile(`
			import { mock } from 'bun:test';
			import assert from 'node:assert/strict';
			let preference = null;
			let fail = false;
			let system = 'dark';
			mock.module('react-native', () => ({ Appearance: { getColorScheme: () => system } }));
			mock.module('./src/utils/storage', () => ({
				getItemAsync: async () => { if (fail) throw new Error('locked'); return preference; },
				setItemAsync: async (_, value) => { preference = value; },
				deleteItemAsync: async () => { preference = null; },
			}));
			const { themeService } = await import('./src/services/theme.ts');
			for (const value of [null, 'system', 'corrupt']) {
				preference = value;
				assert.equal(await themeService.getResolvedTheme(), 'dark');
				assert.equal(await themeService.hasManualThemePreference(), false);
			}
			for (const value of ['light', 'dark']) {
				await themeService.setThemePreference(value);
				assert.equal(await themeService.getResolvedTheme(), value);
				assert.equal(await themeService.hasManualThemePreference(), true);
			}
			await themeService.clearThemePreference();
			assert.equal(await themeService.getThemePreference(), null);
			fail = true;
			assert.equal(await themeService.getResolvedTheme(), 'dark');
			system = null;
			assert.equal(await themeService.getResolvedTheme(), 'light');
		`);
	});

	test('web preference storage handles SSR, round trips, and blocked access', async () => {
		await runMobile(`
			import assert from 'node:assert/strict';
			const storage = await import('./src/utils/storage.web.ts');
			assert.equal(await storage.getItemAsync('theme'), null);
			await storage.setItemAsync('theme', 'dark');
			await storage.deleteItemAsync('theme');
			const values = new Map();
			globalThis.window = { localStorage: {
				getItem: (key) => values.get(key) ?? null,
				setItem: (key, value) => values.set(key, value),
				removeItem: (key) => values.delete(key),
			} };
			await storage.setItemAsync('theme', 'dark');
			assert.equal(await storage.getItemAsync('theme'), 'dark');
			await storage.deleteItemAsync('theme');
			assert.equal(await storage.getItemAsync('theme'), null);
			Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
			assert.equal(await storage.getItemAsync('theme'), null);
			await storage.setItemAsync('theme', 'light');
			await storage.deleteItemAsync('theme');
		`);
	});

	test('keeps splash visible until the themed stack mounts', async () => {
		await runMobile(`
			import { mock } from 'bun:test';
			import assert from 'node:assert/strict';
			const react = await import('react');
			const effects = [];
			let hidden = 0;
			mock.module('react', () => ({ ...react, useEffect: (callback) => effects.push(callback) }));
			mock.module('./src/providers/root-provider', () => ({ RootProvider: 'RootProvider' }));
			mock.module('expo-router', () => ({ Stack: Object.assign(() => null, { Screen: 'Screen' }) }));
			mock.module('react-native-unistyles', () => ({ useUnistyles: () => ({
				theme: { colors: { background: { default: '#000' } } },
			}) }));
			mock.module('expo-splash-screen', () => ({
				preventAutoHideAsync: async () => {},
				hideAsync: async () => { hidden++; },
			}));
			const { default: RootLayout } = await import('./app/_layout.tsx');
			const root = RootLayout();
			assert.equal(effects.length, 0);
			assert.equal(hidden, 0);
			root.props.children.type();
			assert.equal(effects.length, 1);
			await effects[0]();
			assert.equal(hidden, 1);
		`);
	});

	test('tabs respect navigator events, route identity, and accessibility', async () => {
		await runMobile(`
			import { mock } from 'bun:test';
			import assert from 'node:assert/strict';
			const react = await import('react');
			const fakeReact = { ...react, useEffect: () => {}, useCallback: (callback) => callback };
			mock.module('react', () => ({ ...fakeReact, default: fakeReact }));
			mock.module('./src/components/utils/haptics', () => ({ selection: () => {} }));
			mock.module('./src/components/ui/primitives', () => ({ Box: 'Box', Icon: 'Icon' }));
			mock.module('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' }));
			mock.module('react-native', () => ({ Pressable: 'Pressable' }));
			mock.module('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
			const theme = { colors: { background: { plain: '#000' }, text: { default: '#fff' } } };
			mock.module('react-native-unistyles', () => ({
				useUnistyles: () => ({ theme }),
				StyleSheet: { create: (callback) => callback(theme, { insets: { bottom: 0 } }) },
			}));
			mock.module('react-native-reanimated', () => ({
				default: { View: 'AnimatedView' }, Extrapolation: { CLAMP: 'clamp' },
				interpolate: () => 0, useAnimatedStyle: (callback) => callback(),
				useSharedValue: (value) => ({ value }), withTiming: (value) => value,
			}));
			const { default: BottomTabs } = await import('./src/components/molecules/navigation/bottom-tabs-new.tsx');
			const events = [];
			const navigations = [];
			let prevented = false;
			const view = BottomTabs.type({
				state: { index: 0, routes: [
					{ key: 'history-key', name: 'history' },
					{ key: 'home-key', name: 'home', params: { test: true } },
					{ key: 'spend-key', name: 'spend' },
				] },
				navigation: {
					emit: (event) => { events.push(event); return { defaultPrevented: prevented }; },
					navigate: (...args) => navigations.push(args),
				},
			});
			const tabs = view.props.children[1].props.children[1];
			assert.equal(tabs[2].props.isFocused, true);
			const home = tabs[0].type.type(tabs[0].props);
			assert.equal(home.props.accessibilityRole, 'tab');
			assert.equal(home.props.accessibilityLabel, 'Home');
			assert.equal(home.props.accessibilityState.selected, false);
			prevented = true;
			home.props.onPress();
			assert.equal(navigations.length, 0);
			prevented = false;
			home.props.onPress();
			assert.deepEqual(navigations, [['home', { test: true }]]);
			assert.deepEqual(events[0], { type: 'tabPress', target: 'home-key', canPreventDefault: true });
			tabs[2].props.onPress();
			assert.equal(navigations.length, 1);
			home.props.onLongPress();
			assert.deepEqual(events.at(-1), { type: 'tabLongPress', target: 'home-key' });
		`);
	});

	for (const platform of ['ios', 'web']) {
		test(`query lifecycle subscribes and cleans up on ${platform}`, async () => {
			await runMobile(`
				import { mock } from 'bun:test';
				import assert from 'node:assert/strict';
				const react = await import('react');
				let effect;
				let appListener;
				let networkListener;
				let removed = 0;
				mock.module('react', () => ({ ...react,
					useEffect: (callback) => { effect = callback; },
					useState: (initialize) => [initialize(), () => {}],
				}));
				mock.module('react-native', () => ({
					Platform: { OS: '${platform}' },
					AppState: { currentState: 'background', addEventListener: (_, callback) => {
						appListener = callback; return { remove: () => removed++ };
					} },
				}));
				mock.module('@react-native-community/netinfo', () => ({ default: {
					addEventListener: (callback) => { networkListener = callback; return () => removed++; },
				} }));
				const { focusManager, onlineManager } = await import('@tanstack/react-query');
				const { QueryProvider } = await import('./src/providers/query-provider.tsx');
				const first = QueryProvider({ children: null });
				const second = QueryProvider({ children: null });
				assert.notEqual(first.props.client, second.props.client);
				const cleanup = effect();
				if ('${platform}' === 'web') {
					assert.equal(appListener, undefined);
					assert.equal(networkListener, undefined);
				} else {
					assert.equal(focusManager.isFocused(), false);
					appListener('active');
					assert.equal(focusManager.isFocused(), true);
					networkListener({ isConnected: false, isInternetReachable: false });
					assert.equal(onlineManager.isOnline(), false);
					networkListener({ isConnected: null, isInternetReachable: null });
					assert.equal(onlineManager.isOnline(), false);
					networkListener({ isConnected: true, isInternetReachable: false });
					assert.equal(onlineManager.isOnline(), false);
					networkListener({ isConnected: true, isInternetReachable: true });
					assert.equal(onlineManager.isOnline(), true);
					cleanup();
					assert.equal(removed, 2);
				}
			`);
		});
	}
});
