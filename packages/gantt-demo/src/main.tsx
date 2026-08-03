import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// StrictMode double-invokes effects in development, which is exactly the pressure
// the chart's mount/dispose path should survive.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
