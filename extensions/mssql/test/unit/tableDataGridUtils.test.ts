/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    clearRevertedCellChanges,
    enqueueTableExplorerCreateRow,
    hasPendingChangesForRow,
    isTableExplorerDataColumn,
    runBeforeTableExplorerSessionReplacement,
    snapshotCellChangesForRow,
    TableExplorerLifecycleMutex,
    TableExplorerRowMutationQueue,
    tryLockTableExplorerRow,
} from "../../src/webviews/pages/TableExplorer/tableDataGridUtils";

suite("tableDataGridUtils", () => {
    suite("isTableExplorerDataColumn", () => {
        test("returns true for data columns", () => {
            expect(isTableExplorerDataColumn({ originalIndex: 0 })).to.equal(true);
        });

        test("returns false for control columns", () => {
            expect(isTableExplorerDataColumn({ id: "_checkbox_selector" })).to.equal(false);
            expect(isTableExplorerDataColumn({ id: "undo" })).to.equal(false);
            expect(isTableExplorerDataColumn(undefined)).to.equal(false);
        });
    });

    suite("hasPendingChangesForRow", () => {
        test("returns true for a row with a pending cell edit", () => {
            const cellChanges = [{ rowId: 3 }, { rowId: 5 }];

            expect(hasPendingChangesForRow(5, cellChanges, new Set(), new Set())).to.equal(true);
        });

        test("returns true for a row pending deletion", () => {
            expect(hasPendingChangesForRow(5, [], new Set([5]), new Set())).to.equal(true);
        });

        test("returns true for a newly inserted row", () => {
            expect(hasPendingChangesForRow(5, [], new Set(), new Set([5]))).to.equal(true);
        });

        test("returns false for a row without pending changes", () => {
            expect(hasPendingChangesForRow(5, [{ rowId: 3 }], new Set([4]), new Set([6]))).to.equal(
                false,
            );
        });
    });

    suite("reverted cell change cleanup", () => {
        test("snapshots only changes for the reverted row", () => {
            const rowFiveChange = { rowId: 5 };
            const cellChanges = new Map([
                ["5-0", rowFiveChange],
                ["6-0", { rowId: 6 }],
            ]);

            expect([...snapshotCellChangesForRow(5, cellChanges)]).to.deep.equal([
                ["5-0", rowFiveChange],
            ]);
        });

        test("preserves changes made while the row revert is pending", () => {
            const originalFirstCellChange = { rowId: 5, newValue: "before" };
            const originalSecondCellChange = { rowId: 5, newValue: "unchanged" };
            const cellChanges = new Map([
                ["5-0", originalFirstCellChange],
                ["5-1", originalSecondCellChange],
            ]);
            const revertedCellChanges = snapshotCellChangesForRow(5, cellChanges);
            const laterFirstCellChange = { rowId: 5, newValue: "after" };
            const laterThirdCellChange = { rowId: 5, newValue: "new" };
            cellChanges.set("5-0", laterFirstCellChange);
            cellChanges.set("5-2", laterThirdCellChange);
            const failedCells = new Set(["5-0", "5-1", "5-2"]);

            clearRevertedCellChanges(cellChanges, revertedCellChanges, failedCells);

            expect(cellChanges.get("5-0")).to.equal(laterFirstCellChange);
            expect(cellChanges.has("5-1")).to.equal(false);
            expect(cellChanges.get("5-2")).to.equal(laterThirdCellChange);
            expect([...failedCells]).to.deep.equal(["5-0", "5-2"]);
        });
    });

    suite("row mutation lock", () => {
        test("prevents concurrent mutations until the row is unlocked", () => {
            const lockedRows = new Set<number>();

            expect(tryLockTableExplorerRow(5, lockedRows)).to.equal(true);
            expect(tryLockTableExplorerRow(5, lockedRows)).to.equal(false);

            lockedRows.delete(5);
            expect(tryLockTableExplorerRow(5, lockedRows)).to.equal(true);
        });
    });

    suite("TableExplorerRowMutationQueue", () => {
        test("serializes mutations for the same row", async () => {
            const queue = new TableExplorerRowMutationQueue();
            let completeFirstMutation: () => void;
            let secondMutationStarted = false;
            const firstMutation = queue.enqueue(
                5,
                () =>
                    new Promise<void>((resolve) => {
                        completeFirstMutation = resolve;
                    }),
            );
            const secondMutation = queue.enqueue(5, async () => {
                secondMutationStarted = true;
            });

            await Promise.resolve();
            expect(secondMutationStarted).to.equal(false);

            completeFirstMutation!();
            await firstMutation;
            await secondMutation;
            expect(secondMutationStarted).to.equal(true);
        });

        test("continues the row queue after a failed mutation", async () => {
            const queue = new TableExplorerRowMutationQueue();
            const expectedError = new Error("update failed");
            const firstMutation = queue.enqueue(5, async () => {
                throw expectedError;
            });
            let secondMutationStarted = false;
            const secondMutation = queue.enqueue(5, async () => {
                secondMutationStarted = true;
            });

            let caughtError: unknown;
            try {
                await firstMutation;
            } catch (error) {
                caughtError = error;
            }
            await secondMutation;

            expect(caughtError).to.equal(expectedError);
            expect(secondMutationStarted).to.equal(true);
        });

        test("drains pending mutations before continuing", async () => {
            const queue = new TableExplorerRowMutationQueue();
            let completeMutation: () => void;
            void queue.enqueue(
                5,
                () =>
                    new Promise<void>((resolve) => {
                        completeMutation = resolve;
                    }),
            );
            let drainCompleted = false;
            const drain = queue.drain().then(() => {
                drainCompleted = true;
            });

            await Promise.resolve();
            expect(drainCompleted).to.equal(false);

            completeMutation!();
            await drain;
            expect(drainCompleted).to.equal(true);
        });

        test("includes create-row operations in mutation drains", async () => {
            const queue = new TableExplorerRowMutationQueue();
            let completeCreateRow: () => void;
            const createRow = enqueueTableExplorerCreateRow(
                queue,
                false,
                () =>
                    new Promise<void>((resolve) => {
                        completeCreateRow = resolve;
                    }),
            );
            let drainCompleted = false;
            const drain = queue.drain().then(() => {
                drainCompleted = true;
            });

            await Promise.resolve();
            expect(drainCompleted).to.equal(false);

            completeCreateRow!();
            await createRow;
            await drain;
            expect(drainCompleted).to.equal(true);
        });

        test("drains all mutations before propagating a failure", async () => {
            const queue = new TableExplorerRowMutationQueue();
            const expectedError = new Error("update failed");
            void queue.enqueue(5, async () => {
                throw expectedError;
            });
            let secondMutationCompleted = false;
            void queue.enqueue(6, async () => {
                secondMutationCompleted = true;
            });

            let caughtError: unknown;
            try {
                await queue.drain();
            } catch (error) {
                caughtError = error;
            }

            expect(caughtError).to.equal(expectedError);
            expect(secondMutationCompleted).to.equal(true);
        });

        test("does not mask a same-row failure with a successful tail mutation", async () => {
            const queue = new TableExplorerRowMutationQueue();
            const expectedError = new Error("update failed");
            const failedMutation = queue.enqueue(5, async () => {
                throw expectedError;
            });
            const successfulMutation = queue.enqueue(5, async () => undefined);

            await failedMutation.catch(() => undefined);
            await successfulMutation;

            let caughtError: unknown;
            try {
                await queue.drain();
            } catch (error) {
                caughtError = error;
            }

            expect(caughtError).to.equal(expectedError);
            await queue.drain();
        });

        test("invalidates queued mutations from an earlier session", async () => {
            const queue = new TableExplorerRowMutationQueue();
            let completeFirstMutation: () => void;
            const firstMutation = queue.enqueue(
                5,
                () =>
                    new Promise<void>((resolve) => {
                        completeFirstMutation = resolve;
                    }),
            );
            let staleMutationStarted = false;
            const staleMutation = queue.enqueue(5, async () => {
                staleMutationStarted = true;
            });

            await Promise.resolve();
            queue.invalidate();
            completeFirstMutation!();
            await firstMutation;
            await staleMutation;

            expect(staleMutationStarted).to.equal(false);
        });

        test("blocks and drains mutations before replacing the session", async () => {
            const queue = new TableExplorerRowMutationQueue();
            const events: string[] = [];
            let completeMutation: () => void;
            void queue.enqueue(
                5,
                () =>
                    new Promise<void>((resolve) => {
                        events.push("mutation");
                        completeMutation = resolve;
                    }),
            );

            const replacement = runBeforeTableExplorerSessionReplacement(
                queue,
                (blocked) => events.push(`blocked:${blocked}`),
                async () => {
                    events.push("replacement");
                },
            );

            await Promise.resolve();
            expect(events).to.deep.equal(["blocked:true", "mutation"]);

            completeMutation!();
            await replacement;

            expect(events).to.deep.equal([
                "blocked:true",
                "mutation",
                "replacement",
                "blocked:false",
            ]);
        });
    });

    suite("TableExplorerLifecycleMutex", () => {
        test("serializes save and session replacement operations", async () => {
            const mutex = new TableExplorerLifecycleMutex();
            const events: string[] = [];
            let completeSave: () => void;
            const save = mutex.runExclusive(() =>
                new Promise<void>((resolve) => {
                    events.push("save:start");
                    completeSave = resolve;
                }).then(() => {
                    events.push("save:end");
                }),
            );
            const replacement = mutex.runExclusive(async () => {
                events.push("replacement");
            });

            await Promise.resolve();
            expect(events).to.deep.equal(["save:start"]);

            completeSave!();
            await save;
            await replacement;

            expect(events).to.deep.equal(["save:start", "save:end", "replacement"]);
        });
    });
});
