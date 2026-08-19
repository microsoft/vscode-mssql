/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Identifier quoting and insertion are owned by the semantic identifier module so that the name a
// feature writes is the name binding looks up. This file stays as the feature-facing entry point.
export {
    formatMultipartName,
    preserveIdentifierQuotes,
    quoteIdentifier,
    quoteIdentifierIfNeeded,
} from "../semantics/identifiers.js";
