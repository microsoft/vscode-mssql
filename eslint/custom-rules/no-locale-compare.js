"use strict";

/**
 * Bans String.prototype.localeCompare in determinism-critical ordering
 * paths (metadata catalog, language service, scripting emitters, AI
 * schema-context projection). localeCompare delegates to the embedded ICU
 * collator, whose output changes across Electron/VS Code updates and
 * platforms — persisted metadata ordering, the byte-identical schema
 * context guarantee, prompt caches, and replay comparison all break under
 * that drift (metadata cache/drift review, finding C-1). Use
 * ordinalCompare from services/metadata/catalogModel instead; UI-only
 * presentation sorts belong outside the scoped directories.
 */
module.exports = {
    meta: {
        type: "problem",
        docs: {
            description:
                "Disallow ICU-dependent localeCompare in determinism-critical ordering paths",
            category: "Determinism",
            recommended: false,
        },
        fixable: null,
        schema: [],
    },
    create: function (context) {
        return {
            CallExpression(node) {
                const callee = node.callee;
                if (
                    callee &&
                    callee.type === "MemberExpression" &&
                    !callee.computed &&
                    callee.property &&
                    callee.property.name === "localeCompare"
                ) {
                    context.report({
                        node: callee.property,
                        message:
                            "localeCompare is ICU/collation-dependent and breaks byte-identity across " +
                            "Electron/platform updates (cache design C-1). Use ordinalCompare from " +
                            "services/metadata/catalogModel for deterministic ordering.",
                    });
                }
            },
        };
    },
};
