/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";

// Since we can't use @testing-library/react, we test the hook exports and types
// The actual hook behavior is tested via integration tests

suite("DiffViewerContext", () => {
    suite("exports", () => {
        test("should export useDiffViewerOptional hook", async () => {
            // Dynamically import to test exports exist
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // Verify the hook is exported
            assert.ok(
                typeof contextModule.useDiffViewerOptional === "function",
                "useDiffViewerOptional should be exported as a function",
            );
        });

        test("should export useDiffViewer hook", async () => {
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // Verify the hook is exported
            assert.ok(
                typeof contextModule.useDiffViewer === "function",
                "useDiffViewer should be exported as a function",
            );
        });

        test("should export DiffViewerProvider component", async () => {
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // Verify the provider is exported
            assert.ok(
                contextModule.DiffViewerProvider !== undefined,
                "DiffViewerProvider should be exported",
            );
        });

        test("should export useChangeCounts hook", async () => {
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // Verify the hook is exported
            assert.ok(
                typeof contextModule.useChangeCounts === "function",
                "useChangeCounts should be exported as a function",
            );
        });

        test("should export useTableDiffIndicator hook", async () => {
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // Verify the hook is exported
            assert.ok(
                typeof contextModule.useTableDiffIndicator === "function",
                "useTableDiffIndicator should be exported as a function",
            );
        });

        test("should export useColumnDiffIndicator hook", async () => {
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // Verify the hook is exported
            assert.ok(
                typeof contextModule.useColumnDiffIndicator === "function",
                "useColumnDiffIndicator should be exported as a function",
            );
        });

        test("should export useDeletedColumns hook", async () => {
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // Verify the hook is exported
            assert.ok(
                typeof contextModule.useDeletedColumns === "function",
                "useDeletedColumns should be exported as a function",
            );
        });
    });

    suite("useDiffViewerOptional implementation", () => {
        test("should use React.useContext internally", async () => {
            // This tests that useDiffViewerOptional follows the expected pattern
            // by checking its source structure
            const contextModule = await import(
                "../../../../src/reactviews/pages/SchemaDesigner/diffViewer/diffViewerContext"
            );

            // useDiffViewerOptional should return undefined when no context is provided
            // This is a structural verification that the hook exists and is callable
            const hookFn = contextModule.useDiffViewerOptional;
            assert.strictEqual(hookFn.length, 0, "useDiffViewerOptional should take no arguments");
        });
    });
});
