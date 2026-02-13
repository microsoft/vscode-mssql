/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

const entryMode = process.env.MSSQL_EXTENSION_ENTRY;
const extensionModulePath = entryMode === "out" ? "./out/src/extension" : "./dist/extension";

module.exports = require(extensionModulePath);
