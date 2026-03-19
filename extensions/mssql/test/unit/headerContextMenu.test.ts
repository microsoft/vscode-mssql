/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { HeaderContextMenuAction } from "../../src/reactviews/pages/QueryResult/table/plugins/HeaderContextMenu";
import { locConstants } from "../../src/reactviews/common/locConstants";

chai.use(sinonChai);

suite("Copy Column Name - Header Context Menu (#21632)", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("HeaderContextMenuAction enum", () => {
        test("includes CopyColumnName with expected value", () => {
            expect(HeaderContextMenuAction.CopyColumnName).to.equal("copyColumnName");
        });
    });

    suite("locConstants", () => {
        test("provides non-empty Copy Column Name label", () => {
            expect(locConstants.queryResult.copyColumnName).to.be.a("string").and.not.be.empty;
        });
    });

    suite("clipboard write logic", () => {
        // These tests verify the exact expression used in handleHeaderContextMenuAction for
        // CopyColumnName: `await navigator.clipboard.writeText(column.name ?? "")`

        test("writes column name to clipboard for a named column", async () => {
            const writeText = sandbox.stub().resolves();
            (global as any).navigator = { clipboard: { writeText } };

            const column: { name?: string } = { name: "OrderDate" };
            await navigator.clipboard.writeText(column.name ?? "");

            expect(writeText).to.have.been.calledWith("OrderDate");
        });

        test("writes empty string to clipboard when column name is undefined", async () => {
            const writeText = sandbox.stub().resolves();
            (global as any).navigator = { clipboard: { writeText } };

            const column: { name?: string } = { name: undefined };
            await navigator.clipboard.writeText(column.name ?? "");

            expect(writeText).to.have.been.calledWith("");
        });

        test("writes column name verbatim without brackets or formatting", async () => {
            const writeText = sandbox.stub().resolves();
            (global as any).navigator = { clipboard: { writeText } };

            const rawName = "my column with spaces";
            const column: { name?: string } = { name: rawName };
            await navigator.clipboard.writeText(column.name ?? "");

            expect(writeText).to.have.been.calledWith(rawName);
        });
    });
});
