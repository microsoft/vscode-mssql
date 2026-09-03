/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { extractZipArchive } from "../../../src/dab/dabCliArchive";
import { getAzureCliInstallLink, isDatabaseConnectionFailure } from "../../../src/dab/dabCliRunner";
import {
    getCurrentRuntimeIdentifier,
    getDabCliInstallPath,
    getDabCliPackageUrl,
    readRuntimePackageId,
    stripByteOrderMark,
} from "../../../src/dab/dabCliTool";
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

        test("downloads from a configured mirror when one is given", () => {
            const url = getDabCliPackageUrl("2.0.12", "https://contoso.example/nuget/v3/flat2");

            expect(
                url,
                "Environments that disable nuget.org must be able to point elsewhere",
            ).to.equal(
                "https://contoso.example/nuget/v3/flat2/microsoft.dataapibuilder/2.0.12/microsoft.dataapibuilder.2.0.12.nupkg",
            );
        });

        test("tolerates a trailing slash on the feed URL", () => {
            expect(getDabCliPackageUrl("2.0.12", "https://contoso.example/flat2/")).to.equal(
                getDabCliPackageUrl("2.0.12", "https://contoso.example/flat2"),
            );
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
    suite("runtime-specific packages", () => {
        // The manifest the CLI package actually ships from 2.1 onward.
        const toolSettings = `<?xml version="1.0" encoding="utf-8"?>
<DotNetCliTool Version="2">
  <Commands>
    <Command Name="dab" />
  </Commands>
  <RuntimeIdentifierPackages>
    <RuntimeIdentifierPackage RuntimeIdentifier="win-x64" Id="Microsoft.DataApiBuilder.win-x64" />
    <RuntimeIdentifierPackage RuntimeIdentifier="linux-x64" Id="Microsoft.DataApiBuilder.linux-x64" />
    <RuntimeIdentifierPackage RuntimeIdentifier="osx-x64" Id="Microsoft.DataApiBuilder.osx-x64" />
  </RuntimeIdentifierPackages>
</DotNetCliTool>`;

        test("reads the package for each published runtime", () => {
            expect(readRuntimePackageId(toolSettings, "win-x64")).to.equal(
                "Microsoft.DataApiBuilder.win-x64",
            );
            expect(readRuntimePackageId(toolSettings, "linux-x64")).to.equal(
                "Microsoft.DataApiBuilder.linux-x64",
            );
            expect(readRuntimePackageId(toolSettings, "osx-x64")).to.equal(
                "Microsoft.DataApiBuilder.osx-x64",
            );
        });

        test("reads a manifest written with a byte order mark", () => {
            // NuGet writes DotnetToolSettings.xml as UTF-8 with a BOM, which an
            // XML parser otherwise rejects as content before the declaration.
            expect(readRuntimePackageId(`﻿${toolSettings}`, "win-x64")).to.equal(
                "Microsoft.DataApiBuilder.win-x64",
            );
        });

        test("strips only a leading byte order mark", () => {
            expect(stripByteOrderMark("﻿<xml />")).to.equal("<xml />");
            expect(stripByteOrderMark("<xml />")).to.equal("<xml />");
            expect(stripByteOrderMark("")).to.equal("");
        });

        test("reports a runtime the tool does not publish", () => {
            expect(
                readRuntimePackageId(toolSettings, "win-arm64"),
                "An arm64 host has no build to download, and must be told so",
            ).to.be.undefined;
        });

        test("builds a runtime identifier for this machine", () => {
            expect(getCurrentRuntimeIdentifier()).to.match(/^(win|linux|osx)-(x64|arm64)$/);
        });

        test("downloads a runtime package by its own id at the CLI's version", () => {
            expect(
                getDabCliPackageUrl(
                    "2.1.3-rc",
                    "https://contoso.example/flat2",
                    "Microsoft.DataApiBuilder.win-x64",
                ),
            ).to.equal(
                "https://contoso.example/flat2/microsoft.dataapibuilder.win-x64/2.1.3-rc/microsoft.dataapibuilder.win-x64.2.1.3-rc.nupkg",
            );
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

suite("DAB CLI connection failure detection", () => {
    test("recognises the engine's connection failure", () => {
        // Captured from the engine: a login that the server rejected.
        expect(
            isDatabaseConnectionFailure(
                "fail: A valid Connection String should be provided. Database connection failed due to: Login failed for user ''.",
            ),
        ).to.be.true;
    });

    test("recognises a failure to reach the server", () => {
        // Captured from the engine: a host that does not resolve.
        expect(
            isDatabaseConnectionFailure(
                "fail: A valid Connection String should be provided. Database connection failed due to: A network-related or instance-specific error occurred while establishing a connection to SQL Server.",
            ),
        ).to.be.true;
    });

    test("does not mistake a schema failure for a connection failure", () => {
        // The guidance tells people to fix their sign-in, which would be wrong
        // advice for a configuration the engine read perfectly well.
        expect(
            isDatabaseConnectionFailure(
                "fail: > Total schema validation errors: 64\n> JSON does not match all schemas from 'allOf'. Invalid schema indexes: 1. at 29:31",
            ),
        ).to.be.false;
    });

    test("treats absent output as no connection failure", () => {
        expect(isDatabaseConnectionFailure(undefined)).to.be.false;
        expect(isDatabaseConnectionFailure("")).to.be.false;
    });
});

suite("Azure CLI install link", () => {
    test("points at instructions for this machine's operating system", () => {
        // The install steps differ per platform, so the wrong page is worse
        // than no page: it describes a package manager the reader does not have.
        const expectedPage =
            process.platform === "win32"
                ? "install-azure-cli-windows"
                : process.platform === "darwin"
                  ? "install-azure-cli-macos"
                  : "install-azure-cli-linux";

        expect(getAzureCliInstallLink()).to.contain(expectedPage);
    });

    test("omits the locale so the page opens in the reader's language", () => {
        expect(getAzureCliInstallLink()).to.not.contain("/en-us/");
    });
});

suite("Azure CLI install guidance", () => {
    test("points at the instructions for this machine", () => {
        const link = getAzureCliInstallLink();
        const expectedPage =
            {
                win32: "install-azure-cli-windows",
                darwin: "install-azure-cli-macos",
            }[process.platform as string] ?? "install-azure-cli-linux";

        expect(
            link,
            "Install steps differ per platform, so the wrong page is unusable advice",
        ).to.contain(expectedPage);
    });

    test("omits the locale so the page opens in the reader's language", () => {
        expect(getAzureCliInstallLink()).to.not.contain("/en-us/");
    });
});
