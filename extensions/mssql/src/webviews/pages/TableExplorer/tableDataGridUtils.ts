/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface TableExplorerDataColumn {
    originalIndex: number;
}

interface TableExplorerCellChange {
    rowId: number;
}

export function isTableExplorerDataColumn(column: unknown): column is TableExplorerDataColumn {
    return (
        typeof column === "object" &&
        column !== null &&
        typeof (column as Partial<TableExplorerDataColumn>).originalIndex === "number"
    );
}

export function hasPendingChangesForRow(
    rowId: number,
    cellChanges: Iterable<TableExplorerCellChange>,
    deletedRows: ReadonlySet<number>,
    newRowIds: ReadonlySet<number>,
): boolean {
    if (deletedRows.has(rowId) || newRowIds.has(rowId)) {
        return true;
    }

    for (const change of cellChanges) {
        if (change.rowId === rowId) {
            return true;
        }
    }

    return false;
}

export function snapshotCellChangesForRow<T extends TableExplorerCellChange>(
    rowId: number,
    cellChanges: ReadonlyMap<string, T>,
): Map<string, T> {
    const snapshot = new Map<string, T>();
    for (const [key, change] of cellChanges) {
        if (change.rowId === rowId) {
            snapshot.set(key, change);
        }
    }
    return snapshot;
}

export function clearRevertedCellChanges<T>(
    cellChanges: Map<string, T>,
    revertedCellChanges: ReadonlyMap<string, T>,
    failedCells: Set<string>,
): void {
    for (const [key, revertedChange] of revertedCellChanges) {
        if (cellChanges.get(key) === revertedChange) {
            cellChanges.delete(key);
            failedCells.delete(key);
        }
    }
}

export function tryLockTableExplorerRow(rowId: number, lockedRows: Set<number>): boolean {
    if (lockedRows.has(rowId)) {
        return false;
    }
    lockedRows.add(rowId);
    return true;
}

export class TableExplorerRowMutationQueue {
    private readonly pendingMutations = new Map<number, Promise<void>>();
    private readonly pendingFailures: unknown[] = [];
    private readonly persistentFailures = new Map<string, unknown>();
    private generation = 0;

    public enqueue(
        rowId: number,
        mutation: () => Promise<void>,
        persistentFailureKey?: string,
    ): Promise<void> {
        const generation = this.generation;
        const previousMutation =
            this.pendingMutations.get(rowId)?.catch(() => undefined) ?? Promise.resolve();
        const currentMutation = previousMutation.then(() =>
            generation === this.generation ? mutation() : undefined,
        );
        this.pendingMutations.set(rowId, currentMutation);

        void currentMutation.then(
            () => {
                if (generation === this.generation && persistentFailureKey) {
                    this.persistentFailures.delete(persistentFailureKey);
                }
                this.removeCompletedMutation(rowId, currentMutation);
            },
            (error) => {
                if (generation === this.generation) {
                    if (persistentFailureKey) {
                        this.persistentFailures.set(persistentFailureKey, error);
                    } else {
                        this.pendingFailures.push(error);
                    }
                }
                this.removeCompletedMutation(rowId, currentMutation);
            },
        );
        return currentMutation;
    }

    public async drain(): Promise<void> {
        while (this.pendingMutations.size > 0) {
            await Promise.allSettled(this.pendingMutations.values());
        }

        if (this.pendingFailures.length > 0) {
            const [firstError] = this.pendingFailures;
            this.pendingFailures.length = 0;
            throw firstError;
        }

        const persistentFailure = this.persistentFailures.values().next();
        if (!persistentFailure.done) {
            throw persistentFailure.value;
        }
    }

    public invalidate(): void {
        this.generation++;
        this.pendingMutations.clear();
        this.pendingFailures.length = 0;
        this.persistentFailures.clear();
    }

    public clearPersistentFailuresForRow(rowId: number): void {
        const rowPrefix = `${rowId}-`;
        for (const key of this.persistentFailures.keys()) {
            if (key.startsWith(rowPrefix)) {
                this.persistentFailures.delete(key);
            }
        }
    }

    public acknowledgeFailure(error: unknown): void {
        const failureIndex = this.pendingFailures.indexOf(error);
        if (failureIndex !== -1) {
            this.pendingFailures.splice(failureIndex, 1);
        }
    }

    private removeCompletedMutation(rowId: number, mutation: Promise<void>): void {
        if (this.pendingMutations.get(rowId) === mutation) {
            this.pendingMutations.delete(rowId);
        }
    }
}

export class TableExplorerLifecycleMutex {
    private pendingOperation = Promise.resolve();

    public runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.pendingOperation.then(operation);
        this.pendingOperation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}

const CREATE_ROW_MUTATION_QUEUE_ID = Number.MIN_SAFE_INTEGER;

export function enqueueTableExplorerCreateRow(
    mutationQueue: TableExplorerRowMutationQueue,
    mutationsBlocked: boolean,
    createRow: () => Promise<void>,
): Promise<void> {
    return mutationsBlocked
        ? Promise.resolve()
        : mutationQueue.enqueue(CREATE_ROW_MUTATION_QUEUE_ID, createRow);
}

export async function runBeforeTableExplorerSessionReplacement(
    mutationQueue: TableExplorerRowMutationQueue,
    setMutationsBlocked: (blocked: boolean) => void,
    operation: () => Promise<void>,
): Promise<void> {
    setMutationsBlocked(true);
    try {
        await mutationQueue.drain();
        mutationQueue.invalidate();
        await operation();
    } finally {
        setMutationsBlocked(false);
    }
}
