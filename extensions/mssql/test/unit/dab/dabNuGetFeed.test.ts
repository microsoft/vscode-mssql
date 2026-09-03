/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";
import type { VscodeHttpClient } from "extension-toolkit/vscode";
import {
    getNuGetConfigPaths,
    parseNuGetConfig,
    resolveFlatContainerUrl,
} from "../../../src/dab/dabNuGetFeed";

/** Minimal client returning one canned service index response. */
function createHttpClient(response: {
    ok: boolean;
    data?: { resources?: { "@id"?: string; "@type"?: string }[] };
}): VscodeHttpClient {
    return {
        get: async () => response,
    } as unknown as VscodeHttpClient;
}

suite("DAB NuGet Feed Tests", () => {
    suite("parseNuGetConfig", () => {
        test("reads declared package sources", () => {
            const contents = parseNuGetConfig(`<?xml version="1.0" encoding="utf-8"?>
                <configuration>
                  <packageSources>
                    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
                    <add key="internal" value="https://contoso.example/nuget/v3/index.json" />
                  </packageSources>
                </configuration>`);

            expect(contents.sources).to.deep.equal([
                { key: "nuget.org", value: "https://api.nuget.org/v3/index.json" },
                { key: "internal", value: "https://contoso.example/nuget/v3/index.json" },
            ]);
        });

        test("reads disabled sources", () => {
            const contents = parseNuGetConfig(`<?xml version="1.0" encoding="utf-8"?>
                <configuration>
                  <packageSources>
                    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
                  </packageSources>
                  <disabledPackageSources>
                    <add key="nuget.org" value="true" />
                  </disabledPackageSources>
                </configuration>`);

            expect(contents.disabledKeys).to.deep.equal(["nuget.org"]);
        });

        test("treats a non-true disabled value as enabled", () => {
            const contents = parseNuGetConfig(`<?xml version="1.0" encoding="utf-8"?>
                <configuration>
                  <disabledPackageSources>
                    <add key="nuget.org" value="false" />
                  </disabledPackageSources>
                </configuration>`);

            expect(contents.disabledKeys).to.be.empty;
        });

        test("reports a clear element", () => {
            const contents = parseNuGetConfig(`<?xml version="1.0" encoding="utf-8"?>
                <configuration>
                  <packageSources>
                    <clear />
                    <add key="internal" value="https://contoso.example/nuget/v3/index.json" />
                  </packageSources>
                </configuration>`);

            expect(contents.clearsSources).to.be.true;
            expect(contents.sources).to.have.lengthOf(1);
        });

        test("handles a config with no package sources", () => {
            const contents = parseNuGetConfig(
                `<?xml version="1.0" encoding="utf-8"?><configuration />`,
            );

            expect(contents.sources).to.be.empty;
            expect(contents.disabledKeys).to.be.empty;
            expect(contents.clearsSources).to.be.false;
        });
    });

    suite("getNuGetConfigPaths", () => {
        test("puts directory configuration after user configuration", () => {
            const workspacePath = path.join("C:", "src", "project");
            const paths = getNuGetConfigPaths(workspacePath);

            // Anything under the walked workspace tree is directory
            // configuration; everything else is machine or user level.
            const isDirectoryConfig = (candidate: string) =>
                path.dirname(candidate).endsWith(`${path.sep}src`) ||
                path.dirname(candidate) === workspacePath;

            const lastNonDirectoryIndex = paths.reduce(
                (last, candidate, index) => (isDirectoryConfig(candidate) ? last : index),
                -1,
            );
            const firstDirectoryIndex = paths.findIndex(isDirectoryConfig);

            expect(
                firstDirectoryIndex,
                "A config next to the project must be able to override the user's",
            ).to.be.greaterThan(lastNonDirectoryIndex);
        });

        test("walks from the filesystem root down to the workspace", () => {
            const paths = getNuGetConfigPaths(path.join("C:", "src", "project"));
            const projectIndex = paths.findIndex((candidate) =>
                candidate.includes(path.join("src", "project")),
            );
            const parentIndex = paths.findIndex(
                (candidate) =>
                    candidate.includes(path.join("C:", "src")) &&
                    !candidate.includes(path.join("src", "project")),
            );

            expect(projectIndex).to.be.greaterThan(parentIndex);
        });

        test("needs no workspace", () => {
            expect(getNuGetConfigPaths()).to.not.be.empty;
        });
    });

    suite("resolveFlatContainerUrl", () => {
        test("returns the flat container resource", async () => {
            const client = createHttpClient({
                ok: true,
                data: {
                    resources: [
                        {
                            "@type": "RegistrationsBaseUrl/3.6.0",
                            "@id": "https://contoso.example/registrations/",
                        },
                        {
                            "@type": "PackageBaseAddress/3.0.0",
                            "@id": "https://contoso.example/flat2/",
                        },
                    ],
                },
            });

            expect(
                await resolveFlatContainerUrl("https://contoso.example/index.json", client),
            ).to.equal("https://contoso.example/flat2");
        });

        test("returns undefined when the feed exposes no flat container", async () => {
            const client = createHttpClient({
                ok: true,
                data: {
                    resources: [
                        {
                            "@type": "SearchQueryService/3.0.0",
                            "@id": "https://contoso.example/query",
                        },
                    ],
                },
            });

            expect(await resolveFlatContainerUrl("https://contoso.example/index.json", client)).to
                .be.undefined;
        });

        test("returns undefined when the service index cannot be read", async () => {
            const client = createHttpClient({ ok: false });

            expect(await resolveFlatContainerUrl("https://contoso.example/index.json", client)).to
                .be.undefined;
        });
    });
});
