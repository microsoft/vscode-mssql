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
    BetaResultsGrid = "betaResultsGrid",
    BetaObjectExplorerFilter = "betaObjectExplorerFilter",
    BetaExecutionPlan = "betaExecutionPlan",
}

/**
 * Refactor features that are still in private preview. Unlike the legacy
 * `PreviewFeature` overrides above, these are strict sub-flags: the global
 * `mssql.enableExperimentalFeatures` umbrella and every requested feature
 * setting must be enabled.
 */
export enum PrivatePreviewFeature {
    SqlDataPlane = "mssql.sqlDataPlane.enabled",
    MetadataCache = "mssql.metadataCache.enabled",
    DebugConsole = "mssql.debugConsole.enabled",
    SessionDiagnostics = "mssql.sessionDiag.enabled",
}

/**
 * Activation snapshots used by contributed UI. Configuration keys update
 * immediately, even for reload-required settings, so UI gates also require
 * these context keys to avoid exposing commands before their handlers exist.
 */
export enum PrivatePreviewContextKey {
    SqlDataPlaneActive = "mssql.privatePreview.sqlDataPlaneActive",
    MetadataCacheActive = "mssql.privatePreview.metadataCacheActive",
    DebugConsoleActive = "mssql.privatePreview.debugConsoleActive",
    SessionDiagnosticsActive = "mssql.privatePreview.sessionDiagnosticsActive",
}

export const CONFIG_PREVIEW_PREFIX = "mssql.preview.";

export function getPreviewConfigKey(feature: PreviewFeature): string {
    return `${CONFIG_PREVIEW_PREFIX}${feature}`;
}

/**
 * Returns whether the beta execution plan experience is enabled.
 *
 * This preview is intentionally independent from the global
 * `mssql.enableExperimentalFeatures` setting.
 */
export function isBetaExecutionPlanEnabled(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(getPreviewConfigKey(PreviewFeature.BetaExecutionPlan), false) ?? false
    );
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
            .getConfiguration()
            .get<boolean | undefined>(getPreviewConfigKey(feature));

        // eslint-disable-next-line no-restricted-syntax
        if (subFlag !== undefined && subFlag !== null) {
            // value may be null when read from configuration
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
     * Returns whether a private-preview feature path is enabled.
     *
     * Private-preview flags are hierarchical and never override the global
     * umbrella. Passing multiple settings expresses prerequisites, for example
     * metadata cache requires both SQL Data Plane and metadata cache flags.
     */
    public isPrivatePreviewEnabled(...requiredFeatures: PrivatePreviewFeature[]): boolean {
        return (
            this.experimentalFeaturesEnabled &&
            requiredFeatures.every(
                (feature) =>
                    vscode.workspace.getConfiguration().get<boolean>(feature, false) ?? false,
            )
        );
    }

    /**
     * Returns per-feature overrides that differ from the global flag.
     * Only features with an explicit `mssql.preview.<feature>` value that
     * differs from `experimentalFeaturesEnabled` are included.
     */
    public getNonDefaultOverrides(): Partial<Record<PreviewFeature, boolean>> {
        const globalEnabled = this.experimentalFeaturesEnabled;
        const overrides: Partial<Record<PreviewFeature, boolean>> = {};

        for (const feature of Object.values(PreviewFeature)) {
            const subFlag = this.isFeatureEnabled(feature);
            if (subFlag !== undefined && subFlag !== globalEnabled) {
                overrides[feature] = subFlag;
            }
        }

        return overrides;
    }
}

export const previewService = PreviewFeaturesService.getInstance();
