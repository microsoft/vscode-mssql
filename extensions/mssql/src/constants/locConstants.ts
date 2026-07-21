/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";
import * as os from "os";

// Warning: Only update these strings if you are sure you want to affect _all_ locations they're shared between.
export class Common {
    public static remindMeLater = l10n.t("Remind Me Later");
    public static dontShowAgain = l10n.t("Don't Show Again");
    public static learnMore = l10n.t("Learn More");
    public static openFile = l10n.t("Open File");
    public static revealInExplorer = l10n.t("Reveal in Explorer");
    public static revealInFinder = l10n.t("Reveal in Finder");
    public static openContainingFolder = l10n.t("Open Containing Folder");
    public static delete = l10n.t("Delete");
    public static cancel = l10n.t("Cancel");
    public static areYouSure = l10n.t("Are you sure?");
    public static areYouSureYouWantTo = (action: string) =>
        l10n.t({
            message: "Are you sure you want to {0}?",
            args: [action],
            comment: ["{0} is the action being confirmed"],
        });
    public static accept = l10n.t("Accept");
    public static error = l10n.t("Error");
    public static publicString = l10n.t("Public");
    public static privateString = l10n.t("Private");
    public static remove = l10n.t("Remove");
}

export class SqlToolsMcp {
    public static serverLabel = l10n.t("SQL Tools (MSSQL)");
}

export class RunbookStudio {
    public static newRunbookName = l10n.t("New runbook");
    public static incompatibleArtifact = (detail: string) =>
        l10n.t({
            message:
                "This runbook was created by a newer version of the extension. Update the MSSQL extension to open it. ({0})",
            args: [detail],
            comment: ["{0} is a technical detail string"],
        });
    public static invalidArtifact = (detail: string) =>
        l10n.t({
            message: "This file is not a valid runbook: {0}",
            args: [detail],
            comment: ["{0} is a technical detail string"],
        });
    public static untrustedWorkspace = l10n.t(
        "Runbook execution is disabled in untrusted workspaces. Trust this workspace to run runbooks.",
    );
    public static runtimeUnavailable = l10n.t("The runbook runtime is not available.");
    public static notCompiled = l10n.t(
        "This runbook has no compiled plan. Compile it before running.",
    );
    public static runActive = l10n.t("A run is already active for this runbook.");
    public static runtimeSwitchBlocked = l10n.t(
        "The runbook runtime setting changed, but runs are still active on the previous runtime. Cancel or finish them, then run again.",
    );
    public static runtimeStartFailed = l10n.t("The runbook runtime failed to start the run.");
    public static runtimeExited = l10n.t("The runbook runtime exited unexpectedly.");
    public static runInterrupted = l10n.t(
        "This run did not finish — the window closed while it was still running.",
    );
    public static branchNotTaken = l10n.t("Not executed — branch not taken.");
    public static runEndedBeforeStep = l10n.t("Not executed — the run ended before this step.");
    public static runtimeKindUnavailable = (kind: string) =>
        l10n.t({
            message:
                "The configured runbook runtime '{0}' is not available in this build. Set mssql.runbookStudio.runtime to 'fake' to use the deterministic preview runtime.",
            args: [kind],
            comment: ["{0} is a configuration value"],
        });
    public static gateNotPending = l10n.t("This approval is no longer pending.");
    public static approvalPersistenceFailed = l10n.t(
        "The approval decision could not be saved safely. The operation was not released.",
    );
    public static compileModelUnavailable = l10n.t(
        "No language model is available to compile this runbook. Install and sign in to GitHub Copilot (or another VS Code language model provider), then try again.",
    );
    public static compileModelDenied = l10n.t(
        "Language model access was declined. Grant this extension access to your language models to compile runbooks.",
    );
    public static compileInvalid = (detail: string) =>
        l10n.t({
            message:
                "The model could not produce a valid plan from this intent ({0}). Try rephrasing the intent.",
            args: [detail],
            comment: ["{0} is a technical validation detail"],
        });
    public static sqlNotReadOnly = l10n.t(
        "This activity only runs read-only SELECT statements; the generated SQL was refused.",
    );
    public static planQueryUnavailable = l10n.t(
        "This plan step is not an executable read-only SQL query.",
    );
    public static queryStudioDisabled = l10n.t(
        "Query Studio is disabled. Enable mssql.queryStudio.enabled and reload VS Code to execute this query.",
    );
    public static queryStudioOpenFailed = l10n.t("Query Studio could not open this plan query.");
    public static connectionProfileNotFound = (id: string) =>
        l10n.t({
            message: "Connection profile '{0}' was not found.",
            args: [id],
            comment: ["{0} is a connection profile id"],
        });
    public static connectFailed = l10n.t("Could not connect to the selected connection.");
    public static compileApplyFailed = l10n.t(
        "The compiled plan could not be written into the document.",
    );
    public static missingRunbookCapabilities = (activityKinds: string) =>
        l10n.t({
            message:
                "Design-only: this workflow requires activities that are not installed: {0}. No executable plan was generated.",
            args: [activityKinds],
            comment: ["{0} is a comma-separated list of versioned runbook activity kinds"],
        });
    public static runbookPolicyBlocked = (detail: string) =>
        l10n.t({
            message: "Run policy blocks this plan: {0}",
            args: [detail],
            comment: ["{0} is a safe policy-readiness detail"],
        });
    public static runbookIncompatible = (detail: string) =>
        l10n.t({
            message: "This plan is incompatible with the current run host: {0}",
            args: [detail],
            comment: ["{0} is a safe host compatibility detail"],
        });
    public static hobbesRunbookNotInLibrary = l10n.t(
        "This runbook is not in the Hobbes runtime's library, so the 'hobbes' runtime cannot run it. Generated runbooks run on the 'local' runtime — set mssql.runbookStudio.runtime to 'local' (or remove the setting to use the default).",
    );
    public static hobbesConnectionNotResolved = l10n.t(
        "The Hobbes runtime could not resolve the connection alias for this run.",
    );
    public static hobbesIntegratedAuthOnly = l10n.t(
        "The Hobbes runtime lane supports Windows integrated authentication only in this preview. Choose an integrated-auth connection profile.",
    );
    public static hobbesPublishRefused = (detail: string) =>
        l10n.t({
            message: "This runbook cannot be published to the Hobbes runtime yet: {0}",
            args: [detail],
            comment: ["{0} lists the untranslatable plan features"],
        });
    public static hobbesPlannerFailed = (detail: string) =>
        l10n.t({
            message: "The Hobbes runtime planner could not produce a plan: {0}",
            args: [detail],
            comment: ["{0} is a technical detail string"],
        });
    public static hobbesPlannerTimeout = (minutes: number) =>
        l10n.t({
            message:
                "The Hobbes runtime planner did not finish within the configured {0}-minute time limit. Try again, simplify the request, or increase mssql.runbookStudio.plannerTimeoutMinutes (maximum 30).",
            args: [minutes],
            comment: ["{0} is the configured planner timeout in minutes"],
        });
    public static plannerPhaseSessionStarted = l10n.t("Planning session started");
    public static plannerPhasePlanSynthesized = l10n.t("Plan synthesized");
    public static plannerPhaseDryRunPassed = l10n.t("Dry-run passed");
    public static targetConnectionLabel = l10n.t("Target connection");
    public static hobbesRunStalledAfterFailure = l10n.t(
        "A step failed and the Hobbes runtime did not finalize the run. The run has been marked failed; check Open diagnostics for the step error.",
    );
    public static hobbesRuntimeUnresponsive = l10n.t(
        "The Hobbes runtime stopped responding and was restarted, but the run still could not start. Try running again.",
    );
    public static approvalRequired = l10n.t("Approval required to continue.");
    public static stepCancelled = l10n.t("Cancelled before the step completed.");
    public static plannerCancelled = l10n.t(
        "Plan generation was cancelled. Edit the prompt and generate again.",
    );
    public static modelConfigUnavailable = l10n.t(
        "The runtime's authoring or execution provider profile does not expose configurable models.",
    );
    public static configureModelsTitle = l10n.t("Configure Runbook Studio AI models");
    public static modelRolePlanner = l10n.t("Authoring AI (generates the runbook plan)");
    public static modelRoleWorkflow = l10n.t("Execution AI (executes plan steps)");
    public static modelConfigSaved = (role: string, modelId: string) =>
        l10n.t({
            message: "{0} model set to {1}.",
            args: [role, modelId],
            comment: ["{0} model role name, {1} model id"],
        });
    public static runtimeProviderNotReady = (provider: string) =>
        l10n.t({
            message:
                "The Hobbes runtime provider '{0}' is not ready. Run 'Runbook Studio: Check Runtime Provider' to inspect readiness or sign in.",
            args: [provider],
            comment: ["{0} is a runtime provider profile label"],
        });
    public static runtimeProviderStatusFailed = l10n.t(
        "The Hobbes runtime provider status could not be checked.",
    );
    public static runtimeProviderReady = (provider: string) =>
        l10n.t({
            message: "Runtime provider '{0}' is ready.",
            args: [provider],
            comment: ["{0} is a runtime provider profile label"],
        });
    public static runtimeProviderUnavailable = (provider: string, reason: string) =>
        l10n.t({
            message: "Runtime provider '{0}' is not ready: {1}",
            args: [provider, reason],
            comment: ["{0} is a provider label, {1} is its bounded readiness reason"],
        });
    public static runtimeProviderNoReason = l10n.t("No readiness reason was reported.");
    public static runtimeProviderCheck = l10n.t("Check provider");
    public static runtimeProviderSignIn = l10n.t("Sign in");
    public static runtimeProviderSigningIn = (provider: string) =>
        l10n.t({
            message: "Signing in to runtime provider '{0}'",
            args: [provider],
            comment: ["{0} is a runtime provider profile label"],
        });
    public static runtimeProviderWaiting = l10n.t("Waiting for provider authorization…");
    public static runtimeProviderDeviceCode = (code: string) =>
        l10n.t({
            message: "Use code {0} to sign in to the runtime provider.",
            args: [code],
            comment: ["{0} is a short provider device code"],
        });
    public static runtimeProviderOpenSignIn = l10n.t("Open sign-in page");
    public static runtimeProviderSignInSucceeded = l10n.t("Runtime provider sign-in succeeded.");
    public static runtimeProviderSignInFailed = l10n.t("Runtime provider sign-in failed.");
    public static runtimeProviderSignInCancelled = l10n.t(
        "Runtime provider sign-in was cancelled.",
    );
    public static hobbesRunNoProgress = l10n.t(
        "The Hobbes runtime reported no progress for 10 minutes; the run has been marked failed. Open the runtime log for details.",
    );
    public static statusBarName = l10n.t("Runbook run");
    public static statusBarRunning = l10n.t("Runbook: running…");
    public static statusBarAwaitingApproval = l10n.t("Runbook: awaiting approval");
    public static statusBarPassed = l10n.t("Runbook: passed");
    public static statusBarFailed = l10n.t("Runbook: failed");
    public static hobbesLaunchRefused = (code: string) =>
        l10n.t({
            message: "The Hobbes runtime refused to start the run ({0}).",
            args: [code],
            comment: ["{0} is a stable error code from the runtime"],
        });
    public static hobbesRuntimePathMissing = l10n.t(
        "No Hobbes runtime executable is configured. Set mssql.runbookStudio.hobbesRuntimePath (or the MSSQL_HOBBES_RUNTIME environment variable) to the runtime executable.",
    );
    public static dataExpired = l10n.t("The detail data for this output has expired.");
    public static outputArtifactUnavailable = l10n.t(
        "This output does not contain a retained file artifact.",
    );
    public static outputArtifactChanged = l10n.t(
        "The retained artifact is missing or no longer matches the file produced by this run.",
    );
    public static outputArtifactActionFailed = l10n.t(
        "The artifact action could not be completed. Verify the destination and try again.",
    );
    public static outputArtifactExportTitle = l10n.t("Export run artifact copy");
    public static outputArtifactFile = l10n.t("Run artifact");
    public static outputArtifactExported = l10n.t("Run artifact copy exported.");
    public static presentationTransformFailed = l10n.t(
        "This derived result could not be produced from the retained output. Review its field mappings and transform steps.",
    );
    public static parameterRequired = (label: string) =>
        l10n.t({
            message: "Parameter '{0}' is required.",
            args: [label],
            comment: ["{0} is a parameter label"],
        });
    public static parameterNotInteger = (label: string) =>
        l10n.t({
            message: "Parameter '{0}' must be an integer.",
            args: [label],
            comment: ["{0} is a parameter label"],
        });
    public static parameterNotInEnum = (label: string) =>
        l10n.t({
            message: "Parameter '{0}' must be one of its allowed values.",
            args: [label],
            comment: ["{0} is a parameter label"],
        });
    public static targetBindingInvalid = (detail: string) =>
        l10n.t({
            message: "This runbook has an invalid or unbound activity target: {0}",
            args: [detail],
            comment: ["{0} is a safe structural target-binding detail"],
        });
    public static workspaceProjectsFound = (count: number) =>
        l10n.t({
            message: "Found {0} database projects in the open workspace.",
            args: [count],
            comment: ["{0} is a count of SQL database project files"],
        });
    public static sqlTestsDiscovered = (testCount: number, classCount: number) =>
        l10n.t({
            message: "Discovered {0} tSQLt test(s) in {1} test class(es).",
            args: [testCount, classCount],
            comment: ["{0} is a test count", "{1} is a tSQLt test class count"],
        });
    public static dacpacBuilt = (artifactPath: string, diagnosticCount: number) =>
        l10n.t({
            message: "Built {0} ({1} diagnostics).",
            args: [artifactPath, diagnosticCount],
            comment: ["{0} is a DACPAC file path", "{1} is a diagnostic count"],
        });
    public static dacpacExtracted = (databaseName: string, artifactPath: string) =>
        l10n.t({
            message: "Extracted database '{0}' to {1}.",
            args: [databaseName, artifactPath],
            comment: ["{0} is a database name", "{1} is a managed DACPAC artifact path"],
        });
    public static openWorkspaceForDatabaseProject = l10n.t(
        "Open a workspace containing the SQL database project before running this step.",
    );
    public static openWorkspaceForSqlTestDiscovery = l10n.t(
        "Open a workspace containing the repository SQL tests before running this step.",
    );
    public static sqlTestDiscoveryCancelled = l10n.t("SQL test discovery was cancelled.");
    public static dacpacBuildCancelled = l10n.t("DACPAC build was cancelled.");
    public static dacpacExtractCancelled = l10n.t("DACPAC extraction was cancelled.");
    public static dacpacExtractServiceUnavailable = l10n.t(
        "The DacFx service is not available for DACPAC extraction.",
    );
    public static dacpacExtractDatabaseRequired = l10n.t(
        "The selected source connection must specify a database to extract.",
    );
    public static dacpacExtractFailed = l10n.t(
        "DacFx could not extract a DACPAC from the selected source database.",
    );
    public static runbookArtifactAlreadyExists = (artifactPath: string) =>
        l10n.t({
            message:
                "The managed run artifact already exists at '{0}'. Start a new run before retrying.",
            args: [artifactPath],
            comment: ["{0} is a managed run artifact path"],
        });
    public static dacpacArtifactLabel = l10n.t("DACPAC artifact");
    public static databaseProjectLabel = l10n.t("Database project");
    public static dacpacEvidenceCancelled = l10n.t("DACPAC evidence collection was cancelled.");
    public static sqlProjectsRequired = l10n.t(
        "SQL Database Projects is required to build this DACPAC.",
    );
    public static projectPropertiesUnavailable = (projectPath: string) =>
        l10n.t({
            message: "Unable to read SQL project properties for '{0}'.",
            args: [projectPath],
            comment: ["{0} is a SQL project file path"],
        });
    public static dacpacArtifactNotReported = (projectPath: string) =>
        l10n.t({
            message: "The SQL project build did not report a DACPAC for '{0}'.",
            args: [projectPath],
            comment: ["{0} is a SQL project file path"],
        });
    public static dacpacArtifactNotCreated = (artifactPath: string) =>
        l10n.t({
            message: "The SQL project build completed without creating '{0}'.",
            args: [artifactPath],
            comment: ["{0} is the expected DACPAC file path"],
        });
    public static dacpacArtifactInvalid = (artifactPath: string) =>
        l10n.t({
            message: "The SQL project build produced an empty or invalid artifact at '{0}'.",
            args: [artifactPath],
            comment: ["{0} is the DACPAC file path"],
        });
    public static dacpacPreviewGenerated = (changeCount: number, alertCount: number) =>
        l10n.t({
            message: "Deployment preview found {0} schema changes and {1} alerts.",
            args: [changeCount, alertCount],
            comment: ["{0} is a schema change count", "{1} is a DacFx alert count"],
        });
    public static dacpacPreviewCancelled = l10n.t("DACPAC deployment preview was cancelled.");
    public static dacpacPreviewServiceUnavailable = l10n.t(
        "The DacFx service is not available for deployment preview.",
    );
    public static dacpacPreviewDatabaseRequired = l10n.t(
        "The selected connection must specify a target database for deployment preview.",
    );
    public static dacpacPreviewFailed = l10n.t(
        "DacFx could not generate a deployment report for the selected target.",
    );
    public static dacpacPreviewReportInvalid = l10n.t(
        "DacFx returned an empty or invalid deployment report.",
    );
    public static dacpacPreviewNoSchemaChanges = l10n.t("No schema changes");
    public static schemaComparisonExported = (changeCount: number, artifactPath: string) =>
        l10n.t({
            message: "Exported {0} schema difference(s) to {1}.",
            args: [changeCount, artifactPath],
            comment: ["{0} is a schema change count", "{1} is a report artifact path"],
        });
    public static schemaComparisonExportFailed = l10n.t(
        "The schema comparison report could not be retained as a managed artifact.",
    );
    public static sandboxProvisioned = (databaseName: string) =>
        l10n.t({
            message: "Disposable database '{0}' was provisioned.",
            args: [databaseName],
            comment: ["{0} is a generated local database name"],
        });
    public static developmentDatabaseProvisioned = (databaseName: string) =>
        l10n.t({
            message: "Named development database '{0}' was provisioned and retained.",
            args: [databaseName],
            comment: ["{0} is an explicitly requested local development database name"],
        });
    public static sqlContainerProvisioned = (containerName: string, databaseName: string) =>
        l10n.t({
            message: "SQL container '{0}' and disposable database '{1}' were provisioned.",
            args: [containerName, databaseName],
            comment: ["{0} is an owned container name", "{1} is a database name"],
        });
    public static sqlContainerDisposed = (containerName: string) =>
        l10n.t({
            message: "Owned SQL container '{0}' was removed.",
            args: [containerName],
            comment: ["{0} is an owned container name"],
        });
    public static sqlContainerPolicyInvalid = l10n.t(
        "The SQL container name, database, version, or port is outside the Runbook Studio local-container policy.",
    );
    public static sqlContainerPasswordInvalid = l10n.t(
        "The SQL container password does not meet SQL Server complexity requirements.",
    );
    public static sqlContainerUnavailable = l10n.t(
        "Docker is not installed, running, or configured for supported Linux SQL containers.",
    );
    public static sqlContainerNameExists = l10n.t(
        "A container with this name already exists. Runbook Studio will not adopt or replace it.",
    );
    public static sqlContainerProvisionFailed = l10n.t(
        "The owned SQL container could not be provisioned and verified safely.",
    );
    public static sqlContainerCredentialsUnavailable = l10n.t(
        "The SQL container credentials are no longer available in this extension host. Dispose the owned lease and rerun provisioning.",
    );
    public static sqlContainerOwnershipMismatch = l10n.t(
        "The SQL container owner labels do not match this runbook lease. Automatic use or cleanup was refused.",
    );
    public static workloadInspected = (fileName: string, batchCount: number) =>
        l10n.t({
            message: "Inspected SQL workload '{0}' with {1} bounded batch(es).",
            args: [fileName, batchCount],
            comment: ["{0} is a file name", "{1} is a SQL batch count"],
        });
    public static workloadCompleted = (batchCount: number) =>
        l10n.t({
            message: "SQL workload completed {0} batch execution(s).",
            args: [batchCount],
            comment: ["{0} is an executed SQL batch count"],
        });
    public static workloadFailed = (failureCount: number) =>
        l10n.t({
            message: "SQL workload completed with {0} failed batch execution(s).",
            args: [failureCount],
            comment: ["{0} is a failed SQL batch count"],
        });
    public static workloadPathInvalid = l10n.t(
        "The workload must be a real, workspace-contained .sql file within the size limit.",
    );
    public static workloadPolicyDenied = l10n.t(
        "The workload contains unsupported SQLCMD directives or server, external, or cross-database effects.",
    );
    public static workloadPreviewChanged = l10n.t(
        "The inspected workload snapshot or digest no longer matches the approved workload.",
    );
    public static workloadOwnedContainerRequired = l10n.t(
        "Workload execution is allowed only on an ownership-verified SQL container created by this run.",
    );
    public static developmentDatabaseNameInvalid = l10n.t(
        "The development database name must be a non-system SQL identifier of at most 128 characters.",
    );
    public static developmentDatabaseTargetExists = l10n.t(
        "The named development database already exists. This activity only creates absent targets and will not take ownership of an existing database.",
    );
    public static developmentDatabaseOwnershipMismatch = l10n.t(
        "The named development database ownership marker does not match this runbook lease. The operation was refused.",
    );
    public static sandboxDisposed = (databaseName: string) =>
        l10n.t({
            message: "Disposable database '{0}' was removed.",
            args: [databaseName],
            comment: ["{0} is a generated local database name"],
        });
    public static sandboxApprovalRequired = l10n.t(
        "The disposable database operation does not have a matching durable approval.",
    );
    public static sandboxLoopbackRequired = l10n.t(
        "Disposable database targets currently require an explicit localhost or loopback SQL Server connection.",
    );
    public static sandboxStructuredProfileRequired = l10n.t(
        "Disposable database targets require a structured saved connection rather than a connection-string profile.",
    );
    public static sandboxEffectRecoveryRequired = l10n.t(
        "This disposable database effect already has recovery state. Resolve its cleanup before retrying.",
    );
    public static sandboxOwnershipMismatch = l10n.t(
        "The disposable database ownership marker does not match this runbook lease. Automatic cleanup was refused.",
    );
    public static sandboxProvisionFailed = l10n.t(
        "The disposable database could not be provisioned safely.",
    );
    public static sandboxCleanupFailed = l10n.t(
        "The disposable database could not be removed safely and requires recovery.",
    );
    public static sandboxRecoveryAttention = (count: number) =>
        l10n.t({
            message:
                "Runbook Studio found {0} disposable database effect(s) that require operator review. Automatic cleanup was refused.",
            args: [count],
            comment: ["{0} is a count of effects requiring review"],
        });
    public static dacpacDeployed = (databaseName: string) =>
        l10n.t({
            message:
                "DACPAC deployment to disposable database '{0}' completed and a post-deploy report was generated.",
            args: [databaseName],
            comment: ["{0} is a generated disposable database name"],
        });
    public static developmentDacpacDeployed = (databaseName: string) =>
        l10n.t({
            message:
                "DACPAC deployment to owned development database '{0}' completed and a post-deploy report was generated.",
            args: [databaseName],
            comment: ["{0} is an explicitly requested local development database name"],
        });
    public static schemaMutationCreateTableOnly = l10n.t(
        "Schema mutation currently requires one complete, bounded CREATE TABLE statement.",
    );
    public static schemaMutationOwnedTargetRequired = l10n.t(
        "Schema mutation is allowed only on an ownership-verified named development database created by this run.",
    );
    public static schemaMutationApplied = (tableName: string) =>
        l10n.t({
            message: "Created table '{0}' in the owned development database.",
            args: [tableName],
            comment: ["{0} is the qualified table name created by the runbook"],
        });
    public static schemaMutationFailed = l10n.t(
        "The CREATE TABLE mutation did not produce verified table evidence.",
    );
    public static dacpacDeployPreviewChanged = l10n.t(
        "The deployment preview changed after approval. Deployment was refused; review and approve the new preview.",
    );
    public static dacpacDeployArtifactChanged = l10n.t(
        "The built DACPAC changed after approval. Deployment was refused; rebuild and review the new preview.",
    );
    public static dacpacDeployFailed = l10n.t(
        "DacFx could not deploy the DACPAC to the disposable database.",
    );
    public static dacpacDeployTargetRequired = l10n.t(
        "DACPAC deployment is allowed only for an ownership-verified Runbook Studio disposable database.",
    );
    public static schemaMatches = l10n.t(
        "The disposable database schema matches the built DACPAC.",
    );
    public static schemaDriftDetected = (changeCount: number) =>
        l10n.t({
            message: "Schema verification found {0} remaining deployment change(s).",
            args: [changeCount],
            comment: ["{0} is a DacFx deployment change count"],
        });
    public static sqlTestsPassed = (count: number) =>
        l10n.t({
            message: "All {0} SQL test(s) passed.",
            args: [count],
            comment: ["{0} is a SQL test count"],
        });
    public static tsqltTestsPassed = (passed: number, skipped: number) =>
        l10n.t({
            message: "All tSQLt checks passed ({0} passed, {1} skipped).",
            args: [passed, skipped],
            comment: ["{0} is a passed test count", "{1} is a skipped test count"],
        });
    public static tsqltTestsFailed = (failed: number, errors: number, total: number) =>
        l10n.t({
            message: "tSQLt failed ({0} failures, {1} errors, {2} total).",
            args: [failed, errors, total],
            comment: [
                "{0} is a failed test count",
                "{1} is an errored test count",
                "{2} is a total test count",
            ],
        });
    public static tsqltExecutionCancelled = l10n.t(
        "tSQLt execution was cancelled before the stored-procedure boundary.",
    );
    public static tsqltOwnedSandboxRequired = l10n.t(
        "tSQLt execution is allowed only on an ownership-verified disposable database from this run.",
    );
    public static tsqltExecutionFailed = l10n.t(
        "The tSQLt execution outcome is unknown; cleanup or recovery must settle the disposable database.",
    );
    public static sqlTestsFailed = (failed: number, total: number) =>
        l10n.t({
            message: "{0} of {1} SQL test(s) failed.",
            args: [failed, total],
            comment: ["{0} is the failed count", "{1} is the total count"],
        });
    public static sqlTestsCancelled = l10n.t("SQL test execution was cancelled.");
    public static sqlTestsTimedOut = (seconds: number) =>
        l10n.t({
            message: "SQL test execution timed out after {0} second(s).",
            args: [seconds],
            comment: ["{0} is the configured SQL test timeout in seconds"],
        });
    public static sqlTestsNoResults = l10n.t(
        "The SQL test query returned no test cases. Return one row per test.",
    );
    public static sqlTestsTooManyResults = (maximum: number) =>
        l10n.t({
            message: "The SQL test query exceeded the limit of {0} test cases.",
            args: [maximum],
            comment: ["{0} is the maximum allowed SQL test count"],
        });
    public static sqlTestsColumnsRequired = l10n.t(
        "The SQL test query must return 'test_name' (or 'name') and 'passed' columns; 'message' is optional.",
    );
    public static sqlTestsUniqueNamesRequired = l10n.t(
        "Every SQL test result must have a non-empty, unique test name.",
    );
    public static sqlTestsPassedValueRequired = l10n.t(
        "Every SQL test 'passed' value must be true/false, 1/0, pass/fail, or yes/no.",
    );
    public static evidenceBundlePassed = (nodeCount: number) =>
        l10n.t({
            message: "Evidence bundle captured {0} completed node(s) with a passing verdict.",
            args: [nodeCount],
            comment: ["{0} is the number of run nodes included in an evidence bundle"],
        });
    public static evidenceBundleNotPassed = (verdict: string) =>
        l10n.t({
            message: "Evidence bundle was captured with verdict '{0}'.",
            args: [verdict],
            comment: ["{0} is fail or indeterminate"],
        });
    public static evidenceBundleCancelled = l10n.t("Evidence bundle creation was cancelled.");
    public static evidenceExportTitle = l10n.t("Export run evidence");
    public static evidenceExported = l10n.t("Run evidence exported.");
    public static evidenceExportUnavailable = l10n.t(
        "This run does not have a complete evidence bundle to export.",
    );
    public static evidenceExportInvalid = l10n.t(
        "This run's evidence bundle is invalid and cannot be exported safely.",
    );
    public static evidenceExportFailed = l10n.t(
        "Run evidence could not be exported. Choose a writable destination and try again.",
    );
    public static databaseProjectMustBeSqlproj = (projectPath: string) =>
        l10n.t({
            message: "Database project target '{0}' must be a .sqlproj file.",
            args: [projectPath],
            comment: ["{0} is the requested project path"],
        });
    public static databaseProjectNotFound = (projectPath: string) =>
        l10n.t({
            message: "Database project '{0}' was not found in the open workspace.",
            args: [projectPath],
            comment: ["{0} is the requested project path"],
        });
    public static databaseProjectAmbiguous = (projectPath: string) =>
        l10n.t({
            message:
                "Database project '{0}' is ambiguous across workspace folders; bind an absolute project path.",
            args: [projectPath],
            comment: ["{0} is the requested relative project path"],
        });
    public static runbookPathDoesNotExist = (label: string, targetPath: string) =>
        l10n.t({
            message: "{0} '{1}' does not exist.",
            args: [label, targetPath],
            comment: ["{0} is a target type label", "{1} is a file path"],
        });
    public static runbookPathOutsideWorkspace = (label: string, targetPath: string) =>
        l10n.t({
            message: "{0} '{1}' is outside the open workspace.",
            args: [label, targetPath],
            comment: ["{0} is a target type label", "{1} is a file path"],
        });
    public static libraryUnavailable = (detail: string) =>
        l10n.t({
            message: "The runbook library is unavailable: {0}",
            args: [detail],
            comment: ["{0} is a technical detail string"],
        });
    public static libraryEmpty = l10n.t(
        "No runbooks in the library yet. Use 'Save to Library' from Runbook Studio to publish one.",
    );
    public static libraryImportFailed = (detail: string) =>
        l10n.t({
            message: "This runbook could not be imported from the library: {0}",
            args: [detail],
            comment: ["{0} is a technical detail string"],
        });
    public static libraryImportAssetMissing = l10n.t(
        "The runbook no longer exists in the runtime library.",
    );
    public static libraryOpenItem = l10n.t("Open Runbook");
    public static libraryArchiveConfirm = (title: string) =>
        l10n.t({
            message:
                "Archive runbook '{0}'? Archived runbooks can be restored from the runtime library.",
            args: [title],
            comment: ["{0} is the runbook title"],
        });
    public static libraryArchiveAction = l10n.t("Archive");
    public static libraryArchived = (title: string) =>
        l10n.t({
            message: "Runbook '{0}' was archived.",
            args: [title],
            comment: ["{0} is the runbook title"],
        });
    public static libraryNoActiveRunbook = l10n.t(
        "Open a runbook in Runbook Studio first, then run 'Save to Library'.",
    );
    public static librarySaved = (name: string, versionLabel: string) =>
        l10n.t({
            message: "Runbook '{0}' was saved to the library as version {1}.",
            args: [name, versionLabel],
            comment: ["{0} is the runbook name", "{1} is the library version label"],
        });
    public static libraryCommitted = (name: string) =>
        l10n.t({
            message: "Runbook '{0}' was saved to the library.",
            args: [name],
            comment: ["{0} is the runbook name"],
        });
    public static librarySaveConflict = l10n.t(
        "This runbook changed in the runtime library after you opened it. Rebase keeps non-overlapping newer library edits and applies yours; overwrite replaces the newer authoring changes.",
    );
    public static librarySaveConflictNoRebase = l10n.t(
        "This runbook changed in the runtime library after you opened it, but a common merge base is unavailable. Overwrite replaces the newer authoring changes; cancel keeps this editor dirty.",
    );
    public static librarySaveRebase = l10n.t("Rebase");
    public static librarySaveOverwrite = l10n.t("Overwrite");
    public static presentationApprovedDemotionWarning = (name: string) =>
        l10n.t({
            message:
                "Saving these presentation changes will return approved runbook '{0}' to Draft. Existing run history is preserved, but the updated revision must be approved again before it is the approved library version.",
            args: [name],
            comment: ["{0} is the runbook name"],
        });
    public static presentationApprovedDemotionContinue = l10n.t("Continue and return to Draft");
    public static libraryExported = (path: string) =>
        l10n.t({
            message: "Runbook exported to {0}.",
            args: [path],
            comment: ["{0} is the exported file path"],
        });
    public static libraryExportFilterLabel = l10n.t("Runbook JSON");
    public static libraryNoRuns = l10n.t("No runs yet");
    public static libraryArchivedGroup = l10n.t("Archived");
    public static libraryRunningBadge = l10n.t("running");
    public static libraryDesignOnlyBadge = l10n.t("design-only");
    public static libraryMissingCapabilities = (activityKinds: string) =>
        l10n.t({
            message: "Missing activities: {0}",
            args: [activityKinds],
            comment: ["{0} is a comma-separated list of versioned runbook activity kinds"],
        });
    public static libraryDeleteConfirm = (title: string) =>
        l10n.t({
            message:
                "Permanently delete runbook '{0}' and all of its run history? This cannot be undone.",
            args: [title],
            comment: ["{0} is the runbook title"],
        });
    public static libraryDeleteAction = l10n.t("Delete");
    public static libraryDeleted = (title: string) =>
        l10n.t({
            message: "Runbook '{0}' and its run history were deleted.",
            args: [title],
            comment: ["{0} is the runbook title"],
        });
    public static libraryRestored = (title: string) =>
        l10n.t({
            message: "Runbook '{0}' was restored.",
            args: [title],
            comment: ["{0} is the runbook title"],
        });
    public static libraryNewFolderPrompt = l10n.t("New folder name");
    public static libraryFolderNameEmpty = l10n.t("Enter a folder name.");
    public static libraryFolderExists = (name: string) =>
        l10n.t({
            message: "A folder named '{0}' already exists.",
            args: [name],
            comment: ["{0} is the folder name"],
        });
    public static libraryMovePickPlaceholder = l10n.t("Move to folder");
    public static libraryMoveNewFolderItem = l10n.t("New folder…");
    public static libraryMoved = (title: string, folder: string) =>
        l10n.t({
            message: "Runbook '{0}' moved to '{1}'.",
            args: [title, folder],
            comment: ["{0} is the runbook title", "{1} is the folder name"],
        });
    public static libraryRenamePrompt = l10n.t("Runbook name");
    public static libraryRunbookNameEmpty = l10n.t("Enter a runbook name.");
    public static libraryRenamed = (title: string) =>
        l10n.t({
            message: "Runbook renamed to '{0}'.",
            args: [title],
            comment: ["{0} is the new runbook title"],
        });
    public static libraryRenameFolderPrompt = l10n.t("Folder name");
    public static libraryFolderRenamed = (from: string, to: string) =>
        l10n.t({
            message: "Folder '{0}' renamed to '{1}'.",
            args: [from, to],
            comment: ["{0} is the old folder name", "{1} is the new folder name"],
        });
    public static libraryFolderRenamePartial = (succeeded: number, failed: number) =>
        l10n.t({
            message:
                "Renamed the folder for {0} runbooks, but {1} could not be moved. Refresh and retry the remaining runbooks.",
            args: [succeeded, failed],
            comment: [
                "{0} is the number of runbooks moved successfully",
                "{1} is the number of runbooks that failed to move",
            ],
        });
    public static libraryFolderNotEmpty = (count: number) =>
        l10n.t({
            message: "Folder contains {0} runbooks — move them to another folder first.",
            args: [count],
            comment: ["{0} is the number of runbooks in the folder"],
        });
}

export let createDatabaseDialogTitle = l10n.t("Create Database");
export let dropDatabaseDialogTitle = l10n.t("Drop Database");
export let renameDatabaseDialogTitle = l10n.t("Rename Database");
export let createDatabaseWebviewTitle = l10n.t("Create Database");
export let dropDatabaseWebviewTitle = l10n.t("Drop Database");
export let renameDatabaseWebviewTitle = l10n.t("Rename Database");
export let shortcutsConfigurationTitle = l10n.t("Shortcuts Configuration (Preview)");
export let shortcutsConfigurationSaved = l10n.t("Configuration saved.");
export let quickQuerySlotOutOfRange = (maxSlot: number) =>
    l10n.t({
        message: "Quick Query slot must be between 1 and {0}.",
        args: [maxSlot],
        comment: ["{0} is the maximum Quick Query slot number"],
    });
export let msgSelectServerNodeToCreateDatabase = l10n.t(
    "Please select a server node in Object Explorer to create a database.",
);
export let msgSelectDatabaseNodeToDrop = l10n.t(
    "Please select a database node in Object Explorer to drop.",
);
export let msgSelectDatabaseNodeToRename = l10n.t(
    "Please select a database node in Object Explorer to rename.",
);
export function createDatabaseError(databaseName: string, errorMessage: string) {
    return l10n.t({
        message: "Failed to create database '{0}'. {1}",
        args: [databaseName, errorMessage],
        comment: ["{0} is the database name", "{1} is the error message"],
    });
}
export function dropDatabaseError(databaseName: string, errorMessage: string) {
    return l10n.t({
        message: "Failed to drop database '{0}'. {1}",
        args: [databaseName, errorMessage],
        comment: ["{0} is the database name", "{1} is the error message"],
    });
}
export function renameDatabaseError(
    databaseName: string,
    newDatabaseName: string,
    errorMessage: string,
) {
    return l10n.t({
        message: "Failed to rename database '{0}' to '{1}'. {2}",
        args: [databaseName, newDatabaseName, errorMessage],
        comment: [
            "{0} is the current database name",
            "{1} is the new database name",
            "{2} is the error message",
        ],
    });
}
export function renamingDatabase(databaseName: string, newDatabaseName: string) {
    return l10n.t({
        message: "Renaming database '{0}' to '{1}'...",
        args: [databaseName, newDatabaseName],
        comment: ["{0} is the current database name", "{1} is the new database name"],
    });
}

export let viewMore = l10n.t("View More");
export let releaseNotesPromptDescription = l10n.t(
    "View mssql for Visual Studio Code release notes?",
);
export function msgStartedExecute(documentName: string) {
    return l10n.t({
        message: 'Started query execution for document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
export function msgFinishedExecute(documentName: string) {
    return l10n.t({
        message: 'Finished query execution for document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
export let msgRunQueryInProgress = l10n.t(
    "A query is already running for this editor session. Please cancel this query or wait for its completion.",
);
export let runQueryBatchStartMessage = l10n.t("Started executing query at ");
export function runQueryBatchStartLine(lineNumber: number) {
    return l10n.t({
        message: "Line {0}",
        args: [lineNumber],
        comment: ["{0} is the line number"],
    });
}
export function msgCancelQueryFailed(error: string) {
    return l10n.t({
        message: "Canceling the query failed: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
export let msgCancelQueryNotRunning = l10n.t("Cannot cancel query as no query is running.");
export let msgChooseDatabaseNotConnected = l10n.t(
    "No connection was found. Please connect to a server first.",
);
export let msgChooseDatabasePlaceholder = l10n.t("Choose a database from the list below");
export function msgConnectionError(errorNumber: number, errorMessage: string) {
    return l10n.t({
        message: "Error {0}: {1}",
        args: [errorNumber, errorMessage],
        comment: ["{0} is the error number", "{1} is the error message"],
    });
}
export function msgConnectionError2(errorMessage: string) {
    return l10n.t({
        message: "Failed to connect: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
}
export let serverNameMissing = l10n.t("Server name not set.");
export function msgConnectionErrorPasswordExpired(errorNumber: number, errorMessage: string) {
    return l10n.t({
        message:
            "Error {0}: {1} Please login as a different user and change the password using ALTER LOGIN.",
        args: [errorNumber, errorMessage],
        comment: ["{0} is the error number", "{1} is the error message"],
    });
}
export let msgPromptCancelConnect = l10n.t("Server connection in progress. Do you want to cancel?");
export let msgConnectionInProgress = l10n.t(
    "A connection is already being established. Please wait for it to complete before running a query.",
);
export let msgPromptClearRecentConnections = l10n.t("Confirm to clear recent connections list");
export let msgOpenSqlFile = l10n.t(
    'To use this command, Open a .sql file -or- Change editor language to "SQL" -or- Select T-SQL text in the active SQL editor.',
);
export let recentConnectionsPlaceholder = l10n.t("Choose a connection profile from the list below");
export let CreateProfileFromConnectionsListLabel = l10n.t("Create Connection Profile");
export let CreateProfileLabel = l10n.t("Create a new connection profile");
export let ClearRecentlyUsedLabel = l10n.t("Clear Recent Connections List");
export let EditProfilesLabel = l10n.t("Edit an existing connection profile");
export let RemoveProfileLabel = l10n.t("Remove a connection profile");
export let ManageProfilesPrompt = l10n.t("Manage Connection Profiles");
export let SampleServerName = l10n.t("{{put-server-name-here}}");
export let serverPrompt = l10n.t("Server name or ADO.NET connection string");
export let serverPlaceholder = l10n.t(
    "hostname\\instance or <server>.database.windows.net or ADO.NET connection string",
);
export let databasePrompt = l10n.t("Database name");
export let startIpAddressPrompt = l10n.t("Start IP Address");
export let endIpAddressPrompt = l10n.t("End IP Address");
export let firewallRuleNamePrompt = l10n.t("Firewall rule name");
export let databasePlaceholder = l10n.t(
    "[Optional] Database to connect (press Enter to connect to <default> database)",
);
export let authTypePrompt = l10n.t("Authentication Type");
export let authTypeName = l10n.t("authenticationType");
export let authTypeIntegrated = l10n.t("Integrated");
export let authTypeSql = l10n.t("SQL Login");
export let authTypeAzureActiveDirectory = l10n.t("Microsoft Entra Id - Universal w/ MFA Support");
export let authTypeAzureActiveDirectoryDefault = l10n.t("Microsoft Entra Id - Default");
export let authTypeAzureServicePrincipal = l10n.t("Microsoft Entra Id - Service Principal");
export let azureAuthTypeCodeGrant = l10n.t("Azure Code Grant");
export let azureAuthTypeDeviceCode = l10n.t("Azure Device Code");
export let azureLogChannelName = l10n.t("MSSQL - Azure Auth Logs");
export let azureConsentDialogOpen = l10n.t("Open");
export let azureConsentDialogIgnore = l10n.t("Ignore Tenant");
export function azureConsentDialogBody(tenantName: string, tenantId: string, resource: string) {
    return l10n.t({
        message:
            "Your tenant '{0} ({1})' requires you to re-authenticate again to access {2} resources. Press Open to start the authentication process.",
        args: [tenantName, tenantId, resource],
        comment: ["{0} is the tenant name", "{1} is the tenant id", "{2} is the resource"],
    });
}
export function azureConsentDialogBodyAccount(resource: string) {
    return l10n.t({
        message:
            "Your account needs re-authentication to access {0} resources. Press Open to start the authentication process.",
        args: [resource],
        comment: ["{0} is the resource"],
    });
}
export let azureMicrosoftCorpAccount = l10n.t("Microsoft Corp");
export let azureMicrosoftAccount = l10n.t("Microsoft Entra Account");
export function azureNoMicrosoftResource(provider: string) {
    return l10n.t({
        message: "Provider '{0}' does not have a Microsoft resource endpoint defined.",
        args: [provider],
        comment: ["{0} is the provider"],
    });
}
export let azureServerCouldNotStart = l10n.t(
    "Server could not start. This could be a permissions error or an incompatibility on your system. You can try enabling device code authentication from settings.",
);
export let azureAuthNonceError = l10n.t(
    "Authentication failed due to a nonce mismatch, please close Azure Data Studio and try again.",
);
export let azureAuthStateError = l10n.t(
    "Authentication failed due to a state mismatch, please close ADS and try again.",
);
export let encryptPrompt = l10n.t("Encrypt");
export let encryptName = l10n.t("encrypt");
export let encryptOptional = l10n.t("Optional (False)");
export let encryptMandatory = l10n.t("Mandatory (True)");
export let encryptMandatoryRecommended = l10n.t("Mandatory (Recommended)");
export let enableTrustServerCertificate = l10n.t("Enable Trust Server Certificate");
export let readMore = l10n.t("Read more");
export let msgCopyAndOpenWebpage = l10n.t("Copy code and open webpage");
export let azureChooseAccount = l10n.t("Choose a Microsoft Entra account");
export let azureAddAccount = l10n.t("Add a Microsoft Entra account...");
export function accountAddedSuccessfully(account: string) {
    return l10n.t({
        message: "Microsoft Entra account {0} successfully added.",
        args: [account],
        comment: ["{0} is the account name"],
    });
}
export let accountCouldNotBeAdded = l10n.t("New Microsoft Entra account could not be added.");
export let accountRemovedSuccessfully = l10n.t(
    "Selected Microsoft Entra account removed successfully.",
);
export function accountRemovalFailed(error: string) {
    return l10n.t({
        message: "An error occurred while removing Microsoft Entra account: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
export let noAzureAccountForRemoval = l10n.t(
    "No Microsoft Entra account can be found for removal.",
);
export let cannotConnect = l10n.t(
    "Cannot connect due to expired tokens. Please re-authenticate and try again.",
);
export let aad = l10n.t("Microsoft Entra Id");
export let azureChooseTenant = l10n.t("Choose a Microsoft Entra tenant");
export let tenant = l10n.t("Tenant");
export let usernamePrompt = l10n.t("User name");
export let usernamePlaceholder = l10n.t("User name (SQL Login)");
export let passwordPrompt = l10n.t("Password");
export let passwordPlaceholder = l10n.t("Password (SQL Login)");
export let msgSavePassword = l10n.t(
    "Save Password? If 'No', password will be required each time you connect",
);
export let profileNamePrompt = l10n.t("Profile Name");
export let msgCannotOpenContent = l10n.t("Error occurred opening content in editor.");
export function msgSaveStarted(filePath: string) {
    return l10n.t({
        message: "Started saving results to {0}",
        args: [filePath],
        comment: ["{0} is the file path"],
    });
}
export function msgSaveFailed(error: string) {
    return l10n.t({
        message: "Failed to save results. {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
export function msgSaveSucceeded(filePath: string) {
    return l10n.t({
        message: "Successfully saved results to {0}",
        args: [filePath],
        comment: ["{0} is the file path"],
    });
}
export let msgExportingResults = l10n.t("Exporting results…");
export let msgSelectProfileToRemove = l10n.t("Select profile to remove");
export let msgSelectProfileToEdit = l10n.t("Select profile to edit");
export let confirmRemoveProfilePrompt = l10n.t("Confirm to remove this profile.");
export let msgNoProfilesToRemove = l10n.t("No connection profiles to remove.");
export let msgNoProfilesToEdit = l10n.t("No connection profiles to edit.");
export let msgProfileRemoved = l10n.t("Profile removed successfully");
export let msgProfileCreated = l10n.t("Profile created successfully");
export let msgProfileCreatedAndConnected = l10n.t("Profile created and connected");
export let msgClearedRecentConnections = l10n.t("Recent connections list cleared");
export let msgIsRequired = l10n.t(" is required.");
export let msgError = l10n.t("Error: ");
export let msgYes = l10n.t("Yes");
export let msgNo = l10n.t("No");
export let defaultDatabaseLabel = l10n.t("<default>");
export let connectingTooltip = l10n.t("Connecting to: ");
export let connectErrorTooltip = l10n.t("Error connecting to: ");
export let connectErrorCode = l10n.t("Error code: ");
export let connectErrorMessage = l10n.t("Error Message: ");
export let cancelingQueryLabel = l10n.t("Canceling query ");
export let updatingIntelliSenseLabel = l10n.t("Updating IntelliSense...");
export let extensionNotInitializedError = l10n.t(
    "Unable to execute the command while the extension is initializing. Please try again later.",
);
export let untitledScheme = l10n.t("untitled");
export let msgChangeLanguageMode = l10n.t(
    'To use this command, you must set the language to "SQL". Confirm to change language mode.',
);
export function msgChangedDatabaseContext(databaseName: string, documentName: string) {
    return l10n.t({
        message: 'Changed database context to "{0}" for document "{1}"',
        args: [databaseName, documentName],
        comment: ["{0} is the database name", "{1} is the document name"],
    });
}
export let msgPromptRetryCreateProfile = l10n.t(
    "Error: Unable to connect using the connection information provided. Retry profile creation?",
);
export let refreshTokenLabel = l10n.t("Refresh Credentials");
export let msgGetTokenFail = l10n.t("Failed to fetch user tokens.");
export let msgPromptRetryConnectionDifferentCredentials = l10n.t(
    "Error: Login failed. Retry using different credentials?",
);
export let msgPromptRetryFirewallRuleNotSignedIn = l10n.t(
    "Your client IP address does not have access to the server. Add a Microsoft Entra account and create a new firewall rule to enable access.",
);
export function msgPromptRetryFirewallRuleSignedIn(clientIp: string, serverName: string) {
    return l10n.t({
        message:
            "Your client IP Address '{0}' does not have access to the server '{1}' you're attempting to connect to. Would you like to create new firewall rule?",
        args: [clientIp, serverName],
        comment: ["{0} is the client IP address", "{1} is the server name"],
    });
}
export let msgPromptRetryFirewallRuleAdded = l10n.t(
    "Firewall rule successfully added. Retry profile creation? ",
);
export function msgAccountRefreshFailed(error?: string) {
    if (!error) {
        return l10n.t(
            "Credential Error: An error occurred while attempting to refresh account credentials. Please re-authenticate.",
        );
    } else {
        return l10n.t({
            message:
                "Credential Error: An error occurred while attempting to refresh account credentials. Please re-authenticate. Error: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    }
}
export let msgPromptProfileUpdateFailed = l10n.t(
    "Connection Profile could not be updated. Please modify the connection details manually in settings.json and try again.",
);
export let msgUnableToExpand = l10n.t("Unable to expand. Please check logs for more information.");
export let msgPromptFirewallRuleCreated = l10n.t("Firewall rule successfully created.");
export let msgAuthTypeNotFound = l10n.t(
    "Failed to get authentication method, please remove and re-add the account.",
);
export let msgAccountNotFound = l10n.t("Account not found");
export let msgChooseQueryHistory = l10n.t("Choose Query History");
export let msgChooseQueryHistoryAction = l10n.t("Choose An Action");
export let msgOpenQueryHistory = l10n.t("Open Query History");
export let msgRunQueryHistory = l10n.t("Run Query History");
export let msgInvalidIpAddress = l10n.t("Invalid IP Address");
export let msgInvalidRuleName = l10n.t("Invalid Firewall rule name");
export let msgNoQueriesAvailable = l10n.t("No Queries Available");
export let retryLabel = l10n.t("Retry");
export let createFirewallRuleLabel = l10n.t("Create Firewall Rule");
export function msgConnecting(serverName: string, documentName: string) {
    return l10n.t({
        message: 'Connecting to server "{0}" on document "{1}".',
        args: [serverName, documentName],
        comment: ["{0} is the server name", "{1} is the document name"],
    });
}
export function msgConnectionNotFound(uri: string) {
    return l10n.t({
        message: 'Connection not found for uri "{0}".',
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgFoundPendingReconnect(uri: string) {
    return l10n.t({
        message: "Found pending reconnect promise for uri {0}, waiting.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgPendingReconnectSuccess(uri: string) {
    return l10n.t({
        message: "Previous pending reconnection for uri {0}, succeeded.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgFoundPendingReconnectFailed(uri: string) {
    return l10n.t({
        message: "Found pending reconnect promise for uri {0}, failed.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgFoundPendingReconnectError(uri: string, error: string) {
    return l10n.t({
        message:
            "Previous pending reconnect promise for uri {0} is rejected with error {1}, will attempt to reconnect if necessary.",
        args: [uri, error],
        comment: ["{0} is the uri", "{1} is the error"],
    });
}
export function msgAcessTokenExpired(connectionId: string, uri: string) {
    return l10n.t({
        message: "Access token expired for connection {0} with uri {1}",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export let msgRefreshTokenError = l10n.t("Error when refreshing token");
export let msgAzureCredStoreSaveFailedError = l10n.t(
    'Keys for token cache could not be saved in credential store, this may cause Microsoft Entra Id access token persistence issues and connection instabilities. It\'s likely that SqlTools has reached credential storage limit on Windows, please clear at least 2 credentials that start with "Microsoft.SqlTools|" in Windows Credential Manager and reload.',
);
export function msgRefreshConnection(connectionId: string, uri: string) {
    return l10n.t({
        message: "Failed to refresh connection ${0} with uri {1}, invalid connection result.",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export function msgRefreshTokenSuccess(connectionId: string, uri: string, message: string) {
    return l10n.t({
        message: "Successfully refreshed token for connection {0} with uri {1}, {2}",
        args: [connectionId, uri, message],
        comment: ["{0} is the connection id", "{1} is the uri", "{2} is the message"],
    });
}
export function msgRefreshTokenNotNeeded(connectionId: string, uri: string) {
    return l10n.t({
        message:
            "No need to refresh Microsoft Entra acccount token for connection {0} with uri {1}",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export function msgConnectedServerInfo(
    serverName: string,
    documentName: string,
    serverInfo: string,
) {
    return l10n.t({
        message: 'Connected to server "{0}" on document "{1}". Server information: {2}',
        args: [serverName, documentName, serverInfo],
        comment: ["{0} is the server name", "{1} is the document name", "{2} is the server info"],
    });
}
export function msgConnectionFailed(serverName: string, errorMessage: string) {
    return l10n.t({
        message: 'Error connecting to server "{0}". Details: {1}',
        args: [serverName, errorMessage],
        comment: ["{0} is the server name", "{1} is the error message"],
    });
}
export function msgChangingDatabase(
    databaseName: string,
    serverName: string,
    documentName: string,
) {
    return l10n.t({
        message: 'Changing database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: ["{0} is the database name", "{1} is the server name", "{2} is the document name"],
    });
}
export function msgChangedDatabase(databaseName: string, serverName: string, documentName: string) {
    return l10n.t({
        message: 'Changed database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: ["{0} is the database name", "{1} is the server name", "{2} is the document name"],
    });
}
export function msgDisconnected(documentName: string) {
    return l10n.t({
        message: 'Disconnected on document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
export let help = l10n.t("Help");
export let macSierraRequiredErrorMessage = l10n.t(
    "macOS Sierra or newer is required to use this feature.",
);
export let gettingDefinitionMessage = l10n.t("Getting definition ...");
export let definitionRequestedStatus = l10n.t("DefinitionRequested");
export let definitionRequestCompletedStatus = l10n.t("DefinitionRequestCompleted");
export let updatingIntelliSenseStatus = l10n.t("updatingIntelliSense");
export let intelliSenseUpdatedStatus = l10n.t("intelliSenseUpdated");
export let testLocalizationConstant = l10n.t("test");
export let disconnectOptionLabel = l10n.t("Disconnect");
export let disconnectOptionDescription = l10n.t("Close the current connection");
export let disconnectConfirmationMsg = l10n.t("Are you sure you want to disconnect?");
export function elapsedBatchTime(batchTime: string) {
    return l10n.t({
        message: "Batch execution time: {0}",
        args: [batchTime],
        comment: ["{0} is the batch time"],
    });
}
export let noActiveEditorMsg = l10n.t("A SQL editor must have focus before executing this command");
export let maximizeLabel = l10n.t("Maximize");
export let restoreLabel = l10n.t("Restore");
export let saveCSVLabel = l10n.t("Save as CSV");
export let saveJSONLabel = l10n.t("Save as JSON");
export let saveExcelLabel = l10n.t("Save as Excel");
export let fileTypeCSVLabel = l10n.t("CSV");
export let fileTypeJSONLabel = l10n.t("JSON");
export let fileTypeExcelLabel = l10n.t("Excel");
export let fileTypeAllFilesLabel = l10n.t("All files");
export let resultPaneLabel = l10n.t("Results");
export let selectAll = l10n.t("Select all");
export let copyLabel = l10n.t("Copy");
export let copyWithHeadersLabel = l10n.t("Copy with Headers");
export let executeQueryLabel = l10n.t("Executing query...");
export let QueryExecutedLabel = l10n.t("Query executed");
export let messagePaneLabel = l10n.t("Messages");
export let messagesTableTimeStampColumn = l10n.t("Timestamp");
export let messagesTableMessageColumn = l10n.t("Message");
export function lineSelectorFormatted(lineNumber: number) {
    return l10n.t({
        message: "Line {0}",
        args: [lineNumber],
        comment: ["{0} is the line number"],
    });
}
export function elapsedTimeLabel(elapsedTime: string) {
    return l10n.t({
        message: "Total execution time: {0}",
        args: [elapsedTime],
        comment: ["{0} is the elapsed time"],
    });
}
export let msgCannotSaveMultipleSelections = l10n.t(
    "Save results command cannot be used with multiple selections.",
);
export let mssqlProviderName = l10n.t("MSSQL");
export let noneProviderName = l10n.t("None");
export let flavorChooseLanguage = l10n.t("Choose SQL Language");
export let flavorDescriptionMssql = l10n.t(
    "Use T-SQL intellisense and syntax error checking on current document",
);
export let flavorDescriptionNone = l10n.t(
    "Disable intellisense and syntax error checking on current document",
);
export let autoDisableNonTSqlLanguageServicePrompt = l10n.t(
    "Non-SQL Server SQL file detected. Disable IntelliSense for such files?",
);
export let msgAddConnection = l10n.t("Add Connection");
export let msgConnect = l10n.t("Connect");
export let azureSignIn = l10n.t("Azure: Sign In");
export let azureSignInDescription = l10n.t("Sign in to your Azure subscription");
export let azureSignInWithDeviceCode = l10n.t("Azure: Sign In with Device Code");
export let azureSignInWithDeviceCodeDescription = l10n.t(
    "Sign in to your Azure subscription with a device code. Use this in setups where the Sign In command does not work",
);
export let azureSignInToAzureCloud = l10n.t("Azure: Sign In to Azure Cloud");
export let azureSignInToAzureCloudDescription = l10n.t(
    "Sign in to your Azure subscription in one of the sovereign clouds.",
);
export let noBackgroundTasks = l10n.t("No background tasks");
export function backgroundTaskName(taskName: string) {
    return l10n.t({
        message: "Task: {0}",
        args: [taskName],
        comment: ["{0} is the task name"],
    });
}
export function backgroundTaskDescription(description: string) {
    return l10n.t({
        message: "Description: {0}",
        args: [description],
        comment: ["{0} is the task description"],
    });
}
export function backgroundTaskStatus(status: string) {
    return l10n.t({
        message: "Status: {0}",
        args: [status],
        comment: ["{0} is the task status"],
    });
}
export function backgroundTaskSource(source: string) {
    return l10n.t({
        message: "Source: {0}",
        args: [source],
        comment: ["{0} is the task source"],
    });
}
export function backgroundTaskConnection(connectionLabel: string) {
    return l10n.t({
        message: "Connection: {0}",
        args: [connectionLabel],
        comment: ["{0} is the task connection label"],
    });
}
export function backgroundTaskTarget(targetLocation: string) {
    return l10n.t({
        message: "Target: {0}",
        args: [targetLocation],
        comment: ["{0} is the task target location"],
    });
}
export function backgroundTaskElapsedTime(elapsedTime: string) {
    return l10n.t({
        message: "Elapsed time: {0}",
        args: [elapsedTime],
        comment: ["{0} is the task elapsed time"],
    });
}
export let backgroundTaskLogsHeader = l10n.t("Logs");
export let backgroundTaskNoLogEntries = l10n.t("No log entries yet.");
export let backgroundTaskLogUnavailable = l10n.t("Task log is unavailable.");
export let backgroundTaskCancelConfirmation = l10n.t(
    "Are you sure you want to cancel this background task?",
);
export let backgroundTaskCancelConfirm = l10n.t("Cancel Task");
export function backgroundTaskLogLine(timestamp: string, entry: string) {
    return l10n.t({
        message: "[{0}] {1}",
        args: [timestamp, entry],
        comment: ["{0} is the timestamp", "{1} is the log entry text"],
    });
}
export function backgroundTaskLogStateWithMessage(status: string, message: string) {
    return l10n.t({
        message: "{0}: {1}",
        args: [status, message],
        comment: ["{0} is the task status", "{1} is the task message"],
    });
}
export function backgroundTaskLogStateWithProgress(status: string, percent: number) {
    return l10n.t({
        message: "{0} ({1}%)",
        args: [status, percent],
        comment: ["{0} is the task status", "{1} is the completion percent"],
    });
}
export function backgroundTaskLogStateWithProgressAndMessage(
    status: string,
    percent: number,
    message: string,
) {
    return l10n.t({
        message: "{0} ({1}%): {2}",
        args: [status, percent, message],
        comment: [
            "{0} is the task status",
            "{1} is the completion percent",
            "{2} is the task message",
        ],
    });
}
export function backgroundTaskElapsedMilliseconds(milliseconds: number) {
    return l10n.t({
        message: "{0}ms",
        args: [milliseconds],
        comment: ["{0} is the elapsed time in milliseconds"],
    });
}
export function backgroundTaskElapsedSeconds(seconds: number) {
    return l10n.t({
        message: "{0}s",
        args: [seconds],
        comment: ["{0} is the elapsed time in seconds"],
    });
}
export function backgroundTaskElapsedMinutesAndSeconds(minutes: number, seconds: number) {
    return l10n.t({
        message: "{0}m {1}s",
        args: [minutes, seconds],
        comment: [
            "{0} is the elapsed time in minutes",
            "{1} is the remaining elapsed time in seconds",
        ],
    });
}
export function backgroundTaskElapsedHoursAndMinutes(hours: number, minutes: number) {
    return l10n.t({
        message: "{0}h {1}m",
        args: [hours, minutes],
        comment: [
            "{0} is the elapsed time in hours",
            "{1} is the remaining elapsed time in minutes",
        ],
    });
}
export function backgroundTaskElapsedDaysAndHours(days: number, hours: number) {
    return l10n.t({
        message: "{0}d {1}h",
        args: [days, hours],
        comment: ["{0} is the elapsed time in days", "{1} is the remaining elapsed time in hours"],
    });
}
export function taskStatusWithName(taskName: string, status: string) {
    return l10n.t({
        message: "{0}: {1}",
        args: [taskName, status],
        comment: ["{0} is the task name", "{1} is the status"],
    });
}
export function taskStatusWithMessage(status: string, message: string) {
    return l10n.t({
        message: "{0}. {1}",
        args: [status, message],
        comment: ["{0} is the status", "{1} is the message"],
    });
}
export function taskStatusWithNameAndMessage(taskName: string, status: string, message: string) {
    return l10n.t({
        message: "{0}: {1}. {2}",
        args: [taskName, status, message],
        comment: ["{0} is the task name", "{1} is the status", "{2} is the message"],
    });
}
export let failed = l10n.t("Failed");
export let succeeded = l10n.t("Succeeded");
export let succeededWithWarning = l10n.t("Succeeded with warning");
export let canceled = l10n.t("Canceled");
export let inProgress = l10n.t("In progress");
export let canceling = l10n.t("Canceling");
export let notStarted = l10n.t("Not started");
export let nodeErrorMessage = l10n.t("Parent node was not TreeNodeInfo.");
export function deleteCredentialError(id: string, error: string) {
    return l10n.t({
        message: "Failed to delete credential with id: {0}. {1}",
        args: [id, error],
        comment: ["{0} is the id", "{1} is the error"],
    });
}
export let msgClearedRecentConnectionsWithErrors = l10n.t(
    "The recent connections list has been cleared but there were errors while deleting some associated credentials. View the errors in the MSSQL output channel.",
);
export let connectProgressNoticationTitle = l10n.t("Testing connection profile...");
export let msgMultipleSelectionModeNotSupported = l10n.t(
    "Running query is not supported when the editor is in multiple selection mode.",
);
export let msgSelectNodeToScript = l10n.t("Please select a node from Object Explorer to script.");
export let msgSelectSingleNodeToScript = l10n.t(
    "Please select only one node to script. Multiple node scripting is not supported.",
);
export function msgScriptingObjectNotFound(nodeType: string, nodeLabel: string): string {
    return l10n.t({
        message: "Could not find scripting metadata for {0} '{1}'.",
        args: [nodeType, nodeLabel],
        comment: ["{0} is the node type", "{1} is the node label"],
    });
}
export let msgScriptingFailed = l10n.t(
    "Failed to generate script. Please check the logs for more details.",
);
export let msgScriptingEditorFailed = l10n.t("Failed to open script in editor.");
export let msgNoScriptGenerated = l10n.t("No script generated.");
export let msgObjectManagementUnknownDialog = l10n.t("Unknown object management dialog.");
export function msgScriptingOperationFailed(error: string): string {
    return l10n.t({
        message: "Failed to generate script: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
export let newColumnWidthPrompt = l10n.t("Enter new column width");
export let columnWidthInvalidNumberError = l10n.t("Invalid column width");
export let columnWidthMustBePositiveError = l10n.t("Width cannot be 0 or negative");
export let objectExplorerNodeRefreshError = l10n.t(
    "An error occurred refreshing nodes. See the MSSQL output channel for more details.",
);
export let showOutputChannelActionButtonText = l10n.t("Show MSSQL output");
export let reloadPrompt = l10n.t(
    "Authentication Library has changed, please reload Visual Studio Code.",
);
export let reloadPromptGeneric = l10n.t(
    "Visual Studio Code must be relaunched for this setting to come into effect.  Please reload Visual Studio Code.",
);
export let reloadChoice = l10n.t("Reload Visual Studio Code");
export let switchToMsal = l10n.t("Switch to MSAL");
export let dismiss = l10n.t("Dismiss");
export let querySuccess = l10n.t("Query succeeded");
export let queryFailed = l10n.t("Query failed");

export let parameters = l10n.t("Parameters");
export let loading = l10n.t("Loading");
export let executionPlan = l10n.t("Execution Plan");
export let executionPlanFileFilter = l10n.t("SQL Plan Files");
export let scriptCopiedToClipboard = l10n.t("Script copied to clipboard");
export let copied = l10n.t("Copied");
export let failedToOpenTextInEditor = (errorMessage: string) =>
    l10n.t({
        message: "Failed to open text in editor: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
export let failedToCopyTextToClipboard = (errorMessage: string) =>
    l10n.t({
        message: "Failed to copy text to clipboard: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
export let failedToAddTextToWorkspace = (errorMessage: string) =>
    l10n.t({
        message: "Failed to add text to workspace: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
export let schemaDesignerDetailsUnavailable = l10n.t("Schema designer details are not available.");
export let copyingResults = l10n.t("Copying results...");

export let openQueryResultsInTabByDefaultPrompt = l10n.t(
    "Do you want to always display query results in a new tab instead of the query pane?",
);
export let alwaysShowInNewTab = l10n.t("Always show in new tab");
export let keepInQueryPane = l10n.t("Keep in query pane");
export let inMemoryDataProcessingThresholdExceeded = l10n.t(
    "Max row count for filtering/sorting has been exceeded. To update it, navigate to User Settings and change the setting: mssql.resultsGrid.inMemoryDataProcessingThreshold",
);

export let newDeployment = l10n.t("New Deployment");

export class Notebooks {
    // Status bar
    public static statusBarClickToChangeConnection = l10n.t("MSSQL: Click to change connection");
    public static statusBarClickToChangeDatabase = l10n.t("MSSQL: Click to change database");

    // Errors
    public static connectionFailed = l10n.t("Connection failed");
    public static queryExecutionFailed = l10n.t("Query execution failed");
    public static noActiveNotebook = l10n.t("No active notebook.");
    public static noActiveConnection = l10n.t("No active connection.");
    public static noConnectionSelected = l10n.t("No connection selected.");

    // Copy cell output
    public static copyMessages = l10n.t("Copy messages");
    public static copyMessagesTooltip = l10n.t(
        "Copy all text output for this cell (messages, PRINT, errors)",
    );
    public static copiedMessages = l10n.t("$(check) Copied messages");

    // Execution results
    public static rowsAffected(count: number) {
        return l10n.t({
            message: "({0} row(s) affected)",
            args: [count],
            comment: ["{0} is the number of rows affected"],
        });
    }
    public static commandCompletedSuccessfully = l10n.t("(Command completed successfully)");
    public static zeroRows = l10n.t("(0 rows)");
    public static resultSetTruncated(actual: number, expected: number) {
        return l10n.t({
            message:
                "Warning: Result set is incomplete. Showing {0} of {1} rows. The full result set could not be loaded.",
            args: [actual, expected],
            comment: [
                "{0} is the number of rows actually returned",
                "{1} is the total number of rows expected",
            ],
        });
    }
    public static rowCountPlain(count: number) {
        if (count === 1) {
            return l10n.t({
                message: "({0} row)",
                args: [count],
                comment: ["{0} is the number of rows (singular)"],
            });
        }
        return l10n.t({
            message: "({0} rows)",
            args: [count],
            comment: ["{0} is the number of rows (plural)"],
        });
    }

    // Magic commands
    public static disconnected = l10n.t("Disconnected.");
    public static connectedTo(label: string) {
        return l10n.t({
            message: "Connected to {0}",
            args: [label],
            comment: ["{0} is the connection label"],
        });
    }
    public static switchedTo(label: string) {
        return l10n.t({
            message: "Switched to {0}",
            args: [label],
            comment: ["{0} is the connection label"],
        });
    }
    public static noDatabaseSelected = l10n.t("No database selected.");
    public static unknownMagicCommand(cmd: string) {
        return l10n.t({
            message: "Unknown magic command: %%{0}",
            args: [cmd],
            comment: ["{0} is the magic command name"],
        });
    }

    // UI
    public static selectDatabase = l10n.t("Select Database");
    public static chooseDatabasePlaceholder = l10n.t("Choose a database");
    public static currentDatabaseLabel = l10n.t("(current)");

    // Code lens
    public static codeLensClickToChangeConnection = l10n.t("Click to change connection");
    public static codeLensClickToChangeDatabase = l10n.t("Click to change database");
    public static codeLensConnectToSqlServer = l10n.t("Connect to SQL Server");

    // Info
    public static notebookConnectedTo(label: string) {
        return l10n.t({
            message: "MSSQL Notebook connected to {0}",
            args: [label],
            comment: ["{0} is the connection label"],
        });
    }
    public static errorPrefix(msg: string) {
        return l10n.t({
            message: "Error: {0}",
            args: [msg],
            comment: ["{0} is the error message"],
        });
    }

    // Cancellation
    public static executionCanceled = l10n.t("Query execution was canceled.");

    // Controller
    public static controllerDescription = l10n.t("Execute SQL against SQL Server / Azure SQL");

    // General
    public static notConnected = l10n.t("Not connected");

    // Renderer
    public static parseError = l10n.t("Error: Failed to parse query result data.");

    // Save as
    public static saveAsCsvDialogTitle = l10n.t("Save results as CSV");
    public static saveAsExcelDialogTitle = l10n.t("Save results as Excel");
    public static saveAsJsonDialogTitle = l10n.t("Save results as JSON");
    public static saveResultsFailed(message: string) {
        return l10n.t({
            message: "Failed to save results: {0}",
            args: [message],
            comment: ["{0} is the underlying error message"],
        });
    }
    public static savedResultsTo(uri: string) {
        return l10n.t({
            message: "Saved results to {0}",
            args: [uri],
            comment: ["{0} is the saved file path"],
        });
    }
}

export class ObjectExplorer {
    public static ErrorLoadingRefreshToTryAgain = l10n.t("Error loading; refresh to try again");
    public static NoItems = l10n.t("No items");
    public static FailedOEConnectionError = l10n.t(
        "We couldn't connect using the current connection information. Would you like to retry the connection or edit the connection profile?",
    );
    public static FailedOEConnectionErrorRetry = l10n.t("Retry");
    public static FailedOEConnectionErrorUpdate = l10n.t("Edit connection profile");
    public static FailedOEConnectionErrorSignIn = l10n.t("Sign in and retry");
    public static Connecting = l10n.t("Connecting...");
    public static ResumingDatabase = l10n.t("Resuming database");
    public static NodeDeletionConfirmation(nodeLabel: string) {
        return l10n.t({
            message: "Are you sure you want to remove {0}?",
            args: [nodeLabel],
            comment: ["{0} is the node label"],
        });
    }
    public static NodeDeletionConfirmationYes = l10n.t("Yes");
    public static NodeDeletionConfirmationNo = l10n.t("No");
    public static LoadingNodeLabel = l10n.t("Loading...");
    public static GeneratingScript = l10n.t("Generating script...");
    public static FetchingScriptLabel(scriptType: string) {
        return l10n.t({
            message: "Fetching {0} script...",
            args: [scriptType],
            comment: ["{0} is the script type"],
        });
    }
    public static ScriptSelectLabel = l10n.t("Select");
    public static ScriptCreateLabel = l10n.t("Create");
    public static ScriptInsertLabel = l10n.t("Insert");
    public static ScriptUpdateLabel = l10n.t("Update");
    public static ScriptDeleteLabel = l10n.t("Delete");
    public static ScriptExecuteLabel = l10n.t("Execute");
    public static ScriptAlterLabel = l10n.t("Alter");
    public static AzureSignInMessage(accountName: string) {
        return l10n.t({
            message: "Signing in to Azure as {0}...",
            args: [accountName],
            comment: ["{0} is the account name"],
        });
    }

    public static ConnectionGroupDeletionConfirmationWithContents(groupName: string) {
        return l10n.t({
            message:
                "Are you sure you want to delete {0}?  You can delete its connections as well, or move them to the root folder.",
            args: [groupName],
            comment: ["{0} is the group name"],
        });
    }

    public static ConnectionGroupDeleteContents = l10n.t("Delete Contents");
    public static ConnectionGroupMoveContents = l10n.t("Move to Root");

    public static ConnectionGroupDeletionConfirmationWithoutContents(groupName: string) {
        return l10n.t({
            message: "Are you sure you want to delete {0}?",
            args: [groupName],
            comment: ["{0} is the group name"],
        });
    }
    public static ConnectionStringCopied = l10n.t("Connection string copied to clipboard");
}

export class ConnectionDialog {
    public static connectionDialog = l10n.t("Connection Dialog");
    public static microsoftAccount = l10n.t("Microsoft Account");
    public static microsoftAccountIsRequired = l10n.t("Microsoft Account is required");
    public static selectAnAccount = l10n.t("Select an account");
    public static addAccount = l10n.t("Add account");
    public static savePassword = l10n.t("Save Password");
    public static tenantId = l10n.t("Tenant ID");
    public static selectATenant = l10n.t("Select a tenant");
    public static tenantIdIsRequired = l10n.t("Tenant ID is required");
    public static profileName = l10n.t("Profile Name");
    public static profileNamePlaceholder = l10n.t("Enter profile name");
    public static profileNameTooltip = l10n.t(
        "[Optional] Enter a display name for this connection profile",
    );
    public static connectionGroup = l10n.t("Connection Group");
    public static serverIsRequired = l10n.t("Server is required");
    public static usernameIsRequired = l10n.t("User name is required");
    public static connectionString = l10n.t("Connection String");
    public static connectionStringIsRequired = l10n.t("Connection string is required");
    public static signIn = l10n.t("Sign in");
    public static additionalParameters = l10n.t("Additional parameters");
    public static connect = l10n.t("Connect");
    public static default = l10n.t("<Default>");
    public static entraDefaultAuthTooltip = l10n.t(
        "Automatically selects an available Microsoft Entra ID identity from providers installed on your system. Click the info icon to learn more.",
    );
    public static entraMfaAuthTooltip = l10n.t(
        "Sign in with your Microsoft Entra ID account, including accounts with multi-factor authentication. Click the info icon to learn more.",
    );
    public static entraServicePrincipalAuthTooltip = l10n.t(
        "Authenticate using a Microsoft Entra service principal. Enter the Application (client) ID as the user name and the client secret as the password. Click the info icon to learn more.",
    );
    public static applicationClientId = l10n.t("Application (Client) ID");
    public static applicationClientIdTooltip = l10n.t(
        "The Application (Client) ID of your Microsoft Entra app registration.",
    );
    public static clientSecret = l10n.t("Client Secret");
    public static clientSecretTooltip = l10n.t(
        "The client secret for your Microsoft Entra app registration.",
    );
    public static applicationClientIdIsRequired = l10n.t("Application (Client) ID is required.");
    public static clientSecretIsRequired = l10n.t("Client secret is required.");
    public static saveSecret = l10n.t("Save Secret");
    public static createConnectionGroup = l10n.t("+ Create Connection Group");
    public static selectConnectionGroup = l10n.t("Select a connection group");
    public static searchConnectionGroups = l10n.t("Search connection groups");

    public static errorLoadingAzureDatabases(subscriptionName: string, subscriptionId: string) {
        return l10n.t({
            message:
                "Error loading Azure databases for subscription {0} ({1}).  Confirm that you have permission.",
            args: [subscriptionName, subscriptionId],
            comment: ["{0} is the subscription name", "{1} is the subscription id"],
        });
    }
    public static deleteTheSavedConnection = (connectionName: string) => {
        return l10n.t({
            message: "delete the saved connection: {0}?",
            args: [connectionName],
            comment: ["{0} is the connection name"],
        });
    };
    public static multipleMatchingTokensError(accountDisplayName?: string, tenantId?: string) {
        if (!accountDisplayName || !tenantId) {
            return l10n.t(
                "Authentication error for account. Resolving this requires clearing your token cache, which will sign you out of all connected accounts.",
            );
        }
        return l10n.t({
            message:
                "Authentication error for account '{0}' (tenant '{1}'). Resolving this requires clearing your token cache, which will sign you out of all connected accounts.",
            args: [accountDisplayName, tenantId],
            comment: ["{0} is the account display name", "{1} is the tenant id"],
        });
    }
    public static clearCacheAndRefreshToken = l10n.t("Clear cache and refresh token");
    public static clearTokenCache = l10n.t("Clear token cache");
    public static tokenRefreshedSuccessfully = l10n.t("Token refreshed successfully.");

    public static unableToAcquireValidToken(expiresOn: string, currentTime: string) {
        return l10n.t({
            message: "Unable to acquire a valid token. (expires: {0}, but is currently {1})",
            args: [expiresOn, currentTime],
            comment: ["{0} is the token expiration time", "{1} is the current time"],
        });
    }
    public static errorRefreshingToken(errorMessage: string) {
        return l10n.t({
            message: "Error refreshing token; you may need to sign out and sign back in: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
    public static errorValidatingEntraToken(errorMessage: string) {
        return l10n.t({
            message:
                "Error validating Entra authentication token; you may need to refresh your token: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }

    public static noWorkspacesFound = l10n.t(
        "No workspaces found. Please change Fabric account or tenant to view available workspaces.",
    );

    public static noSubscriptionsFound = l10n.t(
        "No subscriptions found. Please change Azure account or tenant to view available subscriptions.",
    );

    public static selectDatabase = l10n.t("Select a database");
    public static userDatabasesGroup = l10n.t("User databases");
    public static systemDatabasesGroup = l10n.t("System databases");
    public static unableToLoadDatabaseList(errorMessage: string) {
        return l10n.t({
            message:
                "Unable to load database list from server: {0} You may enter the database name directly.",
            args: [errorMessage],
            comment: ["{0} is the connection error message"],
        });
    }

    public static unsupportedAuthType(authenticationType: string) {
        return l10n.t({
            message:
                "Unsupported authentication type in connection string: {0}. Only SQL Login, Integrated, Azure MFA, and Active Directory Default authentication are supported.",
            args: [authenticationType],
            comment: ["{0} is the authentication type"],
        });
    }
}

export class FirewallRule {
    public static addFirewallRule = l10n.t("Add Firewall Rule");
    public static addFirewallRuleToServer = (serverName: string) => {
        return l10n.t({
            message: "Add Firewall Rule to {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
}

export class Azure {
    public static unableToAcquireEntraTokenFromVsCode(accountDisplayName: string): string {
        return l10n.t({
            message:
                "Unable to acquire a Microsoft Entra token from VS Code for the selected account: {0}",
            args: [accountDisplayName],
            comment: ["{0} is the account label or ID"],
        });
    }

    public static noResourceConfiguredForCurrentCloud(
        resourceType: string,
        cloudName: string,
    ): string {
        return l10n.t({
            message:
                "No resource of type '{0}' is configured for the current cloud '{1}'. Please update your Azure account settings.",
            args: [resourceType, cloudName],
            comment: ["{0} is the resource type", "{1} is the display name of the current cloud"],
        });
    }

    public static accountNotFound(accountDisplayName: string): string {
        return l10n.t({
            message:
                "Azure account '{0}' was not found. Sign in with the correct account or select a different one.",
            args: [accountDisplayName],
            comment: ["{0} is the display name or ID of the Azure account that was not found"],
        });
    }

    public static errorSigningIntoAzure(errorMessage: string): string {
        return l10n.t({
            message: "Error signing into Azure: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }

    public static errorLoadingAzureAccountInfoForTenantId = (tenantId: string) => {
        return l10n.t({
            message: "Error loading Azure account information for tenant ID '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };

    public static errorCreatingFirewallRule = (ruleInfo: string, error: string) => {
        return l10n.t({
            message:
                "Error creating firewall rule {0}.  Check your Azure account settings and try again.  Error: {1}",
            args: [ruleInfo, error],
            comment: [
                "{0} is the rule info in format 'name (startIp - endIp)'",
                "{1} is the error message",
            ],
        });
    };

    public static failedToGetTenantForAccount = (tenantId: string, accountName: string) => {
        return l10n.t({
            message: "Failed to get tenant '{0}' for account '{1}'.",
            args: [tenantId, accountName],
            comment: ["{0} is the tenant id", "{1} is the account name"],
        });
    };

    public static PublicCloud = l10n.t("Azure (Public)");
    public static USGovernmentCloud = l10n.t("Azure (US Government)");
    public static ChinaCloud = l10n.t("Azure (China)");

    public static customCloudNotConfigured = (missingSetting: string) => {
        return l10n.t(
            "The custom cloud choice is not configured. Please configure the setting `{0}`.",
            missingSetting,
        );
    };
}

export class Fabric {
    public static failedToGetWorkspacesForTenant = (
        tenantName: string,
        tenantId: string,
        errorMessage?: string,
    ) => {
        if (errorMessage) {
            return l10n.t({
                message: "Failed to get Fabric workspaces for tenant '{0} ({1})': {2}",
                args: [tenantName, tenantId, errorMessage],
                comment: [
                    "{0} is the tenant name",
                    "{1} is the tenant id",
                    "{2} is the error message",
                ],
            });
        } else {
            return l10n.t({
                message: "Failed to get Fabric workspaces for tenant '{0} ({1})'.",
                args: [tenantName, tenantId],
                comment: ["{0} is the tenant name", "{1} is the tenant id"],
            });
        }
    };

    public static listingCapacitiesForTenant = (tenantId: string) => {
        return l10n.t({
            message: "Listing Fabric capacities for tenant '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };

    public static listingWorkspacesForTenant = (tenantId: string) => {
        return l10n.t({
            message: "Listing Fabric workspaces for tenant '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };

    public static gettingWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Getting Fabric workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static listingSqlDatabasesForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Listing Fabric SQL Databases for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static listingSqlEndpointsForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Listing Fabric SQL Endpoints for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static listingWarehousesForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Listing Fabric Warehouses for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static gettingConnectionStringForSqlEndpoint = (
        sqlEndpointId: string,
        workspaceId: string,
    ) => {
        return l10n.t({
            message: "Getting connection string for SQL Endpoint '{0}' in workspace '{1}'",
            args: [sqlEndpointId, workspaceId],
            comment: ["{0} is the SQL endpoint ID", "{1} is the workspace ID"],
        });
    };

    public static createWorkspaceWithCapacity = (capacityId: string) => {
        return l10n.t({
            message: "Creating workspace with capacity {0}",
            args: [capacityId],
            comment: ["{0} is the capacity ID"],
        });
    };

    public static createSqlDatabaseForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Creating SQL Database for workspace {0}",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static listingRoleAssignmentsForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Listing role assignments for workspace '${workspaceId}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static gettingFabricDatabase = (databaseId: string) => {
        return l10n.t({
            message: "Getting Fabric database '{0}'",
            args: [databaseId],
            comment: ["{0} is the database ID"],
        });
    };

    public static fabricApiError = (resultCode: string, resultMessage: string) => {
        return l10n.t({
            message: "Fabric API error occurred ({0}): {1}",
            args: [resultCode, resultMessage],
            comment: ["{0} is the error code", "{1} is the error message"],
        });
    };

    public static fabricLongRunningApiError = (resultCode: string, error: string) => {
        return l10n.t({
            message: "Fabric long-running API error with error code '{0}': {1}",
            args: [resultCode, error],
            comment: ["{0} is the error code", "{1} is the error message"],
        });
    };

    public static fabricAccount = l10n.t("Fabric Account");
    public static fabricAccountIsRequired = l10n.t("Fabric Account is required");
    public static workspace = l10n.t("Workspace");
    public static selectAWorkspace = l10n.t("Select a Workspace");
    public static searchWorkspaces = l10n.t("Search Workspaces");
    public static workspaceIsRequired = l10n.t("Workspace is required");
    public static insufficientWorkspacePermissions = l10n.t("Insufficient Workspace Permissions");

    public static fabricNotSupportedInCloud = (cloudName: string, settingName: string) => {
        return l10n.t({
            message:
                "Fabric is not supported in the current cloud ({0}).  Ensure setting '{1}' is configured correctly.",
            args: [cloudName, settingName],
            comment: ["{0} is the cloud name", "{1} is the setting name"],
        });
    };
}

export class Accounts {
    static entraAccountNotAvailableThroughMsal(
        accountDisplayName: string,
        tenantId?: string,
    ): string {
        if (tenantId === undefined || tenantId === "") {
            return l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}' but that account is not signed into the MSSQL extension. Edit the connection or sign into MSSQL with that account to connect.",
                args: [accountDisplayName],
                comment: ["{0} is the account ID or label"],
            });
        } else {
            return l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}' on tenant '{1}', but that account is not signed into the MSSQL extension. Edit the connection or sign into MSSQL with that account to connect.",
                args: [accountDisplayName, tenantId],
                comment: ["{0} is the account ID or label", "{1} is the tenant ID"],
            });
        }
    }
    static accountNotAvailableThroughVsCode(accountDisplayName: string, tenantId?: string): string {
        if (tenantId === undefined || tenantId === "") {
            return l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}', but that account is not available through VS Code sign-in. Edit the connection or sign into VS Code with that account to connect.",
                args: [accountDisplayName],
                comment: ["{0} is the account ID or label"],
            });
        } else {
            return l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}' on tenant '{1}', but that account is not available through VS Code sign-in. Edit the connection or sign into VS Code with that account to connect.",
                args: [accountDisplayName, tenantId],
                comment: ["{0} is the account ID or label", "{1} is the tenant ID"],
            });
        }
    }
    public static invalidEntraAccountsRemoved = (numRemoved: number) => {
        return l10n.t({
            message:
                "{0} invalid Entra accounts have been removed; you may need to run `MS SQL: Clear Microsoft Entra account token cache` and log in again.",
            args: [numRemoved],
            comment: ["{0} is the number of invalid accounts that have been removed"],
        });
    };
    public static clearedEntraTokenCache = l10n.t("Entra token cache cleared successfully.");
}

export class AzureSqlDatabase {
    public static azureAccount = l10n.t("Azure Account");
    public static azureAccountIsRequired = l10n.t("Azure Account is required");
    public static subscription = l10n.t("Subscription");
    public static selectASubscription = l10n.t("Select a subscription");
    public static subscriptionIsRequired = l10n.t("Subscription is required");
    public static resourceGroup = l10n.t("Resource Group");
    public static selectAResourceGroup = l10n.t("Select a resource group");
    public static resourceGroupIsRequired = l10n.t("Resource Group is required");
    public static databaseName = l10n.t("Database Name");
    public static enterDatabaseName = l10n.t("Enter database name");
    public static databaseNameIsRequired = l10n.t("Database Name is required");
    public static noAzureAccountsFound = l10n.t("No Azure accounts found");
    public static noTenantsFound = l10n.t("No tenants found");
    public static noSubscriptionsFound = l10n.t("No subscriptions found");
    public static noResourceGroupsFound = l10n.t("No resource groups found");
    public static server = l10n.t("Server");
    public static selectAServer = l10n.t("Select a server");
    public static serverIsRequired = l10n.t("SQL Server is required");
    public static noServersFound = l10n.t("No servers found");
    public static connectionFailed = l10n.t("Connection failed");
    public static firewallRuleCreationFailed = (error: string) =>
        l10n.t({
            message: "Failed to create firewall rule: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static clientIpDetectionFailed = l10n.t(
        "Could not detect your client IP address. Please add a firewall rule manually in the Azure portal.",
    );
    public static createNew = l10n.t("Create New");
    public static enterResourceGroupName = l10n.t("Enter a name for the new resource group");
    public static selectLocation = l10n.t("Select a location for the resource group");
    public static resourceGroupNameIsRequired = l10n.t("Resource group name is required");
    public static creating = l10n.t("Creating...");
    public static enterServerName = l10n.t("Enter a name for the new server");
    public static serverNameIsRequired = l10n.t("Server name is required");
    public static creatingServer = l10n.t("Creating server...");
    public static authenticationType = l10n.t("Authentication Type");
    public static sqlLogin = l10n.t("SQL Authentication");
    public static azureMFA = l10n.t("Microsoft Entra ID");
    public static azureMFAAndUser = l10n.t("Both");
    public static userName = l10n.t("Username");
    public static enterUserName = l10n.t("Enter username");
    public static password = l10n.t("Password");
    public static enterPassword = l10n.t("Enter password");
    public static savePassword = l10n.t("Save password");
    public static userNameIsRequired = l10n.t("Username is required");
    public static passwordIsRequired = l10n.t("Password is required");
    public static dataSource = l10n.t("Data Source");
    public static selectDataSource = l10n.t("Select a data source");
    public static noDataSource = l10n.t("None (empty database)");
    public static collation = l10n.t("Collation");
    public static selectCollation = l10n.t("Select a collation");
    public static loadingCollations = l10n.t("Loading collations...");
    public static enableAlwaysEncrypted = l10n.t("Always Encrypted");
    public static maintenanceWindow = l10n.t("Maintenance Window");
    public static selectMaintenanceWindow = l10n.t("Select a maintenance window");
    public static loadingMaintenanceConfigs = l10n.t("Loading maintenance windows...");
    public static serverTooltipMFA = l10n.t(
        "This server only supports Microsoft Entra ID authentication.",
    );
    public static databaseTooltipMFA = l10n.t(
        "Use Microsoft Entra ID authentication to provision and connect to this database.",
    );
    public static serverTooltipMFAAndUser = l10n.t(
        "This server supports Microsoft Entra ID and SQL Authentication.",
    );
    public static databaseTooltipMFAAndUser = l10n.t(
        "Connect using either Microsoft Entra ID or SQL Authentication.",
    );
    public static userNameTooltip = l10n.t("[Read-only] Pre-filled from the server properties.");
    public static serverTooltipSqlLogin = l10n.t("This server only supports SQL Authentication.");
    public static databaseTooltipSqlLogin = l10n.t(
        "Use SQL Authentication with a valid username and password.",
    );
    public static serverAuthTypeUnknown = l10n.t(
        "Unable to determine the server authentication type.",
    );
    public static maxVcores = l10n.t("Max vCores");
    public static selectMaxVcores = l10n.t("Select Max vCores");
}

export class FabricProvisioning {
    public static databaseName = l10n.t("Database Name");
    public static enterDatabaseName = l10n.t("Enter Database Name");
    public static databaseNameIsRequired = l10n.t("Database Name is required");
    public static databaseDescription = l10n.t("Database Description");
    public static enterDatabaseDescription = l10n.t("Enter Database Description");
    public static workspacePermissionsError = l10n.t(
        "Please select a workspace where you have sufficient permissions (Contributor or higher)",
    );
    public static databaseNameError = l10n.t(
        "This database name is already in use. Please choose a different name.",
    );
}

export class QueryResult {
    public static nonNumericSelectionSummary = (
        count: number,
        distinctCount: number,
        nullCount: number,
    ) =>
        l10n.t({
            message: "Count: {0}  Distinct Count: {1}  Null Count: {2}",
            args: [count, distinctCount, nullCount],
            comment: ["{0} is the count, {1} is the distinct count, and {2} is the null count"],
        });
    public static numericSelectionSummary = (average: string, count: number, sum: number) =>
        l10n.t({
            message: "Average: {0}  Count: {1}  Sum: {2}",
            args: [average, count, sum],
            comment: ["{0} is the average, {1} is the count, {2} is the sum"],
        });
    public static numericSelectionSummaryTooltip = (
        average: string,
        count: number,
        distinctCount: number,
        max: number,
        min: number,
        nullCount: number,
        sum: number,
    ) => {
        return [
            l10n.t({
                message: "Average: {0}",
                args: [average],
                comment: ["{0} is the average"],
            }),
            l10n.t({
                message: "Count: {0}",
                args: [count],
                comment: ["{0} is the count"],
            }),
            l10n.t({
                message: "Distinct Count: {0}",
                args: [distinctCount],
                comment: ["{0} is the distinct count"],
            }),
            l10n.t({
                message: "Max: {0}",
                args: [max],
                comment: ["{0} is the max"],
            }),
            l10n.t({
                message: "Min: {0}",
                args: [min],
                comment: ["{0} is the min"],
            }),
            l10n.t({
                message: "Null Count: {0}",
                args: [nullCount],
                comment: ["{0} is the null count"],
            }),
            l10n.t({
                message: "Sum: {0}",
                args: [sum],
                comment: ["{0} is the sum"],
            }),
        ].join(os.EOL);
    };
    public static nonNumericSelectionSummaryTooltip = (
        count: number,
        distinctCount: number,
        nullCount: number,
    ) => {
        return [
            l10n.t({
                message: "Count: {0}",
                args: [count],
                comment: ["{0} is the count"],
            }),
            l10n.t({
                message: "Distinct Count: {0}",
                args: [distinctCount],
                comment: ["{0} is the distinct count"],
            }),
            l10n.t({
                message: "Null Count: {0}",
                args: [nullCount],
                comment: ["{0} is the null count"],
            }),
        ].join(os.EOL);
    };
    public static copyError = (error: string) =>
        l10n.t({
            message: "An error occurred while copying results: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static summaryFetchConfirmation = (numRows: number) =>
        l10n.t({
            message: "{0} rows selected, click to load summary",
            args: [numRows],
            comment: ["{0} is the number of rows to fetch summary statistics for"],
        });
    public static clickToFetchSummary = l10n.t("Click to load summary");
    public static summaryLoadingProgress = (totalRows: number) => {
        return l10n.t({
            message: `Loading summary for {0} rows (Click to cancel)`,
            args: [totalRows],
            comment: ["{0} is the total number of rows"],
        });
    };
    public static clickToCancelLoadingSummary = l10n.t("Click to cancel loading summary");
    public static summaryLoadingCanceled = l10n.t("Summary loading canceled");
    public static summaryLoadingCanceledTooltip = l10n.t("Summary loading was canceled by user");
    public static errorLoadingSummary = l10n.t("Error loading summary");
    public static errorLoadingSummaryTooltip = (error: string) =>
        l10n.t({
            message: "Error loading summary: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static getRowsError = (error: string) =>
        l10n.t({
            message: "An error occurred while retrieving rows: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static queryResultPanelFailedToLoad = l10n.t(
        "The query results panel failed to load. Please try running the query again.",
    );
}

export class LocalContainers {
    public static stoppedContainerSucessfully = (name: string) =>
        l10n.t({
            message: "{0} stopped successfully.",
            args: [name],
            comment: ["{0} stopped successfully."],
        });
    public static failStopContainer = (name: string) =>
        l10n.t({
            message: "Failed to stop {0}.",
            args: [name],
            comment: ["Failed to stop {0}."],
        });
    public static startedContainerSucessfully = (name: string) =>
        l10n.t({
            message: "{0} started successfully.",
            args: [name],
            comment: ["{0} started successfully."],
        });
    public static startingContainer = (name: string) =>
        l10n.t({
            message: "Starting {0}...",
            args: [name],
            comment: ["{0} is the container name"],
        });
    public static failStartContainer = (name: string) =>
        l10n.t({
            message: "Failed to start {0}.",
            args: [name],
            comment: ["Failed to start {0}."],
        });
    public static deletedContainerSucessfully = (name: string) =>
        l10n.t({
            message: "{0} deleted successfully.",
            args: [name],
            comment: ["{0} deleted successfully."],
        });
    public static failDeleteContainer = (name: string) =>
        l10n.t({
            message: "Failed to delete {0}.",
            args: [name],
            comment: ["Failed to delete {0}."],
        });
    public static selectImage = l10n.t("Select image");
    public static selectImageTooltip = l10n.t("Select the SQL Server Container Image");
    public static sqlServerVersionImage = (version: string) =>
        l10n.t({
            message: "SQL Server {0} - latest",
            args: [version],
            comment: ["{0} is the SQL Server version"],
        });
    public static sqlServerPasswordTooltip = l10n.t("SQL Server Container SA Password");
    public static pleaseChooseUniqueProfileName = l10n.t(
        "Please choose a unique name for the profile",
    );
    public static containerName = l10n.t("Container Name");
    public static containerNameTooltip = l10n.t(
        "Choose a name for the SQL Server Docker Container",
    );
    public static pleaseChooseUniqueContainerName = l10n.t(
        "Please choose a unique name for the container",
    );
    public static port = l10n.t("Port");
    public static portTooltip = l10n.t("Choose a port to host the SQL Server Docker Container");
    public static pleaseChooseUnusedPort = l10n.t(
        "Please make sure the port is a number, and choose a port that is not in use",
    );
    public static hostname = l10n.t("Hostname");
    public static hostnameTooltip = l10n.t("Choose a hostname for the container");
    public static termsAndConditions = l10n.t("Terms & Conditions");
    public static acceptSqlServerEulaTooltip = l10n.t(
        "Accept the SQL Server EULA to deploy a SQL Server Docker container",
    );
    public static acceptSqlServerEula = l10n.t("Please Accept the SQL Server EULA");
    public static dockerInstallHeader = l10n.t("Checking if Docker is installed");
    public static dockerInstallBody = l10n.t("Checking if Docker is installed on your machine");
    public static dockerInstallError = l10n.t(
        "Docker is not installed or not in PATH. Please install Docker Desktop and try again.",
    );
    public static startDockerHeader = l10n.t("Checking if Docker is started");
    public static startDockerBody = l10n.t(
        "Checking if Docker is running on your machine. If not, we'll start it for you.",
    );
    public static dockerError = l10n.t(
        "Error running Docker commands. Please make sure Docker is running.",
    );
    public static startDockerEngineHeader = l10n.t("Checking Docker Engine Configuration");
    public static startDockerEngineBody = l10n.t(
        "Checking if the Docker Engine is configured correctly on your machine.",
    );
    public static pullImageHeader = l10n.t("Pulling SQL Server Image");
    public static pullImageBody = l10n.t(
        "Pulling the SQL Server container image. This might take a few minutes depending on your internet connection.",
    );

    public static creatingContainerHeader = l10n.t("Creating Container");
    public static creatingContainerBody = l10n.t("Creating and starting your SQL Server container");
    public static settingUpContainerHeader = l10n.t("Setting up container");
    public static settingUpContainerBody = l10n.t("Readying container for connections.");
    public static connectingToContainerHeader = l10n.t("Connecting to Container");
    public static connectingToContainerBody = l10n.t(
        "Connecting to your SQL Server Docker container",
    );
    public static passwordLengthError = l10n.t("Please make your password 8-128 characters long.");
    public static passwordComplexityError = l10n.t(
        "Your password must contain characters from at least three of the following categories: uppercase letters, lowercase letters, numbers (0-9), and special characters (!, $, #, %, etc.).",
    );
    public static pullSqlServerContainerImageError = l10n.t(
        "Failed to pull SQL Server image. Please check your network connection and try again.",
    );
    public static unsupportedDockerPlatformError = (platform: string) =>
        l10n.t({
            message: "Unsupported platform for Docker: {0}",
            args: [platform],
            comment: ["{0} is the platform name of the machine"],
        });
    public static unsupportedDockerArchitectureError = (architecture: string) =>
        l10n.t({
            message: "Unsupported architecture for Docker: {0}",
            args: [architecture],
            comment: ["{0} is the architecture name of the machine"],
        });
    public static rosettaError = l10n.t(
        'Rosetta is required to run SQL Server container images on Apple Silicon. Enable "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" in Docker Desktop > Settings > General.',
    );
    public static windowsContainersError = l10n.t(
        "SQL Server does not support Windows containers. Please switch to Linux containers in Docker Desktop settings.",
    );
    public static linuxDockerPermissionsError = l10n.t(
        "Docker requires root permissions to run. Please run Docker with sudo or add your user to the docker group using sudo usermod -aG docker $USER. Then, reboot your machine and retry.",
    );
    public static dockerSocketPermissionError = l10n.t(
        "Cannot access the Docker socket. Your user may not be in the 'docker' group, or VS Code was started before group membership took effect. Run 'sudo usermod -aG docker $USER' and then log out and back in (or reboot) before relaunching VS Code.",
    );
    public static dockerFailedToStartWithinTimeout = l10n.t(
        "Docker failed to start within the timeout period. Please manually start Docker and try again.",
    );
    public static containerFailedToStartWithinTimeout = l10n.t(
        "Container failed to start within the timeout period. Please wait a few minutes and try again.",
    );
    public static dockerDesktopPathError = l10n.t(
        "We can't find where Docker Desktop is located on your machine. Please manually start Docker Desktop and try again.",
    );
    public static installDocker = l10n.t("Install Docker");
    public static msgCreateLocalSqlContainer = l10n.t("Create Local SQL Container");
    public static startingDockerLoadingLabel = l10n.t("Starting Docker...");
    public static startingContainerLoadingLabel = l10n.t("Starting Container...");
    public static readyingContainerLoadingLabel = l10n.t("Readying container for connections...");
    public static stoppingContainerLoadingLabel = l10n.t("Stopping Container...");
    public static deletingContainerLoadingLabel = l10n.t("Deleting Container...");
    public static deleteContainerConfirmation = (containerName: string) => {
        return l10n.t({
            message:
                "Are you sure you want to delete the container {0}? This will remove both the container and its connection from VS Code.",
            args: [containerName],
            comment: ["{0} is the container name"],
        });
    };
    public static configureLinuxContainers = l10n.t("Configure Linux containers");
    public static configureRosetta = l10n.t("Configure Rosetta in Docker Desktop");
    public static switchToLinuxContainersConfirmation = l10n.t(
        "Your Docker Engine currently runs Windows containers. SQL Server only supports Linux containers. Would you like to switch to Linux containers?",
    );
    public static switchToLinuxContainersCanceled = l10n.t(
        "Switching to Linux containers was canceled. SQL Server only supports Linux containers.",
    );
    public static startSqlServerContainerError = l10n.t(
        "Failed to start SQL Server container. Please check the error message for more details, and then try again.",
    );
    public static containerDoesNotExistError = l10n.t(
        "Container does not exist. Would you like to remove the connection?",
    );
    public static passwordPlaceholder = l10n.t("Enter password");
    public static containerNamePlaceholder = l10n.t("Enter container name");
    public static portPlaceholder = l10n.t("Enter port");
    public static hostnamePlaceholder = l10n.t("Enter hostname");
    // DAB (Data API builder) deployment strings
    public static dabContainerNameInvalidOrInUse = l10n.t(
        "Container name is invalid or already in use",
    );
    public static dabPortAlreadyInUse = (port: number) =>
        l10n.t({
            message: "Port {0} is already in use",
            args: [port],
            comment: ["{0} is the port number"],
        });
    public static dabStartContainerMissingParams = l10n.t(
        "Container name, port, and config content are required to start the container.",
    );
    public static dabFailedToStartContainer = l10n.t("Failed to start DAB container.");
    public static dabCheckContainerMissingParams = l10n.t(
        "Container name and port are required to check container readiness.",
    );
    public static dabUnknownDeploymentStep = (step: number) =>
        l10n.t({
            message: "Unknown deployment step: {0}",
            args: [step],
            comment: ["{0} is the deployment step number"],
        });
    public static dabPullImageError = l10n.t(
        "Failed to pull DAB container image. Please check your network connection.",
    );
    public static dabStartContainerError = l10n.t(
        "Failed to start DAB container. Please check the Docker logs for details.",
    );
    public static dabContainerReadyTimeout = l10n.t(
        "DAB container failed to become ready within the timeout period.",
    );
    public static dabStopContainerError = l10n.t("Failed to stop and remove DAB container.");
}

export class UserSurvey {
    public static overallHowSatisfiedAreYouWithMSSQLExtension = l10n.t(
        "Overall, how satisfied are you with the MSSQL extension?",
    );
    public static howlikelyAreYouToRecommendMSSQLExtension = l10n.t(
        "How likely it is that you would recommend the MSSQL extension to a friend or colleague?",
    );
    public static whatCanWeDoToImprove = l10n.t("What can we do to improve?");
    public static takeSurvey = l10n.t("Take Survey");
    public static doYouMindTakingAQuickFeedbackSurvey = l10n.t(
        "Do you mind taking a quick feedback survey about the MSSQL Extension for VS Code?",
    );
    public static mssqlFeedback = l10n.t("MSSQL Feedback");
    public static privacyDisclaimer = l10n.t(
        "Microsoft reviews your feedback to improve our products, so don't share any personal data or confidential/proprietary content.",
    );
    public static overallHowStatisfiedAreYouWithFeature = (featureName: string) =>
        l10n.t({
            message: "Overall, how satisfied are you with {0}?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });

    public static howLikelyAreYouToRecommendFeature = (featureName: string) =>
        l10n.t({
            message: "How likely it is that you would recommend {0} to a friend or colleague?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });
    public static fileAnIssuePrompt = l10n.t(
        "Encountering a problem?  Share the details with us by opening a GitHub issue so we can improve!",
    );
    public static submitIssue = l10n.t("Submit an issue");
    public static mssqlMarketplaceReviewPrompt = l10n.t(
        "We're glad you're enjoying MSSQL for VS Code!  Please consider leaving a quick review on the VS Code Marketplace.",
    );
    public static writeReview = l10n.t("Write a review");
}

export class Webview {
    public static webviewRestorePrompt = (webviewName: string) =>
        l10n.t({
            message: "{0} has been closed. Would you like to restore it?",
            args: [webviewName],
            comment: ["{0} is the webview name"],
        });
    public static Restore = l10n.t("Restore");
    public static webviewNotReadyTimeout = (webviewName: string, timeoutMs: number) =>
        l10n.t({
            message: "Webview '{0}' did not become ready within {1}ms",
            args: [webviewName, timeoutMs],
            comment: ["{0} is the webview name", "{1} is the timeout in milliseconds"],
        });
    public static webviewDisposedBeforeReady = l10n.t(
        "Webview was disposed before it became ready",
    );
}

export class TableDesigner {
    public static General = l10n.t("General");
    public static Columns = l10n.t("Columns");
    public static AdvancedOptions = l10n.t("Advanced Options");
}

export class PublishProject {
    public static Title = l10n.t("Publish Project");
    public static PublishProfileLabel = l10n.t("Publish Profile");
    public static PublishProfilePlaceholder = l10n.t("Load profile...");
    public static SelectPublishProfile = l10n.t("Select Profile");
    public static SaveAs = l10n.t("Save As");
    public static PublishSettingsFile = l10n.t("Publish Settings File");
    public static ServerLabel = l10n.t("Server");
    public static DatabaseLabel = l10n.t("Database");
    public static DatabaseRequiredMessage = l10n.t("Database name is required");
    public static SqlCmdVariablesLabel = l10n.t("SQLCMD Variables");
    public static PublishTargetLabel = l10n.t("Publish Target");
    public static PublishTargetExisting = l10n.t("Existing SQL Server");
    public static PublishTargetContainer = l10n.t("New Local Docker SQL Server");
    public static PublishTargetNewAzureServer = l10n.t("New Azure SQL logical server (Preview)");
    public static GenerateScript = l10n.t("Generate Script");
    public static Publish = l10n.t("Publish");
    public static BuildProjectTaskLabel(projectName: string) {
        return l10n.t("Build {0}", projectName);
    }
    public static BuildingProjectProgress(projectName: string) {
        return l10n.t("Building {0}...", projectName);
    }
    public static BuildFailedWithExitCode(exitCode: number) {
        return l10n.t("Build failed with exit code {0}", exitCode);
    }
    public static SqlServerPortNumber = l10n.t("SQL Server port number");
    public static SqlServerAdminPassword = l10n.t("SQL Server admin password");
    public static SqlServerAdminPasswordConfirm = l10n.t("Confirm SQL Server admin password");
    public static SqlServerImageTag = l10n.t("Image tag");
    public static SqlServerLicenseAgreement = l10n.t("Microsoft SQL Server License Agreement");
    public static ServerConnectionPlaceholder = l10n.t("Select Connection");
    public static CheckingDockerPrerequisites = l10n.t("Checking Docker prerequisites...");
    public static CreatingSqlServerContainer = l10n.t("Creating SQL Server container...");
    // Validation messages
    public static InvalidPortMessage = l10n.t("Port must be a number between 1 and 65535");
    public static PortAlreadyInUse = (port: number) =>
        l10n.t({
            message: "Port {0} is already in use. Please choose a different port.",
            args: [port],
            comment: ["{0} is the port number"],
        });
    public static InvalidSQLPasswordMessage(name: string) {
        return l10n.t(
            "Invalid SQL Server password for {0}. Password must be 8–128 characters long and meet the complexity requirements.  For more information see https://docs.microsoft.com/sql/relational-databases/security/password-policy",
            name,
        );
    }
    public static PasswordNotMatchMessage = (name: string) => {
        return l10n.t("{0} password doesn't match the confirmation password", name);
    };
    public static RequiredFieldMessage = l10n.t("Required");
    public static LicenseAcceptanceMessage = l10n.t("You must accept the license");
    public static PublishProfileLoadFailed = l10n.t("Failed to load publish profile");
    public static PublishProfileSavedSuccessfully = (path: string) => {
        return l10n.t("Publish profile saved to: {0}", path);
    };
    public static PublishProfileSaveFailed = l10n.t("Failed to save publish profile");
    public static DacFxServiceNotAvailable = l10n.t(
        "DacFx service is not available. Publish and generate script operations cannot be performed.",
    );
    public static DacFxServiceNotAvailableProfileLoaded = l10n.t(
        "DacFx service is not available. Profile loaded without deployment options. Publish and generate script operations cannot be performed.",
    );
    public static FailedToListDatabases = l10n.t("Failed to list databases");
    public static FailedToConnectToServer = l10n.t("Failed to connect to server");
    public static ConnectionProfileNotFound = l10n.t(
        "Connection profile not found. Please create a new connection using the Connection Dialog.",
    );
    public static FailedToFetchContainerTags = (errorMessage: string) => {
        return l10n.t("Failed to fetch Docker container tags: {0}", errorMessage);
    };
    public static ProfileLoadedConnectionFailed = (serverName: string) =>
        l10n.t({
            message:
                "Profile loaded, but the connection could not be automatically established. Please create a connection to {0} then try again.",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    public static FailedToGenerateSqlPackageCommand(errorMessage: string) {
        return l10n.t("Failed to generate SqlPackage command: {0}", errorMessage);
    }
    public static FailedToGetConnectionString(errorMessage: string) {
        return l10n.t("Failed to get connection string: {0}", errorMessage);
    }
    public static NoActiveConnection = l10n.t("No active connection");
    public static DacpacPathNotFound = l10n.t(
        "DACPAC path not found. Please build the project first.",
    );
}

export class CodeAnalysis {
    public static Title = l10n.t("Code Analysis");
    public static failedToLoadRules = l10n.t("Failed to load code analysis rules");
    public static failedToLoadOverrides = l10n.t(
        "Failed to read saved rule overrides from project",
    );
    public static failedToSaveRules = l10n.t("Failed to save code analysis rules");
    public static rulesSaved = l10n.t("Code analysis rules saved successfully");
}

export class SchemaCompare {
    public static Title = l10n.t("Schema Compare");
    public static Open = l10n.t("Open");
    public static Save = l10n.t("Save");
    public static defaultUserName = l10n.t("default");
    public static Yes = l10n.t("Yes");
    public static No = l10n.t("No");
    public static optionsChangedMessage = l10n.t(
        "Options have changed. Recompare to see the comparison?",
    );
    public static generateScriptErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Failed to generate script: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the generate script operation"],
        });
    public static areYouSureYouWantToUpdateTheTarget = l10n.t(
        "Are you sure you want to update the target?",
    );
    public static schemaCompareApplyFailed = (errorMessage: string) =>
        l10n.t({
            message: "Failed to apply changes: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the publish changes operation"],
        });
    public static openScmpErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open scmp file: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the open scmp operation"],
        });
    public static saveScmpErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Failed to save scmp file: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the save scmp operation"],
        });
    public static cancelErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Cancel schema compare failed: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the cancel operation"],
        });
    public static compareErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Schema Compare failed: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the compare operation"],
        });
    public static cannotExcludeEntryWithBlockingDependency = (
        diffEntryName: string,
        firstDependentName: string,
    ) =>
        l10n.t({
            message: "Cannot exclude {0}. Included dependents exist, such as {1}",
            args: [diffEntryName, firstDependentName],
            comment: [
                "{0} is the name of the entry",
                "{1} is the name of the blocking dependency preventing exclusion.",
            ],
        });
    public static cannotIncludeEntryWithBlockingDependency = (
        diffEntryName: string,
        firstDependentName: string,
    ) =>
        l10n.t({
            message: "Cannot include {0}. Excluded dependents exist, such as {1}",
            args: [diffEntryName, firstDependentName],
            comment: [
                "{0} is the name of the entry",
                "{1} is the name of the blocking dependency preventing inclusion.",
            ],
        });
    public static cannotExcludeEntry = (diffEntryName: string) =>
        l10n.t({
            message: "Cannot exclude {0}. Included dependents exist",
            args: [diffEntryName],
            comment: ["{0} is the name of the entry"],
        });
    public static cannotIncludeEntry = (diffEntryName: string) =>
        l10n.t({
            message: "Cannot include {0}. Excluded dependents exist",
            args: [diffEntryName],
            comment: ["{0} is the name of the entry"],
        });
    public static connectionFailed = (errorMessage: string) =>
        l10n.t({
            message: "Connection failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message from the connection attempt"],
        });
}

export class SchemaDesigner {
    public static LoadingSchemaDesginerModel = l10n.t("Loading Schema Designer Model...");
    public static PanelTitle = l10n.t("Visualize and Design Schema");
    public static ReadOnlyPanelTitle = l10n.t("Table Diagram");
    public static SchemaReady = l10n.t(
        "Schema Designer Model is ready. Changes can now be published.",
    );
    public static SaveAs = l10n.t("Save As");
    public static Save = l10n.t("Save");
    public static SchemaDesigner = l10n.t("Schema Designer");
    public static OpeningPublishScript = l10n.t("Opening Publish Script. This may take a while...");
    public static GeneratingReport = l10n.t("Generating Report. This may take a while...");
    public static PublishScriptFailed = (errorMessage: string) =>
        l10n.t({
            message: "Failed to generate publish script: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the generate script operation"],
        });
    public static mcpServerAddedToWorkspace = (filePath: string) =>
        l10n.t({
            message: "MCP server added to {0}",
            args: [filePath],
            comment: ["{0} is the file path where the MCP server was added"],
        });
    public static mcpServerAlreadyExists = (filePath: string) =>
        l10n.t({
            message: "MCP server is already configured in {0}",
            args: [filePath],
            comment: ["{0} is the file path where the MCP server configuration exists"],
        });
    public static noWorkspaceOpenForMcp = l10n.t(
        "No workspace folder is open. Open a folder to add the MCP server configuration.",
    );
    public static noWorkspaceOpenForGeneratedFile = l10n.t(
        "No workspace folder is open. Open a folder to add the generated file.",
    );
    public static generatedFileAddedToWorkspace = (filePath: string) =>
        l10n.t({
            message: "Generated file added to {0}",
            args: [filePath],
            comment: ["{0} is the generated file path"],
        });
    public static configCopiedToClipboard = l10n.t("Config copied to clipboard");
    public static urlCopiedToClipboard = l10n.t("URL copied to clipboard");
    public static logsCopiedToClipboard = l10n.t("Logs copied to clipboard");
    public static dabLogsEditorTitle = l10n.t("DAB container logs");
    public static failedToOpenUrl = l10n.t(
        "Failed to open URL. The built-in Simple Browser may be disabled.",
    );
    public static dabDeploymentNotSupported = l10n.t(
        "Local container deployment is currently only supported with SQL Authentication connections.",
    );
}

export class StatusBar {
    public static disconnectedLabel = l10n.t("Connect to MSSQL");
    public static notConnectedTooltip = l10n.t("Click to connect to a database");
    public static connectingLabel = l10n.t("Connecting");
    public static connectErrorLabel = l10n.t("Connection error"); // {0} is the server name
}

export class Connection {
    public static connectingToProfile = (profileName: string) => {
        return l10n.t({
            message: "Connecting to {0}...",
            args: [profileName],
            comment: ["{0} is the connection display name"],
        });
    };

    public static missingConnectionIdsError = (connectionDisplayNames: string[]) => {
        return l10n.t({
            message:
                "The following workspace or workspace folder connections are missing the 'id' property and are being ignored.  Please manually add the 'id' property to the connection in order to use it. \n\n {0}",
            args: [connectionDisplayNames.join("\n")],
            comment: [
                "{0} is the list of display names for the connections that have been ignored",
            ],
        });
    };

    public static missingConnectionInformation = (connectionId: string) => {
        return l10n.t({
            message:
                "The connection with ID '{0}' does not have the 'server' property set and is being ignored.  Please set the 'server' property on this connection in order to use it.",
            args: [connectionId],
            comment: ["{0} is the connection ID for the connection that has been ignored"],
        });
    };

    public static orphanedConnectionGroupsWarning = (groupNames: string) => {
        return l10n.t({
            message:
                "One or more connection groups reference parent groups that do not exist and have been ignored: {0}. Update your settings file to fix these entries.",
            args: [groupNames],
            comment: ["{0} is the comma separated list of connection group names"],
        });
    };

    public static orphanedConnectionsWarning = (connectionDisplayNames: string[]) => {
        return l10n.t({
            message:
                "One or more connections reference groups that do not exist and have been ignored: {0}. Update your connection settings to fix these entries.",
            args: [connectionDisplayNames.join(", ")],
            comment: ["{0} is the comma separated list of connection display names"],
        });
    };

    public static multipleRootGroupsFoundError = (rootId: string) => {
        return l10n.t({
            message:
                "Multiple connection groups with ID '{0}' found.  Delete or rename all of them, except one in User/Global settings.json, then restart the extension.",
            args: [rootId],
            comment: ["{0} is the root id"],
        });
    };

    public static defaultConnectionIdNotFoundWarning = (connectionId: string) => {
        return l10n.t({
            message:
                "The connection ID '{0}' set in 'mssql.defaultConnectionId' does not match any known connection profile. New editors will fall back to transferring the active connection.",
            args: [connectionId],
            comment: ["{0} is the connection ID that was not found"],
        });
    };

    public static defaultConnectionIdNotSetWarning = l10n.t(
        "'mssql.newEditorConnectionBehavior' is set to 'defaultConnection', but 'mssql.defaultConnectionId' is not configured. New editors will fall back to transferring the active connection.",
    );

    public static defaultConnectionSelectConnection = l10n.t("Select Connection");

    public static defaultConnectionChangeSetting = l10n.t("Change Setting");

    public static defaultConnectionSelectConnectionPlaceholder = l10n.t(
        "Select a connection to use as the default",
    );

    public static defaultConnectionChangeSettingPlaceholder = l10n.t(
        "Choose the behavior for new editors",
    );

    public static defaultConnectionBehaviorTransferActive = l10n.t(
        "Transfer active connection (Default)",
    );

    public static defaultConnectionBehaviorNone = l10n.t("Do not connect");

    public static errorMigratingLegacyConnection = (connectionId: string, errorMessage: string) => {
        return l10n.t({
            message:
                "Error migrating connection ID {0} to new format.  Please recreate this connection to use it.\nError:\n{1}",
            args: [connectionId, errorMessage],
            comment: ["{0} is the connection id", "{1} is the error message"],
        });
    };
    public static noAccountSelected = l10n.t("No account selected");
    public static currentAccount = (accountDisplayName: string) => {
        return l10n.t({
            message: "{0} (Current Account)",
            args: [accountDisplayName],
            comment: ["{0} is the account display name"],
        });
    };
    public static signInToAzure = l10n.t("Sign in to a new account");
    public static SelectAccountForKeyVault = l10n.t(
        "Select Azure account with Key Vault access for column decryption",
    );
    public static NoTenantSelected = l10n.t("No tenant selected");
    public static SelectTenant = l10n.t("Select a tenant");

    public static ChangePassword = l10n.t("Change Password");

    public static trustServerCertificateMustBeEnabledMessage = l10n.t(
        "Encryption was enabled on this connection; review your SSL and certificate configuration for the target SQL Server, or set 'Trust server certificate' to 'true'. Note: A self-signed certificate offers only limited protection and is not a recommended practice for production environments.",
    );

    public static trustServerCertificateMustBeEnabledPrompt = l10n.t(
        "Do you want to enable 'Trust server certificate' on this connection and retry?",
    );

    public static securityTokenRequestFailed = (errorMessage: string, resource: string) => {
        return l10n.t({
            message: "Failed to obtain token for resource '{1}'.  Error: {0}",
            args: [errorMessage, resource],
            comment: ["{0} is the error message", "{1} is the resource"],
        });
    };
    public static failedToAcquireToken = (accountId: string, tenantId: string) => {
        return l10n.t({
            message: "Failed to acquire token for account '{0}' and tenant '{1}'",
            args: [accountId, tenantId],
            comment: ["{0} is the account ID", "{1} is the tenant ID"],
        });
    };
}

export class MssqlChatAgent {
    public static noModelFound = l10n.t("No model found.");
    public static noToolsToProcess = l10n.t("No tools to process.");
    public static notConnected = l10n.t("You are not connected to any database.");
    public static connectedTo = l10n.t("Connected to:");
    public static server = (serverName: string) => {
        return l10n.t({
            message: "Server - {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static database = (databaseName: string) => {
        return l10n.t({
            message: "Database - {0}",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    };
    public static usingModel = (modelName: string, canSendRequest: boolean | undefined) => {
        return l10n.t({
            message: "Using {0} ({1})...",
            args: [modelName, canSendRequest],
            comment: ["{0} is the model name", "{1} is whether the model can send requests"],
        });
    };
    public static toolLookupFor = (partName: string, partInput: string) => {
        return l10n.t({
            message: "Tool lookup for: {0} - {1}.",
            args: [partName, partInput],
            comment: ["{0} is the part name", "{1} is the part input"],
        });
    };
    public static gotInvalidToolUseParameters = (partInput: string, errorMessage: string) => {
        return l10n.t({
            message: 'Got invalid tool use parameters: "{0}". ({1})',
            args: [partInput, errorMessage],
            comment: ["{0} is the part input", "{1} is the error message"],
        });
    };
    public static callingTool = (toolFunctionName: string, sqlToolParameters: string) => {
        return l10n.t({
            message: "Calling tool: {0} with {1}.",
            args: [toolFunctionName, sqlToolParameters],
            comment: ["{0} is the tool function name", "{1} is the SQL tool parameters"],
        });
    };
    public static modelNotFoundError = l10n.t(
        "The requested model could not be found. Please check model availability or try a different model.",
    );
    public static noPermissionError = l10n.t(
        "Access denied. Please ensure you have the necessary permissions to use this tool or model.",
    );
    public static quoteLimitExceededError = l10n.t(
        "Usage limits exceeded. Try again later, or consider optimizing your requests.",
    );
    public static offTopicError = l10n.t(
        "I'm sorry, I can only assist with SQL-related questions.",
    );
    public static unexpectedError = l10n.t(
        "An unexpected error occurred with the language model. Please try again.",
    );
    public static usingModelToProcessRequest = (modelName: string) => {
        return l10n.t({
            message: "Using {0} to process your request...",
            args: [modelName],
            comment: ["{0} is the model name that will be processing the request"],
        });
    };
    public static languageModelDidNotReturnAnyOutput = l10n.t(
        "The language model did not return any output.",
    );
    public static errorOccurredWhileProcessingRequest = l10n.t(
        "An error occurred while processing your request.",
    );
    public static errorOccurredWith = (errorMessage: string) => {
        return l10n.t({
            message: "An error occurred: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    public static unknownErrorOccurred = l10n.t("An unknown error occurred. Please try again.");
    public static messageCouldNotBeProcessed = l10n.t(
        "This message couldn't be processed. If this issue persists, please check the logs and open an issue on GitHub.",
    );
    public static connect = l10n.t("Connect");
    public static openSqlEditorAndConnect = l10n.t("Open SQL editor and connect");
    public static connectionRequiredMessage = (buttonText: string) => {
        return l10n.t({
            message:
                'An active connection is required for GitHub Copilot to understand your database schema and proceed.\nSelect "{0}" to establish a connection.',
            args: [buttonText],
            comment: ["{0} is the button text (e.g., 'Connect' or 'Open SQL editor and connect')"],
        });
    };
    // Follow-up questions
    public static followUpConnectToDatabase = l10n.t("Connect to a database");
    public static followUpShowRandomTableDefinition = l10n.t("Show a random table definition");
    public static followUpCountTables = l10n.t("How many tables are in this database?");
    public static listServersToolConfirmationTitle = l10n.t("List Connections");
    public static listServersToolConfirmationMessage = l10n.t(
        "List all connections registered with the mssql extension?",
    );
    public static listServersToolInvocationMessage = l10n.t("Listing server connections");
    public static connectToolConfirmationTitle = l10n.t("Connect to Server");
    public static connectToolConfirmationMessageWithServerOnly = (serverName: string) => {
        return l10n.t({
            message: "Connect to server {0}?",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static connectToolConfirmationMessageWithServerAndDatabase = (
        serverName: string,
        databaseName: string,
    ) => {
        return l10n.t({
            message: "Connect to server {0} and database {1}?",
            args: [serverName, databaseName],
            comment: ["{0} is the server name", "{1} is the database name"],
        });
    };
    public static connectToolInvocationMessageWithServerOnly = (serverName: string) => {
        return l10n.t({
            message: "Connecting to server {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static connectToolInvocationMessageWithServerAndDatabase = (
        serverName: string,
        databaseName: string,
    ) => {
        return l10n.t({
            message: "Connecting to server {0} and database {1}",
            args: [serverName, databaseName],
            comment: ["{0} is the server name", "{1} is the database name"],
        });
    };
    public static connectToolServerNotFoundError = (serverName: string) => {
        return l10n.t({
            message: "Server {0} not found.",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static connectToolSuccessMessage = l10n.t("Successfully connected to server.");
    public static connectToolFailMessage = l10n.t("Failed to connect to server.");
    public static connectToolProfileNotFoundError = (profileId: string) => {
        return l10n.t({
            message: "Connection profile '{0}' not found.",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    public static connectToolInvalidInputError = () => {
        return l10n.t("Either profileId or serverName must be provided.");
    };
    public static connectToolConfirmationMessageWithProfile = (profileId: string) => {
        return l10n.t({
            message: "Connect using profile {0}?",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    public static connectToolInvocationMessageWithProfile = (profileId: string) => {
        return l10n.t({
            message: "Connecting using profile {0}",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    public static disconnectToolConfirmationTitle = l10n.t("Disconnect");
    public static disconnectToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Disconnect from connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static disconnectToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Disconnecting from connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static showSchemaToolConfirmationTitle = l10n.t("Show Schema");
    public static showSchemaToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Show schema for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static showSchemaToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Showing schema for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static noConnectionError = (connectionId: string) => {
        return l10n.t({
            message: "No connection found for connectionId: {0}",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static unknownConnection = l10n.t("Unknown Connection");
    public static schemaDesignerToolShowSuccessMessage = l10n.t({
        message:
            "Schema designer opened. For schema mutations, continue with {0} operations ({1}/{2}).",
        args: ["mssql_schema_designer", "get_overview", "apply_edits"],
        comment: [
            "{0} is the command identifier 'mssql_schema_designer' and must not be translated",
            "{1} is the operation name 'get_overview' and must not be translated",
            "{2} is the operation name 'apply_edits' and must not be translated",
        ],
    });
    public static dabToolShowSuccessMessage = l10n.t({
        message: "Data API builder opened. Continue with {0} operations ({1}/{2}).",
        args: ["mssql_dab", "get_state", "apply_changes"],
        comment: [
            "{0} is the command identifier 'mssql_dab' and must not be translated",
            "{1} is the operation name 'get_state' and must not be translated",
            "{2} is the operation name 'apply_changes' and must not be translated",
        ],
    });
    public static schemaDesignerToolConfirmationTitle = l10n.t("Schema Designer");
    public static schemaDesignerToolConfirmationMessage = (operation: string) => {
        return l10n.t({
            message: "Execute '{0}' operation on the schema designer?",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static schemaDesignerToolInvocationMessage = (operation: string) => {
        return l10n.t({
            message: "Executing '{0}' operation on schema designer",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static dabToolConfirmationTitle = l10n.t("Data API builder");
    public static dabToolConfirmationMessage = (operation: string) => {
        return l10n.t({
            message: "Execute '{0}' operation on Data API builder?",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static dabToolInvocationMessage = (operation: string) => {
        return l10n.t({
            message: "Executing '{0}' operation on Data API builder",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static dabToolNoActiveDesigner = l10n.t(
        "No active schema designer found. Please open Data API builder first using mssql_dab with operation 'show' or from the UI.",
    );
    public static toolMissingConnectionReference = l10n.t(
        "Missing connection reference. Please provide exactly one of connectionId or connectionName.",
    );
    public static toolAmbiguousConnectionReference = l10n.t(
        "Ambiguous connection reference. Please provide only one of connectionId or connectionName.",
    );
    public static noSqlToolsMcpConnectionName = (connectionName: string) => {
        return l10n.t({
            message: "No SQL Tools MCP connection found for connectionName: {0}",
            args: [connectionName],
            comment: ["{0} is the SQL Tools MCP registered connection name"],
        });
    };
    public static schemaDesignerNoActiveDesigner = l10n.t(
        "No active schema designer found. Please open one first using mssql_schema_designer with operation 'show' or from the UI.",
    );
    public static schemaDesignerStaleState = l10n.t(
        "Schema designer state changed. Fetch the latest schema and retry the operation.",
    );
    public static schemaDesignerAddTableSuccess = l10n.t(
        "Table added to schema designer successfully.",
    );
    public static schemaDesignerAddTableFailed = l10n.t("Failed to add table to schema designer.");
    public static schemaDesignerUpdateTableSuccess = l10n.t(
        "Table updated in schema designer successfully.",
    );
    public static schemaDesignerUpdateTableFailed = l10n.t(
        "Failed to update table in schema designer.",
    );
    public static schemaDesignerDeleteTableSuccess = l10n.t(
        "Table deleted from schema designer successfully.",
    );
    public static schemaDesignerDeleteTableFailed = l10n.t(
        "Failed to delete table from schema designer.",
    );
    public static schemaDesignerReplaceSchemaSuccess = l10n.t(
        "Schema designer updated successfully.",
    );
    public static schemaDesignerReplaceSchemaFailed = l10n.t("Failed to update schema designer.");
    public static schemaDesignerGetSchemaSuccess = l10n.t(
        "Schema designer state retrieved successfully.",
    );
    public static schemaDesignerMissingSchema = l10n.t(
        "Missing schema payload for replace_schema operation.",
    );
    public static schemaDesignerMissingTable = l10n.t(
        "Missing table payload for update_table operation.",
    );
    public static schemaDesignerMissingDeleteTableTarget = l10n.t(
        "Missing table target for delete_table operation. Provide tableId or tableName+schemaName.",
    );
    public static schemaDesignerUnknownOperation = (operation: string) => {
        return l10n.t({
            message:
                "Unknown operation: {0}. Supported operations: add_table, update_table, delete_table, replace_schema, get_schema",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static getConnectionDetailsToolConfirmationTitle = l10n.t("Get Connection Details");
    public static getConnectionDetailsToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Get connection details for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static getConnectionDetailsToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Getting connection details for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static listDatabasesToolConfirmationTitle = l10n.t("List Databases");
    public static listDatabasesToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List databases for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static listDatabasesToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Listing databases for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static changeDatabaseToolConfirmationTitle = l10n.t("Change Database");
    public static changeDatabaseToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
        database: string,
    ) => {
        return l10n.t({
            message: "Change database to '{2}' for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId, database],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the database name",
            ],
        });
    };
    public static changeDatabaseToolInvocationMessage = (
        displayName: string,
        connectionId: string,
        database: string,
    ) => {
        return l10n.t({
            message: "Changing database to '{2}' for connection '{0}' (ID: {1})",
            args: [displayName, connectionId, database],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the database name",
            ],
        });
    };
    public static changeDatabaseToolSuccessMessage = (database: string) => {
        return l10n.t({
            message: "Successfully changed to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
    public static changeDatabaseToolFailMessage = (database: string) => {
        return l10n.t({
            message: "Failed to connect to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
    public static ListTablesToolConfirmationTitle = l10n.t("List Tables");
    public static ListTablesToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List tables for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListTablesToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Listing tables for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListSchemasToolConfirmationTitle = l10n.t("List Schemas");
    public static ListSchemasToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List schemas for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListSchemasToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Listing schemas for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListViewsToolConfirmationTitle = l10n.t("List Views");
    public static ListViewsToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List views for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListViewsToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Listing views for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListFunctionsToolConfirmationTitle = l10n.t("List Functions");
    public static ListFunctionsToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List functions for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListFunctionsToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Listing functions for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static RunQueryToolConfirmationTitle = l10n.t("Run Query");
    public static RunQueryToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
        query: string,
    ) => {
        return l10n.t({
            message: "Run query on connection '{0}' (ID: {1})?\n\nQuery: {2}",
            args: [displayName, connectionId, query],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the SQL query",
            ],
        });
    };
    public static RunQueryToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Running query on connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };

    // Chat Commands localization strings
    public static connectedSuccessfully = l10n.t("Connected successfully");
    public static failedToConnect = l10n.t("Failed to connect");
    public static disconnectedSuccessfully = l10n.t("Disconnected successfully");
    public static databaseChangedSuccessfully = l10n.t("Database changed successfully");
    public static failedToChangeDatabase = l10n.t("Failed to change database");
    public static noActiveConnectionForDatabaseChange = l10n.t(
        "No active connection for database change",
    );
    public static connectionDetails = l10n.t("Connection Details");
    public static serverLabel = l10n.t("Server");
    public static databaseLabel = l10n.t("Database");
    public static authentication = l10n.t("Authentication");
    public static sqlLogin = l10n.t("SQL Login");
    public static serverVersion = l10n.t("Server Version");
    public static serverEdition = l10n.t("Server Edition");
    public static cloud = l10n.t("Cloud");
    public static yes = l10n.t("Yes");
    public static no = l10n.t("No");
    public static user = l10n.t("User");
    public static noConnectionInformationFound = l10n.t("No connection information found");
    public static noActiveConnection = l10n.t("No active connection");
    public static openingSchemaDesigner = l10n.t("Opening schema designer...");
    public static noConnectionCredentialsFound = l10n.t("No connection credentials found");
    public static noActiveConnectionForSchemaView = l10n.t("No active connection for schema view");
    public static availableServers = l10n.t("Available Servers");
    public static noSavedConnectionProfilesFound = l10n.t("No saved connection profiles found.");
    public static useConnectToCreateNewConnection = (connectCommand: string) => {
        return l10n.t({
            message: "Use {0} to create a new connection.",
            args: [connectCommand],
            comment: ["{0} is the connect command"],
        });
    };
    public static unnamedProfile = l10n.t("Unnamed Profile");
    public static default = l10n.t("Default");
    public static foundSavedConnectionProfiles = (count: number) => {
        return l10n.t({
            message: "Found {0} saved connection profile(s).",
            args: [count],
            comment: ["{0} is the number of connection profiles"],
        });
    };
    public static errorRetrievingServerList = (errorMessage: string) => {
        return l10n.t({
            message: "Error retrieving server list: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    public static unknownError = l10n.t("Unknown error");
    public static noActiveDatabaseConnection = l10n.t(
        "No active database connection in the current editor. Please establish a connection to continue.",
    );
    public static chatCommandNotAvailable = l10n.t(
        "Chat command not available in this VS Code version",
    );

    // Help command strings
    public static helpWelcome = l10n.t(
        "👋 I'm GitHub Copilot for MSSQL extension, your intelligent SQL development assistant in Visual Studio Code. I help you connect, explore, design, and evolve your SQL databases directly from VS Code.",
    );
    public static helpWhatICanDo = l10n.t("What I can do for you:");
    public static helpCapabilityExploreDesign = l10n.t(
        "Explore, design, and evolve database schemas using intelligent, code-first or data-first guidance",
    );
    public static helpCapabilityContextualSuggestions = l10n.t(
        "Apply contextual suggestions for SQL syntax, relationships, and constraints",
    );
    public static helpCapabilityWriteOptimize = l10n.t(
        "Write, optimize, and troubleshoot SQL queries with AI-recommended improvements",
    );
    public static helpCapabilityGenerateMockData = l10n.t(
        "Generate mock data and seed scripts to support testing and development environments",
    );
    public static helpCapabilityAccelerateSchema = l10n.t(
        "Accelerate schema evolution by autogenerating ORM migrations or T-SQL change scripts",
    );
    public static helpCapabilityUnderstandDocument = l10n.t(
        "Understand and document business logic embedded in stored procedures, views, and functions",
    );
    public static helpCapabilitySecurityRecommendations = l10n.t(
        "Get security-related recommendations, such as avoiding SQL injection or excessive permissions",
    );
    public static helpCapabilityNaturalLanguage = l10n.t(
        "Receive natural language explanations to help developers unfamiliar with T-SQL understand code",
    );
    public static helpCapabilityReverseEngineer = l10n.t(
        "Reverse-engineer existing databases by explaining SQL schemas and relationships",
    );
    public static helpCapabilityScaffoldComponents = l10n.t(
        "Scaffold backend components (e.g., data-access layers) based on your current database context",
    );
}

export class QueryEditor {
    public static codeLensConnect = l10n.t("$(plug)  Connect to MSSQL");
    public static queryCancelFailed(errorMessage: string) {
        return l10n.t({
            message: "Cancel failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
    public static queryDisposeFailed(errorMessage: string) {
        return l10n.t({
            message: "Failed disposing query: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
}

export class ConnectionSharing {
    public static connectionSharingRequestNotification(extensionName: string) {
        return l10n.t({
            message:
                "The extension '{0}' is requesting access to your SQL Server connections. This will allow it to execute queries and access your database.",
            args: [extensionName],
            comment: ["{0} is the extension name"],
        });
    }
    public static Approve = l10n.t("Approve");
    public static Deny = l10n.t("Deny");
    public static GrantAccess = l10n.t("✅ Grant Access");
    public static GrantAccessCurrent = l10n.t("✅ Grant Access (Current)");
    public static DenyAccess = l10n.t("❌ Deny Access");
    public static DenyAccessCurrent = l10n.t("❌ Deny Access (Current)");
    public static AllowThisExtensionToAccessYourConnections = l10n.t(
        "Allow this extension to access your connections",
    );
    public static BlockThisExtensionFromAccessingYourConnections = l10n.t(
        "Block this extension from accessing your connections",
    );
    public static SelectAnExtensionToManage = l10n.t(
        "Select an extension to manage connection sharing permissions",
    );
    public static SelectNewPermission = (extensionName: string) => {
        return l10n.t({
            message: "Select new permission for extension: '{0}'",
            args: [extensionName],
            comment: ["{0} is the extension name"],
        });
    };
    public static ClearAllPermissions = l10n.t(
        "Clear permissions for all extensions to access your connections",
    );
    public static Clear = l10n.t("Clear");
    public static Cancel = l10n.t("Cancel");
    public static AllPermissionsCleared = l10n.t(
        "All permissions for extensions to access your connections have been cleared.",
    );
    public static noActiveEditorError = l10n.t(
        "No active text editor found. Please open a file with an active database connection.",
    );
    public static connectionNotFoundError(connectionId: string) {
        return l10n.t({
            message: `Connection with ID "{0}" not found. Please verify the connection ID exists.`,
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    }
    public static failedToEstablishConnectionError(connectionId: string) {
        return l10n.t({
            message: `Failed to establish connection with ID "{0}". Please check connection details and network connectivity.`,
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    }
    public static invalidConnectionUri = l10n.t("Invalid connection URI provided.");
    public static connectionNotActive = l10n.t(
        "Connection is not active. Please establish a connection before performing this action.",
    );
    public static permissionDenied(extensionId: string) {
        return l10n.t({
            message: `Connection sharing permission denied for extension: '{0}'. Use the permission management commands to change this.`,
            args: [extensionId],
            comment: ["{0} is the extension ID"],
        });
    }
    public static permissionRequired(extensionId: string) {
        return l10n.t({
            message: `Connection sharing permission is required for extension: '{0}'`,
            args: [extensionId],
            comment: ["{0} is the extension ID"],
        });
    }
}

export class ConnectionGroup {
    public static createNewGroup = l10n.t("Create Connection Group");
    public static editExistingGroup = (groupName: string) => {
        return l10n.t({
            message: "Edit Connection Group - {0}",
            args: [groupName],
            comment: ["{0} is the connection group name"],
        });
    };
}

export class DacpacDialog {
    public static Title = l10n.t("Data-tier Application");
    public static FilePathRequired = l10n.t("File path is required");
    public static FileNotFound = l10n.t("File not found");
    public static InvalidFileExtension = l10n.t(
        "Invalid file extension. Expected .dacpac or .bacpac",
    );
    public static DirectoryNotFound = l10n.t("Directory not found");
    public static FileAlreadyExists = l10n.t(
        "File already exists. It will be overwritten if you continue",
    );
    public static DatabaseNameRequired = l10n.t("Database name is required");
    public static InvalidDatabaseName = l10n.t(
        'Database name contains invalid characters. Avoid using: < > * ? " / \\ |',
    );
    public static DatabaseNameTooLong = l10n.t(
        "Database name is too long. Maximum length is 128 characters",
    );
    public static DatabaseAlreadyExists = l10n.t(
        "A database with this name already exists on the server",
    );
    public static DatabaseNotFound = l10n.t("Database not found on the server");
    public static ValidationFailed = l10n.t("Validation failed. Please check your inputs");
    public static DeployToExistingWarning = l10n.t("Deploy to Existing Database");
    public static DeployToExistingMessage = l10n.t(
        "You are about to deploy to an existing database. This operation will make permanent changes to the database schema and may result in data loss. Do you want to continue?",
    );
    public static DeployToExistingConfirm = l10n.t("Deploy");
    public static Cancel = l10n.t("Cancel");
    public static Select = l10n.t("Select");
    public static Save = l10n.t("Save");
    public static Files = l10n.t("Files");
    public static InvalidApplicationVersion = l10n.t(
        "Application version must be in format n.n.n.n where n is a number (e.g., 1.0.0.0)",
    );
    public static RevealInExplorer = Common.revealInExplorer;
    public static RevealInFinder = Common.revealInFinder;
    public static OpenContainingFolder = Common.openContainingFolder;
    public static FailedToListDatabases = l10n.t(
        "Unable to retrieve the list of databases. You may not have permission to list databases on this server.",
    );
    public static DeploySuccessWithDatabase(databaseName: string): string {
        return l10n.t({
            message: "DACPAC deployed successfully to database '{0}'",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    }
    public static ExtractSuccessWithFile(filePath: string): string {
        return l10n.t({
            message: "DACPAC extracted successfully to '{0}'",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    }
    public static ImportSuccessWithDatabase(databaseName: string): string {
        return l10n.t({
            message: "BACPAC imported successfully to database '{0}'",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    }
    public static ExportSuccessWithFile(filePath: string): string {
        return l10n.t({
            message: "BACPAC exported successfully to '{0}'",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    }
}

export class SearchDatabase {
    public static title = (serverName: string) =>
        l10n.t({
            message: "Search Database Objects - {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });

    public static failedToEstablishConnection = l10n.t("Failed to establish connection");

    public static typeTable = l10n.t("Table");
    public static typeView = l10n.t("View");
    public static typeStoredProcedure = l10n.t("Stored Procedure");
    public static typeFunction = l10n.t("Function");
    public static typeUnknown = l10n.t("Unknown");

    public static copiedToClipboard = (objectName: string) =>
        l10n.t({
            message: 'Copied "{0}" to clipboard',
            args: [objectName],
            comment: ["{0} is the object name"],
        });

    public static failedToScriptObject = (errorMessage: string) =>
        l10n.t({
            message: "Failed to script object: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToOpenEditData = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open Edit Data: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToOpenModifyTable = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open Modify Table: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
}

export class TableExplorer {
    public static unableToOpenTableExplorer = l10n.t(
        "Unable to open Table Explorer: No target node provided.",
    );
    public static changesSavedSuccessfully = l10n.t("Changes saved successfully.");
    public static rowCreatedSuccessfully = l10n.t("Row created.");
    public static rowMarkedForRemoval = l10n.t("Row marked for removal.");
    public static rowDeletedSuccessfully = l10n.t("Row deleted.");

    public static failedToSaveChanges = (errorMessage: string) =>
        l10n.t({
            message: "Failed to save changes: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToLoadData = (errorMessage: string) =>
        l10n.t({
            message: "Failed to load data: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToCreateNewRow = (errorMessage: string) =>
        l10n.t({
            message: "Failed to create a new row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRemoveRow = (errorMessage: string) =>
        l10n.t({
            message: "Failed to remove row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToUpdateCell = (errorMessage: string) =>
        l10n.t({
            message: "Failed to update cell: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRevertCell = (errorMessage: string) =>
        l10n.t({
            message: "Failed to revert cell: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRevertRow = (errorMessage: string) =>
        l10n.t({
            message: "Failed to revert row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToGenerateScript = (errorMessage: string) =>
        l10n.t({
            message: "Failed to generate script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static noScriptToOpen = l10n.t(
        "No script available. Make changes to the table data and generate a script first.",
    );

    public static failedToOpenScript = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static scriptCopiedToClipboard = l10n.t("Script copied to clipboard.");

    public static noScriptToCopy = l10n.t(
        "No script available. Make changes to the table data and generate a script first.",
    );

    public static failedToCopyScript = (errorMessage: string) =>
        l10n.t({
            message: "Failed to copy script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static unsavedChangesPrompt = (tableName: string) =>
        l10n.t({
            message:
                "Table Explorer for '{0}' has unsaved changes. Do you want to save or discard them?",
            args: [tableName],
            comment: ["{0} is the table name"],
        });

    public static Save = l10n.t("Save");
    public static Discard = l10n.t("Discard");
    public static Cancel = l10n.t("Cancel");

    public static exportSuccessful = (filePath: string) =>
        l10n.t({
            message: "Results exported successfully to {0}",
            args: [filePath],
            comment: ["{0} is the file path"],
        });

    public static exportFailed = (errorMessage: string) =>
        l10n.t({
            message: "Failed to export results: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToOpenTableDesigner = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open Table Designer: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToOpenSchemaDesigner = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open Schema Designer: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRunTableQuery = (errorMessage: string) =>
        l10n.t({
            message: "Failed to run table query: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRunTableQueryUnknown = l10n.t("Failed to run table query.");

    public static pendingChangesWillBeLost = l10n.t(
        "Running a custom query will discard all pending changes. Do you want to continue?",
    );

    public static Continue = l10n.t("Continue");
}

export class AzureDataStudioMigration {
    public static PageTitle = l10n.t("Azure Data Studio Migration");
    public static SelectConfigFileDialogTitle = l10n.t(
        "Locate an Azure Data Studio settings.json file to import",
    );
    public static ImportStatusReady = l10n.t("Ready for import");
    public static ConnectionStatusNeedsAttention = l10n.t("Needs attention");
    public static ConnectionStatusAlreadyImported = (
        connectionDisplayName: string,
        connectionId: string,
    ) =>
        l10n.t({
            message: "Connection with the same ID is already imported: {0} (ID: {1})",
            args: [connectionDisplayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });

    public static ConnectionGroupStatusAlreadyImported = (groupName: string, groupId: string) =>
        l10n.t({
            message: "Connection group with the same ID is already imported: {0} (ID: {1})",
            args: [groupName, groupId],
            comment: ["{0} is the group name", "{1} is the group ID"],
        });
    public static connectionIssueMissingSqlPassword = (username: string) =>
        l10n.t({
            message: "Enter the SQL Login password for user '{0}'.",
            args: [username],
            comment: ["{0} is the SQL Login username"],
        });
    public static connectionIssueMissingAzureAccount = (username: string) =>
        l10n.t({
            message: "Sign in with Entra ID '{0}'.",
            args: [username],
            comment: ["{0} is the Entra ID username"],
        });

    public static EntraSignInDialogUnknownAccount = l10n.t("Unknown account");
    public static EntraSignInDialogUnknownTenant = l10n.t("Unknown tenant ID");

    public static importProgressSuccessMessage = l10n.t(
        "Import complete. You can close this dialog.",
    );
    public static importProgressErrorMessage = (error: string) =>
        l10n.t({
            message: "Import failed: {0}",
            args: [error],
            comment: ["{0} is the error message returned from the import helper."],
        });

    public static groupNotSelectedWillBeMovedToRootWarning = l10n.t(
        "This connection's group has not been selected, so this connection will be imported to the root.",
    );
}

export class Changelog {
    public static ChangelogDocumentTitle = l10n.t("MSSQL: Welcome & What's New");
    public static tryIt = l10n.t("Try it");
    public static watchDemo = l10n.t("Watch demo");
    public static learnMore = l10n.t("Learn more");
    public static watchDemosOnYoutube = l10n.t("Watch demos on YouTube");
    public static viewRoadmap = l10n.t("View roadmap");
    public static readTheDocumentation = l10n.t("Read docs on Microsoft Learn");
    public static joinTheDiscussions = l10n.t("Join the discussions");
    public static customizeKeyboardShortcuts = l10n.t("Customize keyboard shortcuts");

    // Main content
    public static mainContentTitle = l10n.t("Highlights");
    public static schemaDesignerCopilotTitle = l10n.t("Schema Designer with GitHub Copilot");
    public static schemaDesignerCopilotDescription = l10n.t(
        "Use natural language to design database schemas directly within the visual Schema Designer. Create schemas from scratch, evolve existing designs, review changes through a diff view, and import external artifacts - all reflected live in the visual diagram and T-SQL script.",
    );
    public static shortcutsConfigurationTitle = l10n.t("Shortcuts Configuration");
    public static shortcutsConfigurationDescription = l10n.t(
        "Create and manage keyboard shortcuts for frequently used queries, as well as query editor and results grid actions, to discover available commands and execute them more efficiently.",
    );
    public static azureSqlProvisioningTitle = l10n.t("Azure SQL databases provisioning");
    public static azureSqlProvisioningDescription = l10n.t(
        "Easily start with the Azure SQL database free tier to create and connect to a database directly from your editor at no cost.",
    );
    public static dabTitle = l10n.t("Data API builder");
    public static dabDescription = l10n.t(
        "Create REST, GraphQL, and MCP endpoints for your SQL database tables from a visual interface within Visual Studio Code. Configure entities, permissions, and deployment settings — then deploy locally with Docker.",
    );
    public static dabWithCopilotTitle = l10n.t("Data API builder with GitHub Copilot");
    public static dabWithCopilotDescription = l10n.t(
        "Generate REST, GraphQL, and MCP endpoints from your SQL database objects (tables). You can modify the configuration manually or through GitHub Copilot to plan and generate updates - then deploy locally with Docker.",
    );
    public static dabCopilotTitle = l10n.t("GitHub Copilot integration in Data API builder");
    public static dabCopilotDescription = l10n.t(
        "Generate Data API builder configurations using natural language through GitHub Copilot chat and agent tools. Describe your API requirements and let GitHub Copilot scaffold the configuration for you.",
    );
    public static sqlNotebooksTitle = l10n.t("SQL Notebooks");
    public static sqlNotebooksDescription = l10n.t(
        "Write and run SQL queries in native Visual Studio Code Jupyter notebooks with interactive results, sorting, filtering, and Markdown documentation.",
    );
    public static fabricQueryProfilerTitle = l10n.t("Fabric databases in Query Profiler");
    public static fabricQueryProfilerDescription = l10n.t(
        "The Query Profiler now supports SQL database in Microsoft Fabric connections, with new Azure SQL Database templates including {code-snippet-0} for lightweight T-SQL profiling.",
    );
    public static adsMigrationTitle = l10n.t(
        "Azure Data Studio Migration Toolkit - Now Including Keymap!",
    );
    public static adsMigrationDescription = l10n.t(
        "Migrate saved connections, connection groups, and connection settings from Azure Data Studio into the MSSQL extension. Additionally, the MSSQL Data Management Keymap can be installed to add familiar shortcuts from Azure Data Studio.",
    );
    public static dacpacTitle = l10n.t("Data-Tier Application (DACPAC / BACPAC) Import & Export");
    public static dacpacDescription = l10n.t(
        "Deploy and extract .dacpac files or import/export .bacpac packages using an integrated, streamlined workflow in the MSSQL extension.",
    );

    // Secondary content
    public static secondaryContentTitle = l10n.t("In case you missed it");
    public static secondaryContentDescription = l10n.t(
        "Previously released features you may not have explored yet.",
    );
    public static editDataTitle = l10n.t("Edit Data");
    public static editDataDescription = l10n.t(
        "View, add, edit, and delete table rows in an interactive grid with real-time validation and live DML script previews.",
    );
    public static fabricIntegrationTitle = l10n.t("Microsoft Fabric integration");
    public static fabricIntegrationDescription = l10n.t(
        "Browse Fabric workspaces and provision SQL databases in Fabric without leaving VS Code.",
    );
    public static sqlProjCodeAnalysisTitle = l10n.t("SQL Database Projects — Code Analysis");
    public static sqlProjCodeAnalysisDescription = l10n.t(
        "Analyze static code with customizable rulesets in SQL Database Projects.",
    );

    // Sidebar content
    public static resourcesTitle = l10n.t("Resources");
    public static resourcesDescription = l10n.t("Explore tutorials, docs, and what's coming next.");
    public static feedbackTitle = l10n.t("Feedback");
    public static feedbackDescription = l10n.t("Help us improve by sharing your thoughts.");
    public static openNewBug = l10n.t("Open a new bug");
    public static requestNewFeature = l10n.t("Request a new feature");
    public static copilotSurvey = l10n.t("GitHub Copilot survey");
    public static gettingStartedTitle = l10n.t("Getting Started");
    public static gettingStartedDescription = l10n.t(
        "New to the MSSQL extension? Check out our quick-start guide.",
    );
    public static mssqlWalkthrough = l10n.t("MSSQL - VS Code walkthrough");
    public static copilotWalkthrough = l10n.t("GitHub Copilot - VS Code walkthrough");

    // Event banner
    public static sqlconEuDescription1 = l10n.t(
        "Discover how SQL Database in Fabric, Azure SQL, and SQL Server are redefining modern app development. Join engineers and peers pushing the limits of performance, AI integration, and developer productivity.",
    );
    public static sqlconEuDescription2 = l10n.t(
        "Use discount code {0} to save €200 on registration.",
    );
    public static sqlconEuRegister = l10n.t("Register");
}

export class Profiler {
    // Error messages
    public static failedToLaunchProfiler = (error: string) =>
        l10n.t({
            message: "Failed to launch profiler: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static failedToStartProfiler = (error: string) =>
        l10n.t({
            message: "Failed to start profiler: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static failedToCreateSession = (error: string) =>
        l10n.t({
            message: "Failed to create profiler session: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static connectionError = (error: string) =>
        l10n.t({
            message: "Connection error: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static failedToConnect = l10n.t("Failed to connect to the selected server.");
    public static noConnectionAvailable = l10n.t("No profiler connection available");
    public static noSavedConnections = l10n.t(
        "No saved connections found. Please create a connection first.",
    );
    public static noTemplatesAvailable = l10n.t("No profiler templates available");
    public static sessionCreationTimedOut = l10n.t("Session creation timed out");

    // XEL file error messages
    public static failedToOpenXelFile = (error: string) =>
        l10n.t({
            message: "Failed to open XEL file: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static invalidXelFile = l10n.t("The selected file is not a valid XEL file.");
    public static xelFileNotFound = l10n.t("The XEL file was not found.");
    public static xelFileAccessDenied = l10n.t("Access to the XEL file was denied.");

    // Validation messages
    public static sessionNameEmpty = l10n.t("Session name cannot be empty");
    public static sessionNameTooLong = (maxLength: number) =>
        l10n.t({
            message: "Session name must be {0} characters or less",
            args: [maxLength],
            comment: ["{0} is the maximum length"],
        });
    public static sessionNameInvalidChars = l10n.t(
        "Session name can only contain letters, numbers, underscores, and hyphens",
    );

    // Quick pick and input prompts
    public static selectTemplate = l10n.t("Select a profiler template");
    public static newSessionSelectTemplate = l10n.t("New Query Profiler - Select Template");
    public static enterSessionName = l10n.t("Enter a name for the new profiler session");
    public static sessionNamePlaceholder = l10n.t("MyProfilerSession");
    public static newSessionEnterName = l10n.t("New Query Profiler - Enter Name");
    public static engineLabel = (engineType: string) =>
        l10n.t({
            message: "Engine: {0}",
            args: [engineType],
            comment: ["{0} is the engine type"],
        });
    public static selectXelFile = l10n.t("Select XEL File");
    public static xelFileFilter = l10n.t("Extended Events Log Files");

    // Success messages
    public static sessionCreatedSuccessfully = (sessionName: string) =>
        l10n.t({
            message: "Profiler session '{0}' created successfully. Starting profiling...",
            args: [sessionName],
            comment: ["{0} is the session name"],
        });
    public static sessionStartedSuccessfully = (sessionName: string) =>
        l10n.t({
            message: "Profiler session '{0}' started successfully.",
            args: [sessionName],
            comment: ["{0} is the session name"],
        });
    public static profilerReady = l10n.t(
        "Profiler ready. Select a session from the dropdown and click Start to begin profiling.",
    );
    public static stoppingSession = (sessionName: string) =>
        l10n.t({
            message: 'Stopping profiler session "{0}"...',
            args: [sessionName],
            comment: ["{0} is the session name"],
        });
    public static loadingXelFile = (fileName: string) =>
        l10n.t({
            message: "Loading XEL file: {0}",
            args: [fileName],
            comment: ["{0} is the file name"],
        });
    public static xelFileReadOnlyDisconnectedNotification = (fileName: string) =>
        l10n.t({
            message:
                "Profiler is in read-only and disconnected mode for XEL file '{0}' and cannot start or create live sessions without a database connection.",
            args: [fileName],
            comment: ["{0} is the file name"],
        });
    public static xelFileReadOnlyDisconnectedTooltip = (fileName: string) =>
        l10n.t({
            message:
                "Profiler is in read-only and disconnected mode for XEL file '{0}' and cannot start or create live sessions without a database connection",
            args: [fileName],
            comment: ["{0} is the file name"],
        });

    // Status bar
    public static statusBarNoSession = l10n.t("Query Profiler: No session");
    public static statusBarTooltip = l10n.t("Query Profiler Session Status");

    // Panel titles
    public static panelTitleWithSession = (name: string) =>
        l10n.t({
            message: "Query Profiler: {0}",
            args: [name],
            comment: ["{0} is the file name or session name"],
        });
    public static panelTitleDefault = l10n.t("Query Profiler");
    public static stateRunning = l10n.t("Running");
    public static statePaused = l10n.t("Paused");
    public static stateStopped = l10n.t("Stopped");
    public static stateNotStarted = l10n.t("Not Started");
    public static stateReadOnly = l10n.t("Read-Only");
    public static eventsCount = (count: number) =>
        l10n.t({
            message: "{0} events",
            args: [count],
            comment: ["{0} is the number of events"],
        });
    public static eventsCountFiltered = (filtered: number, total: number) =>
        l10n.t({
            message: "{0}/{1} events",
            args: [filtered, total],
            comment: ["{0} is the filtered count, {1} is the total count"],
        });
    public static fileSessionLabel = (fileName: string) =>
        l10n.t({
            message: "File: {0}",
            args: [fileName],
            comment: ["{0} is the file name"],
        });

    // Details panel
    public static failedToOpenInEditor = (error: string) =>
        l10n.t({
            message: "Failed to open text in editor: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });

    // Export messages
    public static defaultExportFileName = l10n.t("profiler_events");
    public static exportToCsv = l10n.t("Export to CSV");
    public static exportSuccess = (filePath: string) =>
        l10n.t({
            message: "Profiler events exported successfully to {0}",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    public static openFile = Common.openFile;
    public static exportFailed = (error: string) =>
        l10n.t({
            message: "Failed to export profiler events: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });

    public static copiedToClipboard = l10n.t("Copied to clipboard");
    // Close prompt messages
    public static unexportedEventsMessage = l10n.t(
        "You have captured Profiler events that have not been exported. If you close now, you will lose all captured events. Do you want to export them to a CSV file?",
    );
    public static exportAndClose = l10n.t("Export & Close");
    public static closeWithoutExport = l10n.t("Close Without Export");
    public static closeSessionConfirmation = l10n.t(
        "Are you sure you want to close the current session? All captured events will be lost. You can export events to CSV from the toolbar before closing.",
    );
    // Database selection for Azure SQL
    public static selectDatabaseForProfiler = l10n.t(
        "Select a database for profiling (Azure SQL requires a specific database)",
    );
    public static noDatabasesFound = l10n.t(
        "No databases found on the server. Please check your connection.",
    );
}

export class Proxy {
    public static unableToGetProxyAgentOptions = l10n.t("Unable to read proxy agent options.");

    public static missingProtocolWarning = (proxy: string) =>
        l10n.t({
            message:
                "Proxy settings found, but without a protocol (e.g. http://): '{0}'. You may encounter connection issues while using the MSSQL extension.",
            args: [proxy],
            comment: ["{0} is the proxy URL"],
        });

    public static unparseableWarning = (proxy: string, errorMessage: string) =>
        l10n.t({
            message:
                "Proxy settings found, but encountered an error while parsing the URL: '{0}'. You may encounter connection issues while using the MSSQL extension.  Error: {1}",
            args: [proxy, errorMessage],
            comment: ["{0} is the proxy URL", "{1} is the error message"],
        });
}

export class BackupDatabase {
    public static backupDatabaseTitle = (databaseName: string) =>
        l10n.t({
            message: "Backup Database - {0}",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    public static backupName = l10n.t("Backup Name");
    public static recoveryModel = l10n.t("Recovery Model");
    public static full = l10n.t("Full");
    public static bulkLogged = l10n.t("Bulk-logged");
    public static simple = l10n.t("Simple");
    public static backupType = l10n.t("Backup Type");
    public static differential = l10n.t("Differential");
    public static transactionLog = l10n.t("Transaction Log");
    public static copyOnly = l10n.t("Copy-only Backup");
    public static saveToUrl = l10n.t("Save backup to URL");
    public static azureAccount = l10n.t("Azure Account");
    public static azureAccountIsRequired = l10n.t("Azure Account is required");
    public static tenant = l10n.t("Tenant");
    public static tenantIsRequired = l10n.t("Tenant is required");
    public static storageAccount = l10n.t("Storage Account");
    public static storageAccountIsRequired = l10n.t("Storage Account is required");
    public static selectAStorageAccount = l10n.t("Select a storage account");
    public static blobContainer = l10n.t("Blob Container");
    public static selectABlobContainer = l10n.t("Select a blob container");
    public static blobContainerIsRequired = l10n.t("Blob Container is required");
    public static subscription = l10n.t("Subscription");
    public static selectASubscription = l10n.t("Select a subscription");
    public static subscriptionIsRequired = l10n.t("Subscription is required");
    public static backupFiles = l10n.t("Backup Files");
    public static compression = l10n.t("Compression");
    public static backupCompression = l10n.t("Set backup Compression");
    public static useDefault = l10n.t("Use the default server setting");
    public static compressBackup = l10n.t("Compress backup");
    public static doNotCompressBackup = l10n.t("Do not compress backup");
    public static media = l10n.t("Media");
    public static append = l10n.t("Append to the existing backup set");
    public static overwrite = l10n.t("Overwrite all existing backup sets");
    public static create = l10n.t("Backup to a new media set");
    public static unavailableForBackupsToExistingFiles = l10n.t(
        "Unavailable for backups to existing files",
    );
    public static pleaseChooseValidMediaOption = l10n.t("Please choose a valid media option");
    public static backupMediaSet = l10n.t("Set backup Media Set");
    public static newMediaSetName = l10n.t("New media set name");
    public static mediaSetNameIsRequired = l10n.t("Media set name is required");
    public static newMediaSetDescription = l10n.t("New media set description");
    public static mediaSetDescriptionIsRequired = l10n.t("Media set description is required");
    public static reliability = l10n.t("Reliability");
    public static performChecksum = l10n.t("Perform checksum before writing to media");
    public static verifyBackup = l10n.t("Verify backup when finished");
    public static continueOnError = l10n.t("Continue on error");
    public static truncateLog = l10n.t("Truncate the transaction log");
    public static backupTail = l10n.t("Backup the tail of the log");
    public static expiration = l10n.t("Expiration");
    public static retainDays = l10n.t("Set backup retain days");
    public static encryption = l10n.t("Encryption");
    public static enableEncryption = l10n.t("Use encryption for this backup");
    public static encryptionAlgorithm = l10n.t("Encryption Algorithm");
    public static encryptionType = l10n.t("Encryption Type");
    public static backupFileTypes = l10n.t("Backup Files (*.bak, *.log, *.trn)");
    public static allFiles = l10n.t("All Files (*.*)");
    public static noTenantsFound = l10n.t("No tenants found");
    public static noSubscriptionsFound = l10n.t("No subscriptions found");
    public static noStorageAccountsFound = l10n.t("No storage accounts found");
    public static noBlobContainersFound = l10n.t("No blob containers found");
    public static generatingSASKeyFailedWithError = (errorMessage: string) => {
        return l10n.t({
            message: "Generating SAS key failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    public static unableToLoadBackupConfig = l10n.t(
        "Unable to load backup configuration. Please try again.",
    );
    public static couldNotConnectToDatabase = (database: string) => {
        return l10n.t({
            message: "Could not connect to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
    public static azureSqlDbNotSupported = l10n.t(
        "Azure SQL Database is not supported for backup.",
    );
}

export class FlatFileImport {
    public static serviceStarting = (serviceName: string) =>
        l10n.t({
            message: "Starting '{0}'...",
            args: [serviceName],
            comment: ["{0} is the service name"],
        });
    public static serviceStarted = (serviceName: string) =>
        l10n.t({
            message: "'{0}' started.",
            args: [serviceName],
            comment: ["{0} is the service name"],
        });
    public static serviceStartFailed = (serviceName: string, errorMessage: string) =>
        l10n.t({
            message: "Failed to start '{0}': {1}",
            args: [serviceName, errorMessage],
            comment: ["{0} is the service name", "{1} is the error message"],
        });
    public static flatFileImportTitle = l10n.t("Import Flat File");
    public static databaseTheTableIsCreatedIn = l10n.t("Database the table is created in");
    public static locationOfTheFileToBeImported = l10n.t("Location of the file to be imported");
    public static newTableName = l10n.t("New Table Name");
    public static tableSchema = l10n.t("Table Schema");
    public static importFileTypes = l10n.t("CSV/TXT Files (*.csv;*.txt)");
    public static noDatabasesFoundToImportInto = l10n.t("No databases found to import into.");
    public static selectFileToImport = l10n.t("Select file to import");
    public static databaseRequired = l10n.t("Database is required");
    public static importFileRequired = l10n.t("Import file is required");
    public static tableNameRequired = l10n.t("Table name is required");
    public static schemaRequired = l10n.t("Schema is required");
    public static fetchTablePreviewError = l10n.t("Error fetching the table preview.");
    public static fetchSchemasError = l10n.t("Error fetching schemas for the selected database.");
    public static loadingSchemas = l10n.t("Loading schemas...");
    public static noSchemasFound = l10n.t("No schemas found");
    public static importFailed = l10n.t("Failed to import file.");
    public static flatFilePathTooltip = l10n.t(
        "Please ensure the file is not open in another application before importing",
    );
}

export class RestoreDatabase {
    public static restoreDatabaseTitle = l10n.t("Restore Database");
    public static sourceDatabase = l10n.t("Source Database");
    public static targetDatabase = l10n.t("Target Database");
    public static files = l10n.t("Files");
    public static relocateDbFiles = l10n.t("Relocate all files");
    public static general = l10n.t("General");
    public static overwriteExistingDb = l10n.t("Overwrite the existing database");
    public static overwriteExistingDbTooltip = l10n.t(
        "Uses the WITH REPLACE option during restore",
    );
    public static preserveReplicationSettings = l10n.t("Preserve the replication settings");
    public static preserveReplicationSettingsTooltip = l10n.t(
        "Uses the WITH KEEP_REPLICATION option during restore",
    );
    public static restrictAccessToRestoredDb = l10n.t("Restrict access to the restored database");
    public static restrictAccessToRestoredDbTooltip = l10n.t(
        "Uses the WITH RESTRICTED_USER option during restore",
    );
    public static recoveryState = l10n.t("Recovery state");
    public static restoreWithRecovery = l10n.t("RESTORE WITH RECOVERY");
    public static restoreWithNoRecovery = l10n.t("RESTORE WITH NORECOVERY");
    public static restoreWithStandby = l10n.t("RESTORE WITH STANDBY");
    public static dataFileFolder = l10n.t("Data file folder");
    public static logFileFolder = l10n.t("Log file folder");
    public static standbyFile = l10n.t("Standby file");
    public static tailLogBackup = l10n.t("Tail-log backup");
    public static takeTailLogBackup = l10n.t("Take tail-log backup before restore");
    public static leaveSourceDatabase = l10n.t("Leave the source database in the restoring state");
    public static leaveSourceDatabaseTooltip = l10n.t(
        "Uses the WITH NORECOVERY option during restore",
    );
    public static tailLogBackupFile = l10n.t("Tail-log backup file");
    public static serverConnections = l10n.t("Server Connections");
    public static closeExistingConnections = l10n.t(
        "Close existing connections to destination database",
    );
    public static blob = l10n.t("Blob");
    public static selectABlob = l10n.t("Select a blob");
    public static blobIsRequired = l10n.t("Blob is required");
    public static blobDatabaseError = l10n.t("Blob does not contain a valid database backup");
    public static noBlobsFound = l10n.t("No blobs found");
    public static backupFileDatabaseError = l10n.t(
        "Selected backup file does not contain a valid database backup",
    );
    public static cannotGenerateScriptWithNoRestorePlan = l10n.t(
        "Cannot generate script without a restore plan",
    );
    public static pleaseChooseAtLeastOneBackupSetToRestore = l10n.t(
        "Please choose at least one backup set to restore",
    );
    public static noDatabasesWithBackups = l10n.t("No databases with backups found");
    public static azureSqlDbNotSupported = l10n.t(
        "Azure SQL Database is not supported for restore.",
    );
}

export class ServiceClient {
    public static runtimeNotFoundError = l10n.t(
        "A required .NET runtime could not be found or installed.",
    );
    public static unableToStartService = (errorMessage: string) =>
        l10n.t({
            message:
                "The SQL Server extension couldn't start because its required background service failed to launch. Install the offline VSIX for your operating system, or check your network connection and try again. Details: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    public static downloadOfflineVsix = l10n.t("Download offline VSIX");
    public static copyLinkToClipboard = l10n.t("Copy link");
    public static linkCopiedToClipboard = l10n.t("Link copied to clipboard");

    public static serviceCrashed = (name: string, error: string) =>
        l10n.t({
            message: "The {0} service has crashed. Details: {1}",
            args: [name, error],
            comment: ["{0} is the service name", "{1} is the error message"],
        });
    public static viewKnownIssues = l10n.t("View known issues");

    public static installFailedStatusText = l10n.t("Service installation failed.");
}

export const azureSignInFailed = l10n.t("Azure sign in failed.");

export const selectSubscriptions = l10n.t("Select subscriptions");

export const errorLoadingAzureSubscriptions = l10n.t("Error loading Azure subscriptions.");

export const azureSubscriptionNotFoundInCache = l10n.t("Azure subscription not found in cache.");

export function invalidConnectionString0(arg0: string | number | boolean) {
    return l10n.t("Invalid connection string: {0}", arg0);
}

export const serializationFailed = l10n.t("Serialization failed");

export const azureMFA = l10n.t("Azure MFA");

export const windowsAuthentication = l10n.t("Windows Authentication");

export const enabled = l10n.t("Enabled");

export const disabled = l10n.t("Disabled");

export const server = l10n.t("Server");

export const database = l10n.t("Database");

export const authenticationType = l10n.t("Authentication Type");

export const user = l10n.t("User");

export const port = l10n.t("Port");

export const sqlContainerName = l10n.t("SQL Container Name");

export const sqlContainerVersion = l10n.t("SQL Container Version");

export const applicationIntent = l10n.t("Application Intent");

export const connectionTimeout = l10n.t("Connection Timeout");

export const commandTimeout = l10n.t("Command Timeout");

export const alwaysEncrypted = l10n.t("Always Encrypted");

export const replication = l10n.t("Replication");

export function loc0Filtered(arg0: string | number | boolean) {
    return l10n.t("{0} (filtered)", arg0);
}

export const objectExplorerFilter = l10n.t("Object Explorer Filter");

export const descriptionForTheTable = l10n.t("Description for the table.");

export const description = l10n.t("Description");

export const theNameOfTheColumnObject = l10n.t("The name of the column object.");

export const name = l10n.t("Name");

export const displaysTheDescriptionOfTheColumn = l10n.t("Displays the description of the column");

export const description2 = l10n.t("Description");

export const displaysTheUnifiedDataTypeIncludingLength = l10n.t(
    "Displays the unified data type (including length, scale and precision) for the column",
);

export const dataType = l10n.t("Data Type");

export const displaysTheDataTypeNameForThe = l10n.t("Displays the data type name for the column");

export const typeLabel = l10n.t("Type");

export const theMaximumLengthInCharactersThatCan = l10n.t(
    "The maximum length (in characters) that can be stored in this database object.",
);

export const length = l10n.t("Length");

export const aPredefinedGlobalDefaultValueForThe = l10n.t(
    "A predefined global default value for the column or binding.",
);

export const defaultValue = l10n.t("Default Value");

export const specifiesWhetherTheColumnMayHaveA = l10n.t(
    "Specifies whether the column may have a NULL value.",
);

export const allowNulls = l10n.t("Allow Nulls");

export const specifiesWhetherTheColumnIsIncludedIn = l10n.t(
    "Specifies whether the column is included in the primary key for the table.",
);

export const primaryKey = l10n.t("Primary Key");

export const forNumericDataTheMaximumNumberOf = l10n.t(
    "For numeric data, the maximum number of decimal digits that can be stored in this database object.",
);

export const precision = l10n.t("Precision");

export const forNumericDataTheMaximumNumberOf2 = l10n.t(
    "For numeric data, the maximum number of decimal digits that can be stored in this database object to the right of decimal point.",
);

export const scale = l10n.t("Scale");

export const columns = l10n.t("Columns");

export const column = l10n.t("Column");

export const newColumn = l10n.t("New Column");

export const theNameOfTheColumn = l10n.t("The name of the column.");

export const column2 = l10n.t("Column");

export const nameOfThePrimaryKey = l10n.t("Name of the primary key.");

export const name2 = l10n.t("Name");

export const theDescriptionOfThePrimaryKey = l10n.t("The description of the primary key.");

export const description3 = l10n.t("Description");

export const columnsInThePrimaryKey = l10n.t("Columns in the primary key.");

export const primaryKeyColumns = l10n.t("Primary Key Columns");

export const primaryKeyColumns2 = l10n.t("Primary Key Columns");

export const addColumn = l10n.t("Add Column");

export const theNameOfTheColumn2 = l10n.t("The name of the column.");

export const column3 = l10n.t("Column");

export const theNameOfTheIndex = l10n.t("The name of the index.");

export const name3 = l10n.t("Name");

export const theDescriptionOfTheIndex = l10n.t("The description of the index.");

export const description4 = l10n.t("Description");

export const theColumnsOfTheIndex = l10n.t("The columns of the index.");

export const columns2 = l10n.t("Columns");

export const addColumn2 = l10n.t("Add Column");

export const indexes = l10n.t("Indexes");

export const index = l10n.t("Index");

export const newIndex = l10n.t("New Index");

export const foreignColumn = l10n.t("Foreign Column");

export const column4 = l10n.t("Column");

export const theNameOfTheForeignKey = l10n.t("The name of the foreign key.");

export const name4 = l10n.t("Name");

export const theDescriptionOfTheForeignKey = l10n.t("The description of the foreign key.");

export const description5 = l10n.t("Description");

export const theTableWhichContainsThePrimaryOr = l10n.t(
    "The table which contains the primary or unique key column.",
);

export const foreignTable = l10n.t("Foreign Table");

export const theBehaviorWhenAUserTriesTo = l10n.t(
    "The behavior when a user tries to update a row with data that is involved in a foreign key relationship.",
);

export const onUpdateAction = l10n.t("On Update Action");

export const theBehaviorWhenAUserTriesTo2 = l10n.t(
    "The behavior when a user tries to delete a row with data that is involved in a foreign key relationship.",
);

export const onDeleteAction = l10n.t("On Delete Action");

export const theMappingBetweenForeignKeyColumnsAnd = l10n.t(
    "The mapping between foreign key columns and primary key columns.",
);

export const columns3 = l10n.t("Columns");

export const columns4 = l10n.t("Columns");

export const newColumnMapping = l10n.t("New Column Mapping");

export const foreignKeys = l10n.t("Foreign Keys");

export const foreignKey = l10n.t("Foreign Key");

export const newForeignKey = l10n.t("New Foreign Key");

export const theNameOfTheCheckConstraint = l10n.t("The name of the check constraint.");

export const name5 = l10n.t("Name");

export const theDescriptionOfTheCheckConstraint = l10n.t(
    "The description of the check constraint.",
);

export const description6 = l10n.t("Description");

export const theExpressionDefiningTheCheckConstraint = l10n.t(
    "The expression defining the check constraint.",
);

export const expression = l10n.t("Expression");

export const checkConstraints = l10n.t("Check Constraints");

export const checkConstraint = l10n.t("Check Constraint");

export const newCheckConstraint = l10n.t("New Check Constraint");

export const columns5 = l10n.t("Columns");

export const primaryKey2 = l10n.t("Primary Key");

export const indexes2 = l10n.t("Indexes");

export const foreignKeys2 = l10n.t("Foreign Keys");

export const checkConstraints2 = l10n.t("Check Constraints");

export const advancedOptions = l10n.t("Advanced Options");

export class SqlSymbolRename {
    public static renameNotSupportedAtPosition = l10n.t(
        "Rename is not supported at this position.",
    );
    public static renameOnlyInProjectFiles = l10n.t(
        "Rename is only supported for SQL files that are part of an open SQL project. Open the project in the Database Projects panel first.",
    );
    public static renameNotSupportedForSymbol = l10n.t("Please select a valid symbol.");
    public static renameRequestFailed = (message: string): string =>
        l10n.t("Rename request failed: {0}", message);
    public static noRenameableSymbolAtCursor = l10n.t("No renameable symbol found at cursor.");
}

export class SqlMoveToSchema {
    public static moveToSchemaTitle = l10n.t("Move to Schema...");
    public static moveToSchemaOnlyInProjectFiles = l10n.t(
        "Move to Schema is only supported for SQL files that are part of an open SQL project. Open the project in the Database Projects panel first.",
    );
    public static selectTargetSchemaPlaceholder = (currentSchema?: string): string =>
        currentSchema
            ? l10n.t("Current Schema: {0}, Select the new schema:", currentSchema)
            : l10n.t("Select the target schema");
    public static noSchemasFound = l10n.t("No schemas were found in the project.");
    public static noMovableSymbolAtCursor = l10n.t(
        "No object that can be moved to another schema was found at the cursor.",
    );
    public static moveToSchemaRequestFailed = (message: string): string =>
        l10n.t("Move to Schema request failed: {0}", message);
    public static resolveRefactorLogFailed = (message: string): string =>
        l10n.t("Failed to resolve the refactor log for this file: {0}", message);
    public static previewLabel = (targetSchema: string): string =>
        l10n.t("Move to schema '{0}'", targetSchema);
    public static applyEditFailed = l10n.t(
        "Failed to apply the Move to Schema changes. Check that the files are writable and try again.",
    );
}
export let copilotEnableGuardMessage = l10n.t(
    "MSSQL inline SQL completions are active. For best results, disable GitHub Copilot's default completions for SQL files.",
);
export let copilotEnableGuardDisableForSql = l10n.t("Disable for SQL");
export let copilotEnableGuardKeepAsIs = l10n.t("Keep as-is");
export let copilotEnableGuardLearnMore = l10n.t("Learn more");
export let copilotEnableGuardApplied = l10n.t(
    "GitHub Copilot's default completions are now disabled for SQL files.",
);
export function copilotEnableGuardApplyFailed(errorMessage: string) {
    return l10n.t({
        message: "Couldn't update the 'github.copilot.enable' setting. {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
}
export class SpatialBasemap {
    public static addOpenStreetMap = l10n.t("Add OpenStreetMap");
    public static dontAskAgain = l10n.t("Don't Ask Again");
    public static setupOfferMessage = l10n.t(
        "Spatial results can draw your data over a world map. Add OpenStreetMap as a map layer? The tile provider receives only the tile coordinates of the area you view — never your query results.",
    );
    public static setupConfirmation = l10n.t(
        "OpenStreetMap added. Pick it from the Layers dropdown in the spatial results pane.",
    );
    public static enable = l10n.t("Enable");
    public static viewProviderTerms = l10n.t("View provider terms");
    public static consentPrompt = (displayName: string, attributionText: string) =>
        l10n.t({
            message:
                'Enable online map layer "{0}"? The provider ({1}) will receive tile coordinates that reveal the approximate area you view. Query results, labels, SQL text, and credentials are not sent as map data.',
            args: [displayName, attributionText],
            comment: [
                "{0} is the configured display name of the map layer",
                "{1} is the provider attribution text",
            ],
        });
    public static tileCacheCleared = l10n.t("Spatial map tile cache cleared.");
    public static consentCleared = l10n.t(
        "Spatial map layer consent cleared. Online layers will ask again before their next use.",
    );
}
