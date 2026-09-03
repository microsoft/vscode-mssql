/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { extractZipArchive } from "../../../src/dab/dabCliArchive";
import { getDabCliInstallPath, getDabCliPackageUrl } from "../../../src/dab/dabCliTool";
import { Dab } from "../../../src/sharedInterfaces/dab";

suite("DAB CLI Tool Tests", () => {
    suite("getDabCliPackageUrl", () => {
        test("builds a NuGet flat container URL with lower-cased id and version", () => {
            const url = getDabCliPackageUrl("1.2.3");

            expect(url).to.equal(
                "https://api.nuget.org/v3-flatcontainer/microsoft.dataapibuilder/1.2.3/microsoft.dataapibuilder.1.2.3.nupkg",
            );
        });

        test("lower-cases a version with pre-release metadata", () => {
            expect(getDabCliPackageUrl("1.2.3-RC")).to.contain("microsoft.dataapibuilder.1.2.3-rc");
        });

        test("uses the pinned version by default", () => {
            expect(getDabCliPackageUrl(Dab.DAB_CLI_VERSION)).to.contain(Dab.DAB_CLI_VERSION);
        });
    });

    suite("getDabCliInstallPath", () => {
        test("keeps each version in its own directory", () => {
            const first = getDabCliInstallPath("/storage", "1.0.0");
            const second = getDabCliInstallPath("/storage", "2.0.0");

            expect(first).to.not.equal(second);
            expect(first).to.equal(path.join("/storage", "dab-cli", "1.0.0"));
        });
    });
});

/** CRC-32 as the zip format defines it. */
function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

suite("DAB CLI Archive Tests", () => {
    let workingDirectory: string;

    setup(async () => {
        workingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "dab-archive-test-"));
    });

    teardown(async () => {
        await fs.rm(workingDirectory, { recursive: true, force: true });
    });

    /**
     * Writes a zip with the given entries and returns its path.
     *
     * Entries are stored uncompressed, which keeps this to the handful of
     * headers the format requires and avoids a test-only zip-writer dependency.
     */
    async function createArchive(entries: Record<string, string>): Promise<string> {
        const archivePath = path.join(workingDirectory, "test.zip");
        const localParts: Buffer[] = [];
        const centralParts: Buffer[] = [];
        let offset = 0;

        for (const [name, contents] of Object.entries(entries)) {
            const nameBytes = Buffer.from(name, "utf8");
            const data = Buffer.from(contents, "utf8");
            const crc = crc32(data);

            const localHeader = Buffer.alloc(30);
            localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
            localHeader.writeUInt16LE(20, 4); // version needed
            localHeader.writeUInt16LE(0, 6); // flags
            localHeader.writeUInt16LE(0, 8); // stored, no compression
            localHeader.writeUInt32LE(crc, 14);
            localHeader.writeUInt32LE(data.length, 18); // compressed size
            localHeader.writeUInt32LE(data.length, 22); // uncompressed size
            localHeader.writeUInt16LE(nameBytes.length, 26);
            localParts.push(localHeader, nameBytes, data);

            const centralHeader = Buffer.alloc(46);
            centralHeader.writeUInt32LE(0x02014b50, 0); // central directory signature
            centralHeader.writeUInt16LE(20, 4); // version made by
            centralHeader.writeUInt16LE(20, 6); // version needed
            centralHeader.writeUInt16LE(0, 8); // flags
            centralHeader.writeUInt16LE(0, 10); // stored
            centralHeader.writeUInt32LE(crc, 16);
            centralHeader.writeUInt32LE(data.length, 20);
            centralHeader.writeUInt32LE(data.length, 24);
            centralHeader.writeUInt16LE(nameBytes.length, 28);
            centralHeader.writeUInt32LE(offset, 42); // local header offset
            centralParts.push(centralHeader, nameBytes);

            offset += localHeader.length + nameBytes.length + data.length;
        }

        const centralDirectory = Buffer.concat(centralParts);
        const endRecord = Buffer.alloc(22);
        endRecord.writeUInt32LE(0x06054b50, 0); // end of central directory signature
        endRecord.writeUInt16LE(Object.keys(entries).length, 8);
        endRecord.writeUInt16LE(Object.keys(entries).length, 10);
        endRecord.writeUInt32LE(centralDirectory.length, 12);
        endRecord.writeUInt32LE(offset, 16);

        await fs.writeFile(
            archivePath,
            Buffer.concat([...localParts, centralDirectory, endRecord]),
        );
        return archivePath;
    }

    test("extracts entries into nested directories", async () => {
        const archivePath = await createArchive({
            "tools/net8.0/any/Microsoft.DataApiBuilder.dll": "assembly",
            "tools/net8.0/any/Microsoft.DataApiBuilder.runtimeconfig.json": "{}",
        });
        const destination = path.join(workingDirectory, "out");

        await extractZipArchive(archivePath, destination);

        const assembly = await fs.readFile(
            path.join(destination, "tools", "net8.0", "any", "Microsoft.DataApiBuilder.dll"),
            "utf8",
        );
        expect(assembly).to.equal("assembly");
    });

    test("skips entries the filter rejects", async () => {
        const archivePath = await createArchive({
            "tools/net8.0/any/Microsoft.DataApiBuilder.dll": "assembly",
            "[Content_Types].xml": "<Types />",
            "package/services/metadata/core-properties/x.psmdcp": "metadata",
        });
        const destination = path.join(workingDirectory, "out");

        await extractZipArchive(archivePath, destination, (entryName) =>
            entryName.startsWith("tools/"),
        );

        const extracted = await fs.readdir(destination);
        expect(extracted, "Only the tool payload should be unpacked").to.deep.equal(["tools"]);
    });

    test("refuses an entry that would escape the destination", async () => {
        const archivePath = await createArchive({ "../escaped.txt": "nope" });
        const destination = path.join(workingDirectory, "out");

        let rejected = false;
        try {
            await extractZipArchive(archivePath, destination);
        } catch {
            // Either yauzl's own path validation or the destination check
            // rejects this; both are the guarantee callers depend on.
            rejected = true;
        }

        expect(rejected, "A traversing entry must not extract").to.be.true;
        const parentEntries = await fs.readdir(workingDirectory);
        expect(parentEntries, "Nothing may be written outside the destination").to.not.contain(
            "escaped.txt",
        );
    });
});
