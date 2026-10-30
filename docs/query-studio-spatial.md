# Spatial results (Private Preview)

Query Studio can display SQL Server `geometry` and `geography` results in a map alongside the grid. The same pane works in pinned original results. This is independent of Chat to Data and does not require Copilot.

## Enable and try

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.sqlDataPlane.enabled": true,
    "mssql.queryStudio.enabled": true,
    "mssql.queryStudio.spatial.enabled": true
}
```

Reload the extension after enabling Query Studio. In a connected `.mssql` document or a new Query Studio query, execute:

```sql
SELECT N'Seattle' AS city, geography::Point(47.6, -122.3, 4326) AS location
UNION ALL
SELECT N'London', geography::Point(51.5, -0.1, 4326);
```

Choose **Spatial** in the results pane. Select the spatial column, optional label/color columns, and a renderer. The feature list and details panel preserve source row identities. Pan, zoom, filter the displayed features, fit the view, or export the map as PNG. Pin the original results to inspect the same map after rerunning or closing the source query.

The flag defaults **off**. Enabling it applies typed spatial transport to subsequent queries when the backend advertises support. Rerun an existing query after enabling it. Ordinary SQL editor results are unaffected. Map code and the decoder worker load only when the spatial pane is used.

## Offline and optional online layers

The map and bundled world outline work offline. Online basemaps default off. Opening the map may offer to configure OpenStreetMap; accepting configures a layer and records the explicit network consent. Online requests are made by the extension host, restricted to trusted workspaces and approved HTTPS sources. Map tiles reveal the viewed area to that provider; query rows, SQL, and server credentials are not sent.

Advanced settings under `mssql.queryStudio.spatial.basemap` configure sources and bounded disk caching. For an authenticated provider, configure its `credentialRef`, then run **MS SQL: Spatial Map Layers: Set Layer Credential** to store its bearer token securely (an empty entry removes it). Credentials never enter webview URLs. Private-network sources require an additional warning and confirmation. **MS SQL: Spatial Map Layers: Clear Tile Cache** and **MS SQL: Spatial Map Layers: Clear Layer Consent** clear cached tiles or remembered permissions. Configuration or consent changes invalidate active sessions; cache budget changes apply without reloading.

## Scope and limits

Spatial transport, decoding, and rendering have row, byte, and geometry budgets. The pane reports partial, unavailable, null, empty, unsupported, and mixed-SRID results rather than silently treating them as valid points. Geometry coordinates are planar; geography uses the map projection where supported. The pane is a viewer, not a spatial editor or an implicit database reprojection operation.

Derived/filtered Chat to Data snapshots are not mapped in this extraction because their logical row ordinals differ from the original store. Pin the original result set instead. Vector analysis, query replay, Chat to Data, and schema designer changes are outside this PR.
