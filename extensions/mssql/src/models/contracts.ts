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

// --------------------------------- < Serialize Data Request > ------------------------------------------
// Serialize data to CSV, JSON, or Excel format using the backend serialization service

export class SerializeColumnInfo {
    /**
     * Name of this column
     */
    public name: string;

    /**
     * Data type name of this column
     */
    public dataTypeName: string;
}

export class SerializeDbCellValue {
    /**
     * Display value of the cell
     */
    public displayValue: string;

    /**
     * Whether the cell value is null
     */
    public isNull: boolean;
}

export class SerializeDataStartRequestParams {
    /**
     * The format to serialize the data to (csv, json, excel)
     */
    public saveFormat: string;

    /**
     * Path to file that the serialized results will be stored in
     */
    public filePath: string;

    /**
     * Results that are to be serialized
     */
    public rows: SerializeDbCellValue[][];

    /**
     * Column information for the data
     */
    public columns: SerializeColumnInfo[];

    /**
     * Whether this is the only batch (or last batch) for this file
     */
    public isLastBatch: boolean;

    /**
     * Whether to include column headers in the output
     */
    public includeHeaders?: boolean;

    /**
     * Delimiter for CSV format
     */
    public delimiter?: string;

    /**
     * Line separator for CSV format
     */
    public lineSeparator?: string;

    /**
     * Text identifier for CSV format
     */
    public textIdentifier?: string;

    /**
     * Encoding for the output file
     */
    public encoding?: string;

    /**
     * Whether to format JSON output
     */
    public formatted?: boolean;
}

export class SerializeDataResult {
    /**
     * Error or status messages
     */
    public messages: string;

    /**
     * Whether the serialization succeeded
     */
    public succeeded: boolean;
}

// Serialize data request to backend service
export namespace SerializeStartRequest {
    export const type = new RequestType<
        SerializeDataStartRequestParams,
        SerializeDataResult,
        void,
        void
    >("serialize/start");
}
// --------------------------------- </ Serialize Data Request > ------------------------------------------
