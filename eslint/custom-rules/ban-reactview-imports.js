"use strict";

module.exports = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Prevent importing from webviews directory except from within webviews",
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
                const currentFilePath = context.getFilename();

                // Check if the import is from webviews directory
                const isImportFromWebviews =
                    importSource.includes("/reactviews/") ||
                    importSource.startsWith("reactviews/") ||
                    importSource === "reactviews";

                // Check if the current file is in webviews directory
                const isFileInWebviews = currentFilePath.includes("/src/reactviews/");

                // If importing from webviews but not within webviews, report an error
                if (isImportFromWebviews && !isFileInWebviews) {
                    context.report({
                        node,
                        message:
                            "Importing from 'reactviews' directory is not allowed outside of the reactviews directory",
                    });
                }
            },
        };
    },
};
