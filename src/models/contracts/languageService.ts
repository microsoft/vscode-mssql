import {NotificationType} from 'vscode-languageclient';
import {Telemetry} from '../telemetry';

// ------------------------------- < IntelliSense Ready Event > ------------------------------------

/**
 * Event sent when the language service is finished updating after a connection
 */
export namespace IntelliSenseReadyNotification {
    export const type: NotificationType<IntelliSenseReadyParams> = { get method(): string { return 'textDocument/intelliSenseReady'; } };
}

/**
 * Update event parameters
 */
export class IntelliSenseReadyParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;
}

// ------------------------------- </ IntelliSense Ready Event > ----------------------------------
// ------------------------------- < Telemetry Sent Event > ------------------------------------

/**
 * Event sent when the language service send a telemetry event
 */
export namespace TelemetryNotification {
    export const type: NotificationType<TelemetryParams> = { get method(): string { return 'textDocument/telemetry'; } };
}

/**
 * Update event parameters
 */
export class TelemetryParams {
    public eventName: string;
    public properties: Telemetry.ITelemetryEventProperties;
    public measures: Telemetry.ITelemetryEventMeasures;
}

// ------------------------------- </ Telemetry Sent Event > ----------------------------------
