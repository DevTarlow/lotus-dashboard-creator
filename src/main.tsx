import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Library styles first so `src/styles/index.css` can theme the grid.
import 'react-grid-layout/css/styles.css';
import '@/styles/index.css';

import App from '@/App';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root was not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
