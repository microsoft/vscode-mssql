/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "node:path";
import * as os from "node:os";
import { promises as fs } from "node:fs";
import { RequestType } from "vscode-languageclient";
import type { Disposable } from "vscode";
import { sendActionEvent, sendErrorEvent } from "extension-toolkit/vscode";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import type ConnectionManager from "../controllers/connectionManager";
import type SqlToolsServiceClient from "../languageservice/serviceclient";
import type { DacFxService } from "../services/dacFxService";
import type { SqlProjectsService } from "../services/sqlProjectsService";
import { onTaskCreated, type SqlTasksService, type TaskInfo } from "../services/sqlTasksService";
import { ExtractTarget, TaskExecutionMode } from "../enums";
import { ProjectType } from "../databaseProjects/common/enums";
import { getMicrosoftBuildSqlVersion } from "../databaseProjects/tools/netcoreTool";
import { LocalToCloud } from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";
import type { ILogger } from "../sharedInterfaces/logger";
import {
    LocalDatabaseCompatibilityRequest,
    LocalDatabaseCompatibilityResult,
    LocalDatabaseCompatibilityProgress,
    LocalDatabaseCompatibilityStage,
} from "../sharedInterfaces/azureSqlDatabase";
import { getLocalDatabaseConnectionId, getLocalDatabaseSources } from "./localDatabaseSources";
import { AzureSqlCompatibilityBuilder } from "./azureSqlCompatibilityBuilder";
import {
    isValidBasenameErrorMessage,
    sanitizeStringForFilename,
} from "../dataWorkspace/common/pathUtilsHelper";

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
