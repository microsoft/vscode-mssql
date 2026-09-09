/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { ContextMenu } from "../../../src/webviews/pages/QueryResult/table/plugins/contextMenu.plugin";
import {
    GridContextMenuAction,
    OpenGeneratedQueryRequest,
    type ResultSetSummary,
} from "../../../src/sharedInterfaces/queryResult";
import type { QueryResultReactProvider } from "../../../src/webviews/pages/QueryResult/queryResultStateProvider";

function makeRange(fromRow: number, toRow: number, fromCell: number, toCell: number) {
    return { fromRow, toRow, fromCell, toCell };
}

function makeCol(index: number, name: string): Slick.Column<Slick.SlickData> {
    return { field: String(index), id: String(index), name } as Slick.Column<Slick.SlickData>;
}

suite("ContextMenu (legacy grid) generate-* actions", () => {
    const sandbox = sinon.createSandbox();
    let slickDescriptor: PropertyDescriptor | undefined;
    let navigatorDescriptor: PropertyDescriptor | undefined;

    suiteSetup(() => {
        slickDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Slick");
        Object.defineProperty(globalThis, "Slick", {
            value: {
                EventHandler: class {
                    public subscribe = sandbox.stub();
                    public unsubscribeAll = sandbox.stub();
                },
            },
            configurable: true,
        });
        // generateSelect/generateUpdate/generateDelete/generateInsertForRows call getEOL(),
        // which reads navigator.userAgent; the extension-host test process has no `navigator`
        // global, so stub one (same pattern as sqlScriptGenerator.test.ts).
        navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            },
            configurable: true,
        });
    });

    suiteTeardown(() => {
        if (slickDescriptor) {
            Object.defineProperty(globalThis, "Slick", slickDescriptor);
        }
        if (navigatorDescriptor) {
            Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
        } else {
            delete (globalThis as any).navigator;
        }
    });

    teardown(() => sandbox.restore());

    const columnInfo = [
        {
            dataTypeName: "int",
            baseColumnName: "Id",
            baseTableName: "Customers",
            baseSchemaName: "dbo",
        },
        {
            dataTypeName: "nvarchar",
            baseColumnName: "Name",
            baseTableName: "Customers",
            baseSchemaName: "dbo",
        },
    ] as ResultSetSummary["columnInfo"];

    const cols = [makeCol(0, "Id"), makeCol(1, "Name")];
    const row = {
        "0": { displayValue: "1", isNull: false },
        "1": { displayValue: "Alice", isNull: false },
    };

    function makeGridAndContext(selectedRanges: unknown[]) {
        const grid = {
            getSelectionModel: () => ({ getSelectedRanges: () => selectedRanges }),
            getColumns: () => cols,
            getData: () => ({ getItem: (r: number) => (r === 0 ? row : {}) }),
        };
        const sendRequest = sandbox.stub().resolves({});
        const queryResultContext = {
            log: { trace: sandbox.stub(), warn: sandbox.stub() },
            extensionRpc: { sendRequest },
            showGridContextMenu: sandbox.stub(),
            hideGridContextMenu: sandbox.stub(),
            showCopyIndicator: sandbox.stub(),
        } as unknown as QueryResultReactProvider;
        return { grid, queryResultContext, sendRequest };
    }

    test("GenerateSelect sends OpenGeneratedQueryRequest with WHERE built from the selected cell only", async () => {
        const { grid, queryResultContext, sendRequest } = makeGridAndContext([
            makeRange(0, 0, 0, 0),
        ]);
        const menu = new ContextMenu<Slick.SlickData>(
            "file:///test.sql",
            { batchId: 0, id: 0, rowCount: 1, columnInfo } as ResultSetSummary,
            queryResultContext,
        );
        menu.init(grid as unknown as Slick.Grid<Slick.SlickData>);
        await (
            menu as unknown as { handleMenuAction: (a: GridContextMenuAction) => Promise<void> }
        ).handleMenuAction(GridContextMenuAction.GenerateSelect);

        expect(sendRequest.calledOnce).to.equal(true);
        const [reqType, params] = sendRequest.firstCall.args;
        expect(reqType).to.equal(OpenGeneratedQueryRequest.type);
        expect(params.uri).to.equal("file:///test.sql");
        expect(params.sql).to.equal(
            "SELECT [Id], [Name]\r\nFROM [dbo].[Customers]\r\nWHERE [Id] = 1;",
        );
    });

    test("GenerateInsert sends a single-row INSERT for a full-row selection", async () => {
        const { grid, queryResultContext, sendRequest } = makeGridAndContext([
            makeRange(0, 0, 0, 1),
        ]);
        const menu = new ContextMenu<Slick.SlickData>(
            "file:///test.sql",
            { batchId: 0, id: 0, rowCount: 1, columnInfo } as ResultSetSummary,
            queryResultContext,
        );
        menu.init(grid as unknown as Slick.Grid<Slick.SlickData>);
        await (
            menu as unknown as { handleMenuAction: (a: GridContextMenuAction) => Promise<void> }
        ).handleMenuAction(GridContextMenuAction.GenerateInsert);

        const [, params] = sendRequest.firstCall.args;
        expect(params.sql).to.equal(
            "INSERT INTO [dbo].[Customers] ([Id], [Name])\r\nVALUES\r\n    (1, 'Alice');",
        );
    });

    test("does nothing and warns when the selection spans more than one row", async () => {
        const { grid, queryResultContext, sendRequest } = makeGridAndContext([
            makeRange(0, 1, 0, 0),
        ]);
        const menu = new ContextMenu<Slick.SlickData>(
            "file:///test.sql",
            { batchId: 0, id: 0, rowCount: 2, columnInfo } as ResultSetSummary,
            queryResultContext,
        );
        menu.init(grid as unknown as Slick.Grid<Slick.SlickData>);
        await (
            menu as unknown as { handleMenuAction: (a: GridContextMenuAction) => Promise<void> }
        ).handleMenuAction(GridContextMenuAction.GenerateSelect);

        expect(sendRequest.called).to.equal(false);
        expect((queryResultContext.log.warn as sinon.SinonStub).calledOnce).to.equal(true);
    });
});
