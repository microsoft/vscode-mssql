const gulp = require('gulp');
const rename = require('gulp-rename');
const ts = require('gulp-typescript');
const tsProject = ts.createProject('tsconfig.extension.json');
const del = require('del');
const srcmap = require('gulp-sourcemaps');
const config = require('./tasks/config');
const concat = require('gulp-concat');
const minifier = require('gulp-uglify/minifier');
const uglifyjs = require('uglify-js');
const argv = require('yargs').argv;
const min = (argv.min === undefined) ? false : true;
const prod = (argv.prod === undefined) ? false : true;
const vscodeTest = require('@vscode/test-electron');
const { exec } = require('child_process');
const gulpESLintNew = require('gulp-eslint-new');
const copy = require('esbuild-plugin-copy');
const clc = require('cli-color');
const path = require('path');
const esbuild = require('esbuild');
const { typecheckPlugin } = require('@jgoz/esbuild-plugin-typecheck');
const run = require('gulp-run-command').default;
require('./tasks/packagetasks');
require('./tasks/localizationtasks');

function getTimeString() {
	const now = new Date();
	const hours = String(now.getHours()).padStart(2, '0');
	const minutes = String(now.getMinutes()).padStart(2, '0');
	const seconds = String(now.getSeconds()).padStart(2, '0');
	return clc.white(`${hours}:${minutes}:${seconds}`);
}

function esbuildProblemMatcherPlugin(processName) {
	const formattedProcessName = clc.cyan(`${processName}`);
	return {
		name: 'esbuild-problem-matcher',
		setup(build) {
			let timeStart;
			build.onStart(async () => {
				timeStart = Date.now();
				timeStart.toString()
				console.log(`[${getTimeString()}] Starting '${formattedProcessName}' build`);
			});
			build.onEnd(async (result) => {
				const timeEnd = Date.now();
				result.errors.forEach(({ text, location }) => {
					console.error(`✘ [ERROR] ${text}`);
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				});
				console.log(`[${getTimeString()}] Finished '${formattedProcessName}' build after ${clc.magenta((timeEnd - timeStart) + ' ms')} `);
			})
		}
	};
}

const cssLoaderPlugin = {
	name: 'css-loader',
	setup(build) {
		build.onLoad({ filter: /\.css$/ }, async (args) => {
			const fs = require('fs').promises;
			const css = await fs.readFile(args.path, 'utf8');
			const contents = `
		  const style = document.createElement('style');
		  style.textContent = ${JSON.stringify(css)};
		  document.head.appendChild(style);
		`;
			return { contents, loader: 'js' };
		});
	},
};

// Copy icons for OE
gulp.task('ext:copy-OE-assets', (done) => {
	return gulp.src([
		config.paths.project.root + '/src/objectExplorer/objectTypes/*'
	])
		.pipe(gulp.dest('out/src/objectExplorer/objectTypes'));
});

// Copy icons for Query History
gulp.task('ext:copy-queryHistory-assets', (done) => {
	return gulp.src([
		config.paths.project.root + '/src/queryHistory/icons/*'
	])
		.pipe(gulp.dest('out/src/queryHistory/icons'));
});

async function generateExtensionBundle() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts',
			'src/languageService/serviceInstallerUtil.ts',
			'src/telemetry/telemetryInterfaces.ts',
			'src/protocol.ts',
			'src/models/interfaces.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: false,
		sourcemap: true,
		sourcesContent: false,
		platform: 'node',
		outdir: 'out/src',
		external: [
			'vscode',
		],
		logLevel: 'silent',
		loader: {
			'.ts': 'ts',
			'.js': 'js',
			'.json': 'json',
		},
		plugins: [
			{
				name: 'custom-types',
				setup(build) {
					build.onResolve({ filter: /^vscode-mssql$/ }, args => {
						return { path: path.resolve(__dirname, 'typings/vscode-mssql.d.ts') };
					});
				}
			},
			copy.copy({
				assets: [
					{
						from: 'src/objectExplorer/objectTypes/*.svg',
						to: './out/src/objectTypes'
					},
					{
						from: 'src/controllers/sqlOutput.ejs',
						to: './out/src/sqlOutput.ejs'
					},
					{
						from: 'src/configurations/config.json',
						to: './out/config.json'
					}
				],
				resolveFrom: __dirname
			}),
			esbuildProblemMatcherPlugin('Extension')
		],
	});

	await ctx.rebuild();
	await ctx.dispose();
}

gulp.task('ext:bundle-src', gulp.series(generateExtensionBundle));

gulp.task('ext:compile-src', (done) => {
	return gulp.src([
		config.paths.project.root + '/src/**/*.ts',
		config.paths.project.root + '/src/**/*.js',
		config.paths.project.root + '/typings/**/*.d.ts',
		'!' + config.paths.project.root + '/src/views/htmlcontent/**/*'])
		.pipe(srcmap.init())
		.pipe(tsProject())
		.on('error', function () {
			if (process.env.BUILDMACHINE) {
				done('Extension source failed to build. See Above.');
				process.exit(1);
			}
		})
		.pipe(srcmap.write('.', { includeContent: false, sourceRoot: '../src' }))
		.pipe(gulp.dest('out/src/'));
});

// Compile angular view
gulp.task('ext:compile-view', (done) => {
return gulp.src([
		config.paths.project.root + '/src/views/htmlcontent/**/*.ts',
		config.paths.project.root + '/typings/**/*.d.ts'])
		.pipe(srcmap.init())
		.pipe(tsProject())
		.pipe(srcmap.write('.', { includeContent: false, sourceRoot: '../src' }))
		.pipe(gulp.dest('out/src/views/htmlcontent'));
});

async function generateReactWebviewsBundle() {
	const ctx = await esbuild.context({
		/**
		 * Entry points for React webviews. This generates individual bundles (both .js and .css files)
		 * for each entry point, to be used by the webview's HTML content.
		 */
		entryPoints: {
			'addFirewallRule': 'src/reactviews/pages/AddFirewallRule/index.tsx',
			'azureAccountManagement': 'src/reactviews/pages/AzureAccountManagement/index.tsx',
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
			esbuildProblemMatcherPlugin('React App'),
			typecheckPlugin()
		],
		sourcemap: prod ? false : 'inline',
		metafile: true,
		minify: prod,
		minifyWhitespace: prod,
		minifyIdentifiers: prod,
		format: 'esm',
		splitting: true,
	});

	const result = await ctx.rebuild();

	/**
	 * Generating esbuild metafile for webviews. You can analyze the metafile https://esbuild.github.io/analyze/
	 * to see the bundle size and other details.
	 */
	const fs = require('fs').promises;
	if (result.metafile) {
		await fs.writeFile('./webviews-metafile.json', JSON.stringify(result.metafile));
	}


	await ctx.dispose();
}

// Compile react views
gulp.task('ext:compile-reactviews',
	gulp.series(generateReactWebviewsBundle)
);


// Copy systemjs config file
gulp.task('ext:copy-systemjs-config', (done) => {
	return gulp.src([
		config.paths.project.root + '/src/views/htmlcontent/*.js'])
		.pipe(gulp.dest('out/src/views/htmlcontent'));
});

// Copy html
gulp.task('ext:copy-html', (done) => {
	return gulp.src([
		config.paths.project.root + '/src/controllers/sqlOutput.ejs'])
		.pipe(gulp.dest('out/src/controllers/'));
});

// Copy css
gulp.task('ext:copy-css', (done) => {
	return gulp.src([
		config.paths.project.root + '/src/views/htmlcontent/src/css/*.css'])
		.pipe(gulp.dest('out/src/views/htmlcontent/src/css'));
});

// Copy images
gulp.task('ext:copy-images', (done) => {
	return gulp.src([
		config.paths.project.root + '/src/views/htmlcontent/src/images/**/*'])
		.pipe(gulp.dest('out/src/views/htmlcontent/src/images'));
});

// Clean angular slickgrid library
gulp.task('ext:clean-library-ts-files', function () {
	del(config.paths.project.root + '/node_modules/angular2-slickgrid/**/*.ts');
	return del(config.paths.project.root + '/node_modules/rxjs/**/*.ts');
});

// Copy and bundle dependencies into one file (vendor/vendors.js)
// system.config.js can also bundled for convenience
gulp.task('ext:copy-dependencies', (done) => {
	gulp.src([config.paths.project.root + '/node_modules/rxjs/**/*'])
		.pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib/rxjs'));

	gulp.src([config.paths.project.root + '/node_modules/angular-in-memory-web-api/**/*'])
		.pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib/angular-in-memory-web-api'));

	// concatenate non-angular2 libs, shims & systemjs-config
	if (min) {
		gulp.src([
			config.paths.project.root + '/node_modules/slickgrid/lib/jquery-1.8.3.js',
			config.paths.project.root + '/node_modules/slickgrid/lib/jquery.event.drag-2.2.js',
			config.paths.project.root + '/node_modules/slickgrid/lib/jquery-ui-1.9.2.js',
			config.paths.project.root + '/node_modules/underscore/underscore-min.js',
			config.paths.project.root + '/node_modules/slickgrid/slick.core.js',
			config.paths.project.root + '/node_modules/slickgrid/slick.grid.js',
			config.paths.project.root + '/node_modules/slickgrid/slick.editors.js',
			config.paths.project.root + '/node_modules/core-js/client/shim.min.js',
			config.paths.project.root + '/node_modules/zone.js/dist/zone.js',
			config.paths.project.root + '/node_modules/rangy/lib/rangy-core.js',
			config.paths.project.root + '/node_modules/rangy/lib/rangy-textrange.js',
			config.paths.project.root + '/node_modules/reflect-metadata/Reflect.js',
			config.paths.project.root + '/node_modules/systemjs/dist/system.src.js',
			config.paths.project.root + '/src/views/htmlcontent/systemjs.config.js'
		])
			.pipe(concat('vendors.min.js'))
			.pipe(minifier({}, uglifyjs))
			.pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib'));
	} else {
		gulp.src([
			config.paths.project.root + '/node_modules/slickgrid/lib/jquery-1.8.3.js',
			config.paths.project.root + '/node_modules/slickgrid/lib/jquery.event.drag-2.2.js',
			config.paths.project.root + '/node_modules/slickgrid/lib/jquery-ui-1.9.2.js',
			config.paths.project.root + '/node_modules/underscore/underscore-min.js',
			config.paths.project.root + '/node_modules/slickgrid/slick.core.js',
			config.paths.project.root + '/node_modules/slickgrid/slick.grid.js',
			config.paths.project.root + '/node_modules/slickgrid/slick.editors.js',
			config.paths.project.root + '/node_modules/core-js/client/shim.min.js',
			config.paths.project.root + '/node_modules/rangy/lib/rangy-core.js',
			config.paths.project.root + '/node_modules/rangy/lib/rangy-textrange.js',
			config.paths.project.root + '/node_modules/reflect-metadata/Reflect.js',
			config.paths.project.root + '/node_modules/systemjs/dist/system.src.js',
			config.paths.project.root + '/src/views/htmlcontent/systemjs.config.js'
		])
			.pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib'));

		gulp.src([config.paths.project.root + '/node_modules/zone.js/**/*'])
			.pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib/zone.js'));
	}

	// copy source maps
	gulp.src([
		// config.paths.html.root + '/node_modules/es6-shim/es6-shim.map',
		config.paths.project.root + '/node_modules/reflect-metadata/Reflect.js.map',
		config.paths.project.root + '/node_modules/systemjs/dist/system-polyfills.js.map',
		config.paths.project.root + '/node_modules/systemjs-plugin-json/json.js'
	]).pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib'));

	gulp.src([
		config.paths.project.root + '/node_modules/angular2-slickgrid/out/css/SlickGrid.css',
		config.paths.project.root + '/node_modules/slickgrid/slick.grid.css'
	]).pipe(gulp.dest('out/src/views/htmlcontent/src/css'));

	gulp.src([
		config.paths.project.root + '/node_modules/angular2-slickgrid/out/**/*.js'
	], { base: config.paths.project.root + '/node_modules/angular2-slickgrid' }).pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib/angular2-slickgrid'));

	return gulp.src([config.paths.project.root + '/node_modules/@angular/**/*'])
		.pipe(gulp.dest('out/src/views/htmlcontent/src/js/lib/@angular'));
});

// Compile tests
gulp.task('ext:compile-tests', (done) => {
	return gulp.src([
		config.paths.project.root + '/test/**/*.ts',
		config.paths.project.root + '/typings/**/*.ts'])
		.pipe(srcmap.init())
		.pipe(tsProject())
		.on('error', function () {
			if (process.env.BUILDMACHINE) {
				done('Extension Tests failed to build. See Above.');
				process.exit(1);
			}
		})
		.pipe(srcmap.write('.', { includeContent: false, sourceRoot: '../test' }))
		.pipe(gulp.dest('out/test/'));

});

gulp.task('ext:compile', gulp.series('ext:compile-src', 'ext:compile-tests', 'ext:copy-OE-assets', 'ext:copy-queryHistory-assets'));

gulp.task('ext:copy-tests', () => {
	return gulp.src(config.paths.project.root + '/test/resources/**/*')
		.pipe(gulp.dest(config.paths.project.root + '/out/test/resources/'))
});

gulp.task('ext:copy-config', () => {
	return gulp.src(config.paths.project.root + '/src/configurations/config.json')
		.pipe(gulp.dest(config.paths.project.root + '/out/src'));
});

gulp.task('ext:copy-js', () => {
	return gulp.src([
		config.paths.project.root + '/src/**/*.js',
		'!' + config.paths.project.root + '/src/views/htmlcontent/**/*'])
		.pipe(gulp.dest(config.paths.project.root + '/out/src'))
});

// Copy the files which aren't used in compilation
gulp.task('ext:copy', gulp.series('ext:copy-tests', 'ext:copy-js', 'ext:copy-config', 'ext:copy-systemjs-config', 'ext:copy-dependencies', 'ext:copy-html', 'ext:copy-css', 'ext:copy-images'));

gulp.task('ext:build', gulp.series('ext:generate-runtime-localization-files', 'ext:copy', 'ext:clean-library-ts-files', 'ext:compile', 'ext:compile-view', 'ext:compile-reactviews')); // removed lint before copy

gulp.task('ext:test', async () => {
	let workspace = process.env['WORKSPACE'];
	if (!workspace) {
		workspace = process.cwd();
	}
	process.env.JUNIT_REPORT_PATH = workspace + '/test-reports/test-results-ext.xml';
	var args = ['--verbose', '--disable-gpu', '--disable-telemetry', '--disable-updates', '-n'];
	let extensionTestsPath = `${workspace}/out/test/unit`;
	let vscodePath = await vscodeTest.downloadAndUnzipVSCode();
	await vscodeTest.runTests({
		vscodeExecutablePath: vscodePath,
		extensionDevelopmentPath: workspace,
		extensionTestsPath: extensionTestsPath,
		launchArgs: args
	});
});

gulp.task('ext:smoke', run('npx playwright test'));

gulp.task('test', gulp.series('ext:test'));

gulp.task('clean', function (done) {
	return del('out', done);
});

gulp.task('build', gulp.series('clean', 'ext:build', 'ext:install-service'));

gulp.task('watch-src', function () {
	return gulp.watch('./src/**/*.ts', gulp.series('ext:compile-src'))
});

gulp.task('watch-tests', function () {
	return gulp.watch('./test/**/*.ts', gulp.series('ext:compile-tests'))
});

gulp.task('watch-reactviews', function () {
	return gulp.watch(['./src/reactviews/**/*', './typings/**/*', './src/sharedInterfaces/**/*'], gulp.series('ext:compile-reactviews'))
});

// Do a full build first so we have the latest compiled files before we start watching for more changes
gulp.task('watch', gulp.series('build', gulp.parallel('watch-src', 'watch-tests', 'watch-reactviews')));