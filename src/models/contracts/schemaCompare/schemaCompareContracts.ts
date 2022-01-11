/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { RequestType } from 'vscode-languageclient';
import * as mssql from 'vscode-mssql';

export namespace SchemaCompareGetDefaultOptionsRequest {
	export const type = new RequestType<mssql.SchemaCompareGetOptionsParams, mssql.SchemaCompareOptionsResult, void, void>('schemaCompare/getDefaultOptions');
}
