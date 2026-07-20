/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type webviewEntryPoints from "../../scripts/webview-entry-points.json";

export type WebviewBundleName = keyof typeof webviewEntryPoints;
