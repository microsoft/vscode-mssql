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

// ------------------------------- < IntelliSense Ready Event > ------------------------------------

/**
 * Event sent when the language service send a definition
 */
export namespace DefinitionSentNotification {
    export const type: NotificationType<DefinitionSentParams> = { get method(): string { return 'textDocument/definitionSent'; } };
}

/**
 * Update event parameters
 */
export class DefinitionSentParams {
}

// ------------------------------- </ IntelliSense Ready Event > ----------------------------------

