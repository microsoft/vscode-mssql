/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type FileIoCounterRow = Readonly<Record<string, unknown>>;

export interface FileIoComparison {
    readonly status: "baseline" | "delta" | "invalid";
    readonly rows: readonly FileIoCounterRow[];
    readonly reason?: "counterReset" | "incomplete" | "invalidValue";
}

/** Compares cumulative file-I/O counters without presenting a reset as negative activity. */
export function compareFileIoCounters(
    baseline: readonly FileIoCounterRow[] | undefined,
    current: readonly FileIoCounterRow[],
    options: { baselineComplete: boolean; currentComplete: boolean },
): FileIoComparison {
    if (!baseline) return { status: "baseline", rows: current };
    if (!options.baselineComplete || !options.currentComplete) {
        return { status: "invalid", rows: current, reason: "incomplete" };
    }

    const baselineByFile = indexByFile(baseline);
    const currentByFile = indexByFile(current);
    const rows: FileIoCounterRow[] = [];
    for (const currentRow of current) {
        const key = fileKey(currentRow);
        if (!key) return { status: "invalid", rows: current, reason: "invalidValue" };
        const previousRow = baselineByFile.get(key);
        const values = counterValues(currentRow);
        const previousValues = previousRow ? counterValues(previousRow) : zeroCounters();
        if (!values || !previousValues) {
            return { status: "invalid", rows: current, reason: "invalidValue" };
        }
        if (
            values.readStall < previousValues.readStall ||
            values.writeStall < previousValues.writeStall ||
            values.reads < previousValues.reads ||
            values.writes < previousValues.writes
        ) {
            return { status: "invalid", rows: current, reason: "counterReset" };
        }
        const reads = values.reads - previousValues.reads;
        const writes = values.writes - previousValues.writes;
        const readStall = values.readStall - previousValues.readStall;
        const writeStall = values.writeStall - previousValues.writeStall;
        rows.push({
            ...currentRow,
            io_stall_read_ms: readStall,
            io_stall_write_ms: writeStall,
            num_of_reads: reads,
            num_of_writes: writes,
            avg_read_stall_ms: reads > 0 ? readStall / reads : undefined,
            avg_write_stall_ms: writes > 0 ? writeStall / writes : undefined,
            read_latency_status: reads > 0 ? "measured" : "not measured",
            write_latency_status: writes > 0 ? "measured" : "not measured",
        });
    }

    for (const [key, previousRow] of baselineByFile) {
        if (currentByFile.has(key)) continue;
        const values = counterValues(previousRow);
        if (!values) return { status: "invalid", rows: current, reason: "invalidValue" };
        if (
            values.readStall > 0 ||
            values.writeStall > 0 ||
            values.reads > 0 ||
            values.writes > 0
        ) {
            return { status: "invalid", rows: current, reason: "counterReset" };
        }
    }

    rows.sort((left, right) => {
        const leftTotal = counter(left.io_stall_read_ms) + counter(left.io_stall_write_ms);
        const rightTotal = counter(right.io_stall_read_ms) + counter(right.io_stall_write_ms);
        return rightTotal - leftTotal;
    });
    return { status: "delta", rows };
}

function fileKey(row: FileIoCounterRow): string | undefined {
    const database = text(row.database_name);
    const file = text(row.file_name);
    const type = text(row.type_desc);
    return database && file && type ? `${database}\u0000${file}\u0000${type}` : undefined;
}

function indexByFile(rows: readonly FileIoCounterRow[]): Map<string, FileIoCounterRow> {
    return new Map(
        rows
            .map((row) => ({ key: fileKey(row), row }))
            .filter(
                (value): value is { key: string; row: FileIoCounterRow } => value.key !== undefined,
            )
            .map(({ key, row }) => [key, row]),
    );
}

function counterValues(row: FileIoCounterRow):
    | {
          readStall: number;
          writeStall: number;
          reads: number;
          writes: number;
      }
    | undefined {
    const readStall = nonNegative(row.io_stall_read_ms);
    const writeStall = nonNegative(row.io_stall_write_ms);
    const reads = nonNegative(row.num_of_reads);
    const writes = nonNegative(row.num_of_writes);
    return readStall === undefined ||
        writeStall === undefined ||
        reads === undefined ||
        writes === undefined
        ? undefined
        : { readStall, writeStall, reads, writes };
}

function zeroCounters() {
    return { readStall: 0, writeStall: 0, reads: 0, writes: 0 };
}

function nonNegative(value: unknown): number | undefined {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function counter(value: unknown): number {
    return nonNegative(value) ?? 0;
}

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
