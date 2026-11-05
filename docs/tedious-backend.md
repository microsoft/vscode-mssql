# Native TypeScript SQL provider (private preview)

This change extracts the Tedious query/connection stack from `dev/refactor`. It is an optional provider for the existing SQL data plane, including Query Studio. SQL Tools Service remains the default; classic query execution and the existing language service retain their current implementation.

Enable the preview and choose the provider explicitly:

```json
{
    "mssql.enableExperimentalFeatures": true,
    "mssql.sqlDataPlane.enabled": true,
    "mssql.queryStudio.enabled": true,
    "mssql.sqlDataPlane.backend": "ts-native"
}
```

Reload, open a new Query Studio query, and connect using SQL Login or a supported Entra token profile. The existing provider picker can also choose a provider for a connection. Provider selection applies on connection; changing the default does not migrate an already connected session. Select `sts2-local` and reconnect to return to SQL Tools Service.

## Supported boundary

- Streaming query execution, paging with backpressure, multiple result sets, messages, row counts, estimated/actual plans, cancellation, disconnect handling, and database switching use the TypeScript provider.
- Windows integrated authentication and LocalDB are not supported. The existing capability/fallback UI offers a supported provider for integrated authentication before resolving credentials. Strict and non-TCP/LocalDB profiles are refused by the native provider; select SQL Tools Service explicitly for these profiles, since automatic capability fallback does not yet route these profile details. There is no automatic reinterpretation of authentication or silent retry of a submitted query.
- The driver cannot preserve every decimal value or original datetimeoffset offsets. Safe decimal/money values render normally. Values with potentially lost precision, datetimeoffset values, and numeric/date sql_variant values show an explicit unavailable marker instead of failing a batch that may already have committed. Debug lossy preview shows a labelled approximation. Explicit whole-query exactness requirements are still refused before execution.
- Native vector and native JSON wire identity are not advertised. A string resembling a vector is not guessed to be one. The separate vector workbench therefore uses SQL Tools Service. Spatial CLR-to-WKB conversion has its own validated boundary.
- Strict TDS 8 is unvalidated and refused before credentials are resolved; choose SQL Tools Service for Strict profiles. Saved Optional/Mandatory values and TCP/local server aliases are normalized. This preview does not replace the language service, scripting stack, or every legacy command.

Tedious 20 is pinned and packaged in a separate `tsNativeProvider.js` bundle. Normal activation does not load the driver. The build checks the pinned driver's streaming PLP decoder shape; a driver update that invalidates the bounded decoding patch fails the build instead of silently bypassing it. Runtime requires Node 22 or newer (the extension reports an unavailable provider on an older host).

## Diagnostics and validation

The existing data-plane diagnostics show the provider identity, negotiated capabilities, session state, and safe override summary. The provider shares the extension's diagnostic sink and does not retain credentials in snapshots.

`mssql.sqlDataPlane.tsNative.overrides` is a debug-only object for page/cell/memory limits, capability masks, lossy preview, and deterministic faults. Its default is `{}`. Unsupported keys/masks are diagnosed; masks only remove supported structured capabilities. Fault/lossy/masked configurations are not valid performance measurements. To apply a change, disconnect all native sessions before reconnecting, or reload the extension host. While any native session remains open, new connections share that provider's existing settings.

Page/cell overrides act as ceilings, including when Query Studio supplies its own tuning. Implemented live faults are openDelayMs, openFailure, dropAfterDriverEvents, hangOnCancel and hangOnClose. Other fault keys are reported as ignored rather than active. The driver retains its private authentication configuration for routing; it is never included in diagnostic snapshots.

Session facts are probed within the connection deadline, including the initial database and engine edition needed for Azure database switching. Query completion waits for ordered sink delivery. Event count/byte limits include the active callback; an unpausable source or an oversized event fails explicitly with a resource limit. Tedious still materializes large MAX values before the output cell cap is applied; true bounded-memory LOB streaming remains unsupported.

The tests cover lazy provider registration, unsupported-auth refusal before credentials, disabled-preview behavior, bounded PLP parsing, transcoders, row/page limits, cancellation/loss, memory budgets, fault injection, and 300 mixed lifecycle cycles. Optional live SQL tests exercise the real driver. Query Studio UI coverage runs the same execution/actual-plan/large-value/pinning scenario against both providers. Packaging checks inspect per-output bundle dependencies in both development and production builds.

Interactive Entra sign-in, strict TDS 8, and customer workloads still need preview evaluation. Local SQL correctness and lifecycle tests are not a claim of throughput improvement over SQL Tools Service.
