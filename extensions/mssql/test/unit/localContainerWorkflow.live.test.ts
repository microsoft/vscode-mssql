/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Optional Docker-backed smoke for the complete owned local-container edge.
 * It uses the production container helper and ownership policy, executes a
 * policy-parsed workload, captures with the production XEvent SQL, validates
 * Docker's TAR response, and removes only the exactly labeled container. */

import { createHash, randomBytes } from "crypto";
import { spawnSync } from "child_process";
import * as path from "path";
import { Readable } from "stream";
import { expect } from "chai";
import {
    checkIfSqlServerContainerIsReadyForConnections,
    startSqlServerDockerContainer,
} from "../../src/deployment/sqlServerContainer";
import { getContainerByName } from "../../src/docker/dockerUtils";
import {
    isOwnedLocalSqlContainer,
    localSqlContainerLabels,
    waitForLocalSqlContainerAuthentication,
} from "../../src/runbookStudio/runtime/localContainerOperations";
import { buildCreateLocalDevelopmentDatabaseSql } from "../../src/runbookStudio/runtime/localDevelopmentDatabaseOperations";
import { parseLocalWorkload } from "../../src/runbookStudio/runtime/localWorkload";
import {
    buildStartLocalXeventSql,
    buildStopLocalXeventSql,
    extractLocalXelFromDockerArchive,
    LOCAL_XEVENT_TEMPLATE,
    localXeventSessionName,
    MAX_LOCAL_XEL_ARCHIVE_BYTES,
    validateLocalXelServerPath,
} from "../../src/runbookStudio/runtime/localXevent";

const LIVE_ENABLED = process.env.RBS2_DOCKER_LIVE === "1";
const SQL_VERSION = "2025";
const SQL_IMAGE = `mcr.microsoft.com/mssql/server:${SQL_VERSION}-latest`;

suite("Runbook Studio owned SQL container workflow live smoke (gated)", function () {
    this.timeout(360_000);

    suiteSetup(function () {
        if (!LIVE_ENABLED) {
            this.skip();
        }
        expect(runDocker(["info", "--format", "{{.ServerVersion}}"]), "Docker engine").to.equal(0);
        expect(runDocker(["image", "inspect", SQL_IMAGE]), `cached image ${SQL_IMAGE}`).to.equal(0);
    });

    test("provisions, runs a workload, collects XEL, and disposes exact ownership", async () => {
        const suffix = randomBytes(6).toString("hex");
        const containerName = `rbs-live-${suffix}`;
        const databaseName = `RbsLive${suffix}`;
        const runId = `run_live_${suffix}`;
        const effectId = `effect-${randomBytes(32).toString("hex")}`;
        const password = `Rbs!${randomBytes(12).toString("hex")}aA9`;
        const port = 15000 + (randomBytes(2).readUInt16BE(0) % 30000);
        const labels = localSqlContainerLabels(effectId, runId);
        let created = false;

        try {
            const started = await startSqlServerDockerContainer(
                containerName,
                password,
                SQL_VERSION,
                containerName,
                port,
                {
                    labels,
                    memoryBytes: 2 * 1024 * 1024 * 1024,
                    nanoCpus: 2_000_000_000,
                },
            );
            expect(started.success, started.fullErrorText ?? started.error).to.equal(true);
            created = true;

            const ready = await checkIfSqlServerContainerIsReadyForConnections(containerName);
            expect(ready.success).to.equal(true);
            const container = await getContainerByName(containerName);
            expect(container).not.to.equal(undefined);
            const inspected = await container!.inspect();
            expect(isOwnedLocalSqlContainer(inspected.Config?.Labels, effectId, runId)).to.equal(
                true,
            );
            expect(inspected.HostConfig.Memory).to.equal(2 * 1024 * 1024 * 1024);
            expect(inspected.HostConfig.NanoCpus).to.equal(2_000_000_000);
            expect(
                await waitForLocalSqlContainerAuthentication(
                    async () => canAuthenticate(containerName, password),
                    async () => undefined,
                    () => false,
                ),
            ).to.equal(true);

            runSql(
                containerName,
                password,
                "master",
                buildCreateLocalDevelopmentDatabaseSql(databaseName, effectId),
            );
            const sessionName = localXeventSessionName(effectId);
            runSql(
                containerName,
                password,
                "master",
                buildStartLocalXeventSql(sessionName, LOCAL_XEVENT_TEMPLATE, 4),
            );

            const workload = parseLocalWorkload(
                [
                    "CREATE TABLE dbo.RunbookSmoke(Id int NOT NULL PRIMARY KEY, Value nvarchar(100) NOT NULL);",
                    "GO",
                    "INSERT dbo.RunbookSmoke VALUES(1, N'captured');",
                    "GO",
                    "SELECT COUNT_BIG(*) AS [CapturedRows] FROM dbo.RunbookSmoke;",
                ].join("\n"),
            );
            expect(workload.mutating).to.equal(true);
            for (const batch of workload.batches) {
                runSql(containerName, password, databaseName, batch);
            }

            const stopped = runSql(
                containerName,
                password,
                "master",
                buildStopLocalXeventSql(sessionName),
            );
            const capture = stopped
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => /^\/var\/opt\/mssql\/log\/.+\.xel\|\d+$/.test(line));
            expect(capture).not.to.equal(undefined);
            const [reportedPath, countText] = capture!.split("|");
            const serverPath = validateLocalXelServerPath(sessionName, reportedPath);
            expect(Number(countText)).to.be.greaterThan(0);

            const archive = await readBoundedArchive(
                (await container!.getArchive({ path: serverPath })) as Readable,
            );
            const xel = extractLocalXelFromDockerArchive(archive, path.posix.basename(serverPath));
            expect(xel.length).to.be.greaterThan(0);
            expect(createHash("sha256").update(xel).digest("hex")).to.match(/^[a-f0-9]{64}$/);
        } finally {
            if (created) {
                await removeExactlyOwnedContainer(containerName, effectId, runId);
            }
        }
        expect(await getContainerByName(containerName)).to.equal(undefined);
    });
});

function runDocker(args: string[]): number | null {
    return spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 }).status;
}

function runSql(
    containerName: string,
    password: string,
    databaseName: string,
    sql: string,
): string {
    const result = spawnSync("docker", sqlcmdArgs(containerName, password, databaseName, sql), {
        encoding: "utf8",
        timeout: 60_000,
    });
    if (result.status !== 0) {
        throw new Error(`Container sqlcmd failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

function canAuthenticate(containerName: string, password: string): boolean {
    return (
        spawnSync("docker", sqlcmdArgs(containerName, password, "master", "SELECT 1;"), {
            encoding: "utf8",
            timeout: 15_000,
        }).status === 0
    );
}

function sqlcmdArgs(
    containerName: string,
    password: string,
    databaseName: string,
    sql: string,
): string[] {
    return [
        "exec",
        containerName,
        "/opt/mssql-tools18/bin/sqlcmd",
        "-S",
        "localhost",
        "-U",
        "sa",
        "-P",
        password,
        "-C",
        "-I",
        "-b",
        "-d",
        databaseName,
        "-h",
        "-1",
        "-W",
        "-s",
        "|",
        "-Q",
        sql,
    ];
}

async function readBoundedArchive(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > MAX_LOCAL_XEL_ARCHIVE_BYTES) {
            stream.destroy();
            throw new Error("Docker XEL archive exceeded the product bound.");
        }
        chunks.push(bytes);
    }
    return Buffer.concat(chunks, length);
}

async function removeExactlyOwnedContainer(
    containerName: string,
    effectId: string,
    runId: string,
): Promise<void> {
    const container = await getContainerByName(containerName);
    if (!container) {
        return;
    }
    const inspected = await container.inspect();
    if (!isOwnedLocalSqlContainer(inspected.Config?.Labels, effectId, runId)) {
        throw new Error("Live smoke container ownership changed; refusing cleanup.");
    }
    await container.remove({ force: true });
}
