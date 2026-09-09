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

interface CellUpdateAcknowledgement {
    requestId: number;
    isDirty: boolean;
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

export function removeAcknowledgedCleanCellChanges<T extends { requestId: number }>(
    acknowledgements: Record<string, CellUpdateAcknowledgement> | undefined,
    cellChanges: Map<string, T>,
): boolean {
    let changed = false;
    for (const [cellKey, acknowledgement] of Object.entries(acknowledgements ?? {})) {
        const trackedChange = cellChanges.get(cellKey);
        if (!acknowledgement.isDirty && trackedChange?.requestId === acknowledgement.requestId) {
            changed = cellChanges.delete(cellKey) || changed;
        }
    }
    return changed;
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
    private readonly pendingFailures: { rowId: number; error: unknown }[] = [];
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
                        this.pendingFailures.push({ rowId, error });
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
            const [{ error: firstError }] = this.pendingFailures;
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

    public clearFailuresForRow(rowId: number): void {
        const rowPrefix = `${rowId}-`;
        for (const key of this.persistentFailures.keys()) {
            if (key.startsWith(rowPrefix)) {
                this.persistentFailures.delete(key);
            }
        }
        for (let index = this.pendingFailures.length - 1; index >= 0; index--) {
            if (this.pendingFailures[index].rowId === rowId) {
                this.pendingFailures.splice(index, 1);
            }
        }
    }

    public acknowledgeFailure(error: unknown): void {
        const failureIndex = this.pendingFailures.findIndex((failure) => failure.error === error);
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

export async function runSessionReplacementAndUpdate<T>(
    nextValue: T,
    setValue: (value: T) => void,
    replaceSession: () => Promise<boolean>,
): Promise<boolean> {
    const succeeded = await replaceSession();
    if (succeeded) {
        setValue(nextValue);
    }
    return succeeded;
}

export async function submitTableExplorerRowCountReload(
    rowCount: number,
    lastSubmittedRowCount: { current: number },
    loadSubset: (rowCount: number) => Promise<boolean>,
): Promise<boolean> {
    if (lastSubmittedRowCount.current === rowCount) {
        return false;
    }

    const previousRowCount = lastSubmittedRowCount.current;
    lastSubmittedRowCount.current = rowCount;
    try {
        const succeeded = await loadSubset(rowCount);
        if (!succeeded && lastSubmittedRowCount.current === rowCount) {
            lastSubmittedRowCount.current = previousRowCount;
        }
        return succeeded;
    } catch (error) {
        if (lastSubmittedRowCount.current === rowCount) {
            lastSubmittedRowCount.current = previousRowCount;
        }
        throw error;
    }
}

export async function clearTableExplorerFilters(
    hasActiveFilters: boolean,
    clearLocalFilters: () => void,
    clearActiveFilters: () => Promise<void>,
): Promise<void> {
    if (hasActiveFilters) {
        await clearActiveFilters();
    } else {
        clearLocalFilters();
    }
}

export interface TableExplorerFilterColumn {
    id: string;
    name: string;
}

export function getTableExplorerFilterColumns(
    columnInfo: readonly { name: string }[] | undefined,
    previousColumns: TableExplorerFilterColumn[],
): TableExplorerFilterColumn[] {
    if (columnInfo === undefined) {
        return previousColumns;
    }

    return columnInfo.map((column, index) => ({
        id: `col${index}`,
        name: column.name,
    }));
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

export async function runBeforeTableExplorerSessionReplacement<T>(
    mutationQueue: TableExplorerRowMutationQueue,
    setMutationsBlocked: (blocked: boolean) => void,
    operation: () => Promise<T>,
): Promise<T> {
    setMutationsBlocked(true);
    try {
        await mutationQueue.drain();
        mutationQueue.invalidate();
        return await operation();
    } finally {
        setMutationsBlocked(false);
    }
}
