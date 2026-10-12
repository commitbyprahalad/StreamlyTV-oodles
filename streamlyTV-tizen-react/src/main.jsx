import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './lib/analytics';
import { crashLogger } from './lib/crashLogger';
import { registerKeys } from './lib/tizen';
import './styles/base.css';
import './styles/screens.css';
import './styles/epg.css';
import './styles/settings.css';

crashLogger.installGlobalHandlers();
registerKeys();
initAnalytics();

createRoot(document.getElementById('root')).render(<App />);
