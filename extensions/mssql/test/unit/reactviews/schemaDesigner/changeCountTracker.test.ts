/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { SchemaDesigner } from "../../../../src/sharedInterfaces/schemaDesigner";
import {
    ChangeCountTracker,
    getChangeCountTracker,
    resetChangeCountTracker,
} from "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/changeCountTracker";

suite("ChangeCountTracker", () => {
    let tracker: ChangeCountTracker;

    setup(() => {
        // Reset singleton and create fresh instance for each test
        resetChangeCountTracker();
        tracker = new ChangeCountTracker();
    });

    suite("getCounts", () => {
        test("should return zero counts initially", () => {
            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 0);
            assert.strictEqual(counts.modifications, 0);
            assert.strictEqual(counts.deletions, 0);
            assert.strictEqual(counts.total, 0);
        });

        test("should calculate total correctly", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Modification);
            tracker.increment(SchemaDesigner.SchemaChangeType.Deletion);

            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 2);
            assert.strictEqual(counts.modifications, 1);
            assert.strictEqual(counts.deletions, 1);
            assert.strictEqual(counts.total, 4);
        });
    });

    suite("increment", () => {
        test("should increment addition count", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 1);
            assert.strictEqual(counts.total, 1);
        });

        test("should increment modification count", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Modification);
            const counts = tracker.getCounts();
            assert.strictEqual(counts.modifications, 1);
            assert.strictEqual(counts.total, 1);
        });

        test("should increment deletion count", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Deletion);
            const counts = tracker.getCounts();
            assert.strictEqual(counts.deletions, 1);
            assert.strictEqual(counts.total, 1);
        });

        test("should handle multiple increments", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);

            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 3);
        });
    });

    suite("decrement", () => {
        test("should decrement addition count", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.decrement(SchemaDesigner.SchemaChangeType.Addition);

            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 1);
        });

        test("should not go below zero", () => {
            tracker.decrement(SchemaDesigner.SchemaChangeType.Addition);
            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 0);
        });

        test("should decrement modification count", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Modification);
            tracker.decrement(SchemaDesigner.SchemaChangeType.Modification);

            const counts = tracker.getCounts();
            assert.strictEqual(counts.modifications, 0);
        });

        test("should decrement deletion count", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Deletion);
            tracker.increment(SchemaDesigner.SchemaChangeType.Deletion);
            tracker.decrement(SchemaDesigner.SchemaChangeType.Deletion);

            const counts = tracker.getCounts();
            assert.strictEqual(counts.deletions, 1);
        });
    });

    suite("reset", () => {
        test("should reset all counts to zero", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Modification);
            tracker.increment(SchemaDesigner.SchemaChangeType.Deletion);

            tracker.reset();

            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 0);
            assert.strictEqual(counts.modifications, 0);
            assert.strictEqual(counts.deletions, 0);
            assert.strictEqual(counts.total, 0);
        });
    });

    suite("setFromSummary", () => {
        test("should set counts from summary object", () => {
            const summary: SchemaDesigner.ChangeCountSummary = {
                additions: 5,
                modifications: 3,
                deletions: 2,
                total: 10,
            };

            tracker.setFromSummary(summary);

            const counts = tracker.getCounts();
            assert.strictEqual(counts.additions, 5);
            assert.strictEqual(counts.modifications, 3);
            assert.strictEqual(counts.deletions, 2);
            assert.strictEqual(counts.total, 10);
        });
    });

    suite("subscribe", () => {
        test("should notify subscribers on increment", (done) => {
            let callCount = 0;
            const unsubscribe = tracker.subscribe((counts) => {
                callCount++;
                // First call is immediate with initial state
                if (callCount === 1) {
                    assert.strictEqual(counts.total, 0);
                } else if (callCount === 2) {
                    assert.strictEqual(counts.additions, 1);
                    assert.strictEqual(counts.total, 1);
                    unsubscribe();
                    done();
                }
            });

            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
        });

        test("should notify subscribers on decrement", (done) => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);

            let callCount = 0;
            const unsubscribe = tracker.subscribe((counts) => {
                callCount++;
                if (callCount === 1) {
                    // Initial notification
                    assert.strictEqual(counts.additions, 2);
                } else if (callCount === 2) {
                    assert.strictEqual(counts.additions, 1);
                    unsubscribe();
                    done();
                }
            });

            tracker.decrement(SchemaDesigner.SchemaChangeType.Addition);
        });

        test("should notify subscribers on reset", (done) => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);

            let callCount = 0;
            const unsubscribe = tracker.subscribe((counts) => {
                callCount++;
                if (callCount === 2) {
                    assert.strictEqual(counts.total, 0);
                    unsubscribe();
                    done();
                }
            });

            tracker.reset();
        });

        test("should call subscriber immediately with current state", () => {
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Modification);

            let receivedCounts: SchemaDesigner.ChangeCountSummary | undefined = undefined;
            const unsubscribe = tracker.subscribe((counts) => {
                receivedCounts = counts;
            });

            assert.notStrictEqual(receivedCounts, undefined);
            assert.strictEqual(receivedCounts!.additions, 1);
            assert.strictEqual(receivedCounts!.modifications, 1);

            unsubscribe();
        });

        test("should stop notifying after unsubscribe", () => {
            let callCount = 0;
            const unsubscribe = tracker.subscribe(() => {
                callCount++;
            });

            // Initial call
            assert.strictEqual(callCount, 1);

            unsubscribe();

            // These should not trigger notifications
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);
            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);

            assert.strictEqual(callCount, 1);
        });

        test("should support multiple subscribers", () => {
            let subscriber1Calls = 0;
            let subscriber2Calls = 0;

            const unsub1 = tracker.subscribe(() => {
                subscriber1Calls++;
            });
            const unsub2 = tracker.subscribe(() => {
                subscriber2Calls++;
            });

            tracker.increment(SchemaDesigner.SchemaChangeType.Addition);

            // Each subscriber gets initial call + increment notification
            assert.strictEqual(subscriber1Calls, 2);
            assert.strictEqual(subscriber2Calls, 2);

            unsub1();
            unsub2();
        });
    });

    suite("singleton", () => {
        test("should return same instance from getChangeCountTracker", () => {
            const instance1 = getChangeCountTracker();
            const instance2 = getChangeCountTracker();
            assert.strictEqual(instance1, instance2);
        });

        test("should reset singleton with resetChangeCountTracker", () => {
            const instance1 = getChangeCountTracker();
            instance1.increment(SchemaDesigner.SchemaChangeType.Addition);

            resetChangeCountTracker();

            const instance2 = getChangeCountTracker();
            assert.notStrictEqual(instance1, instance2);
            assert.strictEqual(instance2.getCounts().total, 0);
        });
    });
});
