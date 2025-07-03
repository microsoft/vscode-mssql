"use strict";
const path = require("path");

function toPosix(p) {
  return p.split(path.sep).join("/"); // turns "\" → "/"
}

module.exports = {
    meta: {
        type: "suggestion",
        docs: {
            description:
                "Prevent importing from reactviews directory except from within reactviews",
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

                // 1️⃣ importing *reactviews* from outside reactviews
                if (isImportFromReactviews && !isFileInReactviews) {
                    context.report({
                        node,
                        message:
                            "Importing from 'reactviews' is not allowed outside the reactviews directory",
                    });
                }

                // 2️⃣ importing *vscode-languageclient* inside forbidden folders
                if ((isFileInReactviews || isFileInSharedInterfaces) && isImportFromVscodeClient) {
                    context.report({
                        node,
                        message:
                            "Use 'vscode-jsonrpc/browser' instead of 'vscode-languageclient' inside reactviews or sharedInterfaces",
                    });
                }
            },
        };
    },
};
