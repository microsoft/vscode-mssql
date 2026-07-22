/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { localManagedArtifactFileName } from "../../src/runbookStudio/runtime/localManagedArtifacts";

suite("Runbook Studio managed artifact filenames", () => {
    test("[artifact-folder-routing] preserves closed semantic extensions", () => {
        expect(localManagedArtifactFileName("extract", "WideWorldImporters.dacpac")).to.equal(
            "extract-WideWorldImporters.dacpac",
        );
        expect(localManagedArtifactFileName("compare/report", "schema-comparison.XML")).to.equal(
            "compare_report-schema-comparison.xml",
        );
        expect(localManagedArtifactFileName("compare", "schema-comparison.json")).to.equal(
            "compare-schema-comparison.json",
        );
        expect(localManagedArtifactFileName("collect", "../../capture 1.xel")).to.equal(
            "collect-capture_1.xel",
        );
    });

    test("[artifact-folder-routing] refuses unregistered extensions", () => {
        expect(() => localManagedArtifactFileName("extract", "database_dacpac")).to.throw(
            "unsupported managed artifact extension '(none)'",
        );
        expect(() => localManagedArtifactFileName("report", "report.sql")).to.throw(
            "unsupported managed artifact extension '.sql'",
        );
    });
});
