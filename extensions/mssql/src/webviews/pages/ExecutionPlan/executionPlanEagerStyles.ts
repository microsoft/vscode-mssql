/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Both renderers remain JavaScript-lazy, but their small stylesheets are part of each host page's
// main bundle so switching renderers never depends on a second stylesheet request.
import "../../index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "@xyflow/react/dist/style.css";
import "./reactFlowExecutionPlan.css";
