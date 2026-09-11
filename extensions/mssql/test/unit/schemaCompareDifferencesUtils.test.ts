/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { DiffEntry } from "vscode-mssql";
import {
    applyDifferenceDetails,
    applyInclusionUpdates,
} from "../../src/webviews/pages/SchemaCompare/schemaCompareDifferencesUtils";

suite("Schema Compare difference list updates", () => {
    const makeDifference = (name: string, included: boolean): DiffEntry =>
        ({
            name: "Table",
            sourceValue: ["dbo", name],
            targetValue: ["dbo", name],
            included,
            hasDetails: false,
            children: [],
        }) as unknown as DiffEntry;

    let differences: DiffEntry[];

    setup(() => {
        differences = [
            makeDifference("Customers", true),
            makeDifference("Orders", true),
            makeDifference("Products", false),
        ];
    });

    test("applyInclusionUpdates only replaces rows whose inclusion changed", () => {
        const updated = applyInclusionUpdates(differences, [
            { id: 0, included: false },
            { id: 1, included: true },
        ]);

        expect(updated.map((d) => d.included)).to.deep.equal([false, true, false]);
        expect(updated[0], "a changed row is a new object").to.not.equal(differences[0]);
        expect(updated[1], "an unchanged row keeps its identity").to.equal(differences[1]);
        expect(updated[2], "an unlisted row keeps its identity").to.equal(differences[2]);
    });

    test("applyInclusionUpdates returns the same array when there is nothing to apply", () => {
        expect(applyInclusionUpdates(differences, [])).to.equal(differences);
    });

    test("applyInclusionUpdates ignores ids outside the list", () => {
        const updated = applyInclusionUpdates(differences, [{ id: 7, included: false }]);
        expect(updated.map((d) => d.included)).to.deep.equal([true, true, false]);
    });

    test("applyDifferenceDetails keeps the inclusion currently shown", () => {
        // Simulates an Include All that is still pending: the row shows included=true while the
        // service response for its details still carries the old included=false.
        const optimistic = applyInclusionUpdates(differences, [{ id: 2, included: true }]);
        const details = {
            ...makeDifference("Products", false),
            hasDetails: true,
            sourceScript: "CREATE TABLE [dbo].[Products] (...)",
        } as DiffEntry;

        const updated = applyDifferenceDetails(optimistic, 2, details);

        expect(updated[2].hasDetails).to.be.true;
        expect(updated[2].sourceScript).to.equal(details.sourceScript);
        expect(updated[2].included, "details must not undo a pending checkbox change").to.be.true;
        expect(updated[0]).to.equal(optimistic[0]);
        expect(updated[1]).to.equal(optimistic[1]);
    });

    test("applyDifferenceDetails ignores rows that no longer exist", () => {
        const details = { ...makeDifference("Gone", true), hasDetails: true } as DiffEntry;
        expect(applyDifferenceDetails(differences, 5, details)).to.equal(differences);
    });
});
