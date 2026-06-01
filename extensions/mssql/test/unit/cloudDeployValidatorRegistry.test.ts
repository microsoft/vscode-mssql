/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy validator registry surface:
 *   * `defineRegistry` freezes the result and preserves entries by type.
 *   * `createDefaultRegistry` returns a frozen registry with every
 *     `ValidationType` arm wired (placeholder validators in commit 1; real
 *     ones in commits 2-5).
 *   * Lookup-by-`ValidationType` returns the validator that declared that type.
 */

import { expect } from "chai";

import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { createDefaultRegistry, defineRegistry, Validator } from "../../src/cloudDeploy/validation";

import { FakeValidator, makeFakeRegistry } from "./cloudDeployValidationTestHelpers";

const ALL_TYPES: readonly ValidationType[] = [
    ValidationType.Connectivity,
    ValidationType.StaticAnalysis,
    ValidationType.UnitTests,
    ValidationType.WorkloadPlayback,
];

suite("CloudDeploy Validator Registry", () => {
    suite("defineRegistry", () => {
        test("returns a frozen object", () => {
            const { registry } = makeFakeRegistry();
            expect(Object.isFrozen(registry)).to.equal(true);
        });

        test("preserves the validator passed for each ValidationType arm", () => {
            const { registry, connectivity, staticAnalysis, unitTests, workloadPlayback } =
                makeFakeRegistry();

            expect(registry[ValidationType.Connectivity]).to.equal(connectivity);
            expect(registry[ValidationType.StaticAnalysis]).to.equal(staticAnalysis);
            expect(registry[ValidationType.UnitTests]).to.equal(unitTests);
            expect(registry[ValidationType.WorkloadPlayback]).to.equal(workloadPlayback);
        });

        test("each entry's validator.type matches its registry key", () => {
            const { registry } = makeFakeRegistry();
            for (const type of ALL_TYPES) {
                const v: Validator = registry[type];
                expect(v.type).to.equal(type);
            }
        });

        test("supports substituting one arm without disturbing the others", () => {
            const original = makeFakeRegistry();
            const replacement = new FakeValidator(ValidationType.StaticAnalysis);
            const swapped = defineRegistry({
                [ValidationType.Connectivity]: original.connectivity,
                [ValidationType.StaticAnalysis]: replacement,
                [ValidationType.UnitTests]: original.unitTests,
                [ValidationType.WorkloadPlayback]: original.workloadPlayback,
            });

            expect(swapped[ValidationType.StaticAnalysis]).to.equal(replacement);
            expect(swapped[ValidationType.Connectivity]).to.equal(original.connectivity);
        });
    });

    suite("createDefaultRegistry", () => {
        test("returns a frozen registry", () => {
            const registry = createDefaultRegistry();
            expect(Object.isFrozen(registry)).to.equal(true);
        });

        test("populates every ValidationType arm with a validator whose type matches", () => {
            const registry = createDefaultRegistry();
            for (const type of ALL_TYPES) {
                expect(registry[type]).to.not.equal(undefined);
                expect(registry[type].type).to.equal(type);
            }
        });

        test("placeholder validators throw on run() so accidental invocation is loud", () => {
            const registry = createDefaultRegistry();
            for (const type of ALL_TYPES) {
                expect(() =>
                    (
                        registry[type] as unknown as {
                            run: () => unknown;
                        }
                    ).run(),
                )
                    .to.throw(Error)
                    .with.property("message")
                    .that.matches(/not wired yet/);
            }
        });
    });
});
