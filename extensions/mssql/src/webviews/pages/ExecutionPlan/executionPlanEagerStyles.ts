/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The renderer stays JavaScript-lazy, but its small stylesheets are part of each host page's
// main bundle so rendering a plan never depends on a second stylesheet request.
import "../../index.css";
import "@xyflow/react/dist/style.css";
import "./reactFlowExecutionPlan.css";
