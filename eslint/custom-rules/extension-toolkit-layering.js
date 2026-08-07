module.exports = {
    meta: {
        type: "problem",
        docs: {
            description: "enforce layering inside packages/extension-toolkit",
        },
        schema: [],
        messages: {
            baseCannotImportVscode:
                "extension-toolkit/base must remain VS Code-independent. Move shared VS Code-dependent code to extension-toolkit/vscode.",
            productionCannotImportTesting:
                "extension-toolkit production code cannot import vscode/testing helpers because they contain test fakes.",
        },
    },
    create(context) {
        const filename = normalizePath(context.getFilename());

        function normalizePath(path) {
            return path.replace(/\\/g, "/");
        }

        function resolveImportPath(source) {
            if (!source.startsWith(".")) {
                return source;
            }

            const base = filename.slice(0, filename.lastIndexOf("/"));
            const parts = `${base}/${source}`.split("/");
            const resolved = [];

            for (const part of parts) {
                if (!part || part === ".") {
                    continue;
                }

                if (part === "..") {
                    resolved.pop();
                    continue;
                }

                resolved.push(part);
            }

            return resolved.join("/");
        }

        function isBaseFile() {
            return filename.includes("/packages/extension-toolkit/src/base/");
        }

        function isTestingFile() {
            return filename.includes("/packages/extension-toolkit/src/vscode/testing/");
        }

        // Keep the dependency direction base <- vscode: base contains portable
        // primitives and must not depend on the VS Code extension host. Shared
        // helpers that use the VS Code API or VS Code-dependent libraries (for
        // example, extension telemetry) are supported in the vscode layer.
        function isVscodeImport(source, resolvedSource) {
            return (
                source === "vscode" ||
                source.startsWith("vscode/") ||
                source.startsWith("extension-toolkit/vscode") ||
                resolvedSource.includes("/packages/extension-toolkit/src/vscode/")
            );
        }

        // Testing helpers may depend on either production layer, but production
        // code must not depend on testing because that would make test fakes part
        // of the shipped extension runtime.
        function isTestingImport(source, resolvedSource) {
            return (
                source.startsWith("extension-toolkit/vscode/testing") ||
                resolvedSource.includes("/packages/extension-toolkit/src/vscode/testing/")
            );
        }

        return {
            ImportDeclaration(node) {
                const source = node.source.value;
                if (typeof source !== "string") {
                    return;
                }

                const resolvedSource = resolveImportPath(source);

                if (isBaseFile() && isVscodeImport(source, resolvedSource)) {
                    context.report({
                        node,
                        messageId: "baseCannotImportVscode",
                    });
                }

                if (!isTestingFile() && isTestingImport(source, resolvedSource)) {
                    context.report({
                        node,
                        messageId: "productionCannotImportTesting",
                    });
                }
            },
        };
    },
};
