/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";

// --------------------------------- < Read Credential Request > -------------------------------------------------

// Read Credential request message callback declaration
export namespace ReadCredentialRequest {
    export const type = new RequestType<Credential, Credential, void, void>("credential/read");
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
    export const type = new RequestType<Credential, boolean, void, void>("credential/save");
}
// --------------------------------- </ Save Credential Request > -------------------------------------------------

// --------------------------------- < Delete Credential Request > -------------------------------------------------

// Delete Credential request message callback declaration
export namespace DeleteCredentialRequest {
    export const type = new RequestType<Credential, boolean, void, void>("credential/delete");
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
    delimiter: string = ",";
    lineSeperator: string = undefined;
    textIdentifier: string = '"';
    encoding: string = "utf-8";
}

export class SaveResultsAsJsonRequestParams extends SaveResultsRequestParams {
    // TODO: Define config for JSON
}

export class SaveResultsAsExcelRequestParams extends SaveResultsRequestParams {
    includeHeaders: boolean = true;
}

export class SaveResultsAsInsertRequestParams extends SaveResultsRequestParams {
    includeHeaders: boolean = true;
}

export class SaveResultRequestResult {
    messages: string;
}

// --------------------------------- < Save Results as CSV Request > ------------------------------------------
// save results in csv format
export namespace SaveResultsAsCsvRequest {
    export const type = new RequestType<
        SaveResultsAsCsvRequestParams,
        SaveResultRequestResult,
        void,
        void
    >("query/saveCsv");
}
// --------------------------------- </ Save Results as CSV Request > ------------------------------------------

// --------------------------------- < Save Results as JSON Request > ------------------------------------------
// save results in json format
export namespace SaveResultsAsJsonRequest {
    export const type = new RequestType<
        SaveResultsAsJsonRequestParams,
        SaveResultRequestResult,
        void,
        void
    >("query/saveJson");
}
// --------------------------------- </ Save Results as JSON Request > ------------------------------------------

// --------------------------------- < Save Results as Excel Request > ------------------------------------------
// save results in Excel format
export namespace SaveResultsAsExcelRequest {
    export const type = new RequestType<
        SaveResultsAsExcelRequestParams,
        SaveResultRequestResult,
        void,
        void
    >("query/saveExcel");
}
// --------------------------------- </ Save Results as Excel Request > ------------------------------------------

// --------------------------------- < Save Results as INSERT Request > ------------------------------------------
// save results in INSERT format
export namespace SaveResultsAsInsertRequest {
    export const type = new RequestType<
        SaveResultsAsInsertRequestParams,
        SaveResultRequestResult,
        void,
        void
    >("query/saveInsert");
}
// --------------------------------- </ Save Results as INSERT Request > ------------------------------------------
