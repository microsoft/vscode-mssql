"use strict";

const path = require("path");

function toPosix(p) {
    return p.split(path.sep).join("/");
}

function resolveRelativeImport(importSource, filePath) {
    if (!importSource.startsWith(".")) {
        return undefined;
    }

    return toPosix(path.resolve(path.dirname(filePath), importSource));
}

function isPackagePath(filePath, layerPath) {
    return new RegExp(`/packages/vscode-extensions-common/src/${layerPath}(/|$)`).test(filePath);
}

function reportsForbiddenLayerImport(filePath, importSource) {
    if (isPackagePath(filePath, "core/base")) {
        if (importSource === "vscode") {
            return true;
        }

        const resolvedImport = resolveRelativeImport(importSource, filePath);
        return (
            resolvedImport !== undefined &&
            (isPackagePath(resolvedImport, "core/di") || isPackagePath(resolvedImport, "vscode"))
        );
    }

    if (isPackagePath(filePath, "core/di")) {
        if (importSource === "vscode") {
            return true;
        }

        const resolvedImport = resolveRelativeImport(importSource, filePath);
        return resolvedImport !== undefined && isPackagePath(resolvedImport, "vscode");
    }

    return false;
}

function checkSource(context, node) {
    if (!node.source || typeof node.source.value !== "string") {
        return;
    }

    const filePath = toPosix(context.getFilename());
    const importSource = node.source.value;

    if (reportsForbiddenLayerImport(filePath, importSource)) {
        context.report({
            node,
            message:
                "Invalid vscode-extensions-common layer import. core/base cannot depend on core/di or vscode, and core/di cannot depend on vscode.",
        });
    }
}

module.exports = {
    meta: {
        type: "problem",
        docs: {
            description:
                "Enforce layering inside packages/vscode-extensions-common: core/base -> core/di -> vscode",
            category: "Imports",
            recommended: false,
        },
        fixable: null,
        schema: [],
    },
    create(context) {
        return {
            ImportDeclaration(node) {
                checkSource(context, node);
            },
            ExportAllDeclaration(node) {
                checkSource(context, node);
            },
            ExportNamedDeclaration(node) {
                checkSource(context, node);
            },
        };
    },
};
