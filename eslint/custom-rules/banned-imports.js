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
                const isFileInTest = /\/test\//.test(filePath);
                const isImportFromVscodeClient = /vscode-languageclient/.test(importSource);

                // Importing *reactviews* from outside reactviews
                if (isImportFromReactviews && !isFileInReactviews && !isFileInTest) {
                    context.report({
                        node,
                        message:
                            "Importing from 'reactviews' is not allowed outside the reactviews directory (except in test).",
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

                // sqlLanguage core purity (language-service design 05 §6.2): the engine
                // must stay isomorphic/rehostable. core/** + features/** + data/** +
                // provider type surface may not import vscode, node builtins, services,
                // or feature-host code. Only provider/catalogProvider.ts and host/** may
                // integrate; testSupport is exempt from the services ban but not vscode.
                const isFileInSqlLanguagePure =
                    /\/src\/sqlLanguage\/(core|features|data)\//.test(filePath) ||
                    /\/src\/sqlLanguage\/provider\/(types|nullProvider|fixtureProvider|overlayView)\.ts$/.test(
                        filePath,
                    ) ||
                    /\/src\/sqlLanguage\/api\.ts$/.test(filePath);
                if (isFileInSqlLanguagePure) {
                    const isVscodeImport =
                        importSource === "vscode" || /^vscode-/.test(importSource);
                    const isNodeBuiltin =
                        /^node:/.test(importSource) ||
                        [
                            "fs",
                            "path",
                            "os",
                            "child_process",
                            "crypto",
                            "util",
                            "events",
                            "stream",
                        ].includes(importSource);
                    const currentDir = path.dirname(filePath);
                    const resolvedImport = importSource.startsWith(".")
                        ? toPosix(path.resolve(currentDir, importSource))
                        : "";
                    const escapesSqlLanguage =
                        resolvedImport !== "" &&
                        /\/src\//.test(resolvedImport) &&
                        !/\/src\/sqlLanguage\//.test(resolvedImport);
                    if (isVscodeImport || isNodeBuiltin || escapesSqlLanguage) {
                        context.report({
                            node,
                            message:
                                "sqlLanguage core/features/provider-types must stay pure: no vscode, node builtins, or imports outside src/sqlLanguage (design 05 §6.2). Integrate via provider/catalogProvider.ts or host/**.",
                        });
                    }
                }

                // STS2 wire DTO containment (documented in src/services/sts2/wire/v2.ts):
                // nothing outside src/services/sts2/ may import the wire module.
                const isImportOfSts2Wire =
                    /\/sts2\/wire\//.test(importSource) || /(^|\/)wire\/v2$/.test(importSource);
                const isFileInSts2 = /\/src\/services\/sts2\//.test(filePath);
                if (isImportOfSts2Wire && !isFileInSts2 && !isFileInTest) {
                    context.report({
                        node,
                        message:
                            "STS2 wire DTOs are contained: only src/services/sts2/** may import sts2/wire (v2.ts module contract).",
                    });
                }

                // OE v2 boundaries (oe-docs oe_view_design §6.2):
                // (a) pure tree modules import no vscode, no classic OE, no
                //     data-plane singletons/concrete metadata services;
                // (b) all of objectExplorer/v2 (except legacy/**) stays off
                //     classic OE modules and ConnectionManager — legacy
                //     handoff is the only door.
                const isFileInOeV2 = /\/src\/objectExplorer\/v2\//.test(filePath);
                const isFileInOeV2PureTree = /\/src\/objectExplorer\/v2\/(tree|sessions)\//.test(
                    filePath,
                );
                const isFileInOeV2Legacy = /\/src\/objectExplorer\/v2\/legacy\//.test(filePath);
                if (isFileInOeV2PureTree && !isFileInTest) {
                    const bansForPure =
                        importSource === "vscode" ||
                        /sqlDataPlaneService/.test(importSource) ||
                        /metadataStoreService/.test(importSource) ||
                        /\/objectExplorer\/(?!v2\/)/.test(importSource) ||
                        /\.\.\/\.\.\/(nodes|objectExplorerService|objectExplorerProvider)/.test(
                            importSource,
                        );
                    if (bansForPure) {
                        context.report({
                            node,
                            message:
                                "OE v2 tree/sessions modules must stay pure: no vscode, no classic Object Explorer modules, no data-plane/metadata singletons (oe_view_design §6.2). Integrate at the provider/activation edge.",
                        });
                    }
                }
                if (isFileInOeV2 && !isFileInOeV2Legacy && !isFileInTest) {
                    const bansClassicOe =
                        /\/objectExplorer\/objectExplorerService/.test(importSource) ||
                        /\/objectExplorer\/nodes\//.test(importSource) ||
                        /\/models\/contracts\/objectExplorer\//.test(importSource) ||
                        /connectionManager$/.test(importSource);
                    if (bansClassicOe) {
                        context.report({
                            node,
                            message:
                                "OE v2 must not import classic Object Explorer modules or ConnectionManager outside objectExplorer/v2/legacy/** (explicit handoff is the only door — oe_view_design §7.5/§12).",
                        });
                    }
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
