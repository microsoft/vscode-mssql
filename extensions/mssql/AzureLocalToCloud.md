# Azure SQL Local-to-Cloud Deployment

Source, Compatibility, Azure, Review, and Deploy are implemented. Passed and warning results enable
**Continue to Azure**, opening the existing free Azure SQL Database form without starting deployment.
Validation and its retained package remain available when navigating between Compatibility, Azure,
and Review. The Azure form's **Next** applies the free database wizard's form/tag checks and opens
Review with the current source, target, deployment content, compatibility, free-limit behavior, and
subscription/resource group/server. A searchable, virtualized object list uses names from the
validated DACPAC, without inventing row-count or data-size estimates.
**Create and Deploy** starts the real schema-only or schema-and-data pipeline described below.

## What "offline target-platform validation" means

DacFx includes a local representation of the schema features and T-SQL supported
by each target platform. We can build a model of the source schema using the
**Azure SQL Database** target platform, rather than the source SQL Server version,
and ask DacFx to validate that model.

The target is:

```xml
<DSP>Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider</DSP>
```

For the DacFx model API, the corresponding value is
`SqlServerVersion.SqlAzureV12`. This is Azure SQL's target-platform identifier,
not a statement that Azure SQL runs SQL Server 2014.

For example, if a schema contains an object or statement that is unsupported by
the Azure SQL schema model, building against this target can report an error.
References between supported objects are also checked. Missing references need
to be distinguished from unsupported features in the displayed diagnostics.

"Offline" means **without connecting to a target database**:

- Reading the schema still requires a connection to the local source database.
- Validation runs locally in DacFx or the SQL project build tooling.
- Installing/restoring .NET or SQL build dependencies can require internet access.
- No schema is uploaded to an Azure service for this check.

Simply extracting a DACPAC successfully is **not** an Azure compatibility check.
An extracted DACPAC normally describes its source platform. Loading it and
validating its original model does not retarget it to Azure SQL. We must rebuild
the schema under the Azure SQL target rules; editing the DACPAC's platform
metadata is not a substitute.

## Calls made by Source today

Webview RPCs are internal extension calls, not STS or HTTP endpoints.

| Layer               | Endpoint or operation                                       | Purpose                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webview RPC         | `deployment/getLocalDatabaseSources`                        | Lists database-specific localhost/loopback connections from saved, recent, and active connections. Reading profiles does not connect to STS.                                                                             |
| Webview RPC         | `deployment/connectLocalDatabaseSource`                     | Resolves the selection by connection ID, reuses an active connection or connects it, and returns connection/version details.                                                                                             |
| Extension / STS     | `ConnectionManager.connect(...)` -> `connection/connect`    | Connects a disconnected source using the existing credential preparation flow. An already-connected source skips this request.                                                                                           |
| STS                 | `query/simpleexecute`                                       | For SQL Server, executes `SELECT @@VERSION AS version;` and extracts the year from `Microsoft SQL Server <year> ...`.                                                                                                    |
| Connection metadata | `serverInfo.engineEditionId` and `serverInfo.serverVersion` | Edition ID `-978196525` identifies an Azure SQL local container. It displays **SQL Azure** with its reported build version, without the SQL Server year query. Engine edition `5` is also treated as Azure SQL Database. |

The compatibility backend resolves the selected source's connection ID to its
active connection URI for extraction. The source DTO contains its connection ID, not the URI.
Connection strings, passwords, and tokens must not be sent to the webview.

Implementation references:

- `src\deployment\localDatabaseSources.ts`
- `src\deployment\deploymentWebviewController.ts`
- `src\sharedInterfaces\azureSqlDatabase.ts`
- `src\models\contracts\connection.ts`

## Implemented Compatibility flow: extraction and SQL project build

This approach uses existing STS operations plus a local build. It does not
require a new STS validation endpoint. The extension orchestrates the work,
collects build diagnostics, and manages temporary artifacts.

1. Resolve the selected connection ID to its connected source URI.
2. Create an extension-owned temporary SDK-style SQL project targeting
   `SqlAzureV12`, without adding it to the user's workspace.
3. Extract the source's object-definition scripts into that temporary project
   using `dacfx/extract` with `extractTarget: 5` (`SchemaObjectType`).
   This outputs scripts grouped by schema and object type, not a DACPAC.
4. Ensure all extracted scripts and required references are included in the
   build. Preserve errors rather than silently dropping incompatible objects.
5. Build the temporary project locally using the existing SQL project build
   tooling. The build validates against the project's Azure SQL target and,
   on success, produces an Azure-targeted DACPAC.
6. Parse errors and warnings from the build's English diagnostic output,
   deduplicate summary messages, and classify schema, dependency, and tooling
   issues. Unrecognized failed-build output is surfaced as a tooling diagnostic,
   not silently interpreted as a successful validation.
7. Read the successful DACPAC's `model.xml` and count top-level named tables,
   views, procedures, scalar/table-valued functions, sequences, synonyms,
   user-defined data/table/CLR types, assemblies, and DML triggers. Nested
   columns/constraints, schemas, database options, and references are not included.
   Counts and object names are returned only after a successful build.
8. Retain the successful package for a future deployment step; close temporary
   project state and remove artifacts when they are no longer needed.

The wizard reuses the backend services rather than the interactive
create-project-from-database UI, so the temporary project is not added to the workspace.
Its loading card follows actual backend stages: capturing the schema, building and checking
Azure SQL support, then verifying the deployment package. Steps do not advance on timers.

### Endpoint and process inventory

These operations are used by Compatibility, except where marked optional.
Endpoint capitalization below matches the extension contracts.

| Webview RPC                                     | Purpose                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployment/validateLocalDatabaseCompatibility` | Takes a unique validation ID, source connection ID, and schema/data choice; returns status, diagnostics, snapshot time, real object count and names, and an opaque package ID plus the DACPAC basename on success. No credentials or artifact paths are returned. |
| `deployment/cancelLocalDatabaseCompatibility`   | Cancels the matching extraction/build and invalidates its retained package. A stale cancellation cannot invalidate a newer validation. Used when leaving the page and before retrying.                                                                            |
| `deployment/clearLocalDatabaseCompatibility`    | Cancels current work and releases retained package artifacts for the wizard. Controller disposal also performs cleanup.                                                                                                                                           |

The `deployment/localDatabaseCompatibilityProgress` notification carries the validation ID
and active stage. The page subscribes before starting validation, ignores updates for other
validation IDs, and unsubscribes when leaving or retrying.
The `deployment/showLocalDatabaseCompatibilityOutput` RPC opens the shared MSSQL output
channel. Failed checks display their diagnostics immediately in a virtualized, scrollable
table with error code, error text, issue type, and source file/line columns.
The table uses `FluentSlickGrid` for virtualized scrolling, column resizing, and drag-to-reorder.
Its compact rows and opaque header stay within the existing card width and a bounded viewport.

| Layer                | Endpoint or operation                                        | Inputs / role                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STS                  | `sqlProjects/createProject`                                  | Temporary `projectUri`, SDK-style `sqlProjectType`, `databaseSchemaProvider` set to the Azure SQL provider, and the chosen build SDK version. Creates the project; it does not validate the schema. |
| STS                  | `sqlProjects/openProject`                                    | Opens the temporary project for project-service operations.                                                                                                                                         |
| STS                  | `dacfx/extract`                                              | Source `ownerUri`, `databaseName`, temporary output directory as `packageFilePath`, application name/version, `extractTarget: 5`, and execution mode. Reads the local schema into object scripts.   |
| STS, optional        | `sqlProjects/setDatabaseSchemaProvider`                      | Sets the Azure SQL provider if an existing temporary project was initially created with a different target. Not needed when creation already specifies the correct target.                          |
| Local process        | `dotnet build "<temporary directory>\Compatibility.sqlproj"` | Runs the SQL project build and target-platform validation locally. **This is not an STS endpoint.** Reuse the repository's build dependency/version handling.                                       |
| STS                  | `sqlProjects/closeProject`                                   | Releases project-service state when finished. Filesystem cleanup is a separate extension operation.                                                                                                 |
| STS notifications    | `tasks/newtaskcreated`, `tasks/statuschanged`                | Track task-mode DacFx extraction progress and its terminal result. Do not assume an operation ID means extraction finished successfully.                                                            |
| STS, on cancellation | `tasks/canceltask`                                           | Requests cancellation of the extraction task by task ID. The local build needs its own cancellation handling.                                                                                       |

An SDK-style project can include extracted `.sql` files through its default
globbing. A legacy-style project would need explicit script registration, such
as `sqlProjects/addSqlObjectScript`, and different build setup; it is not the
proposed default.

The local build invocation above illustrates the process, not a new user-facing
setup command. `AzureSqlCompatibilityBuilder` uses the existing `NetCoreTool`
discovery/prerequisite checks and the configured Microsoft.Build.Sql SDK version,
but starts a cancellable, non-shell `dotnet` process to capture diagnostics rather
than using the interactive `buildProject` API, which only returns an artifact path.
The overall validation times out after ten minutes. Build output is sent to the
shared **MSSQL** output channel and capture is limited to 10 MiB.

Extraction's STS request is awaited through its completed result, rather than
treating an operation ID as success. The task-created event supplies the task ID
for cancellation. The existing SQL Tasks service handles STS progress notifications.
Wizard-owned extraction stays internal: it creates no Tasks-panel entry and shows no
completion notification. Its lifecycle events and cancellation remain available; task UI
and notifications for unrelated DACPAC operations are unchanged.

Repository references:

- `src\services\dacFxService.ts`: `createProjectFromDatabase` and `extractDacpac`
  both use `dacfx/extract`, with different extraction targets.
- `src\models\contracts\dacFx\dacFxContracts.ts`
- `src\services\sqlProjectsService.ts`
- `src\models\contracts\sqlProjects\sqlProjectsContracts.ts`
- `src\databaseProjects\controllers\projectController.ts`: extraction/project
  creation prior art and local `buildProject` orchestration.
- `src\databaseProjects\tools\buildHelper.ts`: build dependencies and arguments.
- `src\services\sqlTasksService.ts`: task notifications and cancellation.
- `src\deployment\localDatabaseCompatibility.ts`: validation lifecycle and package retention.
- `src\deployment\azureSqlCompatibilityBuilder.ts`: build diagnostics and DACPAC model counting.

## Alternative: add a structured DacFx validation endpoint

If a temporary SQL project and .NET SDK dependency are undesirable, we could add
an STS endpoint that owns the Azure-targeted model validation inside the backend.
This is an alternative to the project-build route, not an existing API.

Conceptually, the backend would:

1. Obtain the source object-definition scripts.
2. Create a new `TSqlModel(SqlServerVersion.SqlAzureV12, ...)`.
3. Add the scripts with `AddOrUpdateObjects`, collecting load/parse failures.
4. Call `TSqlModel.Validate()` and collect its `DacModelMessage` errors/warnings.
5. Return structured diagnostics and counts, with cancellation and cleanup.

System/database references and source model options must be handled explicitly.
A proof of concept should verify these details before choosing this route.

Upstream STS has a `dacFx/generateTSqlModel` operation taking
`projectUri`, `modelTargetVersion`, and script `filePaths`. Its current contract
returns a boolean, not a validation report; it is not a drop-in Compatibility
endpoint. It also is not currently exposed by this extension's DacFx wrapper.

The implemented webview RPC orchestrates existing STS operations and a local
build; no new `dacfx/validateAzureCompatibility` STS endpoint has been added.

## What the Compatibility page can truthfully report

| UI result                   | Evidence required                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema package: Passed      | Extraction and the selected packaging/build pipeline completed successfully.                                                                                              |
| Azure SQL target: Supported | Validation against `SqlAzureV12` completed with no blocking model/build errors. Successful extraction alone is insufficient.                                              |
| Objects validated           | A real count of the user-defined schema objects considered by validation, using a consistent documented counting policy. Do not hard-code the screenshot's example count. |
| DACPAC                      | The retained build artifact is renamed to `<database>.dacpac` using platform filename sanitization; its private temporary directory is not returned.                      |
| Database references         | Successful model validation with no dependency diagnostics; dependency warnings are reported rather than labeled resolved.                                                |
| Warnings                    | Actual diagnostics with severity, code, message, and object/file location where available.                                                                                |
| Blocking                    | Validation errors that prevent proceeding; identify dependency-resolution errors separately from unsupported-feature errors.                                              |
| Could not validate          | Connection, extraction, dependency installation, build tooling, cancellation, or other operational failure. Do not present this as a compatibility pass.                  |

The wizard result should retain the selected source identity, validation target,
diagnostics, package identity/location, and source snapshot information. Changing
the source or deployment-affecting options invalidates the result. If the source
schema changes, revalidate or deploy the exact validated package rather than
silently extracting a different schema.

## Validation after an Azure target exists

Offline model validation does not test an actual target's permissions, service
tier limits, existing objects, network access, data migration, or application
runtime behavior. It is not a complete migration assessment or a deployment
guarantee.

Once the Azure step has created or selected a real target, these existing STS
operations can provide further checks:

| Endpoint                         | Role and limitation                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection/connect`             | Connect to the actual Azure target. Requires authentication and connectivity.                                                                                                   |
| `dacfx/generateDeployPlan`       | Uses the source DACPAC and target `ownerUri`/database name to generate an XML deployment report through DacFx `GenerateDeployReport`. Does not deploy, but needs a live target. |
| `dacfx/generateDeploymentScript` | Generates target-specific deployment SQL without executing it. Also needs a live target.                                                                                        |
| `dacfx/deploy`                   | Deploys the schema package. This is a mutating operation reserved for Deploy, not Compatibility.                                                                                |

These STS calls do not provision Azure resources. Deploy separately uses the existing
Azure Resource Manager helper to provision a free-offer database, then invokes the
appropriate STS package operation.

## Deploy lifecycle and data migration

`deployment/deployLocalDatabase` accepts the validation/source identities, deployment mode,
reviewed destination IDs and tags. Credentials and artifact paths
are resolved privately in the extension. The backend snapshots Azure form settings, revalidates
them, rejects a stale destination, and checks that the selected server exists and target database
does not exist. A create-only preflight is repeated immediately before provisioning.
Repeated requests with the same deployment ID return the same operation. Concurrent deployments
in one wizard, or to the same resource from different wizards in one extension host, are rejected.
ARM's create-or-update API does not provide an atomic name reservation here: do not provision
the same target name concurrently from another extension host or tool.

Schema-only copies the retained Azure-targeted DACPAC into deployment-owned temporary storage,
creates the empty target, connects, and calls `dacfx/deploy`. Compatibility cleanup cannot remove
the copy while publishing. No newer source schema is silently extracted for this path.

Schema and data first opens a private source connection and calls `dacfx/export` to create a
BACPAC. Review has no data-export notice or acknowledgment.
The source schema must remain unchanged since Compatibility. Named object sets and exact per-table `COUNT_BIG` results are compared before
and after export to detect observable changes. Data-file space usage above the free offer's 32 GB
capacity is rejected before export; this is a conservative capacity preflight, not a target-size
guarantee. The target is then provisioned and connected, checked for user-defined objects, and
populated with `dacfx/import`. **Do not publish the DACPAC first:** importing into an existing
database requires that database to be empty.

Both paths verify expected named schema objects using system catalogs. Data migration also compares
target table names and exact row counts with the source counts captured around export. Only then
is the connection profile saved and connected in Object Explorer. Success displays actual database,
server, verified object count, connection status, and source. There is no logical-server creation
stage or invented duration/percentage. Success offers **Copy connection string** (without the
password) and **Open in Azure portal** for the captured database in the configured Azure cloud.
`deployment/localDatabaseDeploymentAction` accepts the successful deployment ID and action;
the backend resolves the destination privately and rejects failed or unknown deployments.
The expanded **Download deployment scripts** card reuses the shared preview drawer with ARM,
Bicep, and Terraform formats, download, copy, and add-to-workspace actions. Templates use the
deployment snapshot, including existing server, region, tags, and advanced settings, and do not
include migrated schema or data. Terraform uses AzAPI to retain free-offer settings without
requiring an undeclared server resource.

`deployment/localDatabaseDeploymentProgress` reports actual stages and completed stages;
`deployment/cancelLocalDatabaseDeployment` cancels only the matching wizard operation.
Wizard-owned DacFx tasks suppress duplicate task UI while preserving events and writing task
messages to the shared MSSQL output. Temporary package files are removed after in-flight operations
settle, and private source/target probe connections are disconnected. The saved Object Explorer
connection remains connected after success.

Cancellation is cooperative, and ARM provisioning can still finish remotely after polling is
cancelled. Databases and any narrow client-IP firewall rules already created are deliberately
left intact on failure/cancellation; no automatic destructive rollback is attempted. Failed
deployments return to Azure settings so the user can inspect existing resources and choose a new
database name. Sample datasets and existing/nonempty target databases are not supported.

BACPAC export is **not** live replication or an online cutover. The source must remain quiescent
until export completes. Object-name and row-count checks cannot prove snapshot consistency or
detect every schema/data change if this precondition is violated. Offline compatibility and row
verification do not prove application correctness or eliminate target permission/capacity errors.
The orchestration tests mock Azure/STS; a live deployment must be exercised with an authorized
Azure account and disposable source/target databases.

Upstream also has `migration/getassessments` in the separate
**SQL Tools Migration** service. That service is not currently integrated here;
it should not be described as an available endpoint on the existing STS client.
Likewise, the existing `dacfx/parseTSqlScript` response only reports whether a
script contains a `CREATE TABLE`, and `dacfx/validateStreamingJob` is specific to
streaming jobs. Neither is a general Azure compatibility check.

## References

- [SQL project target-platform validation](https://learn.microsoft.com/en-us/sql/tools/sql-database-projects/concepts/target-platform)
- [DacFx extraction targets](https://learn.microsoft.com/en-us/dotnet/api/microsoft.sqlserver.dac.dacextracttarget)
- [DacFx TSqlModel.Validate](https://learn.microsoft.com/en-us/dotnet/api/microsoft.sqlserver.dac.model.tsqlmodel.validate)
- [STS extraction implementation](https://github.com/microsoft/sqltoolsservice/blob/main/src/Microsoft.SqlTools.ServiceLayer/DacFx/ExtractOperation.cs)
- [STS deployment-plan implementation](https://github.com/microsoft/sqltoolsservice/blob/main/src/Microsoft.SqlTools.ServiceLayer/DacFx/GenerateDeployPlanOperation.cs)
- [SqlPackage Import and empty-target requirements](https://learn.microsoft.com/en-us/sql/tools/sqlpackage/sqlpackage-import)
- [BACPAC export consistency requirements](https://learn.microsoft.com/en-us/azure/azure-sql/database/database-export)
- [STS model-generation contract](https://github.com/microsoft/sqltoolsservice/blob/main/src/Microsoft.SqlTools.ServiceLayer/DacFx/Contracts/GenerateTSqlModelRequest.cs)
- [Separate migration-assessment contract](https://github.com/microsoft/sqltoolsservice/blob/main/src/Microsoft.SqlTools.Migration/Contracts/MigrationAssessmentsRequest.cs)
