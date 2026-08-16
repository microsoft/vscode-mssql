/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    DashboardQueryError,
    DashboardQueryPool,
} from "../../src/dashboard/data/dashboardQueryPool";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";

const profile = {
    profileFingerprint: "dashboard-test",
    server: "fixture",
    database: "FixtureDb",
    authKind: "integrated" as const,
};

function backendWith(...scripts: FakeScript[]): FakeBackend {
    return new FakeBackend({
        scripts: [
            {
                match: (sql) => sql.includes("SET NOCOUNT ON"),
                events: [{ type: "complete", status: "succeeded" }],
            },
            ...scripts,
        ],
    });
}

function poolOver(backend: FakeBackend, maxLanes = 4) {
    const observations: Array<{ phase: string; collector: string; rows?: number }> = [];
    const pool = new DashboardQueryPool(
        (laneId) =>
            backend.openSession({
                profile,
                applicationName: `vscode-mssql-dashboard-${laneId}`,
            }),
        maxLanes,
        (event) => observations.push(event),
    );
    return { pool, observations };
}

suite("SQL Dashboard query pool", () => {
    test("initializes a lane once and returns compact rows with collector observations", async () => {
        const backend = backendWith({
            match: "SELECT dashboard_rows",
            events: [
                {
                    type: "resultSet",
                    columns: ["id", "value"],
                    rows: [
                        [1, "one"],
                        [2, "two"],
                    ],
                },
                { type: "complete", status: "succeeded" },
            ],
        });
        const { pool, observations } = poolOver(backend, 1);
        const signal = new AbortController().signal;

        const first = await pool.query("SELECT dashboard_rows", {
            tag: "dashboard:testRows",
            timeoutMs: 5_000,
            signal,
        });
        const second = await pool.query("SELECT dashboard_rows", {
            tag: "dashboard:testRows",
            timeoutMs: 5_000,
            signal,
        });

        expect(first.columns.map((column) => column.name)).to.deep.equal(["id", "value"]);
        expect(first.rows).to.deep.equal([
            [1, "one"],
            [2, "two"],
        ]);
        expect(second.rows).to.have.length(2);
        expect(backend.sessions).to.have.length(1);
        expect(observations.filter((event) => event.phase === "begin")).to.have.length(2);
        expect(observations.filter((event) => event.phase === "firstPage")).to.have.length(2);
        expect(observations.filter((event) => event.phase === "end")).to.deep.include({
            phase: "end",
            collector: "dashboard:testRows",
            outcome: "succeeded",
            rows: 2,
        });
        await pool.dispose();
    });

    test("bounds concurrent one-query sessions to the configured lane count", async () => {
        const backend = backendWith({
            match: (sql) => sql.startsWith("SELECT lane_"),
            events: [
                {
                    type: "resultSet",
                    columns: ["id"],
                    rows: [[1], [2]],
                    pageSize: 1,
                    pageDelayMs: 15,
                },
                { type: "complete", status: "succeeded" },
            ],
        });
        const { pool } = poolOver(backend, 2);
        const signal = new AbortController().signal;

        const results = await Promise.all(
            [1, 2, 3, 4].map((id) =>
                pool.query(`SELECT lane_${id}`, {
                    tag: "dashboard:laneBound",
                    timeoutMs: 5_000,
                    signal,
                }),
            ),
        );

        expect(results.every((result) => result.rows.length === 2)).to.equal(true);
        expect(backend.sessions).to.have.length(2);
        await pool.dispose();
    });

    test("cancels a collector at its host deadline and releases the lane", async () => {
        const backend = backendWith(
            {
                match: "SELECT hangs",
                events: [{ type: "chaos:noTerminal" }],
            },
            {
                match: "SELECT recovers",
                events: [
                    { type: "resultSet", columns: ["ok"], rows: [[1]] },
                    { type: "complete", status: "succeeded" },
                ],
            },
        );
        const { pool } = poolOver(backend, 1);

        let error: unknown;
        try {
            await pool.query("SELECT hangs", {
                tag: "dashboard:deadline",
                timeoutMs: 10,
                signal: new AbortController().signal,
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(DashboardQueryError);
        expect((error as DashboardQueryError).code).to.equal("timeout");

        const recovered = await pool.query("SELECT recovers", {
            tag: "dashboard:recovered",
            timeoutMs: 5_000,
            signal: new AbortController().signal,
        });
        expect(recovered.rows).to.deep.equal([[1]]);
        await pool.dispose();
    });

    test("rejects queued work when its route is cancelled", async () => {
        const backend = backendWith({
            match: (sql) => sql.startsWith("SELECT slow"),
            events: [
                { type: "resultSet", columns: ["id"], rows: [[1]], delayMs: 30 },
                { type: "complete", status: "succeeded" },
            ],
        });
        const { pool, observations } = poolOver(backend, 1);
        const first = pool.query("SELECT slow_1", {
            tag: "dashboard:first",
            timeoutMs: 5_000,
            signal: new AbortController().signal,
        });
        const queuedAbort = new AbortController();
        const queued = pool.query("SELECT slow_2", {
            tag: "dashboard:queued",
            timeoutMs: 5_000,
            signal: queuedAbort.signal,
        });
        queuedAbort.abort();

        let error: unknown;
        try {
            await queued;
        } catch (caught) {
            error = caught;
        }
        expect(error).to.be.instanceOf(DashboardQueryError);
        expect((error as DashboardQueryError).code).to.equal("cancelled");
        expect(observations).to.deep.include({
            phase: "end",
            collector: "dashboard:queued",
            outcome: "cancelled",
            rows: 0,
        });
        await first;
        await pool.dispose();
    });
});
