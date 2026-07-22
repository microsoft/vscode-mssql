/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Narrow compatibility adapter around the STS v1 Schema Compare service.
 * No v1 endpoint or recursive DiffEntry contract escapes this file.
 */

import type * as mssql from "vscode-mssql";
import {
    DeploymentScenario,
    ExtractTarget,
    SchemaCompareEndpointType,
    SchemaDifferenceType,
    SchemaUpdateAction,
    TaskExecutionMode,
} from "../../enums";
import {
    RUNBOOK_SCHEMA_COMPARE_DOCUMENT_SCHEMA_VERSION,
    RunbookSchemaCompareAction,
    RunbookSchemaCompareDocument,
    RunbookSchemaCompareItem,
} from "../../sharedInterfaces/runbookSchemaCompare";

const MAX_ITEMS = 500;
const MAX_SCRIPT_BYTES = 128 * 1024;
const MAX_TOTAL_SCRIPT_BYTES = 512 * 1024;

export interface RunbookSchemaCompareProviderRequest {
    operationId: string;
    dacpacPath: string;
    sourceLabel: string;
    targetServer: string;
    targetDatabase: string;
    ownerUri: string;
    isCancellationRequested: () => boolean;
}

export interface RunbookSchemaCompareProvider {
    compare(request: RunbookSchemaCompareProviderRequest): Promise<RunbookSchemaCompareDocument>;
}

interface SchemaCompareV1Service {
    compare(
        operationId: string,
        sourceEndpointInfo: mssql.SchemaCompareEndpointInfo,
        targetEndpointInfo: mssql.SchemaCompareEndpointInfo,
        taskExecutionMode: TaskExecutionMode,
        deploymentOptions: mssql.DeploymentOptions,
    ): Thenable<mssql.SchemaCompareResult>;
    cancel(operationId: string): Thenable<mssql.ResultStatus>;
}

interface DacFxOptionsProvider {
    getDeploymentOptions(scenario: DeploymentScenario): Thenable<mssql.GetDeploymentOptionsResult>;
}

export class SchemaCompareProviderError extends Error {
    constructor(
        message: string,
        public readonly code: "cancelled" | "optionsUnavailable" | "compareFailed",
    ) {
        super(message);
        this.name = "SchemaCompareProviderError";
    }
}

export class StsV1RunbookSchemaCompareProvider implements RunbookSchemaCompareProvider {
    constructor(
        private readonly service: SchemaCompareV1Service,
        private readonly dacFx: DacFxOptionsProvider,
    ) {}

    public async compare(
        request: RunbookSchemaCompareProviderRequest,
    ): Promise<RunbookSchemaCompareDocument> {
        if (request.isCancellationRequested()) {
            throw new SchemaCompareProviderError("Schema comparison was cancelled.", "cancelled");
        }
        const options = await this.dacFx.getDeploymentOptions(DeploymentScenario.SchemaCompare);
        if (!options.success || !options.defaultDeploymentOptions) {
            throw new SchemaCompareProviderError(
                options.errorMessage || "Schema Compare options are unavailable.",
                "optionsUnavailable",
            );
        }

        const cancellationPoll = setInterval(() => {
            if (request.isCancellationRequested()) {
                void Promise.resolve(this.service.cancel(request.operationId)).catch(
                    () => undefined,
                );
            }
        }, 50);
        let result: mssql.SchemaCompareResult;
        try {
            result = await this.service.compare(
                request.operationId,
                dacpacEndpoint(request.dacpacPath),
                databaseEndpoint(request.targetServer, request.targetDatabase, request.ownerUri),
                TaskExecutionMode.execute,
                options.defaultDeploymentOptions,
            );
        } finally {
            clearInterval(cancellationPoll);
        }
        if (request.isCancellationRequested()) {
            throw new SchemaCompareProviderError("Schema comparison was cancelled.", "cancelled");
        }
        if (!result?.success) {
            throw new SchemaCompareProviderError(
                result?.errorMessage || "Schema comparison failed.",
                "compareFailed",
            );
        }
        return projectV1SchemaCompareResult(result, request.sourceLabel, request.targetDatabase);
    }
}

export function projectV1SchemaCompareResult(
    result: mssql.SchemaCompareResult,
    sourceLabel: string,
    targetLabel: string,
): RunbookSchemaCompareDocument {
    const differences = collectObjectDifferences(result.differences ?? []);
    const items: RunbookSchemaCompareItem[] = [];
    let scriptBytes = 0;
    for (let index = 0; index < differences.length && items.length < MAX_ITEMS; index++) {
        const difference = differences[index];
        const sourceSql = aggregateScript(difference, true, MAX_SCRIPT_BYTES);
        const targetSql = aggregateScript(difference, false, MAX_SCRIPT_BYTES);
        const remainingBytes = Math.max(0, MAX_TOTAL_SCRIPT_BYTES - scriptBytes);
        const boundedSource = boundUtf8(sourceSql, Math.min(MAX_SCRIPT_BYTES, remainingBytes));
        scriptBytes += Buffer.byteLength(boundedSource, "utf8");
        const boundedTarget = boundUtf8(
            targetSql,
            Math.min(MAX_SCRIPT_BYTES, Math.max(0, MAX_TOTAL_SCRIPT_BYTES - scriptBytes)),
        );
        scriptBytes += Buffer.byteLength(boundedTarget, "utf8");
        items.push({
            id: `difference-${index + 1}`,
            action: schemaCompareAction(difference.updateAction),
            objectType:
                difference.sourceObjectType ||
                difference.targetObjectType ||
                difference.name ||
                "Object",
            ...(qualifiedName(difference.sourceValue)
                ? { sourceName: qualifiedName(difference.sourceValue) }
                : {}),
            ...(qualifiedName(difference.targetValue)
                ? { targetName: qualifiedName(difference.targetValue) }
                : {}),
            ...(boundedSource ? { sourceSql: boundedSource } : {}),
            ...(boundedTarget ? { targetSql: boundedTarget } : {}),
        });
    }
    return {
        schemaVersion: RUNBOOK_SCHEMA_COMPARE_DOCUMENT_SCHEMA_VERSION,
        source: { kind: "dacpac", label: sourceLabel },
        target: { kind: "database", label: targetLabel },
        areEqual: result.areEqual,
        totalDifferences: differences.length,
        items,
        truncated: items.length < differences.length || scriptBytes >= MAX_TOTAL_SCRIPT_BYTES,
        omittedCount: Math.max(0, differences.length - items.length),
        provider: { kind: "sts-v1-schema-compare", contractVersion: 1 },
    };
}

function collectObjectDifferences(roots: readonly mssql.DiffEntry[]): mssql.DiffEntry[] {
    const result: mssql.DiffEntry[] = [];
    const visited = new Set<mssql.DiffEntry>();
    const visit = (entry: mssql.DiffEntry) => {
        if (!entry || visited.has(entry)) {
            return;
        }
        visited.add(entry);
        if (entry.differenceType === SchemaDifferenceType.Object) {
            result.push(entry);
        }
        for (const child of entry.children ?? []) {
            visit(child);
        }
    };
    for (const root of roots) {
        visit(root);
    }
    return result;
}

function aggregateScript(entry: mssql.DiffEntry, source: boolean, maxBytes: number): string {
    const scripts: string[] = [];
    const visited = new Set<mssql.DiffEntry>();
    const visit = (current: mssql.DiffEntry) => {
        if (!current || visited.has(current)) {
            return;
        }
        visited.add(current);
        const script = source ? current.sourceScript : current.targetScript;
        if (script?.trim()) {
            scripts.push(script.trim());
        }
        if (Buffer.byteLength(scripts.join("\n\n"), "utf8") >= maxBytes) {
            return;
        }
        for (const child of current.children ?? []) {
            visit(child);
        }
    };
    visit(entry);
    return boundUtf8(scripts.join("\n\n"), maxBytes);
}

function boundUtf8(value: string, maxBytes: number): string {
    if (!value || maxBytes <= 0) {
        return "";
    }
    const bytes = Buffer.from(value, "utf8");
    if (bytes.byteLength <= maxBytes) {
        return value;
    }
    return `${bytes.subarray(0, Math.max(0, maxBytes - 32)).toString("utf8")}\n-- Script truncated --`;
}

function qualifiedName(parts: string[] | undefined): string | undefined {
    const value = (parts ?? []).filter(Boolean).join(".");
    return value || undefined;
}

function schemaCompareAction(value: SchemaUpdateAction): RunbookSchemaCompareAction {
    switch (value) {
        case SchemaUpdateAction.Add:
            return "add";
        case SchemaUpdateAction.Change:
            return "change";
        case SchemaUpdateAction.Delete:
            return "delete";
        default:
            return "unknown";
    }
}

function dacpacEndpoint(packageFilePath: string): mssql.SchemaCompareEndpointInfo {
    return {
        endpointType: SchemaCompareEndpointType.Dacpac,
        packageFilePath,
        serverDisplayName: "",
        serverName: "",
        databaseName: "",
        ownerUri: "",
        connectionDetails: undefined,
        connectionName: "",
        projectFilePath: "",
        targetScripts: [],
        extractTarget: ExtractTarget.schemaObjectType,
        dataSchemaProvider: "",
    };
}

function databaseEndpoint(
    serverName: string,
    databaseName: string,
    ownerUri: string,
): mssql.SchemaCompareEndpointInfo {
    return {
        endpointType: SchemaCompareEndpointType.Database,
        packageFilePath: "",
        serverDisplayName: serverName,
        serverName,
        databaseName,
        ownerUri,
        connectionDetails: undefined,
        connectionName: "",
        projectFilePath: "",
        targetScripts: [],
        extractTarget: ExtractTarget.schemaObjectType,
        dataSchemaProvider: "",
    };
}
