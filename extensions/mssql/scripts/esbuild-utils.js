/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const esbuild = require("esbuild");
const fs = require("fs").promises;
const logger = require("../../../scripts/terminal-logger");

function esbuildProblemMatcherPlugin(processName) {
  return {
    name: "esbuild-problem-matcher",
    setup(build) {
      let timeStart;

      build.onStart(() => {
        timeStart = Date.now();
        logger.step(`Starting '${processName}' build`);
      });

      build.onEnd((result) => {
        const timeEnd = Date.now();
        const duration = timeEnd - timeStart;

        // Log errors with file locations
        result.errors.forEach(({ text, location }) => {
          logger.error(`${text}`);
          if (location) {
            logger.error(
              `  at ${location.file}:${location.line}:${location.column}`,
            );
          }
        });

        // Log warnings
        result.warnings.forEach(({ text, location }) => {
          logger.warning(`${text}`);
          if (location) {
            logger.warning(
              `  at ${location.file}:${location.line}:${location.column}`,
            );
          }
        });

        if (result.errors.length === 0) {
          logger.success(`Finished '${processName}' build after ${duration}ms`);
        } else {
          logger.error(`Failed '${processName}' build after ${duration}ms`);
        }
      });
    },
  };
}

/**
 * Build once
 */
async function build(config, isProd = false) {
  try {
    logger.info(`Building in ${isProd ? "production" : "development"} mode...`);
    const ctx = await esbuild.context(config);
    const result = await ctx.rebuild();

    // Handle errors
    if (result.errors.length > 0) {
      logger.error(`Build failed with ${result.errors.length} errors`);
      result.errors.forEach((err) => logger.error(err.text));
      await ctx.dispose();
      return false;
    }

    // Show warnings
    if (result.warnings.length > 0) {
      logger.warning(`${result.warnings.length} warnings`);
    }

    // Save metafile
    if (result.metafile) {
      await fs.writeFile(
        "./webviews-metafile.json",
        JSON.stringify(result.metafile),
      );
      logger.success("Metafile saved: webviews-metafile.json");
    }

    await ctx.dispose();
    logger.success("Build completed!");
    return true;
  } catch (error) {
    logger.error(`Build failed: ${error.message}`);
    return false;
  }
}

/**
 * Build in watch mode
 */
async function watch(config) {
  try {
    const ctx = await esbuild.context(config);

    await ctx.watch();
    logger.success("Watching for changes... (Ctrl+C to stop)");

    // Handle Ctrl+C
    process.on("SIGINT", async () => {
      await ctx.dispose();
      logger.success("Watch stopped");
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Watch failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  esbuildProblemMatcherPlugin,
  build,
  watch,
};
