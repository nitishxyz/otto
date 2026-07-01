# Troubleshooting

[← Back to README](../README.md) • [Docs Index](./index.md)

## Common Issues

### Provider not authorized
```bash
# Re-run authentication setup
otto auth login
```

### Database errors
```bash
# Reset local database
bun run db:reset
```

### Configuration issues
```bash
# Run diagnostics
otto doctor
```

### Daemon is stale or using the wrong version

```bash
otto service status
otto service restart
```

The daemon registration lives in the global otto state directory as `server.json` (for example `~/.local/state/otto/server.json` on Linux/macOS). otto removes stale registrations automatically when authenticated health checks fail. Version mismatches are reported by `otto service status` and can be fixed with `otto service restart`.

The daemon requires `127.0.0.1:47477` for stable local URLs, or the port from `OTTO_DAEMON_PORT` / `otto service start --port <port>`. If the configured port is busy, daemon startup fails; stop the process using that port or configure a different daemon port, then retry. Use `otto service status` to read the actual registered daemon URL.

### Local daemon token problems

```bash
otto service stop
otto service password
otto service start
```

The local daemon token is stored as `server-token` in the global otto state directory with restrictive permissions. Stop the daemon before rotating the token. Clients should send either `Authorization: Bearer <token>` or `X-Otto-Server-Token: <token>`.

### Project is missing from the switcher

```bash
otto projects list
otto projects open /path/to/project
```

Known projects are stored in the persisted project registry and are listed after daemon restart. `otto projects forget <id-or-path>` removes a project from the registry without deleting project files or the project database.

### `OTTO_SERVER_URL` points at an existing server but data looks wrong

`OTTO_SERVER_URL` is still supported, but clients must open/select a project and include project context on requests. Prefer `projectId=<id>` or `X-Otto-Project-Id`; legacy `project=/absolute/path` and `X-Otto-Project` are still accepted. If both id and path are sent, the id form wins.

### Need more diagnostics?

Use the built-in checks first:

```bash
otto doctor
```
