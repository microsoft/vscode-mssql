#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 * Simple Asset Copy Script
 * Easy-to-configure file copying that replaces Gulp tasks
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs').promises;
const path = require('path');
const logger = require('./terminal-logger');

// 🔧 COPY TASKS CONFIGURATION - Add/remove tasks here
const COPY_TASKS = [
  {
    name: 'Object Explorer Assets',
    source: 'src/objectExplorer/objectTypes',
    destination: 'out/src/objectExplorer/objectTypes'
  },
  {
    name: 'Query History Assets',
    source: 'src/queryHistory/icons',
    destination: 'out/src/queryHistory/icons'
  },
  {
    name: 'Test Resources',
    source: 'test/resources',
    destination: 'out/test/resources'
  },
  {
    name: 'Configuration Files',
    source: 'src/configurations/config.json',
    destination: 'out/src/config.json'
  }
];

/**
 * Copy files from source to destination
 */
async function copyFiles(src, dest, filter = null) {
  let count = 0;

  try {
    const srcStats = await fs.stat(src);

    if (srcStats.isFile()) {
      if (!filter || filter(src)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
        count = 1;
      }
    } else if (srcStats.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isFile()) {
          if (!filter || filter(srcPath)) {
            await fs.copyFile(srcPath, destPath);
            count++;
          }
        } else if (entry.isDirectory()) {
          count += await copyFiles(srcPath, destPath, filter);
        }
      }
    }
  } catch (error) {
    throw new Error(`Copy failed: ${error.message}`);
  }

  return count;
}

/**
 * Execute a single copy task
 */
async function executeTask(task) {
  logger.step(task.name);

  try {
    const src = path.resolve(task.source);
    const dest = path.resolve(task.destination);

    // Check if source exists
    await fs.access(src);

    const count = await copyFiles(src, dest, task.filter);
    logger.success(`Copied ${count} files`);
    return { success: true, count };

  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warning('Source not found, skipping');
      return { success: true, count: 0 };
    }

    logger.error(error.message);
    return { success: false, count: 0 };
  }
}

/**
 * Run all copy tasks
 */
async function copyAllAssets() {
  logger.header('Copying Assets');

  let totalFiles = 0;
  let errors = 0;

  for (const task of COPY_TASKS) {
    const result = await executeTask(task);
    totalFiles += result.count;
    if (!result.success) errors++;
  }

  logger.newline();
  if (errors === 0) {
    logger.success(`✨ Done! Copied ${totalFiles} files`);
  } else {
    logger.warning(`⚠ Completed with ${errors} errors`);
  }
}

module.exports = {
  copyAllAssets,
  COPY_TASKS
};

// Run if called directly
if (require.main === module) {
  copyAllAssets()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}