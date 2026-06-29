/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — data generator.
 *
 * Seeds a freshly-provisioned ephemeral database with dummy data by running the
 * environment's hand-authored data-generator SQL script. Owned by the runner as
 * a step AFTER provisioning and BEFORE the runtime validators: the runner
 * provisions once per run, seeds once, then hands the seeded connection to
 * workload playback (which needs the volume) and unit tests (which may use it).
 *
 * Re-run fresh on every run so workload measurements stay comparable: the
 * same data each time means a latency difference reflects a SCHEMA change, not a
 * data change.
 *
 * The script is split into batches on `GO` separators (the SQL Server batch
 * terminator, which is a client/tooling convention rather than a T-SQL
 * statement) and each batch is executed in order against the connection.
 */

import { ArtifactProvider } from "./providers/artifactProvider";
import { ConnectionHandle } from "./providers/connectionProvider";

// =============================================================================
// Contract
// =============================================================================

/**
 * Seeds an ephemeral database from a data-generator script. Kept as an
 * injectable seam so the runner stays decoupled from file I/O and tests can
 * substitute a fake.
 */
export interface DataGenerator {
    /**
     * Reads the script at `scriptPath` and executes it against `connection`.
     * Throws `DataGeneratorError` on a read or execution failure.
     */
    seed(connection: ConnectionHandle, scriptPath: string, signal: AbortSignal): Promise<void>;
}

/** Thrown when seeding fails (script not found, or a batch failed to execute). */
export class DataGeneratorError extends Error {
    public constructor(
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "DataGeneratorError";
    }
}

// =============================================================================
// LiveDataGenerator
// =============================================================================

/**
 * Production `DataGenerator`. Reads the script via the injected
 * `ArtifactProvider` (the same artifact seam the workload validator uses, so
 * the path-resolution semantics match), splits it into `GO`-delimited batches,
 * and runs each batch against the connection in order.
 */
export class LiveDataGenerator implements DataGenerator {
    public constructor(private readonly _artifacts: ArtifactProvider) {}

    public async seed(
        connection: ConnectionHandle,
        scriptPath: string,
        signal: AbortSignal,
    ): Promise<void> {
        let script: string;
        try {
            const buffer = await this._artifacts.read(scriptPath);
            script = buffer.toString("utf-8");
        } catch (err) {
            throw new DataGeneratorError(
                `Failed to read the data-generator script at ${scriptPath}.`,
                err,
            );
        }

        const batches = splitSqlBatches(script);
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            try {
                await connection.execute(batch, signal);
            } catch (err) {
                throw new DataGeneratorError(
                    `The data-generator script failed on batch ${i + 1} of ${batches.length}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                    err,
                );
            }
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Splits a T-SQL script into batches on lines consisting solely of `GO`
 * (case-insensitive, surrounding whitespace allowed) — the SQL Server batch
 * separator. Empty / whitespace-only batches are dropped. When the script has
 * no `GO`, the whole script is a single batch.
 */
export function splitSqlBatches(script: string): string[] {
    const lines = script.split(/\r\n|\r|\n/);
    const batches: string[] = [];
    let current: string[] = [];

    for (const line of lines) {
        if (/^\s*GO\s*$/i.test(line)) {
            pushBatch(batches, current);
            current = [];
            continue;
        }
        current.push(line);
    }
    pushBatch(batches, current);
    return batches;
}

function pushBatch(batches: string[], lines: string[]): void {
    const text = lines.join("\n").trim();
    if (text.length > 0) {
        batches.push(text);
    }
}
