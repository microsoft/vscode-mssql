const fs = require('fs');
const path = require('path');

// Helper function to ensure directory exists
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Helper function to copy files with glob-like patterns
function copyFiles(srcPattern, destDir) {
    const glob = require('glob');

    const files = glob.sync(srcPattern);
    ensureDir(destDir);

    files.forEach(file => {
        const fileName = path.basename(file);
        const destPath = path.join(destDir, fileName);
        fs.copyFileSync(file, destPath);
        console.log(`Copied: ${file} -> ${destPath}`);
    });
}

// Helper function to copy directory recursively
function copyDir(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) {
        console.log(`Source directory does not exist: ${srcDir}`);
        return;
    }

    ensureDir(destDir);

    const items = fs.readdirSync(srcDir, { withFileTypes: true });

    items.forEach(item => {
        const srcPath = path.join(srcDir, item.name);
        const destPath = path.join(destDir, item.name);

        if (item.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${srcPath} -> ${destPath}`);
        }
    });
}

// Main copy function
function copyAllFiles() {
    console.log('Starting file copy process...');

    // Copy Object Explorer assets (SVG icons)
    copyFiles(
        'src/extension/objectExplorer/objectTypes/*.svg',
        'out/src/extension/objectExplorer/objectTypes'
    );

    // Copy Query History icons
    copyFiles(
        'src/extension/queryHistory/icons/*',
        'out/src/extension/queryHistory/icons'
    );

    // Copy SQL output template
    copyFiles(
        'src/extension/controllers/sqlOutput.ejs',
        'out/src/extension/controllers'
    );

    // Copy systemjs.config.js for old views
    copyFiles(
        'src/extension/oldviews/htmlcontent/systemjs.config.js',
        'out/src/extension/oldViews/htmlcontent'
    );

    // Copy configuration file
    copyFiles(
        'src/extension/configurations/config.json',
        'out/src/extension'
    );

    // Copy SystemJS config files
    copyFiles(
        'src/extension/oldViews/htmlcontent/*.js',
        'out/src/extension/oldViews/htmlcontent'
    );

    // Copy CSS files
    copyFiles(
        'src/extension/oldViews/htmlcontent/src/css/*.css',
        'out/src/extension/oldViews/htmlcontent/src/css'
    );

    // Copy images recursively
    copyDir(
        'src/extension/oldViews/htmlcontent/src/images',
        'out/src/extension/oldViews/htmlcontent/src/images'
    );

    // Copy test resources
    copyDir(
        'test/resources',
        'out/test/resources'
    );

    // Copy JavaScript files (excluding oldViews/htmlcontent)
    const jsFiles = require('glob').sync('src/**/*.js', {
        ignore: 'src/extension/oldViews/htmlcontent/**/*'
    });

    jsFiles.forEach(file => {
        const relativePath = path.relative('src', file);
        const destPath = path.join('out/src/extension', relativePath);
        ensureDir(path.dirname(destPath));
        fs.copyFileSync(file, destPath);
        console.log(`Copied JS: ${file} -> ${destPath}`);
    });

    // Copy node_modules dependencies
    console.log('Copying node_modules dependencies...');

    // Copy RxJS
    copyDir('node_modules/rxjs', 'out/src/extension/oldViews/htmlcontent/src/js/lib/rxjs');

    // Copy Angular in-memory web API
    copyDir(
        'node_modules/angular-in-memory-web-api',
        'out/src/extension/oldViews/htmlcontent/src/js/lib/angular-in-memory-web-api'
    );

    // Copy Zone.js
    copyDir(
        'node_modules/zone.js',
        'out/src/extension/oldViews/htmlcontent/src/js/lib/zone.js'
    );

    // Copy Angular
    copyDir(
        'node_modules/@angular',
        'out/src/extension/oldViews/htmlcontent/src/js/lib/@angular'
    );

    // Copy Angular2 SlickGrid
    copyDir(
        'node_modules/angular2-slickgrid/out',
        'out/src/extension/oldViews/htmlcontent/src/js/lib/angular2-slickgrid/out'
    );

    // Copy individual vendor files
    const vendorFiles = [
        'node_modules/slickgrid/lib/jquery-1.8.3.js',
        'node_modules/slickgrid/lib/jquery.event.drag-2.2.js',
        'node_modules/slickgrid/lib/jquery-ui-1.9.2.js',
        'node_modules/slickgrid/lib/slick.autosizecolumn.js',
        'node_modules/slickgrid/lib/slick.dragrowselector.js',
        'node_modules/underscore/underscore-min.js',
        'node_modules/slickgrid/slick.core.js',
        'node_modules/slickgrid/slick.grid.js',
        'node_modules/slickgrid/slick.editors.js',
        'node_modules/core-js/client/shim.min.js',
        'node_modules/rangy/lib/rangy-core.js',
        'node_modules/rangy/lib/rangy-textrange.js',
        'node_modules/reflect-metadata/Reflect.js',
        'node_modules/systemjs/dist/system.src.js'
    ];

    const vendorDestDir = 'out/src/extension/oldViews/htmlcontent/src/js/lib';
    ensureDir(vendorDestDir);

    vendorFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const fileName = path.basename(file);
            const destPath = path.join(vendorDestDir, fileName);
            fs.copyFileSync(file, destPath);
            console.log(`Copied vendor: ${file} -> ${destPath}`);
        } else {
            console.log(`Vendor file not found: ${file}`);
        }
    });

    // Copy source maps and additional files
    const additionalFiles = [
        { src: 'node_modules/reflect-metadata/Reflect.js.map', dest: 'out/src/extension/oldViews/htmlcontent/src/js/lib/Reflect.js.map' },
        { src: 'node_modules/systemjs/dist/system-polyfills.js.map', dest: 'out/src/extension/oldViews/htmlcontent/src/js/lib/system-polyfills.js.map' },
        { src: 'node_modules/systemjs-plugin-json/json.js', dest: 'out/src/extension/oldViews/htmlcontent/src/js/lib/json.js' }
    ];

    additionalFiles.forEach(({ src, dest }) => {
        if (fs.existsSync(src)) {
            ensureDir(path.dirname(dest));
            fs.copyFileSync(src, dest);
            console.log(`Copied: ${src} -> ${dest}`);
        } else {
            console.log(`File not found: ${src}`);
        }
    });

    // Copy CSS dependencies
    const cssFiles = [
        'node_modules/angular2-slickgrid/out/css/SlickGrid.css',
        'node_modules/slickgrid/slick.grid.css'
    ];

    const cssDestDir = 'out/src/extension/oldViews/htmlcontent/src/css';
    ensureDir(cssDestDir);

    cssFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const fileName = path.basename(file);
            const destPath = path.join(cssDestDir, fileName);
            fs.copyFileSync(file, destPath);
            console.log(`Copied CSS: ${file} -> ${destPath}`);
        } else {
            console.log(`CSS file not found: ${file}`);
        }
    });

    console.log('File copy process completed!');
}

// Run the copy process
if (require.main === module) {
    // Install glob if not already installed
    try {
        require('glob');
    } catch (e) {
        console.log('Installing glob dependency...');
        require('child_process').execSync('npm install glob', { stdio: 'inherit' });
    }

    copyAllFiles();
}

module.exports = { copyAllFiles };