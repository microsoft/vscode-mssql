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
                "Prevent importing from views directory except from within views",
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

                const isImportFromViews =
                    /(^|\/)views\//.test(importSource) || importSource === "views";

                const isFileInViews = /\/src\/views\//.test(filePath);
                const isFileInShared = /\/src\/shared\//.test(filePath);
                const isImportFromVscodeClient = /vscode-languageclient/.test(importSource);

                // 1️⃣ importing *views* from outside views
                if (isImportFromViews && !isFileInViews) {
                    context.report({
                        node,
                        message:
                            "Importing from 'views' is not allowed outside the views directory",
                    });
                }

                // 2️⃣ importing *vscode-languageclient* inside forbidden folders
                if ((isFileInViews || isFileInShared) && isImportFromVscodeClient) {
                    context.report({
                        node,
                        message:
                            "Use 'vscode-jsonrpc/browser' instead of 'vscode-languageclient' inside views or shared",
                    });
                }
            },
        };
    },
};
