const esbuild = require("esbuild");
const clc = require("cli-color");
const path = require("path");
const fs = require("fs").promises;
const { typecheckPlugin } = require("@jgoz/esbuild-plugin-typecheck");

// Get production flag from environment or command line args
const prod = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');

// Get watch mode flag from command line args
const watchMode = process.argv.includes('--watch') || process.argv.includes('-w');

function getTimeString() {
    return new Date().toLocaleTimeString();
}

function esbuildProblemMatcherPlugin(processName) {
    const formattedProcessName = clc.cyan(`${processName}`);
    return {
        name: "esbuild-problem-matcher",
        setup(build) {
            let timeStart;
            build.onStart(async () => {
                timeStart = Date.now();
                timeStart.toString();
                console.log(`[${getTimeString()}] Starting '${formattedProcessName}' build`);
            });
            build.onEnd(async (result) => {
                const timeEnd = Date.now();
                result.errors.forEach(({ text, location }) => {
                    console.error(`✘ [ERROR] ${text}`);
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                });
                console.log(
                    `[${getTimeString()}] Finished '${formattedProcessName}' build after ${clc.magenta(timeEnd - timeStart + " ms")} `,
                );
            });
        },
    };
}

async function buildWebviews() {
    try {
        const ctx = await esbuild.context({
            /**
             * Entry points for React webviews. This generates individual bundles (both .js and .css files)
             * for each entry point, to be used by the webview's HTML content.
             */
            entryPoints: {
                addFirewallRule: "src/views/pages/AddFirewallRule/index.tsx",
                connectionDialog: "src/views/pages/ConnectionDialog/index.tsx",
                connectionGroup: "src/views/pages/ConnectionGroup/index.tsx",
                containerDeployment: "src/views/pages/ContainerDeployment/index.tsx",
                executionPlan: "src/views/pages/ExecutionPlan/index.tsx",
                tableDesigner: "src/views/pages/TableDesigner/index.tsx",
                objectExplorerFilter: "src/views/pages/ObjectExplorerFilter/index.tsx",
                queryResult: "src/views/pages/QueryResult/index.tsx",
                userSurvey: "src/views/pages/UserSurvey/index.tsx",
                schemaDesigner: "src/views/pages/SchemaDesigner/index.tsx",
                schemaCompare: "src/views/pages/SchemaCompare/index.tsx",
            },
            bundle: true,
            outdir: "out/src/views/assets",
            platform: "browser",
            loader: {
                ".tsx": "tsx",
                ".ts": "ts",
                ".css": "css",
                ".svg": "file",
                ".js": "js",
                ".png": "file",
                ".gif": "file",
            },
            tsconfig: "./tsconfig.views.json",
            plugins: [esbuildProblemMatcherPlugin("React App"), typecheckPlugin()],
            sourcemap: prod ? false : "inline",
            metafile: true,
            minify: prod,
            minifyWhitespace: prod,
            minifyIdentifiers: prod,
            format: "esm",
            splitting: true,
        });

        if (watchMode) {
            console.log(`[${getTimeString()}] Starting watch mode for webviews...`);
            await ctx.watch();
            console.log(`[${getTimeString()}] Watching for changes...`);
            return;
        }

        console.log(`[${getTimeString()}] Starting build for webviews...`);
        const result = await ctx.rebuild();

        /**
         * Generating esbuild metafile for webviews. You can analyze the metafile https://esbuild.github.io/analyze/
         * to see the bundle size and other details.
         */
        if (result.metafile) {
            await fs.writeFile("./webviews-metafile.json", JSON.stringify(result.metafile));
            console.log(`[${getTimeString()}] Metafile written to webviews-metafile.json`);
        }

        await ctx.dispose();
        console.log(`[${getTimeString()}] Build completed successfully`);

    } catch (error) {
        console.error(`[${getTimeString()}] Build failed:`, error);
        process.exit(1);
    }
}

// Run the build function if this file is executed directly
if (require.main === module) {
    buildWebviews();
}

module.exports = { buildWebviews, esbuildProblemMatcherPlugin };