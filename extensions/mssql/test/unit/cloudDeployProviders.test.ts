/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { LocalFileProvider } from "../../src/cloudDeploy/providers";

suite("CloudDeploy LocalFileProvider", () => {
    let root: string;
    let provider: LocalFileProvider;

    setup(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "mssql-fileprov-"));
        provider = new LocalFileProvider();
    });

    teardown(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    suite("readFileBuffer", () => {
        test("returns the file contents as a Buffer", async () => {
            const filePath = path.join(root, "a.bin");
            await fs.writeFile(filePath, Buffer.from([1, 2, 3]));
            const data = await provider.readFileBuffer(filePath);
            expect(Buffer.isBuffer(data)).to.be.true;
            expect(Array.from(data)).to.deep.equal([1, 2, 3]);
        });

        test("throws ENOENT-shaped error when the file is missing", async () => {
            let caught: NodeJS.ErrnoException | undefined;
            try {
                await provider.readFileBuffer(path.join(root, "missing.bin"));
            } catch (err) {
                caught = err as NodeJS.ErrnoException;
            }
            expect(caught).to.exist;
            expect(caught!.code).to.equal("ENOENT");
        });
    });

    suite("writeFileAtomic", () => {
        test("creates the parent directory on demand", async () => {
            const target = path.join(root, "nested", "deep", "out.bin");
            await provider.writeFileAtomic(target, Buffer.from("hi"));
            const stat = await fs.stat(target);
            expect(stat.isFile()).to.be.true;
        });

        test("leaves no temp files behind on success", async () => {
            const target = path.join(root, "out.bin");
            await provider.writeFileAtomic(target, Buffer.from("hi"));
            const entries = await fs.readdir(root);
            expect(entries).to.deep.equal(["out.bin"]);
        });

        test("overwrites prior contents fully (no partial state)", async () => {
            const target = path.join(root, "out.bin");
            await provider.writeFileAtomic(target, Buffer.from("first"));
            await provider.writeFileAtomic(target, Buffer.from("second"));
            const back = await fs.readFile(target, { encoding: "utf8" });
            expect(back).to.equal("second");
        });
    });

    suite("fileExists", () => {
        test("returns true for a present file", async () => {
            const target = path.join(root, "x");
            await fs.writeFile(target, "x");
            expect(await provider.fileExists(target)).to.be.true;
        });

        test("returns false for a missing file (no throw)", async () => {
            expect(await provider.fileExists(path.join(root, "nope"))).to.be.false;
        });
    });
});
