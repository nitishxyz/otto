import { describe, test, expect } from 'bun:test';
import { join, resolve } from 'node:path';
import { guardToolCall } from '../packages/server/src/runtime/tools/guards.ts';

describe('guardToolCall', () => {
	describe('shell — blocked commands', () => {
		const blocked = [
			'rm -rf /',
			'rm -rf /*',
			'rm -Rf /',
			'rm -r -f /',
			'rm --recursive -f /',
			'rm -rf ~',
			'rm -rf ~/',
			':(){ :|:& };:',
			'mkfs.ext4 /dev/sda1',
			'mkfs /dev/sda',
			'dd if=/dev/zero of=/dev/sda',
			'echo test > /dev/sda',
		];

		for (const cmd of blocked) {
			test(`blocks: ${cmd}`, () => {
				const result = guardToolCall('shell', { cmd });
				expect(result.type).toBe('block');
			});
		}
	});

	describe('shell — approval-required commands', () => {
		const needsApproval = [
			'rm -rf ./build',
			'rm -r node_modules',
			'rm -R dist/',
			'sudo apt install vim',
			'sudo rm file.txt',
			'chmod -R 755 .',
			'chown -R user:group .',
			'curl https://example.com | bash',
			'wget https://example.com/setup.sh | sh',
			'git push --force origin main',
		];

		for (const cmd of needsApproval) {
			test(`requires approval: ${cmd}`, () => {
				const result = guardToolCall('shell', { cmd });
				expect(result.type).toBe('approve');
			});
		}
	});

	describe('shell — allowed commands', () => {
		const allowed = [
			'ls -la',
			'cat file.txt',
			'git status',
			'npm install',
			'echo hello',
			'mkdir -p src/utils',
			'cp file1.txt file2.txt',
			'grep -r pattern .',
			'rm file.txt',
			'rm -f single-file.txt',
		];

		for (const cmd of allowed) {
			test(`allows: ${cmd}`, () => {
				const result = guardToolCall('shell', { cmd });
				expect(result.type).toBe('allow');
			});
		}
	});

	describe('terminal — guards start command', () => {
		test('blocks dangerous start command', () => {
			const result = guardToolCall('terminal', {
				operation: 'start',
				command: 'rm -rf /',
			});
			expect(result.type).toBe('block');
		});

		test('requires approval for recursive delete', () => {
			const result = guardToolCall('terminal', {
				operation: 'start',
				command: 'rm -rf ./old-build',
			});
			expect(result.type).toBe('approve');
		});

		test('allows safe terminal operations', () => {
			const result = guardToolCall('terminal', {
				operation: 'start',
				command: 'npm run dev',
			});
			expect(result.type).toBe('allow');
		});

		test('allows read/write/list/kill operations', () => {
			expect(
				guardToolCall('terminal', { operation: 'read', terminalId: 'x' }).type,
			).toBe('allow');
			expect(guardToolCall('terminal', { operation: 'list' }).type).toBe(
				'allow',
			);
		});
	});

	describe('read — path guards', () => {
		test('blocks SSH private keys', () => {
			expect(guardToolCall('read', { path: '~/.ssh/id_rsa' }).type).toBe(
				'block',
			);
			expect(guardToolCall('read', { path: '~/.ssh/id_ed25519' }).type).toBe(
				'block',
			);
		});

		test('blocks /etc/shadow', () => {
			expect(guardToolCall('read', { path: '/etc/shadow' }).type).toBe('block');
		});

		test('requires approval for sensitive paths', () => {
			expect(guardToolCall('read', { path: '/etc/passwd' }).type).toBe(
				'approve',
			);
			expect(guardToolCall('read', { path: '~/.ssh/config' }).type).toBe(
				'approve',
			);
			expect(guardToolCall('read', { path: '~/.aws/credentials' }).type).toBe(
				'approve',
			);
			expect(guardToolCall('read', { path: '~/.npmrc' }).type).toBe('approve');
			expect(guardToolCall('read', { path: '~/.kube/config' }).type).toBe(
				'approve',
			);
		});

		test('requires approval for arbitrary absolute paths', () => {
			expect(guardToolCall('read', { path: '/var/log/syslog' }).type).toBe(
				'approve',
			);
			expect(guardToolCall('read', { path: '~/some-file.txt' }).type).toBe(
				'approve',
			);
		});

		test('allows relative project paths', () => {
			expect(guardToolCall('read', { path: 'src/index.ts' }).type).toBe(
				'allow',
			);
			expect(guardToolCall('read', { path: 'package.json' }).type).toBe(
				'allow',
			);
			expect(guardToolCall('read', { path: './README.md' }).type).toBe('allow');
		});

		test('allows absolute paths inside the current project root', () => {
			const projectRoot = resolve('/tmp/otto-project');
			const path = join(projectRoot, 'packages', 'server', 'src', 'routes');

			expect(guardToolCall('read', { path }, { projectRoot }).type).toBe(
				'allow',
			);
		});

		test('allows absolute paths inside configured read-only reference roots', () => {
			const projectRoot = resolve('/tmp/otto-project');
			const referenceRoot = resolve('/tmp/otto-state/references/docs-hash');
			const path = join(referenceRoot, 'src', 'index.ts');

			expect(
				guardToolCall(
					'read',
					{ path },
					{
						projectRoot,
						readOnlyRoots: [referenceRoot],
					},
				).type,
			).toBe('allow');
		});

		test('allows list and search tools inside reference roots', () => {
			const referenceRoot = resolve('/tmp/otto-state/references/docs-hash');
			const context = {
				projectRoot: resolve('/tmp/otto-project'),
				readOnlyRoots: [referenceRoot],
			};

			for (const toolName of ['ls', 'tree', 'search', 'glob']) {
				expect(
					guardToolCall(toolName, { path: referenceRoot }, context).type,
				).toBe('allow');
			}
		});

		test('does not extend reference access to sibling paths', () => {
			const referenceRoot = resolve('/tmp/otto-state/references/docs-hash');
			const sibling = resolve(
				'/tmp/otto-state/references/docs-hash-other/file.ts',
			);

			expect(
				guardToolCall(
					'read',
					{ path: sibling },
					{
						projectRoot: resolve('/tmp/otto-project'),
						readOnlyRoots: [referenceRoot],
					},
				).type,
			).toBe('approve');
		});
	});

	describe('copy_into — source and target path guards', () => {
		test('allows absolute source paths inside the current project root', () => {
			const projectRoot = resolve('/tmp/otto-project');
			const sourcePath = join(projectRoot, 'fixtures', 'source.txt');

			expect(
				guardToolCall(
					'copy_into',
					{ sourcePath, targetPath: 'target.txt' },
					{ projectRoot },
				).type,
			).toBe('allow');
		});

		test('requires approval for absolute source paths outside the project', () => {
			const projectRoot = resolve('/tmp/otto-project');

			expect(
				guardToolCall(
					'copy_into',
					{
						sourcePath: '/tmp/other-project/source.txt',
						targetPath: 'target.txt',
					},
					{ projectRoot },
				).type,
			).toBe('approve');
		});

		test('allows a reference file as a read-only copy source', () => {
			const referenceRoot = resolve('/tmp/otto-state/references/docs-hash');

			expect(
				guardToolCall(
					'copy_into',
					{
						sourcePath: join(referenceRoot, 'LICENSE'),
						targetPath: 'third-party/LICENSE',
					},
					{
						projectRoot: resolve('/tmp/otto-project'),
						readOnlyRoots: [referenceRoot],
					},
				).type,
			).toBe('allow');
		});

		test('blocks sensitive copy source paths', () => {
			expect(
				guardToolCall('copy_into', {
					sourcePath: '/etc/shadow',
					targetPath: 'target.txt',
				}).type,
			).toBe('block');
		});
	});

	describe('reference roots — shell probing', () => {
		const referenceRoot = resolve('/tmp/otto-state/references/docs-hash');
		const context = {
			projectRoot: resolve('/tmp/otto-project'),
			readOnlyRoots: [referenceRoot],
		};

		test('allows read-only shell probes targeting a reference', () => {
			expect(
				guardToolCall('shell', { cmd: `ls -la ${referenceRoot}` }, context)
					.type,
			).toBe('allow');
			expect(
				guardToolCall(
					'shell',
					{ cmd: `rg "createViewer" ${referenceRoot} | head -20` },
					context,
				).type,
			).toBe('allow');
			expect(
				guardToolCall(
					'shell',
					{ cmd: `git -C ${referenceRoot} status --short` },
					context,
				).type,
			).toBe('allow');
			expect(
				guardToolCall(
					'shell',
					{ cmd: 'git status --short', cwd: referenceRoot },
					context,
				).type,
			).toBe('allow');
		});

		test('blocks shell mutations targeting a reference', () => {
			for (const cmd of [
				`rm ${referenceRoot}/README.md`,
				`echo changed > ${referenceRoot}/README.md`,
				`git -C ${referenceRoot} checkout -- README.md`,
				`cat ${referenceRoot}/README.md | sh`,
			]) {
				expect(guardToolCall('shell', { cmd }, context).type).toBe('block');
			}
			expect(
				guardToolCall(
					'shell',
					{ cmd: 'git checkout -- README.md', cwd: referenceRoot },
					context,
				).type,
			).toBe('block');
		});
	});

	describe('reference roots — file mutations', () => {
		const referenceRoot = resolve('/tmp/otto-state/references/docs-hash');
		const context = { readOnlyRoots: [referenceRoot] };

		test('blocks write and edit tools inside reference roots', () => {
			const path = join(referenceRoot, 'README.md');
			for (const toolName of ['write', 'edit', 'multiedit']) {
				expect(guardToolCall(toolName, { path }, context).type).toBe('block');
			}
		});

		test('blocks copy targets inside reference roots', () => {
			expect(
				guardToolCall(
					'copy_into',
					{
						sourcePath: 'LICENSE',
						targetPath: join(referenceRoot, 'LICENSE'),
					},
					context,
				).type,
			).toBe('block');
		});
	});

	describe('write — path guards', () => {
		test('requires approval for .env files', () => {
			expect(guardToolCall('write', { path: '.env' }).type).toBe('approve');
			expect(guardToolCall('write', { path: '.env.local' }).type).toBe(
				'approve',
			);
			expect(guardToolCall('write', { path: 'src/.env.test' }).type).toBe(
				'approve',
			);
		});

		test('requires approval for git hooks', () => {
			expect(
				guardToolCall('write', { path: '.git/hooks/pre-commit' }).type,
			).toBe('approve');
		});

		test('allows normal project writes', () => {
			expect(guardToolCall('write', { path: 'src/index.ts' }).type).toBe(
				'allow',
			);
			expect(guardToolCall('write', { path: 'package.json' }).type).toBe(
				'allow',
			);
		});
	});

	describe('other tools — always allowed', () => {
		test('allows unknown tools', () => {
			expect(guardToolCall('ls', {}).type).toBe('allow');
			expect(guardToolCall('tree', {}).type).toBe('allow');
			expect(guardToolCall('glob', {}).type).toBe('allow');
			expect(guardToolCall('git_status', {}).type).toBe('allow');
			expect(guardToolCall('finish', {}).type).toBe('allow');
		});
	});
});
