/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import {
    Environment,
    SourceOfTruthKind,
    ValidationConfig,
    ValidationType,
} from "../../src/cloudDeploy/environments/types";
import {
    EnvironmentsChangeEvent,
    EnvironmentStore,
} from "../../src/cloudDeploy/environments/environmentStore";

/**
 * Minimal in-memory `vscode.Memento` for the per-user default-env preference.
 * `Memento` is an interface (not a class), so per the test AGENTS rules a
 * hand-rolled fake is acceptable here.
 */
function makeMemento(): vscode.Memento {
    const map = new Map<string, unknown>();
    return {
        keys: () => Array.from(map.keys()),
        get: <T>(key: string, defaultValue?: T): T | undefined => {
            return map.has(key) ? (map.get(key) as T) : defaultValue;
        },
        update: async (key: string, value: unknown): Promise<void> => {
            if (value === undefined) {
                map.delete(key);
            } else {
                map.set(key, value);
            }
        },
    } as unknown as vscode.Memento;
}

function makeFolder(root: string): vscode.WorkspaceFolder {
    return {
        uri: vscode.Uri.file(root),
        name: path.basename(root),
        index: 0,
    };
}

function makeEnv(id: string, overrides: Partial<Environment> = {}): Environment {
    return {
        id,
        name: id,
        sourceOfTruth: { kind: SourceOfTruthKind.Container, connectionProfileId: "conn-1" },
        validations: [],
        ...overrides,
    };
}

const unitTestValidation: ValidationConfig = {
    type: ValidationType.UnitTests,
    enabled: true,
    settings: {},
};

suite("CloudDeploy EnvironmentStore", () => {
    let workspaceRoot: string;
    let folder: vscode.WorkspaceFolder;
    let memento: vscode.Memento;
    let store: EnvironmentStore;

    setup(async () => {
        workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-envstore-"));
        folder = makeFolder(workspaceRoot);
        memento = makeMemento();
        store = new EnvironmentStore(folder, memento);
        await store.init();
    });

    teardown(async () => {
        store.dispose();
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    });

    suite("init", () => {
        test("starts with an empty list when no file exists", () => {
            expect(store.list()).to.deep.equal([]);
        });

        test("init is idempotent (second call is a no-op)", async () => {
            await store.upsert(makeEnv("a"));
            await store.init();
            expect(store.list().map((e) => e.id)).to.deep.equal(["a"]);
        });

        test("calling list() before init throws", () => {
            const s = new EnvironmentStore(folder, makeMemento());
            expect(() => s.list()).to.throw(/init/i);
            s.dispose();
        });
    });

    suite("upsert", () => {
        test("adds a new env", async () => {
            await store.upsert(makeEnv("a"));
            expect(store.list().map((e) => e.id)).to.deep.equal(["a"]);
        });

        test("replaces an existing env by id", async () => {
            await store.upsert(makeEnv("a", { name: "first" }));
            await store.upsert(makeEnv("a", { name: "second" }));
            const envs = store.list();
            expect(envs).to.have.length(1);
            expect(envs[0].name).to.equal("second");
        });

        test("fires an added event for new envs", async () => {
            const captured: EnvironmentsChangeEvent[] = [];
            store.onDidChangeEnvironments((e) => captured.push(e));
            await store.upsert(makeEnv("a"));
            expect(captured).to.have.length(1);
            expect(captured[0].added.map((e) => e.id)).to.deep.equal(["a"]);
            expect(captured[0].updated).to.deep.equal([]);
            expect(captured[0].removed).to.deep.equal([]);
        });

        test("fires an updated event for existing envs", async () => {
            await store.upsert(makeEnv("a"));
            const captured: EnvironmentsChangeEvent[] = [];
            store.onDidChangeEnvironments((e) => captured.push(e));
            await store.upsert(makeEnv("a", { name: "renamed" }));
            expect(captured).to.have.length(1);
            expect(captured[0].updated.map((e) => e.id)).to.deep.equal(["a"]);
            expect(captured[0].added).to.deep.equal([]);
        });

        test("rejects an env that would produce an invalid file (defense in depth)", async () => {
            const invalid: Environment = makeEnv("a", { name: "" });
            let caught: unknown;
            try {
                await store.upsert(invalid);
            } catch (err) {
                caught = err;
            }
            expect(caught, "expected validation to reject an empty name").to.exist;
            // In-memory state must NOT have been mutated.
            expect(store.list()).to.deep.equal([]);
        });

        test("persists validations through round-trip", async () => {
            await store.upsert(makeEnv("a", { validations: [unitTestValidation] }));
            // Reload via a fresh store to confirm the file shape survives.
            const fresh = new EnvironmentStore(folder, makeMemento());
            await fresh.init();
            const reloaded = fresh.get("a");
            fresh.dispose();
            expect(reloaded?.validations).to.deep.equal([unitTestValidation]);
        });
    });

    suite("delete", () => {
        test("removes the env and fires a removed event", async () => {
            await store.upsert(makeEnv("a"));
            const captured: EnvironmentsChangeEvent[] = [];
            store.onDidChangeEnvironments((e) => captured.push(e));

            await store.delete("a");

            expect(store.list()).to.deep.equal([]);
            expect(captured).to.have.length(1);
            expect(captured[0].removed).to.deep.equal(["a"]);
        });

        test("deleting a missing env is a no-op (no event)", async () => {
            const captured: EnvironmentsChangeEvent[] = [];
            store.onDidChangeEnvironments((e) => captured.push(e));
            await store.delete("nope");
            expect(captured).to.deep.equal([]);
        });

        test("deleting the default env clears the default", async () => {
            await store.upsert(makeEnv("a"));
            await store.setDefaultEnvironmentId("a");
            expect(store.getDefaultEnvironmentId()).to.equal("a");

            await store.delete("a");
            expect(store.getDefaultEnvironmentId()).to.be.undefined;
        });
    });

    suite("reload", () => {
        test("picks up envs added to the file externally", async () => {
            const otherStore = new EnvironmentStore(folder, makeMemento());
            await otherStore.init();
            await otherStore.upsert(makeEnv("external"));
            otherStore.dispose();

            const captured: EnvironmentsChangeEvent[] = [];
            store.onDidChangeEnvironments((e) => captured.push(e));
            await store.reload();

            expect(store.list().map((e) => e.id)).to.deep.equal(["external"]);
            expect(captured).to.have.length(1);
            expect(captured[0].added.map((e) => e.id)).to.deep.equal(["external"]);
        });

        test("emits no event when the file is unchanged", async () => {
            await store.upsert(makeEnv("a"));
            const captured: EnvironmentsChangeEvent[] = [];
            store.onDidChangeEnvironments((e) => captured.push(e));
            await store.reload();
            expect(captured).to.deep.equal([]);
        });
    });

    suite("default environment", () => {
        test("returns undefined when none is set", () => {
            expect(store.getDefaultEnvironmentId()).to.be.undefined;
        });

        test("set + get round-trips", async () => {
            await store.upsert(makeEnv("a"));
            await store.setDefaultEnvironmentId("a");
            expect(store.getDefaultEnvironmentId()).to.equal("a");
        });

        test("fires a change event on set", async () => {
            const captured: (string | undefined)[] = [];
            store.onDidChangeDefaultEnvironment((id) => captured.push(id));
            await store.upsert(makeEnv("a"));
            await store.setDefaultEnvironmentId("a");
            expect(captured).to.deep.equal(["a"]);
        });

        test("filters a stale id whose env no longer exists", async () => {
            // Simulate a previously-saved id that points at a missing env.
            await memento.update("cloudDeploy.defaultEnvironmentId", "ghost");
            expect(store.getDefaultEnvironmentId()).to.be.undefined;
        });
    });

    suite("concurrency (write-chain serializes parallel writes)", () => {
        test("two parallel upserts both land", async () => {
            await Promise.all([store.upsert(makeEnv("a")), store.upsert(makeEnv("b"))]);
            const ids = store
                .list()
                .map((e) => e.id)
                .sort();
            expect(ids).to.deep.equal(["a", "b"]);
        });

        test("a failed write does not poison subsequent writes", async () => {
            // Trigger a validation failure mid-chain.
            await Promise.allSettled([
                store.upsert(makeEnv("a", { name: "" })), // invalid
                store.upsert(makeEnv("good")), // valid, queued behind
            ]);
            expect(store.list().map((e) => e.id)).to.deep.equal(["good"]);
        });
    });
});
