/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./queryResultEagerStyles";
import { renderQueryResult } from "./queryResultEntrypoint";
import { QueryResultFluentResultGridView } from "./queryResultFluentResultGrid";

renderQueryResult(QueryResultFluentResultGridView, true);
