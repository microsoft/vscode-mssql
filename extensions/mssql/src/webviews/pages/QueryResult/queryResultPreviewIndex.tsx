/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./queryResultEagerStyles";
import { lazy } from "react";
import { renderQueryResult } from "./queryResultEntrypoint";

const QueryResultFluentResultGridView = lazy(async () => {
    const module = await import("./queryResultFluentResultGrid");
    return { default: module.QueryResultFluentResultGridView };
});

renderQueryResult(QueryResultFluentResultGridView, true);
