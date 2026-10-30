/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { resolveAuthoritativeVectorTargetIndex } from "../../src/webviews/pages/QueryStudio/vectorSearchTargetSync";

const TARGETS = [{ id: "t-alpha" }, { id: "t-beta" }, { id: "t-gamma" }] as const;

suite("vectorSearchTargetSync", () => {
    suite("resolveAuthoritativeVectorTargetIndex", () => {
        test("ignores an absent prop, missing targets, and empty target lists", () => {
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: undefined,
                    lastEmittedTargetId: "t-alpha",
                    currentTargetId: "t-alpha",
                    targets: TARGETS,
                }),
            ).to.equal(undefined);
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: "t-beta",
                    lastEmittedTargetId: undefined,
                    currentTargetId: undefined,
                    targets: undefined,
                }),
            ).to.equal(undefined);
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: "t-beta",
                    lastEmittedTargetId: undefined,
                    currentTargetId: undefined,
                    targets: [],
                }),
            ).to.equal(undefined);
        });

        test("applies an external (Index-initiated) change to a known target", () => {
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: "t-gamma",
                    lastEmittedTargetId: "t-alpha",
                    currentTargetId: "t-alpha",
                    targets: TARGETS,
                }),
            ).to.equal(2);
        });

        test("ignores its own echo — the prop equals the last emission", () => {
            // Local pick of t-beta already emitted; the prop still carries it.
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: "t-beta",
                    lastEmittedTargetId: "t-beta",
                    currentTargetId: "t-beta",
                    targets: TARGETS,
                }),
            ).to.equal(undefined);
        });

        test("ignores a stale prop that lags a newer local pick", () => {
            // User picked t-gamma (emitted), prop still holds the OLD t-alpha
            // from before the round trip. Reverting here is the flicker bug.
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: "t-alpha",
                    lastEmittedTargetId: "t-alpha",
                    currentTargetId: "t-gamma",
                    targets: TARGETS,
                }),
            ).to.equal(undefined);
        });

        test("ignores ids that no longer map to a verified target", () => {
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: "t-dropped",
                    lastEmittedTargetId: "t-alpha",
                    currentTargetId: "t-alpha",
                    targets: TARGETS,
                }),
            ).to.equal(undefined);
        });

        test("ignores a change to the already-selected target", () => {
            expect(
                resolveAuthoritativeVectorTargetIndex({
                    authoritativeTargetId: "t-beta",
                    lastEmittedTargetId: "t-alpha",
                    currentTargetId: "t-beta",
                    targets: TARGETS,
                }),
            ).to.equal(undefined);
        });

        test("a local dropdown pick converges instead of leapfrogging", () => {
            // Simulate the commit sequence of a local pick under the OLD code
            // (no echo tracking) vs. the seam's rule. State: current target,
            // last emission, and the prop (parent state) round-tripping one
            // commit late. The regression this guards: sync effect reverts the
            // pick, persist re-emits the reverted value, forever.
            let current = "t-alpha";
            let lastEmitted = "t-alpha";
            let prop = "t-alpha";

            // Commit 1: user picks t-gamma. Sync runs BEFORE persist, prop is
            // still stale.
            current = "t-gamma";
            const commit1 = resolveAuthoritativeVectorTargetIndex({
                authoritativeTargetId: prop,
                lastEmittedTargetId: lastEmitted,
                currentTargetId: current,
                targets: TARGETS,
            });
            expect(commit1, "stale prop must not revert the pick").to.equal(undefined);
            lastEmitted = current; // persist effect emits t-gamma
            prop = lastEmitted; // parent round-trips it

            // Commit 2: prop now carries our own emission back.
            const commit2 = resolveAuthoritativeVectorTargetIndex({
                authoritativeTargetId: prop,
                lastEmittedTargetId: lastEmitted,
                currentTargetId: current,
                targets: TARGETS,
            });
            expect(commit2, "echo must be ignored — loop terminates").to.equal(undefined);

            // An Index-initiated change afterwards still applies.
            prop = "t-beta";
            const external = resolveAuthoritativeVectorTargetIndex({
                authoritativeTargetId: prop,
                lastEmittedTargetId: lastEmitted,
                currentTargetId: current,
                targets: TARGETS,
            });
            expect(external, "external change still applies").to.equal(1);
        });
    });
});
