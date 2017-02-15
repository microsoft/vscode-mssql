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

/**
 * Notification sent when the an IntelliSense cache invalidation is requested
 */
export namespace RebuildIntelliSenseNotification {
    export const type: NotificationType<RebuildIntelliSenseParams> = { get method(): string { return 'textDocument/rebuildIntelliSense'; } };
}

/**
 * Rebuild IntelliSense notification parameters
 */
export class RebuildIntelliSenseParams {
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
    export const type: NotificationType<TelemetryParams> = { get method(): string { return 'telemetry/sqlevent'; } };
}

/**
 * Update event parameters
 */
export class TelemetryParams {
    public params: {
        eventName: string;
        properties: Telemetry.ITelemetryEventProperties;
        measures: Telemetry.ITelemetryEventMeasures;
    };
}

// ------------------------------- </ Telemetry Sent Event > ----------------------------------
// ------------------------------- < Status Event > ------------------------------------

/**
 * Event sent when the language service send a status change event
 */
export namespace StatusChangedNotification {
    export const type: NotificationType<StatusChangeParams> = { get method(): string { return 'textDocument/statusChanged'; } };
}

/**
 * Update event parameters
 */
export class StatusChangeParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;

    /**
     * The new status of the document
     */
    public status: string;
}


// ------------------------------- </ Status Sent Event > ----------------------------------
