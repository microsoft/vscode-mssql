const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const copy = require('esbuild-plugin-copy');
const { platform } = require('os');
const clc = require('cli-color');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
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

async function main() {
	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: false,
		sourcemap: true,
		sourcesContent: false,
		platform: 'node',
		outfile: 'out/src/extension.js',
		external: [
			'vscode',
		],
		logLevel: 'silent',
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
						from: 'package.json',
						to: './out/package.json',
					},
					{
						from: 'src/configurations/config.json',
						to: './out/config.json'
					},
					{
						from: 'src/objectExplorer/objectTypes/*.svg',
						to: './out/src/objectTypes'
					}
				],
				resolveFrom: __dirname,
				watch: watch
			}),
			esbuildProblemMatcherPlugin('Extension'),
		],
	});

	const reactApp = await esbuild.context({
		entryPoints: {
			tableDesigner: 'mssql-react-app/src/pages/TableDesigner/index.tsx',
		},
		bundle: true,
		outdir: 'out/mssql-react-app/assets',
		platform: 'browser',
		minify: production,
		sourcemap: production ? false : 'inline',
		loader: {
			'.tsx': 'tsx',
			'.ts': 'ts',
			'.css': 'css',
		},
		tsconfig: './mssql-react-app/tsconfig.json',
		plugins: [
			cssLoaderPlugin,
			esbuildProblemMatcherPlugin('React App'),
		]
	});

	if (watch) {
		Promise.all([ctx.watch(), reactApp.watch()]);
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

function esbuildProblemMatcherPlugin(processName){
	return {
		name: 'esbuild-problem-matcher',
		setup(build) {
			let timeStart;
			build.onStart(async () => {
				timeStart = Date.now();
				console.log(`${clc.cyan(`[${processName}]`)} build started`);
			});
			build.onEnd(async (result) => {
				const timeEnd = Date.now();
				result.errors.forEach(({ text, location }) => {
					console.error(`✘ [ERROR] ${text}`);
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				});
				console.log(`${clc.cyan(`[${processName}]`)} build finished in ${timeEnd - timeStart}ms`);
			})
		}
	};
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
