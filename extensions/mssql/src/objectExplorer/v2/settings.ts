/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** OE v2 settings (oe_view_design §5). Validated readers; never raw-trusted. */

import * as vscode from "vscode";

export type OeViewMode = "classic" | "v2Preview";

export function oeViewMode(): OeViewMode {
    const raw = vscode.workspace
        .getConfiguration()
        .get<string>("mssql.objectExplorer.viewMode", "classic");
    return raw === "v2Preview" ? "v2Preview" : "classic";
}

export interface OeV2Settings {
    readonly confirmLegacyHandoff: boolean;
    readonly tablePreviewRowLimit: number;
    readonly groupBySchema: boolean;
    readonly showSystemDatabases: boolean;
}

export function oeV2Settings(): OeV2Settings {
    const config = vscode.workspace.getConfiguration();
    const limitRaw = config.get<number>("mssql.objectExplorer.v2.tablePreviewRowLimit", 1000);
    const limit =
        Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 100_000 ? limitRaw : 1000;
    return {
        confirmLegacyHandoff:
            config.get<boolean>("mssql.objectExplorer.v2.confirmLegacyHandoff", true) === true,
        tablePreviewRowLimit: limit,
        groupBySchema: config.get<boolean>("mssql.objectExplorer.v2.groupBySchema", false) === true,
        showSystemDatabases:
            config.get<boolean>("mssql.objectExplorer.v2.showSystemDatabases", true) === true,
    };
}
