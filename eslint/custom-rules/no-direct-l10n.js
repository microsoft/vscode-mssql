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

function isDirectL10nCall(node, l10nIdentifiers, vscodeNamespaceIdentifiers) {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
        return false;
    }

    const { object, property } = node.callee;
    if (property.type !== "Identifier" || property.name !== "t") {
        return false;
    }

    if (object.type === "Identifier" && l10nIdentifiers.has(object.name)) {
        return true;
    }

    return (
        object.type === "MemberExpression" &&
        object.object.type === "Identifier" &&
        vscodeNamespaceIdentifiers.has(object.object.name) &&
        object.property.type === "Identifier" &&
        object.property.name === "l10n"
    );
}

function trackVscodeLocalizationImports(node, l10nIdentifiers, vscodeNamespaceIdentifiers) {
    if (node.source.value !== "vscode") {
        return;
    }

    for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
            vscodeNamespaceIdentifiers.add(specifier.local.name);
        } else if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "l10n"
        ) {
            l10nIdentifiers.add(specifier.local.name);
        }
    }
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

        const l10nIdentifiers = new Set(["l10n"]);
        const vscodeNamespaceIdentifiers = new Set(["vscode"]);

        return {
            ImportDeclaration(node) {
                trackVscodeLocalizationImports(node, l10nIdentifiers, vscodeNamespaceIdentifiers);
            },
            CallExpression(node) {
                if (isDirectL10nCall(node, l10nIdentifiers, vscodeNamespaceIdentifiers)) {
                    context.report({
                        node,
                        messageId: "noDirectL10n",
                    });
                }
            },
        };
    },
};
