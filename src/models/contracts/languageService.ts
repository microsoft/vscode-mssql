import {NotificationType} from 'vscode-languageclient';

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
