/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LanguageFeatureRouter (design 05 §9): per-feature engine selection with a
 * capability/maturity gate, a circuit breaker (a native feature that throws
 * or times out repeatedly falls back to the bridge for the rest of the
 * document/session), and a routing span per request
 * (queryStudio.languageService.route — feature/engine/outcome, never text).
 *
 * host/** may import the diagnostics substrate; the engines it routes stay
 * pure behind SqlLanguageFeatureEngine.
 */

import { diag } from "../../diagnostics/diagnosticsCore";
import {
    FeatureMaturity,
    NativeCapabilityTable,
    SqlLanguageFeature,
    SqlLanguageFeatureEngine,
} from "../api";

export type LanguageEnginePreference = "sqlToolsService" | "nativeTypeScript";

const MATURITY_ORDER: readonly FeatureMaturity[] = [
    "off",
    "experimental",
    "preview",
    "defaultCandidate",
    "default",
];

function maturityAtLeast(actual: FeatureMaturity, threshold: FeatureMaturity): boolean {
    return MATURITY_ORDER.indexOf(actual) >= MATURITY_ORDER.indexOf(threshold);
}

/**
 * Default capability table. LS-0 shipped structure features; B9/LS-1
 * promoted completion to preview; B10/LS-2 promoted diagnostics to preview;
 * B11/LS-3 promoted hover + signatureHelp to preview (all served natively
 * only under the nativeTypeScript preference).
 */
export const LS0_NATIVE_CAPABILITIES: NativeCapabilityTable = {
    completion: "preview",
    hover: "preview",
    signatureHelp: "preview",
    diagnostics: "preview",
    definition: "off",
    folding: "preview",
    documentSymbols: "preview",
    highlights: "off",
    semanticTokens: "off",
};

export interface RouterStatusEntry {
    readonly feature: SqlLanguageFeature;
    readonly maturity: FeatureMaturity;
    readonly effectiveEngine: "nativeTypeScript" | "sqlToolsServiceBridge" | "none";
    readonly circuitBroken: boolean;
    readonly nativeFailures: number;
}

export interface LanguageFeatureRouterOptions {
    readonly native: SqlLanguageFeatureEngine;
    /** Absent until the bridge is constructed (lazily, on first bridge route). */
    readonly getBridge: () => SqlLanguageFeatureEngine | undefined;
    readonly getPreference: () => LanguageEnginePreference;
    readonly capabilities?: NativeCapabilityTable;
    /** Native serves a feature when its maturity is at least this. */
    readonly rolloutThreshold?: FeatureMaturity;
    readonly nativeTimeoutMs?: number;
    /** Consecutive native failures before the circuit opens. */
    readonly breakAfterFailures?: number;
}

export class LanguageFeatureRouter {
    private readonly options: LanguageFeatureRouterOptions;
    private readonly capabilities: NativeCapabilityTable;
    private readonly failures = new Map<SqlLanguageFeature, number>();
    private readonly broken = new Set<SqlLanguageFeature>();

    constructor(options: LanguageFeatureRouterOptions) {
        this.options = options;
        this.capabilities = options.capabilities ?? LS0_NATIVE_CAPABILITIES;
    }

    /** The engine a feature request would use right now (status/telemetry). */
    effectiveEngine(
        feature: SqlLanguageFeature,
    ): "nativeTypeScript" | "sqlToolsServiceBridge" | "none" {
        if (this.nativeEligible(feature)) {
            return "nativeTypeScript";
        }
        if (this.bridgeEligible(feature)) {
            return "sqlToolsServiceBridge";
        }
        return "none";
    }

    private nativeEligible(feature: SqlLanguageFeature): boolean {
        if (this.broken.has(feature)) {
            return false;
        }
        const maturity = this.capabilities[feature];
        const threshold = this.options.rolloutThreshold ?? "preview";
        if (!maturityAtLeast(maturity, threshold)) {
            return false;
        }
        // Under the sqlToolsService preference, native still serves features
        // the bridge cannot provide at all (design §9.2 router rule) — the
        // bridge decides per feature by returning undefined; structure
        // features (folding/symbols) have no bridge path.
        if (this.options.getPreference() === "nativeTypeScript") {
            return true;
        }
        return feature === "folding" || feature === "documentSymbols";
    }

    private bridgeEligible(feature: SqlLanguageFeature): boolean {
        // The bridge serves the classic STS v1 feature set only.
        return (
            feature === "completion" ||
            feature === "hover" ||
            feature === "signatureHelp" ||
            feature === "definition" ||
            feature === "diagnostics"
        );
    }

    /**
     * Route one request. Returns undefined when no engine serves the feature
     * (callers surface an empty result to Monaco).
     */
    async route<T>(
        feature: SqlLanguageFeature,
        invoke: (engine: SqlLanguageFeatureEngine) => Promise<T | undefined>,
    ): Promise<T | undefined> {
        const useNative = this.nativeEligible(feature);
        const engineId = useNative ? "nativeTypeScript" : "sqlToolsServiceBridge";
        const span = diag.startSpan({
            feature: "queryStudio",
            kind: "span",
            type: "queryStudio.languageService.route",
            fields: {
                languageFeature: { raw: feature, cls: "diagnostic.metadata" },
                engine: { raw: engineId, cls: "diagnostic.metadata" },
            },
        });
        try {
            if (useNative) {
                const result = await this.invokeNative(feature, invoke);
                if (result.timedOut || result.failed) {
                    span.end("warning", {
                        outcome: {
                            raw: result.timedOut ? "nativeTimeout" : "nativeError",
                            cls: "diagnostic.metadata",
                        },
                    });
                    return await this.routeToBridge(feature, invoke);
                }
                this.failures.set(feature, 0);
                span.end("ok", {
                    outcome: { raw: "native", cls: "diagnostic.metadata" },
                });
                return result.value;
            }
            const bridged = await this.routeToBridge(feature, invoke);
            span.end("ok", {
                outcome: {
                    raw: bridged === undefined ? "unserved" : "bridge",
                    cls: "diagnostic.metadata",
                },
            });
            return bridged;
        } catch (error) {
            span.fail(error);
            throw error;
        }
    }

    private async invokeNative<T>(
        feature: SqlLanguageFeature,
        invoke: (engine: SqlLanguageFeatureEngine) => Promise<T | undefined>,
    ): Promise<{ value?: T | undefined; failed?: boolean; timedOut?: boolean }> {
        const timeoutMs = this.options.nativeTimeoutMs ?? 5000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeout = new Promise<"timeout">((resolve) => {
                timer = setTimeout(() => resolve("timeout"), timeoutMs);
            });
            const nativeCall = invoke(this.options.native).then((value) => ({ value }));
            // A timed-out native call may still settle later; swallow its
            // rejection so the race loser never becomes an unhandled rejection.
            nativeCall.catch(() => undefined);
            const raced = await Promise.race([nativeCall, timeout]);
            if (raced === "timeout") {
                this.recordNativeFailure(feature);
                return { timedOut: true };
            }
            return raced;
        } catch {
            this.recordNativeFailure(feature);
            return { failed: true };
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }

    private recordNativeFailure(feature: SqlLanguageFeature): void {
        const count = (this.failures.get(feature) ?? 0) + 1;
        this.failures.set(feature, count);
        const breakAfter = this.options.breakAfterFailures ?? 2;
        if (count >= breakAfter) {
            this.broken.add(feature);
        }
    }

    private async routeToBridge<T>(
        feature: SqlLanguageFeature,
        invoke: (engine: SqlLanguageFeatureEngine) => Promise<T | undefined>,
    ): Promise<T | undefined> {
        if (!this.bridgeEligible(feature)) {
            return undefined;
        }
        const bridge = this.options.getBridge();
        if (bridge === undefined) {
            return undefined;
        }
        return invoke(bridge);
    }

    /** Reset circuit breakers (e.g. after an engine-preference change). */
    resetCircuits(): void {
        this.broken.clear();
        this.failures.clear();
    }

    status(): readonly RouterStatusEntry[] {
        const features = Object.keys(this.capabilities) as SqlLanguageFeature[];
        return features.map((feature) => ({
            feature,
            maturity: this.capabilities[feature],
            effectiveEngine: this.effectiveEngine(feature),
            circuitBroken: this.broken.has(feature),
            nativeFailures: this.failures.get(feature) ?? 0,
        }));
    }
}
