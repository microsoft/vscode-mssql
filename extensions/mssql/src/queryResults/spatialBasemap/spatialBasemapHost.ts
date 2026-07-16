/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extension-level basemap host (SPA-10): one consent store, one tile cache
 * under `globalStorageUri/spatial-basemap-cache` (the ONLY directory Query
 * Studio webviews gain as an extra local resource root), the user-level
 * source registry read fresh per call, the consent modal, SecretStorage
 * access, and the clear-cache/clear-consent commands. Per-panel session
 * managers borrow these; they never own them.
 */

import * as path from "path";
import * as vscode from "vscode";
import { randomBytes } from "crypto";
import {
    SPATIAL_BASEMAP_LIMITS,
    SpatialBasemapFetcherDeps,
    SpatialBasemapValidatedSource,
} from "./spatialBasemapTypes";
import { validateSpatialBasemapSources } from "./spatialBasemapConfig";
import {
    SpatialBasemapConsentStore,
    createSpatialBasemapConsentStore,
} from "./spatialBasemapConsent";
import { SpatialBasemapTileCache } from "./spatialBasemapTileCache";
import { createSpatialBasemapSetupOffer } from "./spatialBasemapOnboarding";
import { dns } from "./spatialBasemapNode";

export interface SpatialBasemapHost {
    readonly cacheRoot: vscode.Uri;
    readonly consent: SpatialBasemapConsentStore;
    readonly cache: SpatialBasemapTileCache;
    readonly fetcher: SpatialBasemapFetcherDeps;
    sources(): readonly SpatialBasemapValidatedSource[];
    confirm(source: SpatialBasemapValidatedSource): Promise<boolean>;
    secretFor(credentialRef: string): Promise<string | undefined>;
    isTrusted(): boolean;
    /** First-spatial-view setup offer (one-click OpenStreetMap); once per session. */
    maybeOfferSetup(): Promise<void>;
}

let host: SpatialBasemapHost | undefined;

const HMAC_KEY_STATE = "mssql.spatialBasemap.cacheKey.v1";

function cacheBudgets(): { maxDiskBytes: number; maxAgeMs: number } {
    const config = vscode.workspace.getConfiguration();
    const maxMb =
        config.get<number>("mssql.queryStudio.spatial.basemap.cache.maxMb") ??
        SPATIAL_BASEMAP_LIMITS.cacheMaxMbDefault;
    const maxAgeDays =
        config.get<number>("mssql.queryStudio.spatial.basemap.cache.maxAgeDays") ??
        SPATIAL_BASEMAP_LIMITS.cacheMaxAgeDaysDefault;
    return {
        maxDiskBytes: Math.max(16, Math.min(1024, maxMb)) * 1024 * 1024,
        maxAgeMs: Math.max(1, Math.min(365, maxAgeDays)) * 24 * 60 * 60 * 1000,
    };
}

export function initializeSpatialBasemapHost(context: vscode.ExtensionContext): void {
    if (host) {
        return;
    }
    try {
        initialize(context);
    } catch {
        // Partial contexts (unit-test mocks, restricted hosts) leave the
        // feature unavailable rather than failing activation.
        host = undefined;
    }
}

function initialize(context: vscode.ExtensionContext): void {
    let hmacKey = context.globalState.get<string>(HMAC_KEY_STATE);
    if (!hmacKey) {
        hmacKey = randomBytes(32).toString("hex");
        void context.globalState.update(HMAC_KEY_STATE, hmacKey);
    }
    const cacheRoot = vscode.Uri.file(
        path.join(context.globalStorageUri.fsPath, "spatial-basemap-cache"),
    );
    const consent = createSpatialBasemapConsentStore(context.globalState);
    const budgets = cacheBudgets();
    const cache = new SpatialBasemapTileCache({
        root: cacheRoot.fsPath,
        hmacKey,
        maxDiskBytes: budgets.maxDiskBytes,
        maxAgeMs: budgets.maxAgeMs,
    });
    void vscode.workspace.fs.createDirectory(cacheRoot);
    const setupOffer = createSpatialBasemapSetupOffer({
        memento: context.globalState,
        isEnabled: () =>
            vscode.workspace
                .getConfiguration()
                .get<boolean>("mssql.queryStudio.spatial.basemap.enabled") === true,
        globalSources: () =>
            vscode.workspace.getConfiguration().inspect("mssql.queryStudio.spatial.basemap.sources")
                ?.globalValue ?? [],
        updateSettings: async (sources) => {
            const config = vscode.workspace.getConfiguration();
            // Sources land first so enabling never races an empty layer list.
            await config.update(
                "mssql.queryStudio.spatial.basemap.sources",
                sources,
                vscode.ConfigurationTarget.Global,
            );
            await config.update(
                "mssql.queryStudio.spatial.basemap.enabled",
                true,
                vscode.ConfigurationTarget.Global,
            );
        },
        prompt: async () => {
            const add = vscode.l10n.t("Add OpenStreetMap");
            const never = vscode.l10n.t("Don't Ask Again");
            const choice = await vscode.window.showInformationMessage(
                vscode.l10n.t(
                    "Spatial results can draw your data over a world map. Add OpenStreetMap as a map layer? The tile provider receives only the tile coordinates of the area you view — never your query results.",
                ),
                add,
                never,
            );
            return choice === add ? "add" : choice === never ? "never" : "dismiss";
        },
        confirm: () =>
            void vscode.window.showInformationMessage(
                vscode.l10n.t(
                    "OpenStreetMap added. Pick it from the Layers dropdown in the spatial results pane.",
                ),
            ),
        recordConsent: (fingerprint) => consent.record(fingerprint),
    });
    host = {
        cacheRoot,
        consent,
        cache,
        fetcher: {
            fetch: (url, init) => fetch(url, init),
            lookup: async (hostname) =>
                (await dns.lookup(hostname, { all: true })).map((entry) => entry.address),
        },
        sources: () => {
            // Application scope is enforced by the settings schema; reading the
            // effective value and re-validating keeps a hostile workspace from
            // smuggling a source even if scoping regressed (addendum §5.1).
            const raw = vscode.workspace
                .getConfiguration()
                .inspect("mssql.queryStudio.spatial.basemap.sources");
            return validateSpatialBasemapSources(raw?.globalValue ?? []).sources;
        },
        confirm: async (source) => {
            const enable = vscode.l10n.t("Enable");
            const viewTerms = vscode.l10n.t("View provider terms");
            const actions = source.config.attribution.termsUrl ? [enable, viewTerms] : [enable];
            for (;;) {
                const choice = await vscode.window.showWarningMessage(
                    vscode.l10n.t(
                        'Enable online map layer "{0}"? The provider ({1}) will receive tile coordinates that reveal the approximate area you view. Query results, labels, SQL text, and credentials are not sent as map data.',
                        source.config.displayName,
                        source.config.attribution.text,
                    ),
                    { modal: true },
                    ...actions,
                );
                if (choice === viewTerms && source.config.attribution.termsUrl) {
                    await vscode.env.openExternal(
                        vscode.Uri.parse(source.config.attribution.termsUrl),
                    );
                    continue;
                }
                return choice === enable;
            }
        },
        secretFor: (credentialRef) =>
            Promise.resolve(context.secrets.get(`mssql.spatialBasemap.${credentialRef}`)),
        isTrusted: () => vscode.workspace.isTrusted,
        maybeOfferSetup: async () => {
            await setupOffer.maybeOffer();
        },
    };

    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.spatialBasemap.clearCache", async () => {
            await cache.clearAll();
            void vscode.window.showInformationMessage(
                vscode.l10n.t("Spatial map tile cache cleared."),
            );
        }),
        vscode.commands.registerCommand("mssql.spatialBasemap.clearConsent", async () => {
            await consent.clearAll();
            void vscode.window.showInformationMessage(
                vscode.l10n.t(
                    "Spatial map layer consent cleared. Online layers will ask again before their next use.",
                ),
            );
        }),
    );
    // Startup hygiene: prune expired/oversized tiles without blocking activation.
    setTimeout(() => void cache.evict(), 5_000);
}

/** Undefined until activation wires it (tests build their own deps instead). */
export function spatialBasemapHost(): SpatialBasemapHost | undefined {
    return host;
}
