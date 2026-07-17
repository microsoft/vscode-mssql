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
import { SpatialBasemap as Loc } from "../../constants/locConstants";

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

/**
 * Deterministic tile-cache root under global storage. Exposed apart from the
 * host singleton because webview panels restored at startup construct BEFORE
 * activation initializes the host, and localResourceRoots are fixed at
 * construction — a root omitted there turns every tile request into a 401.
 */
export function spatialBasemapCacheRoot(context: { globalStorageUri: vscode.Uri }): vscode.Uri {
    return vscode.Uri.file(path.join(context.globalStorageUri.fsPath, "spatial-basemap-cache"));
}

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
    const cacheRoot = spatialBasemapCacheRoot(context);
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
            const add = Loc.addOpenStreetMap;
            const never = Loc.dontAskAgain;
            const choice = await vscode.window.showInformationMessage(
                Loc.setupOfferMessage,
                add,
                never,
            );
            return choice === add ? "add" : choice === never ? "never" : "dismiss";
        },
        confirm: () => void vscode.window.showInformationMessage(Loc.setupConfirmation),
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
            const enable = Loc.enable;
            const viewTerms = Loc.viewProviderTerms;
            const actions = source.config.attribution.termsUrl ? [enable, viewTerms] : [enable];
            for (;;) {
                const choice = await vscode.window.showWarningMessage(
                    Loc.consentPrompt(source.config.displayName, source.config.attribution.text),
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
            void vscode.window.showInformationMessage(Loc.tileCacheCleared);
        }),
        vscode.commands.registerCommand("mssql.spatialBasemap.clearConsent", async () => {
            await consent.clearAll();
            void vscode.window.showInformationMessage(Loc.consentCleared);
        }),
    );
    // Startup hygiene: prune expired/oversized tiles without blocking activation.
    setTimeout(() => void cache.evict(), 5_000);
}

/** Undefined until activation wires it (tests build their own deps instead). */
export function spatialBasemapHost(): SpatialBasemapHost | undefined {
    return host;
}
