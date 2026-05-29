/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ResultBetaGrid from "./resultBetaGrid";
import { QueryResultsGridView } from "./queryResultsGridView";

export const QueryResultsBetaGridView = () => {
    return <QueryResultsGridView GridComponent={ResultBetaGrid} />;
};
