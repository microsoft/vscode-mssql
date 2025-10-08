"use strict";
const path = require("path");

function toPosix(p) {
    return p.split(path.sep).join("/"); // turns "\" → "/"
}

module.exports = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Enforce import boundaries between extension, webview, and shared code",
            category: "Imports",
            recommended: false,
        },
        fixable: null,
        schema: [], // no options
    },
    create: function (context) {
        return {
            ImportDeclaration(node) {
                const importSource = node.source.value;
                const filePath = toPosix(context.getFilename());

                const isImportFromReactviews =
                    /(^|\/)reactviews\//.test(importSource) || importSource === "reactviews";

                const isFileInReactviews = /\/src\/reactviews\//.test(filePath);
                const isFileInSharedInterfaces = /\/src\/sharedInterfaces\//.test(filePath);
                const isImportFromVscodeClient = /vscode-languageclient/.test(importSource);

                // Importing *reactviews* from outside reactviews
                if (isImportFromReactviews && !isFileInReactviews) {
                    context.report({
                        node,
                        message:
                            "Importing from 'reactviews' is not allowed outside the reactviews directory",
                    });
                }

                // Importing *vscode-languageclient* inside forbidden folders
                if ((isFileInReactviews || isFileInSharedInterfaces) && isImportFromVscodeClient) {
                    context.report({
                        node,
                        message:
                            "Use 'vscode-jsonrpc/browser' instead of 'vscode-languageclient' inside reactviews or sharedInterfaces",
                    });
                }

                // Importing extension code (non-sharedInterfaces src/) from webview (reactviews)
                if (isFileInReactviews) {
                    // Check if import is a relative path starting with ../ or ../../ etc
                    if (importSource.startsWith("..")) {
                        // Resolve the import path relative to the current file
                        const currentDir = path.dirname(filePath);
                        const resolvedImport = toPosix(path.resolve(currentDir, importSource));

                        // Check if the resolved import is in src/ but not in sharedInterfaces/
                        const isImportInSrc = /\/src\//.test(resolvedImport);
                        const isImportInSharedInterfaces = /\/src\/sharedInterfaces\//.test(
                            resolvedImport,
                        );
                        const isImportInReactviews = /\/src\/reactviews\//.test(resolvedImport);

                        if (isImportInSrc && !isImportInSharedInterfaces && !isImportInReactviews) {
                            context.report({
                                node,
                                message:
                                    "Webview code (reactviews) cannot import extension code. Only imports from 'sharedInterfaces' are allowed.",
                            });
                        }
                    }
                }
            },
        };
    },
};
