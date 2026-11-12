import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

// In the /demo split screen each room is an iframe; the `split` variant in styles.css keys off this.
if (window.self !== window.top) document.documentElement.dataset.frame = 'split';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
