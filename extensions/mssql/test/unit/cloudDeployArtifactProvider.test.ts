/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `ArtifactProvider`:
 *   * `FakeArtifactProvider` round-trips a string-seeded artifact via UTF-8.
 *   * `read()` for an unset uri throws `ArtifactNotFoundError` carrying that uri.
 *   * `exists()` mirrors `set()` state without throwing.
 *   * Reads are recorded in order with hit/miss flags.
 *   * `LiveArtifactProvider` translates `ENOENT` into `ArtifactNotFoundError`
 *     while preserving every other error verbatim.
 */

import { expect } from "chai";

import {
    ArtifactNotFoundError,
    FakeArtifactProvider,
    LiveArtifactProvider,
} from "../../src/cloudDeploy/validation";
import type { FileProvider } from "../../src/cloudDeploy/providers";

class StubFileProvider implements FileProvider {
    public constructor(private readonly _impl: Partial<FileProvider>) {}

    public readFileBuffer(filePath: string): Promise<Buffer> {
        if (this._impl.readFileBuffer === undefined) {
            return Promise.reject(new Error("readFileBuffer not stubbed"));
        }
        return this._impl.readFileBuffer(filePath);
    }

    public writeFileAtomic(): Promise<void> {
        return Promise.reject(new Error("writeFileAtomic not used in artifact-provider tests"));
    }

    public fileExists(filePath: string): Promise<boolean> {
        if (this._impl.fileExists === undefined) {
            return Promise.resolve(false);
        }
        return this._impl.fileExists(filePath);
    }
}

suite("CloudDeploy ArtifactProvider", () => {
    suite("FakeArtifactProvider", () => {
        test("round-trips a string-seeded artifact as UTF-8 bytes", async () => {
            const fake = new FakeArtifactProvider();
            fake.set("file:///workload.json", '{"steps":[]}');

            const buf = await fake.read("file:///workload.json");

            expect(buf.toString("utf-8")).to.equal('{"steps":[]}');
        });

        test("throws ArtifactNotFoundError carrying the missing uri", async () => {
            const fake = new FakeArtifactProvider();

            try {
                await fake.read("file:///nope.json");
                expect.fail("expected ArtifactNotFoundError");
            } catch (err) {
                expect(err).to.be.instanceOf(ArtifactNotFoundError);
                expect((err as ArtifactNotFoundError).uri).to.equal("file:///nope.json");
            }
        });

        test("exists() reflects set() state without throwing for missing keys", async () => {
            const fake = new FakeArtifactProvider();
            fake.set("file:///present", "hi");

            expect(await fake.exists("file:///present")).to.equal(true);
            expect(await fake.exists("file:///absent")).to.equal(false);
        });

        test("records reads in order with hit/miss flags", async () => {
            const fake = new FakeArtifactProvider();
            fake.set("file:///present", "hi");

            await fake.read("file:///present");
            await fake.read("file:///absent").catch(() => undefined);
            await fake.read("file:///present");

            expect(fake.reads).to.deep.equal([
                { uri: "file:///present", hit: true },
                { uri: "file:///absent", hit: false },
                { uri: "file:///present", hit: true },
            ]);
        });
    });

    suite("LiveArtifactProvider", () => {
        test("delegates read() to the FileProvider on success", async () => {
            const live = new LiveArtifactProvider(
                new StubFileProvider({
                    readFileBuffer: () => Promise.resolve(Buffer.from("ok", "utf-8")),
                }),
            );

            const buf = await live.read("/some/path.json");

            expect(buf.toString("utf-8")).to.equal("ok");
        });

        test("translates ENOENT into ArtifactNotFoundError carrying the uri", async () => {
            const enoent = Object.assign(new Error("ENOENT: not found"), { code: "ENOENT" });
            const live = new LiveArtifactProvider(
                new StubFileProvider({
                    readFileBuffer: () => Promise.reject(enoent),
                }),
            );

            try {
                await live.read("/missing.json");
                expect.fail("expected ArtifactNotFoundError");
            } catch (err) {
                expect(err).to.be.instanceOf(ArtifactNotFoundError);
                expect((err as ArtifactNotFoundError).uri).to.equal("/missing.json");
            }
        });

        test("re-throws non-ENOENT errors verbatim", async () => {
            const eperm = Object.assign(new Error("EACCES: denied"), { code: "EACCES" });
            const live = new LiveArtifactProvider(
                new StubFileProvider({
                    readFileBuffer: () => Promise.reject(eperm),
                }),
            );

            try {
                await live.read("/locked.json");
                expect.fail("expected EACCES error to propagate");
            } catch (err) {
                expect(err).to.equal(eperm);
            }
        });

        test("exists() delegates to FileProvider.fileExists", async () => {
            const live = new LiveArtifactProvider(
                new StubFileProvider({
                    fileExists: (p) => Promise.resolve(p === "/yes"),
                }),
            );

            expect(await live.exists("/yes")).to.equal(true);
            expect(await live.exists("/no")).to.equal(false);
        });
    });
});
