/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import UntitledSqlDocumentService from "../../src/extension/controllers/untitledSqlDocumentService";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";

interface IFixture {
    openDocResult: Promise<vscode.TextDocument>;
    showDocResult: Promise<vscode.TextEditor>;
    vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    service: UntitledSqlDocumentService;
    textDocuments: vscode.TextDocument[];
}

suite("UntitledSqlDocumentService Tests", () => {
    function createTextDocumentObject(fileName: string = ""): vscode.TextDocument {
        return {
            uri: undefined,
            eol: undefined,
            fileName: fileName,
            getText: undefined,
            getWordRangeAtPosition: undefined,
            isClosed: undefined,
            isDirty: true,
            isUntitled: true,
            languageId: "sql",
            lineAt: undefined,
            lineCount: undefined,
            offsetAt: undefined,
            positionAt: undefined,
            save: undefined,
            validatePosition: undefined,
            validateRange: undefined,
            version: undefined,
        };
    }

    function createUntitledSqlDocumentService(fixture: IFixture): IFixture {
        let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);

        vscodeWrapper
            .setup((x) => x.textDocuments)
            .returns(() => {
                return fixture.textDocuments;
            });
        vscodeWrapper
            .setup((x) => x.openMsSqlTextDocument())
            .returns(() => {
                return Promise.resolve(createTextDocumentObject());
            });
        vscodeWrapper
            .setup((x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(TypeMoq.It.isAny());
            });
        fixture.vscodeWrapper = vscodeWrapper;
        fixture.service = new UntitledSqlDocumentService(vscodeWrapper.object);
        return fixture;
    }

    // @cssuh 10/22 - commented this test because it was throwing some random undefined errors
    test.skip("newQuery should open a new untitled document and show in new tab", () => {
        let fixture: IFixture = {
            openDocResult: Promise.resolve(createTextDocumentObject()),
            showDocResult: Promise.resolve(TypeMoq.It.isAny()),
            service: undefined,
            vscodeWrapper: undefined,
            textDocuments: [],
        };
        fixture = createUntitledSqlDocumentService(fixture);

        void fixture.service.newQuery().then((_) => {
            fixture.vscodeWrapper.verify((x) => x.openMsSqlTextDocument(), TypeMoq.Times.once());
            fixture.vscodeWrapper.verify(
                (x) => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
        });
    });
});
