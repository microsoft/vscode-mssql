/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryReporter as VsCodeTelemetryReporter } from "@vscode/extension-telemetry";
import { TimedAction } from "./timedAction";

export interface ConnectionInfo {
    authenticationType?: string;
    providerName?: string;
}

export interface ServerInfo {
    isCloud?: boolean;
    serverVersion?: string;
    serverEdition?: string;
    engineEditionId?: string | number;
}

export interface TelemetryEventProperties {
    [key: string]: string;
}

export interface TelemetryEventMeasures {
    [key: string]: number;
}

export interface TelemetryEvent {
    send(): void;
    withAdditionalProperties(additionalProperties: TelemetryEventProperties): TelemetryEvent;
    withAdditionalMeasurements(additionalMeasurements: TelemetryEventMeasures): TelemetryEvent;
    withConnectionInfo(connectionInfo: ConnectionInfo): TelemetryEvent;
    withServerInfo(serverInfo: ServerInfo): TelemetryEvent;
}

const msftInternalDomains = [
    "redmond.corp.microsoft.com",
    "northamerica.corp.microsoft.com",
    "fareast.corp.microsoft.com",
    "ntdev.corp.microsoft.com",
    "wingroup.corp.microsoft.com",
    "southpacific.corp.microsoft.com",
    "wingroup.windeploy.ntdev.microsoft.com",
    "ddnet.microsoft.com",
    "europe.corp.microsoft.com",
];

function isMsftInternal(): boolean {
    const userDnsDomain = process.env["USERDNSDOMAIN"];
    if (!userDnsDomain) {
        return false;
    }

    const domain = userDnsDomain.toLowerCase();
    return msftInternalDomains.some((msftDomain) => domain === msftDomain);
}

const commonMeasurements: TelemetryEventMeasures = {
    "common.msftInternal": isMsftInternal() ? 1 : 0,
};

class TelemetryEventImpl implements TelemetryEvent {
    private readonly properties: TelemetryEventProperties;
    private readonly measurements: TelemetryEventMeasures;

    constructor(
        private readonly reporter: VsCodeTelemetryReporter | undefined,
        private readonly eventName: string,
        properties: TelemetryEventProperties = {},
        measurements: TelemetryEventMeasures = {},
    ) {
        this.properties = properties;
        this.measurements = { ...measurements, ...commonMeasurements };
    }

    public send(): void {
        try {
            this.reporter?.sendTelemetryEvent(this.eventName, this.properties, this.measurements);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error sending ${this.eventName} event: ${message}`);
        }
    }

    public withAdditionalProperties(
        additionalProperties: TelemetryEventProperties,
    ): TelemetryEvent {
        Object.assign(this.properties, additionalProperties);
        return this;
    }

    public withAdditionalMeasurements(
        additionalMeasurements: TelemetryEventMeasures,
    ): TelemetryEvent {
        Object.assign(this.measurements, additionalMeasurements);
        return this;
    }

    public withConnectionInfo(connectionInfo: ConnectionInfo): TelemetryEvent {
        if (connectionInfo && typeof connectionInfo === "object") {
            Object.assign(this.properties, {
                authenticationType: connectionInfo.authenticationType ?? "",
                providerName: connectionInfo.providerName ?? "",
            });
        } else {
            console.error(
                `TelemetryReporter received invalid ConnectionInfo object of type ${typeof connectionInfo}`,
            );
        }
        return this;
    }

    public withServerInfo(serverInfo: ServerInfo): TelemetryEvent {
        if (serverInfo && typeof serverInfo === "object") {
            Object.assign(this.properties, {
                connectionType:
                    serverInfo.isCloud === undefined
                        ? ""
                        : serverInfo.isCloud
                          ? "Azure"
                          : "Standalone",
                serverVersion: serverInfo.serverVersion ?? "",
                serverEdition: serverInfo.serverEdition ?? "",
                serverEngineEdition:
                    serverInfo.engineEditionId === undefined
                        ? ""
                        : String(serverInfo.engineEditionId),
            });
        } else {
            console.error(
                `TelemetryReporter received invalid ServerInfo object of type ${typeof serverInfo}`,
            );
        }
        return this;
    }
}

export default class TelemetryReporter<V extends string = string, A extends string = string> {
    private readonly telemetryReporter: VsCodeTelemetryReporter | undefined = undefined;

    constructor(connectionString: string | undefined) {
        if (!connectionString) {
            console.warn(
                "MSSQL telemetry was not initialized because no telemetry connection string was provided.",
            );
            return;
        }

        try {
            this.telemetryReporter = new VsCodeTelemetryReporter(connectionString);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error initializing TelemetryReporter: ${message}`);
        }
    }

    public createViewEvent(view: V): TelemetryEvent {
        return new TelemetryEventImpl(this.telemetryReporter, "view", { view });
    }

    public sendViewEvent(view: V): void {
        this.createViewEvent(view).send();
    }

    public createActionEvent(
        view: V,
        action: A,
        target: string = "",
        source: string = "",
        durationInMs?: number,
    ): TelemetryEvent {
        const measures: TelemetryEventMeasures = durationInMs === undefined ? {} : { durationInMs };
        return new TelemetryEventImpl(
            this.telemetryReporter,
            "action",
            { view, action, target, source },
            measures,
        );
    }

    public sendActionEvent(
        view: V,
        action: A,
        target: string = "",
        source: string = "",
        durationInMs?: number,
    ): void {
        this.createActionEvent(view, action, target, source, durationInMs).send();
    }

    public createTimedAction(
        view: V,
        action: A,
        target?: string,
        source?: string,
    ): TimedAction<V, A> {
        return new TimedAction(this, view, action, target, source);
    }

    public createMetricsEvent(
        measurements: TelemetryEventMeasures,
        groupName: string = "",
    ): TelemetryEvent {
        return new TelemetryEventImpl(
            this.telemetryReporter,
            "metrics",
            { groupName },
            measurements,
        );
    }

    public sendMetricsEvent(measurements: TelemetryEventMeasures, groupName: string = ""): void {
        this.createMetricsEvent(measurements, groupName).send();
    }

    /**
     * @deprecated Use createErrorEvent2.
     */
    public createErrorEvent(
        view: V,
        name: string,
        errorCode: string = "",
        errorType: string = "",
    ): TelemetryEvent {
        return new TelemetryEventImpl(this.telemetryReporter, "error", {
            view,
            name,
            errorCode,
            errorType,
        });
    }

    /**
     * @deprecated Use sendErrorEvent2.
     */
    public sendErrorEvent(
        view: V,
        name: string,
        errorCode: string = "",
        errorType: string = "",
    ): void {
        this.createErrorEvent(view, name, errorCode, errorType).send();
    }

    public createErrorEvent2(
        view: V,
        name: string,
        error: unknown = undefined,
        includeMessage: boolean = false,
        errorCode: string = "",
        errorType: string = "",
    ): TelemetryEvent {
        const properties: TelemetryEventProperties = {
            view,
            name,
            errorCode,
            errorType,
        };

        if (error instanceof Error) {
            properties.message = includeMessage ? error.message : "";
            properties.stack = error.stack ?? "";
            if (!includeMessage && error.message) {
                properties.stack = properties.stack.replaceAll(
                    error.message,
                    "<REDACTED: error-message>",
                );
            }
        } else {
            properties.message = includeMessage && error !== undefined ? String(error) : "";
            properties.stack = "";
        }

        return new TelemetryEventImpl(this.telemetryReporter, "error", properties);
    }

    public sendErrorEvent2(
        view: V,
        name: string,
        error: unknown = undefined,
        includeMessage: boolean = false,
        errorCode: string = "",
        errorType: string = "",
    ): void {
        this.createErrorEvent2(view, name, error, includeMessage, errorCode, errorType).send();
    }

    public createTelemetryEvent(
        eventName: string,
        properties?: TelemetryEventProperties,
        measurements?: TelemetryEventMeasures,
    ): TelemetryEvent {
        return new TelemetryEventImpl(this.telemetryReporter, eventName, properties, measurements);
    }

    public sendTelemetryEvent(
        eventName: string,
        properties?: TelemetryEventProperties,
        measurements?: TelemetryEventMeasures,
    ): void {
        this.createTelemetryEvent(eventName, properties, measurements).send();
    }

    public async dispose(): Promise<void> {
        await this.telemetryReporter?.dispose();
    }
}
