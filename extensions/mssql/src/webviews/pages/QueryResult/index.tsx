/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./queryResultEagerStyles";
import { renderQueryResult } from "./queryResultEntrypoint";
import { QueryResultsGridView } from "./queryResultsGridView";
import ResultGrid from "./resultGrid";

const QueryResultLegacyGridView = () => <QueryResultsGridView GridComponent={ResultGrid} />;

renderQueryResult(QueryResultLegacyGridView, false);
