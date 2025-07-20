/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const esbuild = require('esbuild');
const fs = require('fs').promises;
const logger = require('./terminal-logger');
const { typecheckPlugin } = require('@jgoz/esbuild-plugin-typecheck');


// Parse arguments
const args = process.argv.slice(2);
const isProd = args.includes('--prod') || args.includes('-p');
const isWatch = args.includes('--watch') || args.includes('-w');

function esbuildProblemMatcherPlugin(processName) {
  return {
    name: 'esbuild-problem-matcher',
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
            logger.error(`  at ${location.file}:${location.line}:${location.column}`);
          }
        });

        // Log warnings
        result.warnings.forEach(({ text, location }) => {
          logger.warning(`${text}`);
          if (location) {
            logger.warning(`  at ${location.file}:${location.line}:${location.column}`);
          }
        });

        if (result.errors.length === 0) {
          logger.success(`Finished '${processName}' build after ${duration}ms`);
        } else {
          logger.error(`Failed '${processName}' build after ${duration}ms`);
        }
      });
    }
  };
}

// Build configuration
const config = {
  entryPoints: {
    'addFirewallRule': 'src/reactviews/pages/AddFirewallRule/index.tsx',
    'connectionDialog': 'src/reactviews/pages/ConnectionDialog/index.tsx',
    'connectionGroup': 'src/reactviews/pages/ConnectionGroup/index.tsx',
    'containerDeployment': 'src/reactviews/pages/ContainerDeployment/index.tsx',
    'executionPlan': 'src/reactviews/pages/ExecutionPlan/index.tsx',
    'tableDesigner': 'src/reactviews/pages/TableDesigner/index.tsx',
    'objectExplorerFilter': 'src/reactviews/pages/ObjectExplorerFilter/index.tsx',
    'queryResult': 'src/reactviews/pages/QueryResult/index.tsx',
    'userSurvey': 'src/reactviews/pages/UserSurvey/index.tsx',
    'schemaDesigner': 'src/reactviews/pages/SchemaDesigner/index.tsx',
    'schemaCompare': 'src/reactviews/pages/SchemaCompare/index.tsx',
  },
  bundle: true,
  outdir: 'out/src/reactviews/assets',
  platform: 'browser',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
    '.svg': 'file',
    '.js': 'js',
    '.png': 'file',
    '.gif': 'file',
  },
  tsconfig: './tsconfig.react.json',
  plugins: [
    esbuildProblemMatcherPlugin('webviews'),
    typecheckPlugin()
  ],
  sourcemap: isProd ? false : 'inline',
  metafile: !isProd,
  minify: isProd,
  format: 'esm',
  splitting: true,
};

/**
 * Build once
 */
async function build() {
  const mode = isProd ? 'production' : 'development';
  logger.header(`Building webviews (${mode})`);

  try {
    const ctx = await esbuild.context(config);
    const result = await ctx.rebuild();

    // Handle errors
    if (result.errors.length > 0) {
      logger.error(`Build failed with ${result.errors.length} errors`);
      result.errors.forEach(err => logger.error(err.text));
      await ctx.dispose();
      return false;
    }

    // Show warnings
    if (result.warnings.length > 0) {
      logger.warning(`${result.warnings.length} warnings`);
    }

    // Save metafile
    if (result.metafile) {
      await fs.writeFile('./webviews-metafile.json', JSON.stringify(result.metafile));
      logger.success('Metafile saved: webviews-metafile.json');
    }

    await ctx.dispose();
    logger.success('✨ Build completed!');
    return true;

  } catch (error) {
    logger.error(`Build failed: ${error.message}`);
    return false;
  }
}

/**
 * Build in watch mode
 */
async function watch() {
  logger.header('Building webviews (watch mode)');

  try {
    const ctx = await esbuild.context(config);

    await ctx.watch();
    logger.success('👀 Watching for changes... (Ctrl+C to stop)');

    // Handle Ctrl+C
    process.on('SIGINT', async () => {
      await ctx.dispose();
      logger.success('Watch stopped');
      process.exit(0);
    });

  } catch (error) {
    logger.error(`Watch failed: ${error.message}`);
    process.exit(1);
  }
}

// Main execution
async function main() {
  if (isWatch) {
    await watch();
  } else {
    const success = await build();
    process.exit(success ? 0 : 1);
  }
}

// Export for use in other scripts
module.exports = { build, watch };

// Run if called directly
if (require.main === module) {
  main();
}