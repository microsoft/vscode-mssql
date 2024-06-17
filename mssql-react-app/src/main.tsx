import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

export const vscodeApi = acquireVsCodeApi<number>();

export enum ColorThemeKind {
  Light = 1,
  Dark = 2,
  HighContrast = 3,
  HighContrastLight = 4
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)