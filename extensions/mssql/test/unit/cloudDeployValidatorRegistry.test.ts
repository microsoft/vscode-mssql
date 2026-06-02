/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for the Cloud Deploy validator registry surface:
 *   * `defineRegistry` freezes the result and preserves entries by type.
 *   * `createDefaultRegistry` returns a frozen registry with every
 *     `ValidationType` arm wired. Connectivity uses the real
 *     `ConnectivityValidator` from commit 2; the remaining three arms
 *     (static analysis, unit tests, workload playback) are placeholders
 *     until commits 3-5 land.
 *   * Lookup-by-`ValidationType` returns the validator that declared that type.
 */

import { expect } from "chai";

import { ValidationType } from "../../src/cloudDeploy/environments/types";
import { createDefaultRegistry, defineRegistry, Validator } from "../../src/cloudDeploy/validation";
import { FakeConnectionProvider } from "../../src/cloudDeploy/validation/providers/connectionProvider";
import { FakeProcessProvider } from "../../src/cloudDeploy/validation/providers/processProvider";

import { FakeValidator, makeFakeRegistry } from "./cloudDeployValidationTestHelpers";

const PLACEHOLDER_TYPES: readonly ValidationType[] = [ValidationType.WorkloadPlayback];

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
        const providers = {
            connection: new FakeConnectionProvider(),
            process: new FakeProcessProvider(),
        };

        test("returns a frozen registry", () => {
            const registry = createDefaultRegistry(providers);
            expect(Object.isFrozen(registry)).to.equal(true);
        });

        test("populates every ValidationType arm with a validator whose type matches", () => {
            const registry = createDefaultRegistry(providers);
            for (const type of ALL_TYPES) {
                expect(registry[type]).to.not.equal(undefined);
                expect(registry[type].type).to.equal(type);
            }
        });

        test("connectivity arm is wired to the real ConnectivityValidator (not a placeholder)", () => {
            const registry = createDefaultRegistry(providers);
            expect(registry[ValidationType.Connectivity].constructor.name).to.equal(
                "ConnectivityValidator",
            );
        });

        test("static-analysis arm is wired to the real StaticAnalysisValidator (not a placeholder)", () => {
            const registry = createDefaultRegistry(providers);
            expect(registry[ValidationType.StaticAnalysis].constructor.name).to.equal(
                "StaticAnalysisValidator",
            );
        });

        test("unit-tests arm is wired to the real UnitTestsValidator (not a placeholder)", () => {
            const registry = createDefaultRegistry(providers);
            expect(registry[ValidationType.UnitTests].constructor.name).to.equal(
                "UnitTestsValidator",
            );
        });

        test("placeholder arms still throw on run() so accidental invocation is loud", () => {
            const registry = createDefaultRegistry(providers);
            for (const type of PLACEHOLDER_TYPES) {
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
