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
    private readonly _properties: TelemetryEventProperties;
    private readonly _measurements: TelemetryEventMeasures;

    constructor(
        private readonly reporter: VsCodeTelemetryReporter | undefined,
        private readonly eventName: string,
        properties: TelemetryEventProperties = {},
        measurements: TelemetryEventMeasures = {},
    ) {
        this._properties = properties;
        this._measurements = { ...measurements, ...commonMeasurements };
    }

    public send(): void {
        try {
            this.reporter?.sendTelemetryEvent(this.eventName, this._properties, this._measurements);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error sending ${this.eventName} event: ${message}`);
        }
    }

    public withAdditionalProperties(
        additionalProperties: TelemetryEventProperties,
    ): TelemetryEvent {
        Object.assign(this._properties, additionalProperties);
        return this;
    }

    public withAdditionalMeasurements(
        additionalMeasurements: TelemetryEventMeasures,
    ): TelemetryEvent {
        Object.assign(this._measurements, additionalMeasurements);
        return this;
    }

    public withConnectionInfo(connectionInfo: ConnectionInfo): TelemetryEvent {
        if (connectionInfo && typeof connectionInfo === "object") {
            Object.assign(this._properties, {
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
            Object.assign(this._properties, {
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
    private readonly _telemetryReporter: VsCodeTelemetryReporter | undefined = undefined;

    constructor(connectionString?: string) {
        if (!connectionString) {
            // if running a dev build, look for the aiKey as an environment variable
            connectionString = process.env["APP_INSIGHTS_KEY"];
        }

        try {
            this._telemetryReporter = new VsCodeTelemetryReporter(connectionString);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error initializing TelemetryReporter: ${message}`);
        }
    }

    public createViewEvent(view: V): TelemetryEvent {
        return new TelemetryEventImpl(this._telemetryReporter, "view", { view });
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
            this._telemetryReporter,
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
            this._telemetryReporter,
            "metrics",
            { groupName },
            measurements,
        );
    }

    public sendMetricsEvent(measurements: TelemetryEventMeasures, groupName: string = ""): void {
        this.createMetricsEvent(measurements, groupName).send();
    }

    public createErrorEvent(
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

        return new TelemetryEventImpl(this._telemetryReporter, "error", properties);
    }

    public sendErrorEvent(
        view: V,
        name: string,
        error: unknown = undefined,
        includeMessage: boolean = false,
        errorCode: string = "",
        errorType: string = "",
    ): void {
        this.createErrorEvent(view, name, error, includeMessage, errorCode, errorType).send();
    }

    public createTelemetryEvent(
        eventName: string,
        properties?: TelemetryEventProperties,
        measurements?: TelemetryEventMeasures,
    ): TelemetryEvent {
        return new TelemetryEventImpl(this._telemetryReporter, eventName, properties, measurements);
    }

    public sendTelemetryEvent(
        eventName: string,
        properties?: TelemetryEventProperties,
        measurements?: TelemetryEventMeasures,
    ): void {
        this.createTelemetryEvent(eventName, properties, measurements).send();
    }

    public async dispose(): Promise<void> {
        await this._telemetryReporter?.dispose();
    }
}
