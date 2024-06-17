import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path';
// import fs from 'fs';
// import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: 'inline',
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      },
      input: {
        tableDesigner: resolve(__dirname, './src/pages/TableDesigner/tableDesigner.html'),
      }
    },
    outDir: '../out/mssql-react-app'
  }
})

// const entrypointsDir = resolve(__dirname, 'src', 'entrypoints');
// function generateInput() {
//   const entries: Record<string, string> = {};
//   fs.readdirSync(entrypointsDir).forEach(file => {
//     if (file.endsWith('.tsx')) {
//       const name = file.replace('.tsx', '');
//       entries[name] = resolve(entrypointsDir, file);
//     }
//   });
//   return entries;
// }

// export default defineConfig({
//   plugins: [react()],
//   build: {
//     sourcemap: false,
//     minify: false,
//     rollupOptions: {
//       input: generateInput(),
//       output: {
//         entryFileNames: 'assets/[name].js',
//         chunkFileNames: 'assets/[name].js',
//         assetFileNames: 'assets/[name].[ext]',
//         format: 'esm',
//         dir: resolve(__dirname, '..', 'out', 'mssql-react-app')
//       },
//       watch: {
//         include: 'src/**/**'
//       },
//       plugins: [
//         {
//           name: 'dynamic-component-replace',
//           resolveId(source, importer){
//             console.log('resolveId', source, importer);
//             return null;
//           },
//           load(id) {
//             const ex = path.extname(id);
//             const fileName = path.basename(id).replace(/\.[^/.]+$/, "");
//             if(ex === '.tsx'){
//               const content = fs.readFileSync(id, 'utf-8');
//               const updatedContent = `
//                 import ReactDOM from 'react-dom/client';
//                 ${content}
//                 ReactDOM.createRoot(document.getElementById('root')!).render(<${fileName} />)
//               `
//               //fs.appendFileSync(resolve(__dirname,'temp.tsx'), `${updatedContent}\n`);
//               return updatedContent;
//             }
//             return null;

//             // if (id.includes(entrypointsDir)) {
//             //   fs.appendFileSync(resolve(__dirname,'temp.tsx'), `Loading entry component: ${id}\n`);
//             //   const componentName = id.split('/').pop()?.replace('.tsx', '');
//             //   if (componentName) {
//             //     const componentImport = `import ${componentName} from './entryPoints/${componentName}';\n`;
//             //     const indexContent = fs.readFileSync(resolve(__dirname, 'src', 'dynamicEntry.tsx'), 'utf-8');
//             //     // return componentImport + indexContent + .replace(/render\((.*?)\);/s, 'render(Component);');

//             //     const updateFile =  componentImport + indexContent + `\n render(${componentName});`;
//             //     return updateFile;
//             //   }
//             // }
//             // return null;
//           },
//         },
//       ],
//     },
//   },
// });
