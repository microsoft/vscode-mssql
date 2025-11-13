/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as vscode from "vscode";
import { getEditorInstanceKey, getDocumentUriFromEditorKey } from "../../src/utils/utils";

suite("Editor Instance Key Tests", () => {
    const testUri = vscode.Uri.file("/test/file.sql");
    const testUriString = testUri.toString(true);

    test("getEditorInstanceKey should generate key with view column", () => {
        const mockEditor = {
            document: {
                uri: testUri,
            },
            viewColumn: vscode.ViewColumn.Two,
        } as vscode.TextEditor;

        const key = getEditorInstanceKey(mockEditor);
        assert.strictEqual(key, `${testUriString}::2`);
    });

    test("getEditorInstanceKey should use ViewColumn.One as default", () => {
        const mockEditor = {
            document: {
                uri: testUri,
            },
            viewColumn: undefined,
        } as vscode.TextEditor;

        const key = getEditorInstanceKey(mockEditor);
        assert.strictEqual(key, `${testUriString}::1`);
    });

    test("getEditorInstanceKey should return undefined for invalid editor", () => {
        const key = getEditorInstanceKey(undefined);
        assert.strictEqual(key, undefined);
    });

    test("getDocumentUriFromEditorKey should extract URI from editor key", () => {
        const editorKey = `${testUriString}::2`;
        const uri = getDocumentUriFromEditorKey(editorKey);
        assert.strictEqual(uri, testUriString);
    });

    test("getDocumentUriFromEditorKey should handle plain URI without view column", () => {
        const uri = getDocumentUriFromEditorKey(testUriString);
        assert.strictEqual(uri, testUriString);
    });

    test("getDocumentUriFromEditorKey should return undefined for invalid key", () => {
        const uri = getDocumentUriFromEditorKey(undefined);
        assert.strictEqual(uri, undefined);
    });

    test("Different view columns should generate different keys", () => {
        const editor1 = {
            document: { uri: testUri },
            viewColumn: vscode.ViewColumn.One,
        } as vscode.TextEditor;

        const editor2 = {
            document: { uri: testUri },
            viewColumn: vscode.ViewColumn.Two,
        } as vscode.TextEditor;

        const key1 = getEditorInstanceKey(editor1);
        const key2 = getEditorInstanceKey(editor2);

        assert.notStrictEqual(key1, key2);
        assert.strictEqual(key1, `${testUriString}::1`);
        assert.strictEqual(key2, `${testUriString}::2`);
    });

    test("Same view column should generate same key", () => {
        const editor1 = {
            document: { uri: testUri },
            viewColumn: vscode.ViewColumn.Two,
        } as vscode.TextEditor;

        const editor2 = {
            document: { uri: testUri },
            viewColumn: vscode.ViewColumn.Two,
        } as vscode.TextEditor;

        const key1 = getEditorInstanceKey(editor1);
        const key2 = getEditorInstanceKey(editor2);

        assert.strictEqual(key1, key2);
    });

    test("Editor instance key should contain document URI", () => {
        const editor = {
            document: { uri: testUri },
            viewColumn: vscode.ViewColumn.Three,
        } as vscode.TextEditor;

        const key = getEditorInstanceKey(editor);
        assert.ok(key.startsWith(testUriString));
        assert.ok(key.includes("::"));
    });
});
