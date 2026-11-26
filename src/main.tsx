import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme, setupUiScale } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/tokens.css'
import './app/aliases.css'
import './app/global.css'

ensureKatex()
setupTheme()
setupUiScale()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
