# Containers in Connections (Private Preview)

Connections (Private Preview) uses the existing deployment wizard and container
engine helpers to manage local SQL Server containers through Object Explorer v2.
This is an independent extraction from `dev/refactor`; it does not require the
results-analysis, spatial, vector, or Tedious previews.

## Enable the preview

Set these user settings, then reload the extension:

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.sqlDataPlane.enabled": true,
    "mssql.objectExplorer.v2.enabled": true
}
```

SQL Tools Service remains the default SQL data-plane provider. Query Studio is
optional for container management. The existing Connections view continues to
use its classic connection path.

## Container workflows

- Use **New Deployment** on **Connections (Private Preview)** and select the local
  SQL Server container deployment. The wizard saves the normal connection profile
  according to the password retention settings, then connects it in the preview
  tree. An unsaved password is available only for the active connection and its
  metadata sessions; disconnecting clears it.
- Expand a saved container connection, or choose **Start Container**. A stopped
  container starts before the SQL connection opens. Startup progress appears on
  the connection; **Cancel Connection** stops waiting and cancels pending startup
  work. A Docker operation already accepted by the engine may finish, but a
  canceled attempt cannot subsequently open a SQL connection.
- Use **Stop Container** to stop its engine process and disconnect the preview
  connection. Expanding that disconnected node offers **Start Container**; it
  does not automatically undo the explicit stop. Use **Delete Container** to
  confirm deletion and remove the selected
  saved profile. If other profiles reference that container, the confirmation
  names them; those other profiles are retained, matching classic OE.
- If the container has already been deleted outside VS Code, the existing cleanup
  prompt offers to remove its saved connection.

Container identity comes from the saved profile's `containerName`. This extraction
does not infer container ownership for arbitrary localhost connections. It uses
the same labels, icons, deployment form, and credential storage as classic OE.
It adds no background container polling or new enablement flag.

## Startup and validation

The normal Docker startup/readiness checks run before connecting. Container-only
connection retries handle transient transport failures during SQL Server startup.
The wizard's first connection also allows five seconds for temporary login
failures while a new SQL Server initializes. Ordinary saved profiles still fail
immediately on bad credentials; certificate failures are never retried. A Docker
preparation failure still allows connecting to an already reachable SQL endpoint,
as in classic OE; cancellation and startup timeouts stop the attempt. Concurrent
requests for the same connection share one startup. Cancel, disconnect, profile
replacement, and disposal invalidate outstanding work.

New container profiles connect only after the wizard finishes saving their
credentials. Publishing the profile settings earlier does not trigger a second
connection with an empty password. Ordinary profiles keep their auto-connect
behavior.

The shared Docker helper retains its classic call shape and cancellation path.
New adapter, command, and startup tests accompany the existing Docker and OE v2
suites. `objectExplorerV2.spec.ts` checks toolbar labels/icons and group behavior.

The optional performance scenarios `oev2-container-deploy` and
`oev2-container-reconnect` exercise the real engine and SQL data plane. They require
a running Docker-compatible engine and a cached
`mcr.microsoft.com/mssql/server:2025-latest` image. They create uniquely named
containers and profiles and clean up only their own resources. Their commands are
registered only with OE v2 active and `PERF_MODE`; they do not run in normal use.
The fixtures use the published IPv4 endpoint, avoiding engines that do not forward
the IPv6 address of `localhost`. Failed startup and connection attempts also clean
up their owned fixtures.

These scenarios measure deployment and stopped-container reconnection. Their
single-machine timings are diagnostic observations, not a performance comparison
or a promise of identical behavior on every Docker Desktop platform.
