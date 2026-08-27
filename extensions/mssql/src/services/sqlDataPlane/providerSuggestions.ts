/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Capability-routed provider fallback (TSQ2 addendum §8.2, base design §8.3).
 * When the selected provider cannot open a profile (all missing capabilities
 * known BEFORE secrets), the shared policy decides:
 *
 *   prompt (default) — one actionable choice ("Open with <alternative>")
 *   auto             — route silently but VISIBLY (notification + diag)
 *   off              — surface the typed error
 *
 * Every fallback is attributable: nothing pretends (`session.info.backendKind`
 * carries the real provider). The interaction port keeps this module free of
 * vscode so the decision matrix is unit-testable.
 */

import { CapabilityCheck } from "./api";
import { SqlBackendKind } from "./backendFactory";

export type CapabilityFallbackPolicy = "prompt" | "auto" | "off";

export const CAPABILITY_FALLBACK_SETTING = "mssql.sqlDataPlane.capabilityFallback";

/** vscode-free interaction port (window.* in production, recorder in tests). */
export interface FallbackInteraction {
    /** Returns the chosen action label or undefined (dismissed). */
    prompt(message: string, actions: readonly string[]): Promise<string | undefined>;
    notify(message: string): void;
}

export interface FallbackDecision {
    kind: "useAlternative" | "abort";
    alternative?: SqlBackendKind;
    /** True when the route happened without a user choice (policy auto). */
    automatic?: boolean;
}

export function describeMissingCapabilities(check: CapabilityCheck): string {
    const missing = check.missing?.join(", ") ?? "required capabilities";
    return missing;
}

/**
 * Standard suggestion body used by connect fallback AND feature gating UX
 * ("Native TypeScript can't render spatial results — switch to SQL Tools
 * Service to enable it").
 */
export function formatCapabilitySuggestion(
    what: string,
    currentDisplayName: string,
    alternativeDisplayName: string,
): string {
    return `${what} is not supported by ${currentDisplayName}. ${alternativeDisplayName} supports it.`;
}

export async function resolveCapabilityFallback(options: {
    check: CapabilityCheck;
    policy: CapabilityFallbackPolicy;
    currentKind: SqlBackendKind;
    displayNameFor: (kind: SqlBackendKind) => string;
    interaction: FallbackInteraction;
}): Promise<FallbackDecision> {
    const { check, policy, currentKind, displayNameFor, interaction } = options;
    const alternatives = (check.alternatives ?? []) as SqlBackendKind[];
    if (check.ok || alternatives.length === 0 || policy === "off") {
        return { kind: "abort" };
    }
    const alternative = alternatives[0];
    const currentName = displayNameFor(currentKind);
    const alternativeName = displayNameFor(alternative);
    const missing = describeMissingCapabilities(check);
    if (policy === "auto") {
        // Visible, never silent (TSQ2 §8.2): one notification names the
        // ACTUAL provider; diagnostics carry the same fact via backendKind.
        interaction.notify(
            `This connection requires ${missing}, which ${currentName} does not support. ` +
                `Connected with ${alternativeName} instead.`,
        );
        return { kind: "useAlternative", alternative, automatic: true };
    }
    const action = `Open with ${alternativeName}`;
    const choice = await interaction.prompt(
        `This connection requires ${missing}, which ${currentName} does not support.`,
        [action],
    );
    if (choice === action) {
        return { kind: "useAlternative", alternative };
    }
    return { kind: "abort" };
}
