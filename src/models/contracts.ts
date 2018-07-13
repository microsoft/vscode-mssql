import { RequestType } from 'vscode-languageclient';

// --------------------------------- < Version Request > -------------------------------------------------

// Version request message callback declaration
export namespace VersionRequest {
    export const type: RequestType<void, VersionResult, void> = { get method(): string { return 'version'; } };
}

// Version response format
export type VersionResult = string;

// ------------------------------- </ Version Request > --------------------------------------------------


// --------------------------------- < Read Credential Request > -------------------------------------------------

// Read Credential request message callback declaration
export namespace ReadCredentialRequest {
    export const type: RequestType<Credential, Credential, void> = { get method(): string { return 'credential/read'; } };
}

/**
 * Parameters to initialize a connection to a database
 */
export class Credential {
    /**
     * Unique ID identifying the credential
     */
    public credentialId: string;

    /**
     * password
     */
    public password: string;
}

// --------------------------------- </ Read Credential Request > -------------------------------------------------

// --------------------------------- < Save Credential Request > -------------------------------------------------

// Save Credential request message callback declaration
export namespace SaveCredentialRequest {
    export const type: RequestType<Credential, boolean, void> = { get method(): string { return 'credential/save'; } };
}
// --------------------------------- </ Save Credential Request > -------------------------------------------------


// --------------------------------- < Delete Credential Request > -------------------------------------------------

// Delete Credential request message callback declaration
export namespace DeleteCredentialRequest {
    export const type: RequestType<Credential, boolean, void> = { get method(): string { return 'credential/delete'; } };
}
// --------------------------------- </ Delete Credential Request > -------------------------------------------------

export class SaveResultsRequestParams {
        ownerUri: string;
        filePath: string;
        batchIndex: number;
        resultSetIndex: number;
        rowStartIndex: number;
        rowEndIndex: number;
        columnStartIndex: number;
        columnEndIndex: number;
}

export class SaveResultsAsCsvRequestParams extends SaveResultsRequestParams {
    includeHeaders: boolean = true;
    delimiter: string = ',';
}

export class SaveResultsAsJsonRequestParams extends SaveResultsRequestParams {
    // TODO: Define config for JSON
}

export class SaveResultsAsExcelRequestParams extends SaveResultsRequestParams {
    includeHeaders: boolean = true;
}

export class SaveResultRequestResult {
    messages: string;
}

// --------------------------------- < Save Results as CSV Request > ------------------------------------------
// save results in csv format
export namespace SaveResultsAsCsvRequest {
    export const type: RequestType<SaveResultsAsCsvRequestParams, SaveResultRequestResult, void> = { get method(): string { return 'query/saveCsv'; } };
}
// --------------------------------- </ Save Results as CSV Request > ------------------------------------------

// --------------------------------- < Save Results as JSON Request > ------------------------------------------
// save results in json format
export namespace SaveResultsAsJsonRequest {
    export const type: RequestType<SaveResultsAsJsonRequestParams, SaveResultRequestResult, void> = { get method(): string { return 'query/saveJson'; } };
}
// --------------------------------- </ Save Results as JSON Request > ------------------------------------------

// --------------------------------- < Save Results as Excel Request > ------------------------------------------
// save results in Excel format
export namespace SaveResultsAsExcelRequest {
    export const type: RequestType<SaveResultsAsExcelRequestParams, SaveResultRequestResult, void> = { get method(): string { return 'query/saveExcel'; } };
}
// --------------------------------- </ Save Results as Excel Request > ------------------------------------------
