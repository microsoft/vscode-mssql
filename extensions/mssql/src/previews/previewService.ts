/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

/**
 * String enum of all preview feature names.
 * Each value is used as the config key suffix in `mssql.preview.<value>`,
 * allowing per-feature overrides of the global `mssql.enableExperimentalFeatures` flag.
 */
export enum PreviewFeature {
    UseVscodeAccountsForEntraID = "useVscodeAccountsForEntraID",
}

export class PreviewFeaturesService {
    private static _instance: PreviewFeaturesService;

    private constructor() {}

    public static getInstance(): PreviewFeaturesService {
        if (!PreviewFeaturesService._instance) {
            PreviewFeaturesService._instance = new PreviewFeaturesService();
        }
        return PreviewFeaturesService._instance;
    }

    /**
     * Returns whether a preview feature is enabled.
     *
     * Checks `mssql.preview.<feature>` first. If that setting is explicitly set
     * (true or false) it takes precedence. Otherwise falls back to the global
     * `mssql.enableExperimentalFeatures` flag.
     */
    public isFeatureEnabled(feature: PreviewFeature): boolean {
        const subFlag = vscode.workspace
            .getConfiguration("mssql")
            .get<boolean>(`preview.${feature}`);

        if (subFlag !== undefined) {
            return subFlag;
        }
        return this.experimentalFeaturesEnabled;
    }

    /**
     * Returns whether the global experimental features flag is enabled,
     * ignoring per-feature overrides.
     */
    public get experimentalFeaturesEnabled(): boolean {
        return (
            vscode.workspace.getConfiguration("mssql").get<boolean>("enableExperimentalFeatures") ??
            false
        );
    }

    /**
     * Returns per-feature overrides that differ from the global flag.
     * Only features with an explicit `mssql.preview.<feature>` value that
     * differs from `experimentalFeaturesEnabled` are included.
     */
    public getNonDefaultOverrides(): Partial<Record<PreviewFeature, boolean>> {
        const globalEnabled = this.experimentalFeaturesEnabled;
        const config = vscode.workspace.getConfiguration("mssql");
        const overrides: Partial<Record<PreviewFeature, boolean>> = {};

        for (const feature of Object.values(PreviewFeature)) {
            const subFlag = config.get<boolean>(`preview.${feature}`);
            if (subFlag !== undefined && subFlag !== globalEnabled) {
                overrides[feature] = subFlag;
            }
        }

        return overrides;
    }
}

export const previewFeaturesService = PreviewFeaturesService.getInstance();
