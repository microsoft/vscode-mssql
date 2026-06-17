/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `DispatchingEphemeralDatabaseProvider` (Scope 2): routes a
 * `provision()` call to the right provider by the resolved runtime host.
 *   * `docker` host → the Docker provider.
 *   * `connection` host → the connection provider.
 *   * `connection` host with no connection provider wired → a clear error
 *     (never a silent fallback to Docker).
 */

import { expect } from "chai";

import { SourceOfTruthKind } from "../../src/cloudDeploy/environments/types";
import {
    EphemeralProvisionError,
    FakeEphemeralDatabaseProvider,
} from "../../src/cloudDeploy/validation/providers/ephemeralDatabaseProvider";
import { DispatchingEphemeralDatabaseProvider } from "../../src/cloudDeploy/validation/providers/dispatchingEphemeralDatabaseProvider";

const SQLPROJ = {
    kind: SourceOfTruthKind.SqlProj as const,
    path: "db/MyProject/MyProject.sqlproj",
};

function newSignal(): AbortSignal {
    return new AbortController().signal;
}

suite("CloudDeploy DispatchingEphemeralDatabaseProvider", () => {
    test("routes a docker host to the docker provider", async () => {
        const docker = new FakeEphemeralDatabaseProvider();
        const connection = new FakeEphemeralDatabaseProvider();
        const dispatcher = new DispatchingEphemeralDatabaseProvider({ docker, connection });

        await dispatcher.provision(SQLPROJ, { kind: "docker" }, newSignal());

        expect(docker.invocations).to.have.lengthOf(1);
        expect(connection.invocations).to.have.lengthOf(0);
    });

    test("routes a connection host to the connection provider", async () => {
        const docker = new FakeEphemeralDatabaseProvider();
        const connection = new FakeEphemeralDatabaseProvider();
        const dispatcher = new DispatchingEphemeralDatabaseProvider({ docker, connection });

        await dispatcher.provision(
            SQLPROJ,
            { kind: "connection", connectionProfileId: "dev-box" },
            newSignal(),
        );

        expect(connection.invocations).to.have.lengthOf(1);
        expect(docker.invocations).to.have.lengthOf(0);
    });

    test("errors on a connection host when no connection provider is wired", async () => {
        const docker = new FakeEphemeralDatabaseProvider();
        const dispatcher = new DispatchingEphemeralDatabaseProvider({ docker });

        let caught: unknown;
        try {
            await dispatcher.provision(
                SQLPROJ,
                { kind: "connection", connectionProfileId: "dev-box" },
                newSignal(),
            );
        } catch (err) {
            caught = err;
        }

        expect(caught).to.be.instanceOf(EphemeralProvisionError);
        expect(docker.invocations).to.have.lengthOf(0);
    });
});
