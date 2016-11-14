import {NotificationType} from 'vscode-languageclient';

// ------------------------------- < Language Service Update Event > ------------------------------------

/**
 * Event sent when the language service is finished updating after a connection
 */
export namespace UpdateNotification {
    export const type: NotificationType<UpdateParams> = { get method(): string { return 'textDocument/update'; } };
}

/**
 * Update event parameters
 */
export class UpdateParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;
}

// ------------------------------- </ Language Service Update Event > ----------------------------------
