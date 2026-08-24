/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./queryResultEagerStyles";
import { lazy } from "react";
import { renderQueryResult } from "./queryResultEntrypoint";

const QueryResultLegacyGridView = lazy(async () => {
    const [{ QueryResultsGridView }, { default: ResultGrid }] = await Promise.all([
        import("./queryResultsGridView"),
        import("./resultGrid"),
    ]);

    return {
        default: () => <QueryResultsGridView GridComponent={ResultGrid} />,
    };
});

renderQueryResult(QueryResultLegacyGridView, false);
