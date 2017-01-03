import * as TypeMoq from 'typemoq';
import vscode = require('vscode');
import UntitledSqlDocumentService from '../src/controllers/untitledSqlDocumentService';
import VscodeWrapper from '../src/controllers/vscodeWrapper';
const fse = require('fs-extra');
const fs = require('fs');

interface IFixture {
    openDocResult: Promise<vscode.TextDocument>;
    showDocResult: Promise<vscode.TextEditor>;
    vscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
    service: UntitledSqlDocumentService;
    textDocuments: vscode.TextDocument[];
}

suite('UntitledSqlDocumentService Tests', () => {

     function createTextDocumentObject(fileName: string = ''): vscode.TextDocument {
         return {
            uri: undefined,
            fileName: fileName,
            getText: undefined,
            getWordRangeAtPosition: undefined,
            isDirty: true,
            isUntitled: true,
            languageId: 'sql',
            lineAt: undefined,
            lineCount: undefined,
            offsetAt: undefined,
            positionAt: undefined,
            save: undefined,
            validatePosition: undefined,
            validateRange: undefined,
            version: undefined
        };
     }

     function createUntitledSqlDocumentService(fixture: IFixture): IFixture {
         let vscodeWrapper: TypeMoq.Mock<VscodeWrapper>;
         vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper);

         vscodeWrapper.setup(x => x.textDocuments).returns(() => { return fixture.textDocuments; });
         vscodeWrapper.setup(x => x.openTextDocument(TypeMoq.It.isAny()))
         .returns(() => { return Promise.resolve(createTextDocumentObject()); });
         vscodeWrapper.setup(x => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
         .returns(() => { return Promise.resolve(TypeMoq.It.isAny()); });
         fixture.vscodeWrapper = vscodeWrapper;
         fixture.service = new UntitledSqlDocumentService(vscodeWrapper.object);
         return fixture;
     }

     test('newQuery should open a new untitled document and show in new tab' , () => {
        let fixture: IFixture = {
            openDocResult: Promise.resolve(createTextDocumentObject()),
            showDocResult: Promise.resolve(TypeMoq.It.isAny()),
            service: undefined,
            vscodeWrapper: undefined,
            textDocuments: []
        };
        fixture = createUntitledSqlDocumentService(fixture);

        return fixture.service.newQuery().then(result => {
            fixture.vscodeWrapper.verify(x => x.openTextDocument(
                TypeMoq.It.is<vscode.Uri>(d => d.scheme === 'untitled')), TypeMoq.Times.once());
            fixture.vscodeWrapper.verify(x => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
     });

     test('newQuery should increment the counter for untitled document if file exits' , () => {
        let fixture: IFixture = {
            openDocResult: Promise.resolve(createTextDocumentObject()),
            showDocResult: Promise.resolve(TypeMoq.It.isAny()),
            service: undefined,
            vscodeWrapper: undefined,
            textDocuments: []
        };
        let counter = getCounterForUntitledFile(1);
        fixture = createUntitledSqlDocumentService(fixture);
        let filePath = UntitledSqlDocumentService.createFilePath(counter);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, 'test');
        }
        return fixture.service.newQuery().then(result => {
            fixture.vscodeWrapper.verify(x => x.openTextDocument(
                TypeMoq.It.is<vscode.Uri>(d => verifyDocumentUri(d, counter + 1))), TypeMoq.Times.once());
            fixture.vscodeWrapper.verify(x => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
            if (!fs.existsSync(filePath)) {
                fse.remove(filePath, undefined);
            }
        });
     });

     function verifyDocumentUri(uri: vscode.Uri, expectedNumber: number): boolean {
         return uri.scheme === 'untitled' && uri.path.endsWith(`${expectedNumber}.sql`);
     }

     function getCounterForUntitledFile(start: number): number {
        let counter = start;
        let filePath = UntitledSqlDocumentService.createFilePath(counter);
        while (fs.existsSync(filePath)) {
            counter++;
            filePath = UntitledSqlDocumentService.createFilePath(counter);
        }
        return counter;
     }

     test('newQuery should increment the counter for untitled document given text documents already open with current counter' , () => {
        let counter = getCounterForUntitledFile(1);
        let fixture: IFixture = {
            openDocResult: Promise.resolve(createTextDocumentObject()),
            showDocResult: Promise.resolve(TypeMoq.It.isAny()),
            service: undefined,
            vscodeWrapper: undefined,
            textDocuments: [
                createTextDocumentObject(UntitledSqlDocumentService.createFilePath(counter + 1)),
                createTextDocumentObject(UntitledSqlDocumentService.createFilePath(counter))]
        };
        fixture = createUntitledSqlDocumentService(fixture);
        let service = fixture.service;

        return service.newQuery().then(result => {
            fixture.vscodeWrapper.verify(x => x.openTextDocument(
                TypeMoq.It.is<vscode.Uri>(d => verifyDocumentUri(d, counter + 2))), TypeMoq.Times.once());
            fixture.vscodeWrapper.verify(x => x.showTextDocument(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()), TypeMoq.Times.once());
        });
     });
});

