"use strict";

const path = require("path");

const ALLOWED_LOCALIZATION_FILES = new Set([
    "extensions/mssql/src/constants/locConstants.ts",
    "extensions/mssql/src/webviews/common/locConstants.ts",
    "extensions/sql-database-projects/src/common/constants.ts",
]);

function toPosix(filePath) {
    return filePath.split(path.sep).join("/");
}

function isAllowedLocalizationFile(filePath) {
    const normalizedPath = toPosix(filePath);
    if (/\/test\//.test(normalizedPath)) {
        return true;
    }

    return [...ALLOWED_LOCALIZATION_FILES].some((allowedFile) =>
        normalizedPath.endsWith(allowedFile),
    );
}

function isDirectL10nCall(node) {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
        return false;
    }

    const { object, property } = node.callee;
    if (property.type !== "Identifier" || property.name !== "t") {
        return false;
    }

    if (object.type === "Identifier" && object.name === "l10n") {
        return true;
    }

    return (
        object.type === "MemberExpression" &&
        object.object.type === "Identifier" &&
        object.object.name === "vscode" &&
        object.property.type === "Identifier" &&
        object.property.name === "l10n"
    );
}

module.exports = {
    meta: {
        type: "problem",
        docs: {
            description: "Disallow direct localization calls outside dedicated localization files",
            category: "Localization",
            recommended: false,
        },
        fixable: null,
        schema: [],
        messages: {
            noDirectL10n:
                "Localized strings must be declared in a dedicated localization constants file.",
        },
    },
    create(context) {
        if (isAllowedLocalizationFile(context.getFilename())) {
            return {};
        }

        return {
            CallExpression(node) {
                if (isDirectL10nCall(node)) {
                    context.report({
                        node,
                        messageId: "noDirectL10n",
                    });
                }
            },
        };
    },
};
