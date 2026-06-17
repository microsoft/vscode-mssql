/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `ConnectionEphemeralDatabaseProvider` (Scope 2): the non-Docker
 * runtime host that creates a throwaway database on an existing server reached
 * by a saved connection profile, publishes the schema, and drops it afterwards.
 * The host glue (`ConnectionHostGateway`) is faked so the orchestration is
 * exercised without a live server.
 *   * happy path: CREATE DATABASE → publish → connect → return the throwaway.
 *   * `dispose()` disconnects then drops the throwaway via a fresh admin handle.
 *   * a failure after creation drops the throwaway before surfacing.
 *   * `seedFromScriptFile` resolves the script path and delegates to the gateway.
 *   * a non-`connection` runtime host is rejected.
 */

import { expect } from "chai";

import * as path from "path";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import {
    ConnectionEphemeralDatabaseProvider,
    ConnectionHostGateway,
} from "../../src/cloudDeploy/validation/providers/connectionEphemeralDatabaseProvider";
import { EphemeralProvisionError } from "../../src/cloudDeploy/validation/providers/ephemeralDatabaseProvider";
import { ConnectionHandle } from "../../src/cloudDeploy/validation/providers/connectionProvider";
import { FakeProcessProvider } from "../../src/cloudDeploy/validation/providers/processProvider";

const DACPAC_SOURCE = {
    kind: SourceOfTruthKind.Dacpac as const,
    path: "/abs/MyProject.dacpac",
};

class RecordingHandle implements ConnectionHandle {
    public readonly executed: string[] = [];
    public disposed = false;
    public async execute(sql: string): Promise<unknown[][]> {
        this.executed.push(sql);
        return [[]];
    }
    public async dispose(): Promise<void> {
        this.disposed = true;
    }
}

class FakeConnectionHostGateway implements ConnectionHostGateway {
    public readonly connects: Array<{ profileId: string; database: string }> = [];
    public readonly handles: RecordingHandle[] = [];
    public readonly connectionStringCalls: Array<{ profileId: string; database?: string }> = [];
    public readonly seeds: Array<{ profileId: string; database: string; scriptPath: string }> = [];

    public async connect(connectionProfileId: string, database: string): Promise<ConnectionHandle> {
        this.connects.push({ profileId: connectionProfileId, database });
        const handle = new RecordingHandle();
        this.handles.push(handle);
        return handle;
    }

    public async buildConnectionString(
        connectionProfileId: string,
        database: string | undefined,
    ): Promise<string> {
        this.connectionStringCalls.push({ profileId: connectionProfileId, database });
        return `Server=dev;Database=${database ?? "src"};User ID=sa;Password=pw;`;
    }

    public async seedScriptFile(
        connectionProfileId: string,
        database: string,
        scriptPath: string,
    ): Promise<void> {
        this.seeds.push({ profileId: connectionProfileId, database, scriptPath });
    }
}

const CONNECTION_HOST = { kind: "connection" as const, connectionProfileId: "dev-box" };

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

suite("CloudDeploy ConnectionEphemeralDatabaseProvider", () => {
    test("rejects a non-connection runtime host", async () => {
        const provider = new ConnectionEphemeralDatabaseProvider(
            new FakeProcessProvider(),
            new FakeConnectionHostGateway(),
        );

        let caught: unknown;
        try {
            await provider.provision(DACPAC_SOURCE, { kind: "docker" }, newSignal());
        } catch (err) {
            caught = err;
        }
        expect(caught).to.be.instanceOf(EphemeralProvisionError);
    });

    test("creates the throwaway database, publishes the schema, and connects to it", async () => {
        const processes = new FakeProcessProvider();
        const gateway = new FakeConnectionHostGateway();
        const provider = new ConnectionEphemeralDatabaseProvider(processes, gateway);

        const db = await provider.provision(DACPAC_SOURCE, CONNECTION_HOST, newSignal());

        // A unique throwaway name, never the user's own database.
        expect(db.databaseName.startsWith("CloudDeployValidation_")).to.equal(true);

        // master connection created the database, then was disposed.
        expect(gateway.connects[0].database).to.equal("master");
        expect(gateway.handles[0].executed[0]).to.equal(`CREATE DATABASE [${db.databaseName}]`);
        expect(gateway.handles[0].disposed).to.equal(true);

        // sqlpackage published into the throwaway via a connection string.
        const publish = processes.invocations.find((i) => i.args[0] === "/Action:Publish");
        expect(publish, "expected a sqlpackage publish").to.not.equal(undefined);
        expect(publish!.args.some((a) => a.startsWith("/TargetConnectionString:"))).to.equal(true);
        expect(gateway.connectionStringCalls[0].database).to.equal(db.databaseName);

        // The returned connection is the scratch-database handle (the 2nd connect).
        expect(gateway.connects[1].database).to.equal(db.databaseName);
        expect(db.connection).to.equal(gateway.handles[1]);
    });

    test("dispose() disconnects the throwaway then drops it via a fresh admin handle", async () => {
        const processes = new FakeProcessProvider();
        const gateway = new FakeConnectionHostGateway();
        const provider = new ConnectionEphemeralDatabaseProvider(processes, gateway);

        const db = await provider.provision(DACPAC_SOURCE, CONNECTION_HOST, newSignal());
        const scratchHandle = gateway.handles[1];
        await db.dispose();

        expect(scratchHandle.disposed).to.equal(true);
        // A fresh admin handle (the 3rd connect) dropped the throwaway.
        expect(gateway.connects[2].database).to.equal("master");
        const dropHandle = gateway.handles[2];
        expect(dropHandle.executed[0]).to.contain(`DROP DATABASE [${db.databaseName}]`);
    });

    test("dispose() is idempotent", async () => {
        const gateway = new FakeConnectionHostGateway();
        const provider = new ConnectionEphemeralDatabaseProvider(
            new FakeProcessProvider(),
            gateway,
        );

        const db = await provider.provision(DACPAC_SOURCE, CONNECTION_HOST, newSignal());
        await db.dispose();
        const connectsAfterFirst = gateway.connects.length;
        await db.dispose();

        expect(gateway.connects.length).to.equal(connectsAfterFirst);
    });

    test("drops the throwaway database when publishing fails", async () => {
        const processes = new FakeProcessProvider();
        processes.respond("sqlpackage", "/Action:Publish", {
            mode: "exit",
            exitCode: 1,
            stderr: "publish failed",
        });
        const gateway = new FakeConnectionHostGateway();
        const provider = new ConnectionEphemeralDatabaseProvider(processes, gateway);

        let caught: unknown;
        try {
            await provider.provision(DACPAC_SOURCE, CONNECTION_HOST, newSignal());
        } catch (err) {
            caught = err;
        }

        expect(caught).to.be.instanceOf(EphemeralProvisionError);
        // The created database was dropped: a second admin connect ran a DROP.
        const dropHandle = gateway.handles[gateway.handles.length - 1];
        expect(dropHandle.executed.some((sql) => sql.includes("DROP DATABASE"))).to.equal(true);
    });

    test("seedFromScriptFile resolves the path against the workspace and delegates", async () => {
        const gateway = new FakeConnectionHostGateway();
        const provider = new ConnectionEphemeralDatabaseProvider(
            new FakeProcessProvider(),
            gateway,
            { workspaceRoot: "/ws" },
        );

        const db = await provider.provision(DACPAC_SOURCE, CONNECTION_HOST, newSignal());
        await db.seedFromScriptFile!("seed/datagen.sql", newSignal());

        expect(gateway.seeds).to.have.lengthOf(1);
        expect(gateway.seeds[0].database).to.equal(db.databaseName);
        // Resolved against the workspace root to an absolute path (the drive
        // letter on Windows is tolerated; only the suffix is asserted).
        const seeded = gateway.seeds[0].scriptPath.replace(/\\/g, "/");
        expect(path.isAbsolute(gateway.seeds[0].scriptPath)).to.equal(true);
        expect(seeded.endsWith("/ws/seed/datagen.sql")).to.equal(true);
    });
});
