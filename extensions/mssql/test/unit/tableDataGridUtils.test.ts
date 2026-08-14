/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    clearTableExplorerFilters,
    clearRevertedCellChanges,
    enqueueTableExplorerCreateRow,
    getTableExplorerFilterColumns,
    hasPendingChangesForRow,
    isTableExplorerDataColumn,
    runBeforeTableExplorerSessionReplacement,
    runSessionReplacementAndUpdate,
    snapshotCellChangesForRow,
    submitTableExplorerRowCountReload,
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

        test("preserves a failed cell update through repeated drains until corrected", async () => {
            const queue = new TableExplorerRowMutationQueue();
            const expectedError = new Error("update failed");
            const failedMutation = queue.enqueue(
                5,
                async () => {
                    throw expectedError;
                },
                "5-1",
            );
            await failedMutation.catch(() => undefined);

            for (let attempt = 0; attempt < 2; attempt++) {
                let caughtError: unknown;
                try {
                    await queue.drain();
                } catch (error) {
                    caughtError = error;
                }
                expect(caughtError).to.equal(expectedError);
            }

            await queue.enqueue(5, async () => undefined, "5-1");
            await queue.drain();
        });

        test("clears persistent and pending failures after a successful delete retry", async () => {
            const queue = new TableExplorerRowMutationQueue();
            const updateError = new Error("update failed");
            await queue
                .enqueue(
                    5,
                    async () => {
                        throw updateError;
                    },
                    "5-1",
                )
                .catch(() => undefined);
            const deleteError = new Error("delete failed");
            await queue
                .enqueue(5, async () => {
                    throw deleteError;
                })
                .catch(() => undefined);

            await queue.enqueue(5, async () => undefined);
            queue.clearFailuresForRow(5);

            await queue.drain();
        });

        test("acknowledges an awaited revert failure without affecting the next drain", async () => {
            const queue = new TableExplorerRowMutationQueue();
            const expectedError = new Error("revert failed");
            let caughtError: unknown;
            try {
                await queue.enqueue(5, async () => {
                    throw expectedError;
                });
            } catch (error) {
                caughtError = error;
                queue.acknowledgeFailure(error);
            }

            expect(caughtError).to.equal(expectedError);
            await queue.enqueue(5, async () => undefined);
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

    suite("session replacement state", () => {
        test("does not update state when session replacement fails", async () => {
            const nextFilters = ["next"];
            const stateUpdates: string[][] = [];
            const expectedError = new Error("replacement failed");
            let caughtError: unknown;

            try {
                await runSessionReplacementAndUpdate(
                    nextFilters,
                    (filters) => stateUpdates.push(filters),
                    async () => {
                        throw expectedError;
                    },
                );
            } catch (error) {
                caughtError = error;
            }

            expect(caughtError).to.equal(expectedError);
            expect(stateUpdates).to.deep.equal([]);
        });

        test("does not update state when session replacement reports failure", async () => {
            const stateUpdates: string[][] = [];

            const succeeded = await runSessionReplacementAndUpdate(
                ["next"],
                (filters) => stateUpdates.push(filters),
                async () => false,
            );

            expect(succeeded).to.equal(false);
            expect(stateUpdates).to.deep.equal([]);
        });
    });

    suite("row count reload", () => {
        test("resets the submitted count after failure so the same count can retry", async () => {
            const lastSubmittedRowCount = { current: 100 };
            const expectedError = new Error("replacement failed");
            let attempts = 0;
            const loadSubset = async () => {
                attempts++;
                if (attempts === 1) {
                    throw expectedError;
                }
                return true;
            };

            await submitTableExplorerRowCountReload(200, lastSubmittedRowCount, loadSubset).catch(
                () => undefined,
            );
            expect(lastSubmittedRowCount.current).to.equal(100);

            await submitTableExplorerRowCountReload(200, lastSubmittedRowCount, loadSubset);

            expect(attempts).to.equal(2);
            expect(lastSubmittedRowCount.current).to.equal(200);
        });

        test("resets the submitted count when replacement reports failure", async () => {
            const lastSubmittedRowCount = { current: 100 };
            let attempts = 0;
            const loadSubset = async () => ++attempts > 1;

            expect(
                await submitTableExplorerRowCountReload(200, lastSubmittedRowCount, loadSubset),
            ).to.equal(false);
            expect(lastSubmittedRowCount.current).to.equal(100);

            expect(
                await submitTableExplorerRowCountReload(200, lastSubmittedRowCount, loadSubset),
            ).to.equal(true);
            expect(attempts).to.equal(2);
            expect(lastSubmittedRowCount.current).to.equal(200);
        });
    });

    suite("filter clearing", () => {
        test("clears draft filters without replacing the session", async () => {
            let localFiltersCleared = false;
            let replacementAttempts = 0;

            await clearTableExplorerFilters(
                false,
                () => {
                    localFiltersCleared = true;
                },
                async () => {
                    replacementAttempts++;
                },
            );

            expect(localFiltersCleared).to.equal(true);
            expect(replacementAttempts).to.equal(0);
        });

        test("leaves local filters until an active-filter replacement succeeds", async () => {
            let localFiltersCleared = false;

            await clearTableExplorerFilters(
                true,
                () => {
                    localFiltersCleared = true;
                },
                async () => undefined,
            );

            expect(localFiltersCleared).to.equal(false);
        });
    });

    suite("filter columns", () => {
        test("preserves filter editor columns while the result set is temporarily unavailable", () => {
            const previousColumns = [{ id: "col0", name: "Name" }];

            expect(getTableExplorerFilterColumns(undefined, previousColumns)).to.equal(
                previousColumns,
            );
        });

        test("updates filter editor columns when a result set is available", () => {
            expect(
                getTableExplorerFilterColumns(
                    [{ name: "Id" }, { name: "Name" }],
                    [{ id: "col0", name: "Previous" }],
                ),
            ).to.deep.equal([
                { id: "col0", name: "Id" },
                { id: "col1", name: "Name" },
            ]);
        });
    });
});
