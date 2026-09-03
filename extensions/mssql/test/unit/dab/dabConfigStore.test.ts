/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";
import {
    computeDabStoreKey,
    DabConfigStore,
    DabStoreFs,
    DabStoreKey,
} from "../../../src/dab/dabConfigStore";
import { Dab } from "../../../src/sharedInterfaces/dab";

/** In-memory DabStoreFs so the store is exercised without touching a disk. */
class InMemoryStoreFs implements DabStoreFs {
    public readonly files = new Map<string, string>();
    public readonly directories = new Set<string>();
    public failNextWrite = false;

    async readFile(filePath: string): Promise<string> {
        const contents = this.files.get(filePath);
        if (contents === undefined) {
            const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
        }
        return contents;
    }

    async writeFile(filePath: string, contents: string): Promise<void> {
        if (this.failNextWrite) {
            this.failNextWrite = false;
            throw new Error("disk full");
        }
        this.files.set(filePath, contents);
    }

    async rename(fromPath: string, toPath: string): Promise<void> {
        const contents = this.files.get(fromPath);
        if (contents === undefined) {
            const error = new Error(`ENOENT: ${fromPath}`) as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
        }
        this.files.delete(fromPath);
        this.files.set(toPath, contents);
    }

    async unlink(filePath: string): Promise<void> {
        if (!this.files.delete(filePath)) {
            const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
        }
    }

    async mkdirp(dirPath: string): Promise<void> {
        this.directories.add(dirPath);
    }

    /** Paths of the files that survived, i.e. excluding write temp files. */
    get persistedPaths(): string[] {
        return [...this.files.keys()].filter((filePath) => !filePath.endsWith(".tmp"));
    }
}

const testKey: DabStoreKey = { server: "localhost,1433", database: "AdventureWorks" };
const rootPath = path.join("global-storage");

function createTestConfig(overrides?: Partial<Dab.DabConfig>): Dab.DabConfig {
    return {
        apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL],
        entities: [
            {
                id: "entity-1",
                tableName: "Users",
                schemaName: "dbo",
                isEnabled: true,
                isSupported: true,
                enabledActions: [Dab.EntityAction.Read],
                columns: [],
                advancedSettings: {
                    entityName: "Users",
                    authorizationRole: Dab.AuthorizationRole.Anonymous,
                },
            },
        ],
        ...overrides,
    };
}

suite("DabConfigStore Tests", () => {
    let fs: InMemoryStoreFs;
    let store: DabConfigStore;

    setup(() => {
        fs = new InMemoryStoreFs();
        store = new DabConfigStore(rootPath, fs);
    });

    suite("computeDabStoreKey", () => {
        test("is stable for the same server and database", () => {
            expect(computeDabStoreKey(testKey)).to.equal(computeDabStoreKey({ ...testKey }));
        });

        test("ignores server casing and surrounding whitespace", () => {
            expect(
                computeDabStoreKey({ server: "  LOCALHOST,1433 ", database: "AdventureWorks" }),
                "Server names are case insensitive, so they must map to one key",
            ).to.equal(computeDabStoreKey(testKey));
        });

        test("distinguishes database names by exact spelling", () => {
            expect(
                computeDabStoreKey({ server: "localhost,1433", database: "adventureworks" }),
                "Database names can be case sensitive, so they must not be folded",
            ).to.not.equal(computeDabStoreKey(testKey));
        });

        test("cannot be collided by re-splitting the server and database", () => {
            expect(
                computeDabStoreKey({ server: "a", database: "b:c" }),
                "Length-prefixing keeps the hash input unambiguous",
            ).to.not.equal(computeDabStoreKey({ server: "a:b", database: "c" }));
        });

        test("does not leak the server or database name into the path", () => {
            const key = computeDabStoreKey(testKey);
            expect(key).to.not.contain("localhost");
            expect(key).to.not.contain("AdventureWorks");
            expect(key, "Key must be a safe single path segment").to.match(/^dab_[A-Za-z0-9_-]+$/);
        });
    });

    suite("config", () => {
        test("returns undefined when nothing has been saved", async () => {
            expect(await store.getConfig(testKey)).to.be.undefined;
        });

        test("round-trips a saved config", async () => {
            const config = createTestConfig();
            await store.saveConfig(testKey, config);

            expect(await store.getConfig(testKey)).to.deep.equal(config);
        });

        test("keeps configs for different databases apart", async () => {
            const otherKey: DabStoreKey = { server: testKey.server, database: "Northwind" };
            await store.saveConfig(testKey, createTestConfig());
            await store.saveConfig(otherKey, createTestConfig({ apiTypes: [Dab.ApiType.Mcp] }));

            const config = await store.getConfig(testKey);
            const otherConfig = await store.getConfig(otherKey);
            expect(config?.apiTypes).to.deep.equal([Dab.ApiType.Rest, Dab.ApiType.GraphQL]);
            expect(otherConfig?.apiTypes).to.deep.equal([Dab.ApiType.Mcp]);
        });

        test("reports a malformed file as nothing saved rather than throwing", async () => {
            await store.saveConfig(testKey, createTestConfig());
            const [configPath] = fs.persistedPaths;
            fs.files.set(configPath, "{ not json");

            expect(await store.getConfig(testKey)).to.be.undefined;
        });

        test("ignores a file written by an incompatible format version", async () => {
            await store.saveConfig(testKey, createTestConfig());
            const [configPath] = fs.persistedPaths;
            const contents = JSON.parse(fs.files.get(configPath)!);
            fs.files.set(configPath, JSON.stringify({ ...contents, version: 999 }));

            expect(await store.getConfig(testKey)).to.be.undefined;
        });

        test("does not persist a connection string", async () => {
            await store.saveConfig(testKey, createTestConfig());

            const written = [...fs.files.values()].join("\n");
            expect(written).to.not.contain("connection-string");
            expect(written).to.not.contain("Password");
        });

        test("leaves no temp file behind after a successful write", async () => {
            await store.saveConfig(testKey, createTestConfig());

            expect([...fs.files.keys()].filter((filePath) => filePath.endsWith(".tmp"))).to.be
                .empty;
        });

        test("leaves the previous config intact when a write fails", async () => {
            const original = createTestConfig();
            await store.saveConfig(testKey, original);

            fs.failNextWrite = true;
            try {
                await store.saveConfig(testKey, createTestConfig({ apiTypes: [] }));
                expect.fail("Expected the failed write to be reported");
            } catch (error) {
                expect((error as Error).message).to.contain("config.json");
            }

            expect(
                await store.getConfig(testKey),
                "A failed write must not damage the stored config",
            ).to.deep.equal(original);
            expect([...fs.files.keys()].filter((filePath) => filePath.endsWith(".tmp"))).to.be
                .empty;
        });

        test("deleteConfig discards the saved config", async () => {
            await store.saveConfig(testKey, createTestConfig());
            await store.deleteConfig(testKey);

            expect(await store.getConfig(testKey)).to.be.undefined;
        });

        test("deleteConfig succeeds when nothing is saved", async () => {
            await store.deleteConfig(testKey);
        });

        test("deleteConfig leaves tracked deployments alone", async () => {
            await store.saveConfig(testKey, createTestConfig());
            await store.addDeployment(testKey, {
                containerName: "dab-container",
                port: 5000,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });

            await store.deleteConfig(testKey);

            expect(await store.getDeployments(testKey)).to.have.lengthOf(1);
        });
    });

    suite("deployments", () => {
        test("returns an empty list when nothing is tracked", async () => {
            expect(await store.getDeployments(testKey)).to.deep.equal([]);
        });

        test("addDeployment stamps an id and timestamps", async () => {
            const record = await store.addDeployment(testKey, {
                containerName: "dab-container",
                port: 5000,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });

            expect(record.id).to.be.a("string").and.not.empty;
            expect(record.createdUtc).to.equal(record.deployedUtc);
            expect(await store.getDeployments(testKey)).to.deep.equal([record]);
        });

        test("addDeployment replaces an existing record for the same container name", async () => {
            await store.addDeployment(testKey, {
                containerName: "dab-container",
                port: 5000,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });
            const replacement = await store.addDeployment(testKey, {
                containerName: "dab-container",
                port: 5000,
                apiTypes: [Dab.ApiType.Mcp],
                configHash: "hash-2",
            });

            const deployments = await store.getDeployments(testKey);
            expect(deployments, "The same container must not be tracked twice").to.have.lengthOf(1);
            expect(deployments[0].id).to.equal(replacement.id);
            expect(deployments[0].configHash).to.equal("hash-2");
        });

        test("addDeployment keeps records for other containers", async () => {
            await store.addDeployment(testKey, {
                containerName: "dab-container-1",
                port: 5000,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });
            await store.addDeployment(testKey, {
                containerName: "dab-container-2",
                port: 5001,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });

            expect(await store.getDeployments(testKey)).to.have.lengthOf(2);
        });

        test("updateDeployment applies a partial update", async () => {
            const record = await store.addDeployment(testKey, {
                containerName: "dab-container",
                port: 5000,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });

            const updated = await store.updateDeployment(testKey, record.id, {
                configHash: "hash-2",
                deployedUtc: "2026-09-02T10:00:00.000Z",
            });

            expect(updated?.configHash).to.equal("hash-2");
            expect(updated?.deployedUtc).to.equal("2026-09-02T10:00:00.000Z");
            expect(updated?.createdUtc, "The original deployment time is preserved").to.equal(
                record.createdUtc,
            );
            expect((await store.getDeployments(testKey))[0].configHash).to.equal("hash-2");
        });

        test("updateDeployment returns undefined for an unknown deployment", async () => {
            expect(await store.updateDeployment(testKey, "missing-id", { configHash: "x" })).to.be
                .undefined;
        });

        test("removeDeployment stops tracking one deployment", async () => {
            const first = await store.addDeployment(testKey, {
                containerName: "dab-container-1",
                port: 5000,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });
            await store.addDeployment(testKey, {
                containerName: "dab-container-2",
                port: 5001,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });

            await store.removeDeployment(testKey, first.id);

            const deployments = await store.getDeployments(testKey);
            expect(deployments).to.have.lengthOf(1);
            expect(deployments[0].containerName).to.equal("dab-container-2");
        });

        test("removeDeployment succeeds for an unknown deployment", async () => {
            await store.removeDeployment(testKey, "missing-id");

            expect(await store.getDeployments(testKey)).to.deep.equal([]);
        });

        test("reports a malformed deployments file as nothing tracked", async () => {
            await store.addDeployment(testKey, {
                containerName: "dab-container",
                port: 5000,
                apiTypes: [Dab.ApiType.Rest],
                configHash: "hash-1",
            });
            const [deploymentsPath] = fs.persistedPaths;
            fs.files.set(deploymentsPath, "{ not json");

            expect(await store.getDeployments(testKey)).to.deep.equal([]);
        });
    });
});
