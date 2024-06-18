/**
 * System configuration for Angular 2 samples
 * Adjust as necessary for your application needs.
 */

var process = new Object();
process.env = new Object();
process.env.NODE_ENV = 'production';

(function (global) {
	var paths = {
		'npm:': 'views/htmlcontent/src/js/lib/'
	}
	// map tells the System loader where to look for things
	var map = {
		'app': 'views/htmlcontent/src/js',
		'connection': 'webviews/apps/connection',
		'welcome': 'webviews/apps/welcome',
		'@angular': 'npm:@angular',
		'rxjs': 'npm:rxjs',
		'json': 'npm:json.js',
		'angular2-slickgrid': 'npm:angular2-slickgrid',
		'@angular/common': 'npm:@angular/common/bundles/common.umd.js',
		'@angular/compiler': 'npm:@angular/compiler/bundles/compiler.umd.js',
		'@angular/core': 'npm:@angular/core/bundles/core.umd.js',
		'@angular/forms': 'npm:@angular/forms/bundles/forms.umd.js',
		'@angular/platform-browser': 'npm:@angular/platform-browser/bundles/platform-browser.umd.js',
		'@angular/platform-browser-dynamic': 'npm:@angular/platform-browser-dynamic/bundles/platform-browser-dynamic.umd.js',
		'@angular/router': 'npm:@angular/router/bundles/router.umd.js',
		'@angular/upgrade': 'npm:@angular/upgrade/bundles/upgrade.umd.js',
		'angular-in-memory-web-api': 'npm:angular-in-memory-web-api/bundles/in-memory-web-api.umd.js',

		'hooks': 'npm:@fluentui/react-table/lib-commonjs/hooks',


		'use-sync-external-store': 'npm:use-sync-external-store',
		'@remix-run/router': 'npm:@remix-run/router',
		'react': 'npm:react',
		'react-dom': 'npm:react-dom',
		'react-router-dom': 'npm:react-router-dom',
		'react-router': 'npm:react-router',
		'@griffel/react': 'npm:@griffel/react',
		'@fluentui/react-components': 'npm:@fluentui/react-components',
		'@fluentui/react-toolbar': 'npm:@fluentui/react-toolbar',
		'@fluentui/react-icons': 'npm:@fluentui/react-icons',
		'@fluentui/react-button': 'npm:@fluentui/react-button',
		'@fluentui/react-provider': 'npm:@fluentui/react-provider',
		'@fluentui/react-tabster': 'npm:@fluentui/react-tabster',
		'@fluentui/react-theme': 'npm:@@fluentui/react-theme',
		'@fluentui/react-shared-contexts': 'npm:@fluentui/react-shared-contexts',
		'@fluentui/react-utilities': 'npm:@fluentui/react-utilities',
		'@fluentui/react-accordion': 'npm:@fluentui/react-accordion',
		'@fluentui/react-avatar': 'npm:@fluentui/react-avatar',
		'@fluentui/react-badge': 'npm:@fluentui/react-badge',
		'@fluentui/react-checkbox': 'npm:@fluentui/react-checkbox',
		'@fluentui/react-combobox': 'npm:@fluentui/react-combobox',
		'@fluentui/react-divider': 'npm:@fluentui/react-divider',
		'@fluentui/react-image': 'npm:@fluentui/react-image',
		'@fluentui/react-input': 'npm:@fluentui/react-input',
		'@fluentui/react-jsx-runtime': 'npm:@fluentui/react-jsx-runtime',
		'@fluentui/react-label': 'npm:@fluentui/react-label',
		'@fluentui/react-link': 'npm:@fluentui/react-link',
		'@fluentui/react-menu': 'npm:@fluentui/react-menu',
		'@fluentui/react-positioning': 'npm:@fluentui/react-positioning',
		'@fluentui/react-progress': 'npm:@fluentui/react-progress',
		'@fluentui/react-radio': 'npm:@fluentui/react-radio',
		'@fluentui/react-select': 'npm:@fluentui/react-select',
		'@fluentui/react-text': 'npm:@fluentui/react-text',
		'@fluentui/react-textarea': 'npm:@fluentui/react-textarea',
		'@fluentui/react-theme': 'npm:@fluentui/react-theme',
		'@fluentui/react-toast': 'npm:@fluentui/react-toast',
		'@fluentui/react-toolbar': 'npm:@fluentui/react-toolbar',
		'@fluentui/react-tooltip': 'npm:@fluentui/react-tooltip',
		'@fluentui/react-tree': 'npm:@fluentui/react-tree',
		'@fluentui/react-dialog': 'npm:@fluentui/react-dialog',
		'@fluentui/react-persona': 'npm:@fluentui/react-persona',
		'@fluentui/react-popover': 'npm:@fluentui/react-popover',
		'@fluentui/react-portal': 'npm:@fluentui/react-portal',
		'@fluentui/react-skeleton': 'npm:@fluentui/react-skeleton',
		'@fluentui/react-slider': 'npm:@fluentui/react-slider',
		'@fluentui/react-spinbutton': 'npm:@fluentui/react-spinbutton',
		'@fluentui/react-spinner': 'npm:@fluentui/react-spinner',
		'@fluentui/react-switch': 'npm:@fluentui/react-switch',
		'@fluentui/react-tabs': 'npm:@fluentui/react-tabs',

		'@fluentui/react-overflow': 'npm:@fluentui/react-overflow',
		'@fluentui/react-table': 'npm:@fluentui/react-table',
		'@fluentui/react-card': 'npm:@fluentui/react-card',
		'@fluentui/react-field': 'npm:@fluentui/react-field',
		'@fluentui/react-message-bar': 'npm:@fluentui/react-message-bar',
		'@fluentui/react-infolabel': 'npm:@fluentui/react-infolabel',
		'@fluentui/react-tabs': 'npm:@fluentui/react-tabs',
		'@fluentui/react-drawer': 'npm:@fluentui/react-drawer',
		'@fluentui/react-breadcrumb': 'npm:@fluentui/react-breadcrumb',
		'@fluentui/react-aria': 'npm:@fluentui/react-aria',
		'@fluentui/react-rating': 'npm:@fluentui/react-rating',
		'@fluentui/react-search': 'npm:@fluentui/react-search',
		'@fluentui/react-teaching-popover': 'npm:@fluentui/react-teaching-popover',
		'@fluentui/react-tag-picker': 'npm:@fluentui/react-tag-picker',
		'@fluentui/react-tags': 'npm:@fluentui/react-tags',
		'@griffel/core': 'npm:@griffel/core',
		'@floating-ui/devtools': 'npm:@floating-ui/devtools',
		'@floating-ui/dom': 'npm:@floating-ui/dom',
		'@floating-ui/core': 'npm:@floating-ui/core',
		'@fluentui/react-motion-preview': 'npm:@fluentui/react-motion-preview',
		'@fluentui/priority-overflow': 'npm:@fluentui/priority-overflow',
		'@fluentui/keyboard-keys': 'npm:@fluentui/keyboard-keys',
		'@fluentui/react-context-selector': 'npm:@fluentui/react-context-selector',
		'@fluentui/tokens': 'npm:@fluentui/tokens',
		'use-disposable': 'npm:use-disposable',
		'react-transition-group': 'npm:react-transition-group',
		'scheduler': 'npm:scheduler',
		'keyborg': 'npm:keyborg',
		'tabster': 'npm:tabster',
		'traceur': 'npm:traceur',
		'stylis': 'npm:stylis',
		'rtl-css-js': 'npm:rtl-css-js',
		'@emotion/hash': 'npm:@emotion/hash',
		'@swc/helpers': 'npm:@swc/helpers',
		'react-is': 'npm:react-is',
		'tslib': 'npm:tslib',


	};
	// packages tells the System loader how to load when no filename and/or no extension
	var packages = {
		'app': { main: 'main.js', defaultExtension: 'js' },
		'connection': { main: 'connection.js', defaultExtension: 'js' },
		'welcome': { main: 'WelcomeMain.js', defaultExtension: 'js' },
		'': { main: 'views/htmlcontent/src/js/constants.js', defaultExtension: 'js' },
		'angular2-slickgrid': { main: 'out/index.js', defaultExtension: 'js' },
		'/src/controllers': { defaultExtension: 'js' },
		'rxjs': { main: 'Rx.js', defaultExtension: 'js' },

		'@remix-run/router': { main: 'dist/router.umd.min.js', defaultExtension: 'js' },
		'react': { main: 'umd/react.development.js', defaultExtension: 'js' },
		'react-dom': { main: 'umd/react-dom.development.js', defaultExtension: 'js' },
		'react-router-dom': { main: 'dist/umd/react-router-dom.development.js', defaultExtension: 'js' },
		'react-router': { main: 'dist/umd/react-router.development.js', defaultExtension: 'js' },
		'@griffel/react': { main: 'index.cjs.js', defaultExtension: 'js' },
		'use-sync-external-store': { main: 'cjs/use-sync-external-store.production.min.js', defaultExtension: 'js' },
		'use-sync-external-store/shim': { main: 'index.js', defaultExtension: 'js' },


		'@fluentui/react-components': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-toolbar': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-icons': { main: 'lib-cjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-button': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-provider':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-tabster':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-theme':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-shared-contexts':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-utilities':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-accordion':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-avatar':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-badge':  { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-checkbox': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-combobox': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-divider': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-image': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-input': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-jsx-runtime': { main: 'lib/index.js', defaultExtension: 'js' },
		'@fluentui/react-label': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-link': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-menu': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-positioning': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-progress': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-radio': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-select': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-text': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-textarea': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-theme': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-toast': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-toolbar': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-tooltip': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-tree': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-dialog': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-persona': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-popover': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-portal': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-skeleton': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-slider': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-spinbutton': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-spinner': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-switch': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-tabs': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-overflow': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-table': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-card': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-field': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-message-bar': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-infolabel': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-tabs': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-drawer': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-breadcrumb': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-aria':{ main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-rating': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-search': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-teaching-popover': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-tag-picker': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },

		'@fluentui/react-tags': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@griffel/core': { main: 'index.cjs.js', defaultExtension: 'js' },

		'@floating-ui/devtools': { main: 'dist/floating-ui.devtools.umd.min.js', defaultExtension: 'js' },
		'@fluentui/react-motion-preview': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-jsx-runtime': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-overflow': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/priority-overflow': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/keyboard-keys': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/react-context-selector': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },
		'@fluentui/tokens': { main: 'lib-commonjs/index.js', defaultExtension: 'js' },

		'@fluentui/react-dialog/lib-commonjs/contexts': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-dialog/lib-commonjs/utils': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-table/lib-commonjs/hooks': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-tags/lib-commonjs/utils': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-tree/lib-commonjs/context': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-message-bar/lib-commonjs/contexts': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-toast/lib-commonjs/state': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-drawer/lib-commonjs/contexts': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-drawer/lib-commonjs/components/OverlayDrawer': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-drawer/lib-commonjs/components/OverlayDrawer/OverlayDrawerSurface': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-drawer/lib-commonjs/components/InlineDrawer': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-text/lib-commonjs/components/Text': { main: 'index.js', defaultExtension: 'js' },

		'@fluentui/react-toast/lib-commonjs/components/ToastContainer': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-toast/lib-commonjs/components/AriaLive': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-table/lib-commonjs/components/TableSelectionCell': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-teaching-popover/lib-commonjs/components/TeachingPopoverFooter': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-toast/lib-commonjs/state/vanilla': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-positioning/lib-commonjs/middleware': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-positioning/lib-commonjs/utils': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-aria/lib-commonjs/activedescendant': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-tree/lib-commonjs/contexts': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-menu/lib-commonjs/utils': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-shared-contexts/lib-commonjs/AnnounceContext': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-shared-contexts/lib-commonjs/BackgroundAppearanceContex': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-shared-contexts/lib-commonjs/OverridesContext': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-motion-preview/lib-commonjs/hooks': { main: 'index.js', defaultExtension: 'js' },
		'@fluentui/react-shared-contexts/lib-commonjs/BackgroundAppearanceContext': { main: 'index.js', defaultExtension: 'js' },

		'use-disposable': { main: 'lib/index.cjs', defaultExtension: 'cjs' },
		'react-transition-group': { main: 'dist/react-transition-group.min.js', defaultExtension: 'js' },
		'scheduler': { main: 'cjs/scheduler.production.min.js', defaultExtension: 'js' },
		'keyborg': { main: 'dist/index.js', defaultExtension: 'js' },
		'tabster': { main: 'dist/index.js', defaultExtension: 'js' },
		'traceur': { main: 'dist/commonjs/traceur.js', defaultExtension: 'js' },
		'stylis': { main: 'dist/umd/stylis.js', defaultExtension: 'js' },
		'rtl-css-js': { main: 'dist/rtl-css-js.umd.min.js', defaultExtension: 'js' },
		'@emotion/hash': { main: 'dist/emotion-hash.cjs.js', defaultExtension: 'js' },
		'@floating-ui/dom': { main: 'dist/floating-ui.dom.umd.min.js', defaultExtension: 'js' },
		'@floating-ui/core': { main: 'dist/floating-ui.core.umd.min.js', defaultExtension: 'js' },
		'@fluentui/react-jsx-runtime/jsx-runtime': { main: '../lib-commonjs/jsx-runtime.js', defaultExtension: 'js' },
		'react-is': { main: 'cjs/react-is.production.min.js', defaultExtension: 'js' },
		'rtl-css-js/core': { main: '../dist/cjs/core.js', defaultExtension: 'js' },
		'@swc/helpers': { main: 'cjs/index.cjs', defaultExtension: 'js' },
		'@swc/helpers/_/_interop_require_wildcard': { main: '../../cjs/_interop_require_wildcard.cjs', defaultExtension: 'cjs' },
		'@swc/helpers/_/_export_star': { main: '../../cjs/_export_star.cjs', defaultExtension: 'cjs' },
		'tslib': { main: 'tslib.js', defaultExtension: 'js' },
		'@fluentui/react-icons/lib-cjs/contexts': { main: 'index.js', defaultExtension: 'js' },

	};


	console.log('Packages = ' + packages);

	var meta = {
		'**/*.json': {
			loader: 'json'
		}
	}
	var config = {
		paths: paths,
		map: map,
		packages: packages,
		meta: meta
	};
	System.config(config);


// 	// Function to recursively configure subfolders
// 	function configureSubfolders(basePath, packages) {
// 		const fs = require('fs');
// 		const path = require('path');

// 		function configure(pathName) {
// 			const items = fs.readdirSync(pathName);
// 			items.forEach(item => {
// 				const itemPath = path.join(pathName, item);
// 				if (fs.lstatSync(itemPath).isDirectory()) {
// 				const packagePath = path.relative(basePath, itemPath).replace(/\\/g, '/');
// 				packages[packagePath] = {
// 					main: 'index.js',
// 					defaultExtension: 'js'
// 				};
// 				configure(itemPath); // Recurse into subdirectory
// 				}
// 			});
// 		}

// 		configure(basePath);
// 	}

//   // Assume your-module's absolute path is available

//   //out/srcviews\htmlcontent\src\js\lib\
//   const modulePath = path.resolve(__dirname, '@fluentui/react-table/lib-commonjs');
//   configureSubfolders(modulePath, System.packages);
})(this);
