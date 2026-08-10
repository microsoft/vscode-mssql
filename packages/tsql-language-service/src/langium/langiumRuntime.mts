/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** ESM bridge loaded synchronously by CommonJS consumers on the package's supported Node runtime. */
export { DocumentState, inject, URI } from "langium";
export type { AstNode, LangiumDocument, Module, TextDocument, URI as URIType } from "langium";
