/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KnownAlwaysEncryptedEnclaveType } from "@azure/arm-sql";
import { DOMParser } from "@xmldom/xmldom";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { env, Uri, type Disposable, type OutputChannel } from "vscode";
import { RequestType } from "vscode-languageclient";
import type { DacFxResult, IServerInfo, SimpleExecuteResult } from "vscode-mssql";
import * as yauzl from "yauzl";
import { getCloudProviderSettings } from "../azure/providerSettings";
import {
    acquireTokenFromVscodeAccountForResource,
    getCloudResourceEndpoint,
} from "../azure/vscodeEntraMfaUtils";
import { BackgroundTaskState } from "../backgroundTasks/backgroundTasksService";
import { VsCodeAzureHelper } from "../connectionconfig/azureHelpers";
import * as Constants from "../constants/constants";
import { LocalToCloud } from "../constants/locConstants";
import type {
    ConnectionInfo,
    default as ConnectionManager,
} from "../controllers/connectionManager";
import { DatabaseEngineEdition, ProjectType } from "../databaseProjects/common/enums";
import { getMicrosoftBuildSqlVersion, NetCoreTool } from "../databaseProjects/tools/netcoreTool";
import {
    isValidBasenameErrorMessage,
    sanitizeStringForFilename,
} from "../dataWorkspace/common/pathUtilsHelper";
import { ExtractTarget, TaskExecutionMode } from "../enums";
import type SqlToolsServiceClient from "../languageservice/serviceclient";
import { ConnectionProfile } from "../models/connectionProfile";
import { QueryCancelRequest } from "../models/contracts/queryCancel";
import type { DacFxService } from "../services/dacFxService";
import type { SqlProjectsService } from "../services/sqlProjectsService";
import {
    onTaskCreated,
    onTaskProgress,
    type SqlTasksService,
    type TaskInfo,
} from "../services/sqlTasksService";
import {
    AzureSqlDatabaseState,
    LocalDatabaseCompatibilityDiagnostic,
    LocalDatabaseCompatibilityProgress,
    LocalDatabaseCompatibilityRequest,
    LocalDatabaseCompatibilityResult,
    LocalDatabaseCompatibilityStage,
    LocalDatabaseDeploymentProgress,
    LocalDatabaseDeploymentRequest,
    LocalDatabaseDeploymentResult,
    LocalDatabaseDeploymentStage,
    LocalDatabaseSource,
} from "../sharedInterfaces/azureSqlDatabase";
import { AuthenticationType } from "../sharedInterfaces/connectionDialog";
import { DeploymentType } from "../sharedInterfaces/deployment";
import type { ILogger } from "../sharedInterfaces/logger";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ApiStatus } from "../sharedInterfaces/webview";
import { getErrorMessage } from "../utils/utils";
import type { DeploymentWebviewController } from "./deploymentWebviewController";

//#region Local database sources

const azureSqlContainerEngineEdition = -978196525;
const versionRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");

export function isAzureSqlDatabaseSource(serverInfo?: IServerInfo): boolean {
    return (
        serverInfo?.engineEditionId === azureSqlContainerEngineEdition ||
        serverInfo?.engineEditionId === DatabaseEngineEdition.SqlDatabase
    );
}

export function getLocalDatabaseConnectionId(connection: ConnectionInfo): string {
    return "id" in connection.credentials &&
        typeof connection.credentials.id === "string" &&
        connection.credentials.id
        ? connection.credentials.id
        : connection.connectionId;
}

export async function connectLocalDatabaseSource(
    manager: ConnectionManager,
    id: string,
    client: SqlToolsServiceClient,
): Promise<LocalDatabaseSource> {
    const profiles = await manager.connectionStore.readAllConnections(true);
    const profile = profiles.find((connection) => connection.id === id);
    const active = Object.entries(manager.activeConnections).find(
        ([uri, connection]) =>
            getLocalDatabaseConnectionId(connection) === id && manager.isConnected(uri),
    );
    const credentials = active?.[1].credentials ?? profile;
    const source = getLocalDatabaseSources(
        credentials
            ? [
                  {
                      ...credentials,
                      id,
                      profileName: profile?.profileName,
                      isConnected: !!active,
                      serverVersion: active?.[1].serverInfo?.serverVersion,
                  },
              ]
            : [],
    )[0];
    if (!source || !credentials) {
        throw new Error("The selected local database connection is no longer available.");
    }
    const uri = active?.[0] ?? `mssql-deployment:${randomUUID()}`;
    if (
        !active &&
        !(await manager.connect(
            uri,
            { ...credentials },
            {
                shouldHandleErrors: false,
                connectionSource: "localToCloudDeployment",
            },
        ))
    ) {
        throw new Error("Unable to connect to the selected local database.");
    }
    const serverInfo = active?.[1].serverInfo ?? manager.getConnectionInfo(uri)?.serverInfo;
    const isAzureSql = isAzureSqlDatabaseSource(serverInfo);
    let serverVersion = serverInfo?.serverVersion;
    if (!isAzureSql) {
        const result = await client.sendRequest(versionRequest, {
            ownerUri: uri,
            queryString: "SELECT @@VERSION AS version;",
        });
        const cell = result.rows?.[0]?.[0];
        const year = !cell?.isNull
            ? cell?.displayValue.match(/\bMicrosoft SQL Server\s+(\d{4})\b/i)?.[1]
            : undefined;
        if (!year || result.messages?.some((message) => message.isError)) {
            throw new Error("Unable to determine the selected SQL Server release year.");
        }
        serverVersion = year;
    }
    return {
        ...source,
        isConnected: true,
        serverVersion,
        ...(isAzureSql ? { isAzureSql: true } : {}),
    };
}

export function getLocalDatabaseSources(
    connections: {
        id?: string;
        profileName?: string;
        server?: string;
        database?: string;
        isConnected?: boolean;
        serverVersion?: string;
        isAzureSql?: boolean;
    }[],
): LocalDatabaseSource[] {
    const sources = new Map<string, LocalDatabaseSource>();
    for (const connection of connections) {
        const server = connection.server?.trim();
        // Match the host, not a prefix such as localhost.example.com.
        if (
            !connection.id ||
            !server ||
            !connection.database?.trim() ||
            !/^(?:tcp:|np:|lpc:)?\s*(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1|\(local\)|\.)(?=$|[,\\])/i.test(
                server,
            ) ||
            (sources.has(connection.id) && !connection.isConnected)
        ) {
            continue;
        }

        sources.set(connection.id, {
            id: connection.id,
            profileName: connection.profileName || sources.get(connection.id)?.profileName || "",
            server,
            database: connection.database,
            isConnected: connection.isConnected ?? false,
            serverVersion: connection.serverVersion,
            ...(connection.isAzureSql ? { isAzureSql: true } : {}),
        });
    }
    return [...sources.values()];
}

//#endregion

//#region Azure SQL compatibility build

export interface AzureSqlCompatibilityBuildResult {
    diagnostics: LocalDatabaseCompatibilityDiagnostic[];
    packagePath?: string;
    objectsValidated?: number;
    schemaObjects?: string[];
    errorMessage?: string;
}

export function parseCompatibilityDiagnostics(
    output: string,
    projectDirectory: string,
): LocalDatabaseCompatibilityDiagnostic[] {
    const diagnostics = new Map<string, LocalDatabaseCompatibilityDiagnostic>();
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(
            /^(.*?)\s*:\s*(?:Build\s+)?(error|warning)\s+([A-Z]+\d+)\s*:\s*(.*?)(?:\s+\[[^\]]+\.sqlproj\])?$/i,
        );
        if (!match) {
            continue;
        }
        const [, location, severity, code, message] = match;
        const fileLocation = location.match(/^(.*?)(?:\((\d+)(?:,\d+)?(?:,\d+,\d+)?\))?$/);
        const file = fileLocation?.[1].trim();
        const diagnostic: LocalDatabaseCompatibilityDiagnostic = {
            severity: severity.toLowerCase() === "error" ? "error" : "warning",
            category: ["SQL71501", "SQL71502", "SQL71561", "SQL71562"].includes(code.toUpperCase())
                ? "dependency"
                : /^SQL7/i.test(code)
                  ? "compatibility"
                  : "tooling",
            code: code.toUpperCase(),
            message,
            ...(file && file !== "MSBUILD" ? { file: path.relative(projectDirectory, file) } : {}),
            ...(fileLocation?.[2] ? { line: Number(fileLocation[2]) } : {}),
        };
        diagnostics.set(JSON.stringify(diagnostic), diagnostic);
    }
    return [...diagnostics.values()];
}

export function getCompatibilityModelObjects(xml: string): string[] {
    const document = new DOMParser({
        onError: (level, message) => {
            if (level !== "warning") {
                throw new Error(message);
            }
        },
    }).parseFromString(xml, "text/xml");
    const model = document.getElementsByTagName("Model")[0];
    if (!model) {
        throw new Error(LocalToCloud.modelMissing);
    }
    // Include top-level named schema objects, not columns, constraints, or database settings.
    const types = new Set([
        "SqlTable",
        "SqlView",
        "SqlProcedure",
        "SqlScalarFunction",
        "SqlInlineTableValuedFunction",
        "SqlMultiStatementTableValuedFunction",
        "SqlSequence",
        "SqlSynonym",
        "SqlUserDefinedDataType",
        "SqlTableType",
        "SqlUserDefinedType",
        "SqlAssembly",
        "SqlDmlTrigger",
    ]);
    const objects: string[] = [];
    const elements = model.getElementsByTagName("Element");
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        const name = element.getAttribute("Name");
        if (element.parentNode === model && name && types.has(element.getAttribute("Type") ?? "")) {
            objects.push(name);
        }
    }
    return objects;
}

async function readPackageModel(packagePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        yauzl.open(packagePath, { lazyEntries: true }, (error, zip) => {
            if (error || !zip) {
                reject(error ?? new Error(LocalToCloud.packageMissing));
                return;
            }
            const fail = (failure: Error) => {
                zip.close();
                reject(failure);
            };
            zip.on("error", fail);
            zip.on("end", () => reject(new Error(LocalToCloud.modelMissing)));
            zip.on("entry", (entry: yauzl.Entry) => {
                if (entry.fileName !== "model.xml") {
                    zip.readEntry();
                    return;
                }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError || !stream) {
                        fail(streamError ?? new Error(LocalToCloud.modelMissing));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    stream.on("error", fail);
                    stream.on("end", () => {
                        zip.close();
                        resolve(Buffer.concat(chunks).toString("utf8"));
                    });
                });
            });
            zip.readEntry();
        });
    });
}

export class AzureSqlCompatibilityBuilder {
    constructor(private readonly output: OutputChannel) {}

    public async build(
        projectPath: string,
        signal: AbortSignal,
        onCheckingPackage?: () => void,
    ): Promise<AzureSqlCompatibilityBuildResult> {
        const tool = new NetCoreTool(this.output);
        await tool.verifyNetCoreInstallation();
        signal.throwIfAborted();
        const directory = await fs.realpath(path.dirname(projectPath));
        const outputDirectory = path.join(directory, "package");
        const executable = path.join(
            tool.netcoreInstallLocation,
            process.platform === "win32" ? "dotnet.exe" : "dotnet",
        );
        const args = [
            "build",
            projectPath,
            "--nologo",
            "--verbosity",
            "normal",
            "--output",
            outputDirectory,
            "/nr:false",
            "/m:1",
        ];
        this.output.appendLine([executable, ...args].join(" "));
        const { code, output } = await new Promise<{ code: number | null; output: string }>(
            (resolve, reject) => {
                const child = spawn(executable, args, {
                    cwd: directory,
                    shell: false,
                    windowsHide: true,
                    env: {
                        ...process.env,
                        DOTNET_CLI_UI_LANGUAGE: "en-US",
                        VSLANG: "1033",
                        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
                    },
                });
                const chunks: string[] = [];
                let outputBytes = 0;
                let spawnError: Error | undefined;
                const abort = () => {
                    child.kill();
                };
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) {
                    abort();
                }
                const append = (text: string) => {
                    if (spawnError) {
                        return;
                    }
                    outputBytes += Buffer.byteLength(text, "utf8");
                    if (outputBytes > 10 * 1024 * 1024) {
                        spawnError = new Error(LocalToCloud.buildOutputTooLarge);
                        child.kill();
                        return;
                    }
                    chunks.push(text);
                    this.output.append(text);
                };
                child.stdout.setEncoding("utf8").on("data", append);
                child.stderr.setEncoding("utf8").on("data", append);
                child.on("error", (error) => {
                    spawnError = error;
                });
                child.on("close", (code) => {
                    signal.removeEventListener("abort", abort);
                    if (spawnError) {
                        reject(spawnError);
                    } else {
                        resolve({ code, output: chunks.join("") });
                    }
                });
            },
        );
        signal.throwIfAborted();
        const diagnostics = parseCompatibilityDiagnostics(output, directory);
        if (code !== 0 || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
            if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
                diagnostics.push({
                    severity: "error",
                    category: "tooling",
                    code: "BUILD",
                    message: output.trim() || LocalToCloud.buildFailed,
                });
            }
            return { diagnostics, errorMessage: LocalToCloud.buildFailed };
        }
        onCheckingPackage?.();
        const packagePath = path.join(
            outputDirectory,
            `${path.basename(projectPath, ".sqlproj")}.dacpac`,
        );
        await fs.access(packagePath);
        const schemaObjects = getCompatibilityModelObjects(await readPackageModel(packagePath));
        return {
            diagnostics,
            packagePath,
            objectsValidated: schemaObjects.length,
            schemaObjects,
        };
    }
}

//#endregion

//#region Local database compatibility validation

const azureSqlProvider = "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider";
const cancelTaskRequest = new RequestType<{ taskId: string }, boolean, void>("tasks/canceltask");

interface ValidationOperation {
    request: LocalDatabaseCompatibilityRequest;
    abort: AbortController;
    taskId?: string;
    cancelTask?: Promise<boolean>;
    promise?: Promise<LocalDatabaseCompatibilityResult>;
}

export class LocalDatabaseCompatibilityService {
    private running?: ValidationOperation;
    private retainedPackage?: {
        directory: string;
        packagePath: string;
        request: LocalDatabaseCompatibilityRequest;
        result: LocalDatabaseCompatibilityResult;
    };
    private disposed = false;

    constructor(
        private readonly manager: ConnectionManager,
        private readonly client: SqlToolsServiceClient,
        private readonly tasks: SqlTasksService,
        private readonly projects: SqlProjectsService,
        private readonly dacFx: DacFxService,
        private readonly builder: AzureSqlCompatibilityBuilder,
        private readonly logger: ILogger,
    ) {}

    public async copyValidatedPackage(
        request: LocalDatabaseCompatibilityRequest,
        destination: string,
    ): Promise<LocalDatabaseCompatibilityResult> {
        await this.running?.promise;
        const retained = this.retainedPackage;
        if (
            this.disposed ||
            !retained ||
            retained.request.validationId !== request.validationId ||
            retained.request.sourceId !== request.sourceId ||
            retained.request.deploymentContent !== request.deploymentContent ||
            !["passed", "warnings"].includes(retained.result.status)
        ) {
            throw new Error(LocalToCloud.validationExpired);
        }
        await fs.copyFile(retained.packagePath, destination);
        if (this.retainedPackage !== retained || this.disposed) {
            throw new Error(LocalToCloud.validationExpired);
        }
        return structuredClone(retained.result);
    }

    public async validate(
        request: LocalDatabaseCompatibilityRequest,
        onProgress?: (progress: LocalDatabaseCompatibilityProgress) => void,
    ): Promise<LocalDatabaseCompatibilityResult> {
        if (
            this.disposed ||
            !request.validationId ||
            !request.sourceId ||
            !["schemaAndData", "schemaOnly"].includes(request.deploymentContent)
        ) {
            throw new Error(LocalToCloud.invalidRequest);
        }
        const previous = this.running;
        const operation: ValidationOperation = { request, abort: new AbortController() };
        this.running = operation;
        previous?.abort.abort();
        operation.promise = this.execute(operation, previous?.promise, onProgress);
        return operation.promise;
    }

    public async cancel(validationId: string): Promise<void> {
        const operation = this.running;
        if (operation?.request.validationId === validationId) {
            operation.abort.abort();
            await this.cancelExtraction(operation);
            await operation.promise;
        }
        if (this.retainedPackage?.request.validationId === validationId) {
            await this.clearPackage();
        }
    }

    private async cancelExtraction(operation: ValidationOperation): Promise<void> {
        if (operation.taskId && !operation.cancelTask) {
            operation.cancelTask = Promise.resolve(
                this.client.sendRequest(cancelTaskRequest, { taskId: operation.taskId }),
            );
        }
        if (operation.cancelTask && !(await operation.cancelTask)) {
            this.logger.warn("The compatibility extraction task could not be cancelled.");
        }
    }

    public async clear(): Promise<void> {
        const operation = this.running;
        if (operation) {
            await this.cancel(operation.request.validationId);
        }
        await this.clearPackage();
    }

    public dispose(): void {
        this.disposed = true;
        void this.clear().catch((error) =>
            this.logger.error("Failed to clean up compatibility validation.", error),
        );
    }

    private async clearPackage(): Promise<void> {
        const retained = this.retainedPackage;
        if (retained) {
            await fs.rm(retained.directory, { recursive: true, force: true });
            if (this.retainedPackage === retained) {
                this.retainedPackage = undefined;
            }
        }
    }

    private async execute(
        operation: ValidationOperation,
        previous?: Promise<LocalDatabaseCompatibilityResult>,
        onProgress?: (progress: LocalDatabaseCompatibilityProgress) => void,
    ): Promise<LocalDatabaseCompatibilityResult> {
        const { request, abort } = operation;
        const startedAt = performance.now();
        let stage: LocalDatabaseCompatibilityStage | "preparing" | "cleanup" = "preparing";
        sendActionEvent(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.ValidateLocalDatabaseCompatibility,
            {
                additionalProps: {
                    deploymentContent: request.deploymentContent,
                    status: "started",
                },
            },
        );
        const reportProgress = (value: LocalDatabaseCompatibilityStage) => {
            abort.signal.throwIfAborted();
            stage = value;
            sendActionEvent(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalDatabaseCompatibilityStage,
                { additionalProps: { deploymentContent: request.deploymentContent, stage } },
            );
            onProgress?.({ validationId: request.validationId, stage });
        };
        const result: LocalDatabaseCompatibilityResult = {
            ...request,
            database: "",
            target: "AzureSqlDatabase",
            status: "error",
            diagnostics: [],
            snapshotCreatedAt: new Date().toISOString(),
        };
        let directory: string | undefined;
        let projectPath: string | undefined;
        let opened = false;
        let retained = false;
        let taskSuppression: Disposable | undefined;
        const timeout = setTimeout(
            () => abort.abort(new Error(LocalToCloud.validationTimedOut)),
            10 * 60 * 1000,
        );
        const cancel = () => {
            void this.cancelExtraction(operation).catch((error) =>
                this.logger.error("Failed to cancel compatibility extraction.", error),
            );
        };
        abort.signal.addEventListener("abort", cancel);
        const isExtractionTask = (task: TaskInfo) =>
            !!directory && !!task.targetLocation && path.resolve(task.targetLocation) === directory;
        const taskSubscription = onTaskCreated((task) => {
            if (isExtractionTask(task)) {
                operation.taskId = task.taskId;
                if (abort.signal.aborted) {
                    cancel();
                }
            }
        });
        try {
            await previous;
            await this.clearPackage();
            abort.signal.throwIfAborted();
            const active = Object.entries(this.manager.activeConnections).find(
                ([uri, connection]) =>
                    getLocalDatabaseConnectionId(connection) === request.sourceId &&
                    this.manager.isConnected(uri),
            );
            const source =
                active &&
                getLocalDatabaseSources([{ ...active[1].credentials, id: request.sourceId }])[0];
            if (!source) {
                throw new Error(LocalToCloud.sourceUnavailable);
            }
            result.database = source.database;
            reportProgress("extractingSchema");
            directory = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-azure-compatibility-"));
            taskSuppression = this.tasks.suppressTaskUI(isExtractionTask);
            projectPath = path.join(directory, "Compatibility.sqlproj");
            const created = await this.projects.createProject(
                projectPath,
                ProjectType.SdkStyle,
                azureSqlProvider,
                getMicrosoftBuildSqlVersion(),
            );
            if (!created.success) {
                throw new Error(created.errorMessage);
            }
            abort.signal.throwIfAborted();
            const open = await this.projects.openProject(projectPath);
            if (!open.success) {
                throw new Error(open.errorMessage);
            }
            opened = true;
            abort.signal.throwIfAborted();
            const extracted = await this.dacFx.createProjectFromDatabase(
                source.database,
                directory,
                source.database,
                "1.0.0.0",
                active[0],
                ExtractTarget.schemaObjectType,
                TaskExecutionMode.execute,
                true,
            );
            abort.signal.throwIfAborted();
            if (!extracted.success) {
                throw new Error(extracted.errorMessage || LocalToCloud.extractionFailed);
            }
            reportProgress("validatingSchema");
            const build = await this.builder.build(projectPath, abort.signal, () =>
                reportProgress("checkingPackage"),
            );
            abort.signal.throwIfAborted();
            result.diagnostics = build.diagnostics;
            const errors = build.diagnostics.filter(
                (diagnostic) => diagnostic.severity === "error",
            );
            if (build.errorMessage || errors.length) {
                result.status =
                    errors.length && errors.every((diagnostic) => diagnostic.category !== "tooling")
                        ? "blocked"
                        : "error";
                result.errorMessage = build.errorMessage;
            } else if (build.packagePath && build.objectsValidated !== undefined) {
                const packageFileName = `${sanitizeStringForFilename(source.database)}.dacpac`;
                const filenameError = isValidBasenameErrorMessage(packageFileName);
                if (filenameError) {
                    throw new Error(filenameError);
                }
                if (packageFileName !== `${source.database}.dacpac`) {
                    this.logger.warn(
                        `The database name contains invalid filename characters. Using ${packageFileName} for its DACPAC.`,
                    );
                }
                const packagePath = path.join(path.dirname(build.packagePath), packageFileName);
                if (packagePath !== build.packagePath) {
                    await fs.rename(build.packagePath, packagePath);
                }
                abort.signal.throwIfAborted();
                this.retainedPackage = { directory, packagePath, request, result };
                retained = true;
                result.status = build.diagnostics.length ? "warnings" : "passed";
                result.objectsValidated = build.objectsValidated;
                result.schemaObjects = build.schemaObjects;
                result.packageId = request.validationId;
                result.packageFileName = packageFileName;
            } else {
                throw new Error(LocalToCloud.packageMissing);
            }
        } catch (error) {
            if (abort.signal.aborted && abort.signal.reason?.name === "AbortError") {
                result.status = "cancelled";
            } else {
                result.status = "error";
                result.errorMessage = getErrorMessage(
                    abort.signal.aborted ? abort.signal.reason : error,
                );
                this.logger.error("Azure SQL compatibility validation failed.", error);
            }
        } finally {
            clearTimeout(timeout);
            taskSubscription.dispose();
            abort.signal.removeEventListener("abort", cancel);
            if (opened && projectPath) {
                try {
                    const closed = await this.projects.closeProject(projectPath);
                    if (!closed.success) {
                        throw new Error(closed.errorMessage);
                    }
                } catch (error) {
                    stage = "cleanup";
                    this.logger.error("Failed to close the compatibility project.", error);
                    result.status = "error";
                    result.errorMessage = getErrorMessage(error);
                    result.packageId = undefined;
                    result.packageFileName = undefined;
                }
            }
            if (directory && (!retained || result.status === "error")) {
                try {
                    await fs.rm(directory, { recursive: true, force: true });
                    if (this.retainedPackage?.directory === directory) {
                        this.retainedPackage = undefined;
                    }
                } catch (error) {
                    stage = "cleanup";
                    this.logger.error("Failed to clean up compatibility artifacts.", error);
                    result.status = "error";
                    result.errorMessage = getErrorMessage(error);
                    result.packageId = undefined;
                    result.packageFileName = undefined;
                }
            }
            if (this.running === operation) {
                this.running = undefined;
            }
            taskSuppression?.dispose();
        }
        const telemetryOptions = {
            additionalProps: {
                deploymentContent: request.deploymentContent,
                status: result.status,
                stage,
            },
            additionalMeasurements: {
                durationInMs: performance.now() - startedAt,
                errorCount: result.diagnostics.filter((item) => item.severity === "error").length,
                warningCount: result.diagnostics.filter((item) => item.severity === "warning")
                    .length,
                ...(result.objectsValidated !== undefined
                    ? { objectsValidated: result.objectsValidated }
                    : {}),
            },
        };
        if (result.status === "error") {
            sendErrorEvent(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.ValidateLocalDatabaseCompatibility,
                {
                    ...telemetryOptions,
                    errorType: "CompatibilityValidationFailed",
                    includeErrorMessage: false,
                },
            );
        } else {
            sendActionEvent(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.ValidateLocalDatabaseCompatibility,
                telemetryOptions,
            );
        }
        return result;
    }
}

//#endregion

//#region Local-to-cloud deployment

const simpleQuery = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");
const cancelTask = new RequestType<{ taskId: string }, boolean, void>("tasks/canceltask");

const schemaQuery = `
SELECT QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) AS name
FROM sys.objects
WHERE is_ms_shipped = 0 AND type IN ('U', 'V', 'P', 'FN', 'IF', 'TF', 'SO', 'SN', 'TR')
UNION ALL
SELECT QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name)
FROM sys.types WHERE is_user_defined = 1
UNION ALL
SELECT QUOTENAME(name) FROM sys.assemblies WHERE is_user_defined = 1;`;

const emptyTargetQuery = `
SELECT CASE WHEN
    EXISTS (SELECT 1 FROM sys.objects WHERE is_ms_shipped = 0) OR
    EXISTS (SELECT 1 FROM sys.types WHERE is_user_defined = 1) OR
    EXISTS (SELECT 1 FROM sys.schemas WHERE schema_id BETWEEN 5 AND 16383)
THEN 1 ELSE 0 END AS has_user_objects;`;

const storageQuery = `
SELECT CONVERT(varchar(30), SUM(CONVERT(bigint, FILEPROPERTY(name, 'SpaceUsed'))) * 8192)
AS used_bytes FROM sys.database_files WHERE type = 0;`;

// COUNT_BIG reads actual rows, not the approximate counts in sys.partitions.
const rowCountsQuery = `
DECLARE @counts TABLE (name nvarchar(517), row_count bigint);
DECLARE @schema sysname, @table sysname, @count bigint, @sql nvarchar(max);
DECLARE tables_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT SCHEMA_NAME(schema_id), name FROM sys.tables WHERE is_ms_shipped = 0;
OPEN tables_cursor;
FETCH NEXT FROM tables_cursor INTO @schema, @table;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'SELECT @count = COUNT_BIG(*) FROM ' + QUOTENAME(@schema) + N'.' + QUOTENAME(@table);
    EXEC sys.sp_executesql @sql, N'@count bigint OUTPUT', @count OUTPUT;
    INSERT INTO @counts VALUES (QUOTENAME(@schema) + N'.' + QUOTENAME(@table), @count);
    FETCH NEXT FROM tables_cursor INTO @schema, @table;
END;
CLOSE tables_cursor;
DEALLOCATE tables_cursor;
SELECT name, CONVERT(varchar(30), row_count) FROM @counts ORDER BY name;`;

interface DeploymentOperation {
    request: LocalDatabaseDeploymentRequest;
    abort: AbortController;
    promise?: Promise<LocalDatabaseDeploymentResult>;
    targetKey?: string;
}

export class LocalDatabaseDeploymentService {
    private static readonly activeTargets = new Set<string>();
    private running?: DeploymentOperation;
    private readonly results = new Map<string, Promise<LocalDatabaseDeploymentResult>>();
    private readonly destinations = new Map<
        string,
        { profile: ConnectionProfile; portalUrl: string }
    >();
    private disposed = false;

    constructor(
        private readonly controller: DeploymentWebviewController,
        private readonly compatibility: LocalDatabaseCompatibilityService,
        private readonly client: SqlToolsServiceClient,
        private readonly output: OutputChannel,
        private readonly logger: ILogger,
    ) {}

    public deploy(
        request: LocalDatabaseDeploymentRequest,
        onProgress: (progress: LocalDatabaseDeploymentProgress) => void,
    ): Promise<LocalDatabaseDeploymentResult> {
        if (
            this.disposed ||
            !request.deploymentId ||
            !request.validationId ||
            !request.sourceId ||
            !["schemaOnly", "schemaAndData"].includes(request.deploymentContent) ||
            !request.target ||
            !request.tags ||
            typeof request.tags !== "object" ||
            Array.isArray(request.tags)
        ) {
            throw new Error(LocalToCloud.invalidDeployment);
        }
        const previous = this.results.get(request.deploymentId);
        if (previous) {
            return previous;
        }
        const state = this.controller.state;
        if (
            this.running ||
            state.deploymentType !== DeploymentType.AzureSqlDatabase ||
            !("azureComponentStatuses" in state.deploymentTypeState)
        ) {
            throw new Error(LocalToCloud.invalidDeployment);
        }
        const current = state.deploymentTypeState;
        const snapshot = new AzureSqlDatabaseState({
            ...current,
            formState: { ...current.formState },
            formComponents: Object.fromEntries(
                Object.entries(current.formComponents).map(([key, component]) => [
                    key,
                    { ...component },
                ]),
            ),
        });
        const operation: DeploymentOperation = {
            request: { ...request, tags: { ...request.tags }, target: { ...request.target } },
            abort: new AbortController(),
        };
        this.running = operation;
        operation.promise = this.execute(operation, snapshot, onProgress).finally(() => {
            if (this.running === operation) {
                this.running = undefined;
            }
            if (operation.targetKey) {
                LocalDatabaseDeploymentService.activeTargets.delete(operation.targetKey);
            }
            if (this.disposed) {
                this.disposeResources();
            }
        });
        this.results.set(request.deploymentId, operation.promise);
        return operation.promise;
    }

    public async cancel(deploymentId: string): Promise<void> {
        const operation = this.running;
        if (operation?.request.deploymentId === deploymentId) {
            operation.abort.abort();
            await operation.promise;
        }
    }

    public get isRunning(): boolean {
        return this.running !== undefined;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        // Closing the wizard detaches its deployment; only explicit cancellation stops it.
        if (!this.running) {
            this.disposeResources();
        }
    }

    private disposeResources(): void {
        this.compatibility.dispose();
        this.destinations.clear();
        this.results.clear();
    }

    public async performAction(
        deploymentId: string,
        action: "copyConnectionString" | "openPortal",
    ): Promise<void> {
        const destination = this.destinations.get(deploymentId);
        if (
            this.disposed ||
            !destination ||
            !["copyConnectionString", "openPortal"].includes(action) ||
            (await this.results.get(deploymentId))?.status !== "succeeded"
        ) {
            throw new Error(LocalToCloud.invalidDeployment);
        }
        const startedAt = performance.now();
        try {
            if (action === "copyConnectionString") {
                const manager = this.controller.mainController.connectionManager;
                const connectionString = await manager.getConnectionString(
                    manager.createConnectionDetails(destination.profile),
                    false,
                    false,
                );
                if (!connectionString) {
                    throw new Error(LocalToCloud.deploymentConnectionFailed);
                }
                await env.clipboard.writeText(connectionString);
            } else if (action === "openPortal") {
                if (!(await env.openExternal(Uri.parse(destination.portalUrl)))) {
                    throw new Error(LocalToCloud.deploymentPortalFailed);
                }
            }
            sendActionEvent(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalToCloudPostDeploymentAction,
                {
                    additionalProps: { action, status: "succeeded" },
                    additionalMeasurements: { durationInMs: performance.now() - startedAt },
                },
            );
        } catch (error) {
            sendErrorEvent(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalToCloudPostDeploymentAction,
                {
                    errorType: "PostDeploymentActionFailed",
                    includeErrorMessage: false,
                    additionalProps: { action, status: "error" },
                    additionalMeasurements: { durationInMs: performance.now() - startedAt },
                },
            );
            throw error;
        }
    }

    private async execute(
        operation: DeploymentOperation,
        state: AzureSqlDatabaseState,
        onProgress: (progress: LocalDatabaseDeploymentProgress) => void,
    ): Promise<LocalDatabaseDeploymentResult> {
        const { request, abort } = operation;
        const startedAt = performance.now();
        let currentStage: LocalDatabaseDeploymentStage = "authenticating";
        let failureStage: LocalDatabaseDeploymentStage | "cleanup" | undefined;
        sendActionEvent(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.StartLocalToCloudDeployment,
            { additionalProps: { deploymentContent: request.deploymentContent } },
        );
        const signal = abort.signal;
        const main = this.controller.mainController;
        const manager = main.connectionManager;
        const form = state.formState;
        const title = LocalToCloud.deployingDatabase(form.databaseName);
        const backgroundTask = main.backgroundTasksService.registerTask({
            displayText: title,
            tooltip: title,
            target: `${form.serverName}/${form.databaseName}`,
            message: LocalToCloud.deploymentStages.authenticating,
            state: BackgroundTaskState.InProgress,
            canCancel: true,
            cancel: () => this.cancel(request.deploymentId),
            open: this.output.show.bind(this.output, true),
        });
        const targetUri = `mssql-local-to-cloud-target:${randomUUID()}`;
        const sourceUri = `mssql-local-to-cloud-source:${randomUUID()}`;
        const completedStages: LocalDatabaseDeploymentStage[] = [];
        const result: LocalDatabaseDeploymentResult = {
            deploymentId: request.deploymentId,
            status: "error",
            database: form.databaseName,
            server: "",
            sourceDatabase: "",
            resourcesMayRemain: false,
        };
        let directory: string | undefined;
        const safeError = (error: unknown) => {
            let message = getErrorMessage(error);
            for (const secret of [directory, form.password]) {
                if (secret) {
                    message = message.split(secret).join("[redacted]");
                }
            }
            return message;
        };
        const run = async <T>(stage: LocalDatabaseDeploymentStage, action: () => Promise<T>) => {
            signal.throwIfAborted();
            currentStage = stage;
            const stageStartedAt = performance.now();
            let status = "succeeded";
            try {
                if (!this.disposed) {
                    onProgress({
                        deploymentId: request.deploymentId,
                        stage,
                        completedStages: [...completedStages],
                    });
                }
                backgroundTask.update({ message: LocalToCloud.deploymentStages[stage] });
                this.output.appendLine(LocalToCloud.deploymentStages[stage]);
                const value = await action();
                signal.throwIfAborted();
                completedStages.push(stage);
                return value;
            } catch (error) {
                status = signal.aborted ? "cancelled" : "error";
                throw error;
            } finally {
                sendActionEvent(
                    TelemetryViews.LocalToCloudDeployment,
                    TelemetryActions.LocalToCloudDeploymentStage,
                    {
                        additionalProps: {
                            deploymentContent: request.deploymentContent,
                            stage,
                            status,
                        },
                        additionalMeasurements: {
                            durationInMs: performance.now() - stageStartedAt,
                        },
                    },
                );
            }
        };
        const query = async (ownerUri: string, queryString: string): Promise<string[][]> => {
            signal.throwIfAborted();
            const cancel = () => {
                void Promise.resolve(
                    this.client.sendRequest(QueryCancelRequest.type, { ownerUri }),
                ).catch((error) =>
                    this.logger.error(
                        `Failed to cancel migration verification: ${safeError(error)}`,
                    ),
                );
            };
            signal.addEventListener("abort", cancel, { once: true });
            try {
                const response = await this.client.sendRequest(simpleQuery, {
                    ownerUri,
                    queryString,
                });
                signal.throwIfAborted();
                if (response.messages?.some((message) => message.isError) || !response.rows) {
                    throw new Error(
                        response.messages
                            ?.filter((message) => message.isError)
                            .map((message) => message.message)
                            .join("\n") || LocalToCloud.deploymentQueryFailed,
                    );
                }
                return response.rows.map((row) =>
                    row.map((cell) => {
                        if (cell.isNull || typeof cell.displayValue !== "string") {
                            throw new Error(LocalToCloud.deploymentQueryFailed);
                        }
                        return cell.displayValue;
                    }),
                );
            } finally {
                signal.removeEventListener("abort", cancel);
            }
        };
        const schemaMatches = (rows: string[][], expected: string[], exact: boolean) => {
            if (exact && rows.length !== expected.length) {
                return false;
            }
            const counts = new Map<string, number>();
            for (const [name] of rows) {
                counts.set(name, (counts.get(name) ?? 0) + 1);
            }
            return expected.every((name) => {
                const remaining = counts.get(name) ?? 0;
                counts.set(name, remaining - 1);
                return remaining > 0;
            });
        };
        const readCounts = async (ownerUri: string) => {
            const counts = await query(ownerUri, rowCountsQuery);
            if (counts.some((row) => row.length !== 2 || !row[0] || !/^\d+$/.test(row[1]))) {
                throw new Error(LocalToCloud.deploymentQueryFailed);
            }
            return counts;
        };
        const equalCounts = (left: string[][], right: string[][]) => {
            const counts = new Map<string, string>();
            for (const [name, count] of right) {
                counts.set(name, count);
            }
            return (
                left.length === right.length &&
                left.every(([name, count]) => counts.get(name) === count)
            );
        };

        try {
            const subscription = state.subscriptions.find(
                (item) => item.subscriptionId === form.subscriptionId,
            );
            await run("authenticating", async () => {
                if (!subscription || !form.accountId || !form.tenantId) {
                    throw new Error(LocalToCloud.invalidAzureSettings);
                }
                const scope = `${getCloudProviderSettings().settings.armResource.endpoint.replace(/\/$/, "")}/.default`;
                if (!(await subscription.credential.getToken(scope, { abortSignal: signal }))) {
                    throw new Error(LocalToCloud.deploymentAuthenticationFailed);
                }
            });
            if (!subscription) {
                throw new Error(LocalToCloud.invalidAzureSettings);
            }
            const validation = await run("validatingSettings", async () => {
                const errors = await this.controller.validateDeploymentForm(undefined, state);
                if (
                    state.loadState !== ApiStatus.Loaded ||
                    errors.length ||
                    form.dataSource ||
                    !form.databaseName ||
                    !form.serverName ||
                    !form.resourceGroup ||
                    request.target.subscriptionId !== form.subscriptionId ||
                    request.target.resourceGroup !== form.resourceGroup ||
                    request.target.serverName !== form.serverName ||
                    request.target.databaseName !== form.databaseName ||
                    (form.authenticationType !== AuthenticationType.SqlLogin &&
                        form.authenticationType !== AuthenticationType.AzureMFA) ||
                    (form.authenticationType === AuthenticationType.SqlLogin &&
                        (!form.userName || !form.password)) ||
                    Object.entries(request.tags).some(
                        ([key, value]) =>
                            !key.trim() ||
                            key !== key.trim() ||
                            key.length > 512 ||
                            typeof value !== "string" ||
                            value.length > 256,
                    ) ||
                    Object.keys(request.tags).length > 50 ||
                    new Set(Object.keys(request.tags).map((key) => key.toLowerCase())).size !==
                        Object.keys(request.tags).length
                ) {
                    throw new Error(LocalToCloud.invalidAzureSettings);
                }
                const key = JSON.stringify(
                    [
                        getCloudProviderSettings().settings.armResource.endpoint,
                        form.subscriptionId,
                        form.resourceGroup,
                        form.serverName,
                        form.databaseName,
                    ].map((value) => value.toLowerCase()),
                );
                if (LocalDatabaseDeploymentService.activeTargets.has(key)) {
                    throw new Error(LocalToCloud.invalidDeployment);
                }
                LocalDatabaseDeploymentService.activeTargets.add(key);
                operation.targetKey = key;
                const server = await VsCodeAzureHelper.validateNewAzureSqlDatabase(
                    subscription,
                    form.resourceGroup,
                    form.serverName,
                    form.databaseName,
                    signal,
                );
                if (!server.fullyQualifiedDomainName || !server.location) {
                    throw new Error(LocalToCloud.invalidAzureSettings);
                }
                result.server = server.fullyQualifiedDomainName;
                result.scriptSettings = {
                    databaseName: form.databaseName,
                    serverName: form.serverName,
                    resourceGroup: form.resourceGroup,
                    serverResourceId: `/subscriptions/${form.subscriptionId}/resourceGroups/${form.resourceGroup}/providers/Microsoft.Sql/servers/${form.serverName}`,
                    location: server.location,
                    collation: form.collation,
                    maxVcores: form.maxVcores,
                    freeLimitBehavior: form.freeLimitBehavior,
                    maintenanceConfig: form.maintenanceConfig,
                    enableAlwaysEncrypted: form.enableAlwaysEncrypted,
                    tags: { ...request.tags },
                };
                directory = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-local-to-cloud-"));
                const validated = await this.compatibility.copyValidatedPackage(
                    request,
                    path.join(directory, "schema.dacpac"),
                );
                if (!validated.schemaObjects) {
                    throw new Error(LocalToCloud.packageMissing);
                }
                result.sourceDatabase = validated.database;
                return { ...validated, directory, schemaObjects: validated.schemaObjects };
            });
            const expectedObjects = validation.schemaObjects;
            const dacpacPath = path.join(validation.directory, "schema.dacpac");
            const bacpacPath = path.join(validation.directory, "database.bacpac");
            let sourceCounts: string[][] | undefined;

            if (request.deploymentContent === "schemaAndData") {
                await run("exportingData", async () => {
                    const active = Object.entries(manager.activeConnections).find(
                        ([uri, connection]) =>
                            manager.isConnected(uri) &&
                            getLocalDatabaseConnectionId(connection) === request.sourceId &&
                            connection.credentials.database === validation.database,
                    );
                    if (
                        !active ||
                        !(await manager.connect(
                            sourceUri,
                            { ...active[1].credentials, commandTimeout: 0 },
                            { shouldHandleErrors: false },
                        ))
                    ) {
                        throw new Error(LocalToCloud.sourceUnavailable);
                    }
                    const usedBytesText = (await query(sourceUri, storageQuery))[0]?.[0];
                    const usedBytes = Number(usedBytesText);
                    if (
                        !usedBytesText ||
                        !/^\d+$/.test(usedBytesText) ||
                        !Number.isSafeInteger(usedBytes)
                    ) {
                        throw new Error(LocalToCloud.deploymentQueryFailed);
                    }
                    if (usedBytes > 32 * 1024 ** 3) {
                        throw new Error(LocalToCloud.sourceTooLarge);
                    }
                    if (
                        !schemaMatches(await query(sourceUri, schemaQuery), expectedObjects, true)
                    ) {
                        throw new Error(LocalToCloud.sourceChanged);
                    }
                    sourceCounts = await readCounts(sourceUri);
                    await this.packageOperation(
                        operation,
                        (task) => task.targetLocation === bacpacPath,
                        () =>
                            main.dacFxService.exportBacpac(
                                validation.database,
                                bacpacPath,
                                sourceUri,
                                TaskExecutionMode.execute,
                            ),
                        safeError,
                    );
                    if (!(await fs.stat(bacpacPath)).size) {
                        throw new Error(LocalToCloud.packageMissing);
                    }
                    if (
                        !equalCounts(sourceCounts, await readCounts(sourceUri)) ||
                        !schemaMatches(await query(sourceUri, schemaQuery), expectedObjects, true)
                    ) {
                        throw new Error(LocalToCloud.sourceChanged);
                    }
                });
            }
            await run("creatingDatabase", async () => {
                result.resourcesMayRemain = true;
                await VsCodeAzureHelper.createAzureSqlDatabase(
                    subscription,
                    form.resourceGroup,
                    form.serverName,
                    form.databaseName,
                    {
                        collation: form.collation || undefined,
                        preferredEnclaveType: form.enableAlwaysEncrypted
                            ? KnownAlwaysEncryptedEnclaveType.Default
                            : undefined,
                        maintenanceConfigurationId: form.maintenanceConfig || undefined,
                        tags: request.tags,
                        freeLimitExhaustionBehavior: form.freeLimitBehavior,
                        useFreeLimit: true,
                        maxVcores: form.maxVcores,
                    },
                    { requireNew: true, abortSignal: signal },
                );
            });
            const profile = new ConnectionProfile();
            profile.id = randomUUID();
            profile.server = result.server;
            profile.database = form.databaseName;
            profile.port = 1433;
            profile.commandTimeout = 0;
            profile.encrypt = "Mandatory";
            profile.trustServerCertificate = false;
            profile.authenticationType = form.authenticationType;
            profile.accountId = form.accountId;
            profile.tenantId = form.tenantId;
            profile.user = form.userName;
            profile.password = form.password;
            profile.savePassword = form.savePassword;
            profile.profileName = form.profileName;
            profile.groupId = form.groupId;
            await run("connecting", async () => {
                if (form.authenticationType === AuthenticationType.AzureMFA) {
                    const token = await acquireTokenFromVscodeAccountForResource(
                        getCloudResourceEndpoint("sqlResource"),
                        form.accountId,
                        form.tenantId,
                    );
                    profile.user = token.account.label;
                    profile.email = token.session.account.label;
                    profile.azureAccountToken = token.token.token;
                    profile.expiresOn = token.token.expiresOn;
                    profile.password = "";
                }
                let firewallCreated = false;
                for (let attempt = 0; attempt < 10; attempt++) {
                    signal.throwIfAborted();
                    if (await manager.connect(targetUri, profile, { shouldHandleErrors: false })) {
                        return;
                    }
                    signal.throwIfAborted();
                    const info = manager.getConnectionInfo(targetUri);
                    if (info?.errorNumber !== 40615 || attempt === 9) {
                        throw new Error(
                            info?.errorMessage || LocalToCloud.deploymentConnectionFailed,
                        );
                    }
                    if (!firewallCreated) {
                        const firewall = await manager.firewallService.handleFirewallRule(
                            info.errorNumber,
                            info.errorMessage,
                        );
                        if (!firewall.result || !firewall.ipAddress) {
                            throw new Error(LocalToCloud.deploymentConnectionFailed);
                        }
                        signal.throwIfAborted();
                        await VsCodeAzureHelper.createFirewallRule(
                            subscription,
                            form.resourceGroup,
                            form.serverName,
                            `mssql-migration-${profile.id}`,
                            firewall.ipAddress,
                            firewall.ipAddress,
                        );
                        firewallCreated = true;
                    }
                    await delay(30_000, undefined, { signal });
                }
            });
            const withData = request.deploymentContent === "schemaAndData";
            await run(withData ? "importingData" : "publishingSchema", async () => {
                const targetEmpty = await query(targetUri, emptyTargetQuery);
                if (targetEmpty[0]?.[0] !== "0") {
                    throw new Error(LocalToCloud.targetDatabaseExists);
                }
                await this.packageOperation(
                    operation,
                    (task) =>
                        (task.serverName === profile.server ||
                            task.serverName === `${profile.server},${profile.port}`) &&
                        task.databaseName === profile.database &&
                        task.operationName ===
                            (withData
                                ? Constants.operationIdImportBacpac
                                : Constants.operationIdDeployDacpac),
                    () =>
                        withData
                            ? main.dacFxService.importBacpac(
                                  bacpacPath,
                                  profile.database,
                                  targetUri,
                                  TaskExecutionMode.execute,
                              )
                            : main.dacFxService.deployDacpac(
                                  dacpacPath,
                                  profile.database,
                                  true,
                                  targetUri,
                                  TaskExecutionMode.execute,
                              ),
                    safeError,
                );
            });
            await run("verifying", async () => {
                if (
                    !schemaMatches(await query(targetUri, schemaQuery), expectedObjects, false) ||
                    (sourceCounts && !equalCounts(sourceCounts, await readCounts(targetUri)))
                ) {
                    throw new Error(LocalToCloud.deploymentVerificationFailed);
                }
                result.objectsDeployed = expectedObjects.length;
            });
            await run("savingConnection", async () => {
                const saved = await manager.connectionUI.saveProfile(profile);
                signal.throwIfAborted();
                if (!saved) {
                    throw new Error(LocalToCloud.deploymentProfileFailed);
                }
                const node = await main.createObjectExplorerSession(saved);
                if (!node?.sessionId || node.errorMessage) {
                    throw new Error(LocalToCloud.deploymentProfileFailed);
                }
            });
            result.status = "succeeded";
            const resourcePath = [
                "subscriptions",
                form.subscriptionId,
                "resourceGroups",
                form.resourceGroup,
                "providers",
                "Microsoft.Sql",
                "servers",
                form.serverName,
                "databases",
                form.databaseName,
            ]
                .map(encodeURIComponent)
                .join("/");
            this.destinations.set(request.deploymentId, {
                profile,
                portalUrl: `${getCloudProviderSettings().portalEndpoint.replace(/\/$/, "")}/#resource/${resourcePath}`,
            });
            this.output.appendLine(LocalToCloud.deploymentSucceeded);
        } catch (error) {
            failureStage = currentStage;
            result.status = signal.aborted ? "cancelled" : "error";
            result.errorMessage = signal.aborted
                ? LocalToCloud.deploymentCancelled
                : safeError(error);
            this.output.appendLine(result.errorMessage);
            if (result.status === "error") {
                this.logger.error(`Local database deployment failed: ${result.errorMessage}`);
            } else {
                this.logger.trace(result.errorMessage);
            }
        } finally {
            for (const uri of [sourceUri, targetUri]) {
                if (manager.isConnected(uri) || manager.isConnecting(uri)) {
                    try {
                        if (!(await manager.disconnect(uri))) {
                            this.logger.warn(
                                "A temporary migration connection could not be disconnected.",
                            );
                        }
                    } catch (error) {
                        this.logger.error(
                            `Failed to close a temporary migration connection: ${safeError(error)}`,
                        );
                    }
                }
            }
            if (directory) {
                try {
                    await fs.rm(directory, { recursive: true, force: true });
                } catch (error) {
                    failureStage = "cleanup";
                    result.status = "error";
                    result.errorMessage = LocalToCloud.deploymentCleanupFailed;
                    this.logger.error(
                        `Failed to remove migration artifacts in ${directory}: ${safeError(error)}`,
                    );
                    this.output.appendLine(result.errorMessage);
                }
            }
        }
        backgroundTask.complete(
            result.status === "succeeded"
                ? BackgroundTaskState.Succeeded
                : result.status === "cancelled"
                  ? BackgroundTaskState.Canceled
                  : BackgroundTaskState.Failed,
            {
                message:
                    result.status === "succeeded"
                        ? LocalToCloud.deploymentSucceeded
                        : result.errorMessage,
            },
        );
        const telemetryOptions = {
            additionalProps: {
                deploymentContent: request.deploymentContent,
                status: result.status,
                stage: failureStage ?? currentStage,
                resourcesMayRemain: String(result.resourcesMayRemain),
            },
            additionalMeasurements: {
                durationInMs: performance.now() - startedAt,
                completedStageCount: completedStages.length,
                ...(result.objectsDeployed !== undefined
                    ? { objectsDeployed: result.objectsDeployed }
                    : {}),
            },
        };
        if (result.status === "error") {
            sendErrorEvent(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.FinishLocalToCloudDeployment,
                {
                    ...telemetryOptions,
                    errorType: "LocalToCloudDeploymentFailed",
                    includeErrorMessage: false,
                },
            );
        } else {
            sendActionEvent(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.FinishLocalToCloudDeployment,
                telemetryOptions,
            );
        }
        return result;
    }

    private async packageOperation(
        operation: DeploymentOperation,
        matches: (task: TaskInfo) => boolean,
        action: () => PromiseLike<DacFxResult>,
        safeError: (error: unknown) => string,
    ): Promise<void> {
        const { signal } = operation.abort;
        const tasks = this.controller.mainController.sqlTasksService;
        let taskId: string | undefined;
        let cancellation: Promise<void> | undefined;
        const cancel = () => {
            if (taskId && !cancellation) {
                cancellation = Promise.resolve(this.client.sendRequest(cancelTask, { taskId }))
                    .then((cancelled) => {
                        if (!cancelled) {
                            this.logger.warn(
                                "The migration package operation could not be cancelled.",
                            );
                        }
                    })
                    .catch((error) =>
                        this.logger.error(
                            `Failed to cancel the migration package operation: ${safeError(error)}`,
                        ),
                    );
            }
        };
        const listener = onTaskCreated((task) => {
            if (matches(task)) {
                taskId = task.taskId;
                if (signal.aborted) {
                    cancel();
                }
            }
        });
        const suppression = tasks.suppressTaskUI(matches);
        let lastMessage: string | undefined;
        const progressListener = onTaskProgress((progress) => {
            if (progress.taskId === taskId) {
                const message = progress.message || progress.progressMessage;
                if (message) {
                    lastMessage = safeError(message);
                    this.output.appendLine(lastMessage);
                }
            }
        });
        signal.addEventListener("abort", cancel, { once: true });
        try {
            signal.throwIfAborted();
            const result = await action();
            signal.throwIfAborted();
            if (!result.success) {
                throw new Error(
                    result.errorMessage || lastMessage || LocalToCloud.deploymentOperationFailed,
                );
            }
        } finally {
            signal.removeEventListener("abort", cancel);
            listener.dispose();
            progressListener.dispose();
            suppression.dispose();
            await cancellation;
        }
    }
}

//#endregion
