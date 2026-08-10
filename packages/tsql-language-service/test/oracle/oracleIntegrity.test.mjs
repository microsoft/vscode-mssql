/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";
import {
    oracleAreas,
    oracleCatalog,
    oracleFixtures,
    resolveSelector,
    selectorsOf,
} from "./oracleFixtures.mjs";

test("oracle has unique IDs and covers every requested behavior area", () => {
    const ids = oracleFixtures.map((fixture) => fixture.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
        [...new Set(oracleFixtures.map((fixture) => fixture.area))].sort(),
        [...oracleAreas].sort(),
    );
    for (const area of oracleAreas) {
        assert.ok(
            oracleFixtures.some((fixture) => fixture.area === area && fixture.priority === "P0"),
        );
    }
});

test("every source selector resolves in the phase where it is asserted", () => {
    for (const fixture of oracleFixtures) {
        for (const assertion of fixture.assertions) {
            const selectors = selectorsOf(assertion);
            if (selectors.length === 0) {
                continue;
            }
            const phase = assertion.phase ?? "single";
            const text =
                phase === "updated"
                    ? fixture.updatedText
                    : phase === "initial"
                      ? fixture.initialText
                      : fixture.text;
            assert.equal(typeof text, "string", `${fixture.id} has no text for phase ${phase}`);
            for (const selector of selectors) {
                assert.doesNotThrow(
                    () => resolveSelector(text, selector),
                    `${fixture.id}: ${JSON.stringify(selector)}`,
                );
            }
        }
    }
});

test("diagnostic cases cannot pass through diagnostic silence", () => {
    const diagnosticFixtures = oracleFixtures.filter((fixture) =>
        fixture.assertions.some((assertion) => assertion.kind === "diagnostic"),
    );
    assert.ok(diagnosticFixtures.length >= 10);
    for (const fixture of diagnosticFixtures) {
        for (const assertion of fixture.assertions.filter(
            (candidate) => candidate.kind === "diagnostic",
        )) {
            assert.ok(assertion.family);
            assert.ok(assertion.target);
            assert.ok(assertion.exactCount > 0);
        }
    }
});

test("incremental fixtures require immutable predecessors and distinguish update phases", () => {
    const updates = oracleFixtures.filter((fixture) => fixture.area === "incremental");
    assert.ok(updates.length >= 5);
    for (const fixture of updates) {
        assert.equal(typeof fixture.initialText, "string");
        assert.equal(typeof fixture.updatedText, "string");
        assert.notEqual(fixture.initialText, fixture.updatedText);
        assert.ok(
            fixture.assertions.some((assertion) => assertion.kind === "prior-snapshot-immutable"),
            fixture.id,
        );
    }
});

test("fixtures are self-contained and provenance is reference-only", () => {
    assert.equal(oracleCatalog.world, "closed");
    assert.ok(oracleCatalog.schemas.dbo.Customers.DisplayName);
    for (const fixture of oracleFixtures) {
        assert.ok(fixture.provenance.length > 0, fixture.id);
        for (const source of fixture.provenance) {
            assert.match(source, /^src\/FunctionalTest\/RadParserTest\//);
            assert.ok(!source.includes(".."));
        }
    }
});
