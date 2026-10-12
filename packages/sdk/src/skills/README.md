# Discovery ownership

Skill precedence is cwd > repository root > user. Within each scope, directories
are loaded in `.otto`, `.agents`, `.claude`, `.codex` order; the last matching
name wins. Definitions are immutable snapshots of SKILL.md at discovery time.
Supporting files are read on demand and must resolve inside the canonical skill
base directory; symlink escapes are neither listed nor loaded.

The array returned by `discoverSkills` or `initializeSkills` owns its registry.
Pass that exact array to `buildSkillTool(skills, settings)` when project discovery
and tool construction can interleave. `loadSkill(name, skills)` and
`discoverSkillFiles(name, skills)` also accept the discovery array, including for
explicit skill expansion. `setSkillSettings(settings, skills)` records settings
for that registry. A tool snapshots its enabled names when constructed and checks
them on every execution, including supporting-file requests.

No-argument exports remain compatible: they use the most recent discovery only
when constructing a tool or resolving a legacy lookup. Constructed tools never
consult that default again. Concurrent server callers must pass their discovery
array explicitly rather than depend on the legacy default.
