import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { createAppQueryClient } from './queryClient'
import './styles/global.css'

const queryClient = createAppQueryClient()

const container = document.getElementById('root')
if (container === null) throw new Error('Missing #root')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
