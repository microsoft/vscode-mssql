/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TSQ2-9: capability-fallback decision matrix (addendum §8.2). Pins: prompt
 * asks and honors dismissal; auto routes visibly (notification, never
 * silent); off never switches; no alternatives always aborts; the suggestion
 * body is the shared feature-gating copy.
 */

import { expect } from "chai";
import { CapabilityCheck } from "../../src/services/sqlDataPlane/api";
import {
    FallbackInteraction,
    formatCapabilitySuggestion,
    resolveCapabilityFallback,
} from "../../src/services/sqlDataPlane/providerSuggestions";

const FAILED_CHECK: CapabilityCheck = {
    ok: false,
    missing: ["auth.integrated"],
    reason: "missing capabilities: auth.integrated",
    alternatives: ["sts2-local"],
};

class RecordingInteraction implements FallbackInteraction {
    prompts: { message: string; actions: readonly string[] }[] = [];
    notifications: string[] = [];
    promptAnswer: string | undefined;

    async prompt(message: string, actions: readonly string[]): Promise<string | undefined> {
        this.prompts.push({ message, actions });
        return this.promptAnswer;
    }

    notify(message: string): void {
        this.notifications.push(message);
    }
}

const NAMES: Record<string, string> = {
    "ts-native": "Native TypeScript (tedious)",
    "sts2-local": "SQL Tools Service (STS v2)",
};

function options(
    policy: "prompt" | "auto" | "off",
    interaction: RecordingInteraction,
    check: CapabilityCheck = FAILED_CHECK,
) {
    return {
        check,
        policy,
        currentKind: "ts-native" as const,
        displayNameFor: (kind: string) => NAMES[kind] ?? kind,
        interaction,
    };
}

suite("SQL Data Plane capability fallback (TSQ2-9)", () => {
    test("prompt: user accepts the alternative", async () => {
        const interaction = new RecordingInteraction();
        interaction.promptAnswer = "Open with SQL Tools Service (STS v2)";
        const decision = await resolveCapabilityFallback(options("prompt", interaction));
        expect(decision).to.deep.equal({
            kind: "useAlternative",
            alternative: "sts2-local",
        });
        expect(interaction.prompts[0].message).to.contain("auth.integrated");
        expect(interaction.prompts[0].message).to.contain("Native TypeScript");
        expect(interaction.notifications).to.deep.equal([]);
    });

    test("prompt: dismissal aborts (never switches behind the user's back)", async () => {
        const interaction = new RecordingInteraction();
        interaction.promptAnswer = undefined;
        const decision = await resolveCapabilityFallback(options("prompt", interaction));
        expect(decision.kind).to.equal("abort");
    });

    test("auto: routes with a visible notification naming the actual provider", async () => {
        const interaction = new RecordingInteraction();
        const decision = await resolveCapabilityFallback(options("auto", interaction));
        expect(decision).to.deep.equal({
            kind: "useAlternative",
            alternative: "sts2-local",
            automatic: true,
        });
        expect(interaction.prompts).to.deep.equal([]);
        expect(interaction.notifications.length).to.equal(1);
        expect(interaction.notifications[0]).to.contain("SQL Tools Service (STS v2)");
    });

    test("off: surfaces the typed error, never switches", async () => {
        const interaction = new RecordingInteraction();
        const decision = await resolveCapabilityFallback(options("off", interaction));
        expect(decision.kind).to.equal("abort");
        expect(interaction.prompts).to.deep.equal([]);
        expect(interaction.notifications).to.deep.equal([]);
    });

    test("no alternatives: aborts under every policy", async () => {
        const check: CapabilityCheck = { ok: false, missing: ["auth.integrated"] };
        for (const policy of ["prompt", "auto", "off"] as const) {
            const interaction = new RecordingInteraction();
            const decision = await resolveCapabilityFallback(options(policy, interaction, check));
            expect(decision.kind).to.equal("abort", policy);
        }
    });

    test("shared suggestion copy for feature gating UX", () => {
        expect(
            formatCapabilitySuggestion(
                "Spatial rendering",
                "Native TypeScript (tedious)",
                "SQL Tools Service (STS v2)",
            ),
        ).to.equal(
            "Spatial rendering is not supported by Native TypeScript (tedious). SQL Tools Service (STS v2) supports it.",
        );
    });
});
