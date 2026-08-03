/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { BridgeErrorCode, BridgeRequestError, QueryContentDescriptor } from "./contracts";

type SqlToolsMcpTelemetryAction =
    | TelemetryActions.SqlToolsMcpProviderRegistration
    | TelemetryActions.SqlToolsMcpDefinitionResolution
    | TelemetryActions.SqlToolsMcpBridgeLifecycle
    | TelemetryActions.SqlToolsMcpListConnections
    | TelemetryActions.SqlToolsMcpConnect
    | TelemetryActions.SqlToolsMcpRegisterConnection
    | TelemetryActions.SqlToolsMcpExecuteQuery
    | TelemetryActions.SqlToolsMcpRemoveConnection;

type TelemetryProps = Record<string, string>;
type TelemetryMeasures = Record<string, number>;

export function sendSqlToolsMcpAction(
    action: SqlToolsMcpTelemetryAction,
    properties: TelemetryProps = {},
    measurements: TelemetryMeasures = {},
): void {
    sendActionEvent(TelemetryViews.SqlToolsMcp, action, properties, measurements);
}

export function sendSqlToolsMcpError(
    action: SqlToolsMcpTelemetryAction,
    error: unknown,
    properties: TelemetryProps = {},
    measurements: TelemetryMeasures = {},
): void {
    const bridgeErrorCode = getBridgeErrorCode(error);
    sendErrorEvent(
        TelemetryViews.SqlToolsMcp,
        action,
        error instanceof Error ? error : new Error("SQL Tools MCP operation failed."),
        false,
        bridgeErrorCode,
        getErrorType(error),
        {
            ...properties,
            ...(bridgeErrorCode ? { bridgeErrorCode } : {}),
        },
        measurements,
        undefined,
        undefined,
        false,
    );
}

export function getQueryTelemetryProperties(
    descriptor: QueryContentDescriptor | undefined,
): TelemetryProps {
    if (!descriptor) {
        return {
            queryMode: "unknown",
            returnAsMarkdown: "unknown",
            hasQueryParameters: "false",
        };
    }

    return {
        queryMode: descriptor.executeStoredProcedure ? "storedProcedure" : "text",
        returnAsMarkdown: String(descriptor.returnAsMarkdown ?? true),
        hasQueryParameters: String((descriptor.queryParameters?.length ?? 0) > 0),
    };
}

export function getElapsedMs(startTime: number): number {
    return Math.max(0, Math.round(performance.now() - startTime));
}

function getBridgeErrorCode(error: unknown): BridgeErrorCode | undefined {
    return error instanceof BridgeRequestError ? error.bridgeErrorCode : undefined;
}

function getErrorType(error: unknown): string {
    return error instanceof Error ? error.name : "Unknown";
}
