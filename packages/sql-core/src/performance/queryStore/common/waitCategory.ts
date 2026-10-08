/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A Query Store wait category. */
export type WaitCategory =
    | "unknown"
    | "cpu"
    | "workerThread"
    | "lock"
    | "latch"
    | "bufferLatch"
    | "bufferIo"
    | "compilation"
    | "sqlClr"
    | "mirroring"
    | "transaction"
    | "idle"
    | "preemptive"
    | "serviceBroker"
    | "tranLogIo"
    | "networkIo"
    | "parallelism"
    | "memory"
    | "userWait"
    | "tracing"
    | "fullTextSearch"
    | "otherDiskIo"
    | "replication"
    | "logRateGovernor";

export interface WaitCategoryInfo {
    readonly category: WaitCategory;
    /** `sys.query_store_wait_stats.wait_category`. */
    readonly id: number;
    /** `sys.query_store_wait_stats.wait_category_desc`. Not localized. */
    readonly name: string;
}

/** Every wait category, in `wait_category` order. */
export const waitCategories: readonly WaitCategoryInfo[] = [
    { category: "unknown", id: 0, name: "Unknown" },
    { category: "cpu", id: 1, name: "CPU" },
    { category: "workerThread", id: 2, name: "Worker Thread" },
    { category: "lock", id: 3, name: "Lock" },
    { category: "latch", id: 4, name: "Latch" },
    { category: "bufferLatch", id: 5, name: "Buffer Latch" },
    { category: "bufferIo", id: 6, name: "Buffer IO" },
    { category: "compilation", id: 7, name: "Compilation" },
    { category: "sqlClr", id: 8, name: "SQL CLR" },
    { category: "mirroring", id: 9, name: "Mirroring" },
    { category: "transaction", id: 10, name: "Transaction" },
    { category: "idle", id: 11, name: "Idle" },
    { category: "preemptive", id: 12, name: "Preemptive" },
    { category: "serviceBroker", id: 13, name: "Service Broker" },
    { category: "tranLogIo", id: 14, name: "Tran Log IO" },
    { category: "networkIo", id: 15, name: "Network IO" },
    { category: "parallelism", id: 16, name: "Parallelism" },
    { category: "memory", id: 17, name: "Memory" },
    { category: "userWait", id: 18, name: "User Wait" },
    { category: "tracing", id: 19, name: "Tracing" },
    { category: "fullTextSearch", id: 20, name: "Full Text Search" },
    { category: "otherDiskIo", id: 21, name: "Other Disk IO" },
    { category: "replication", id: 22, name: "Replication" },
    { category: "logRateGovernor", id: 23, name: "Log Rate Governor" },
];

/** Returns the category with the `wait_category` ID, or undefined. */
export function getWaitCategoryById(id: number): WaitCategoryInfo | undefined {
    return waitCategories.find((info) => info.id === id);
}

/** Returns the information for the category. */
export function getWaitCategoryInfo(category: WaitCategory): WaitCategoryInfo {
    const info = waitCategories.find((item) => item.category === category);
    if (!info) {
        throw new RangeError(`"${String(category)}" is not a wait category.`);
    }
    return info;
}
