// Canvas-Notion Sync Background Service Worker

// Import all modules
import { setupMessageHandlers } from './src/handlers/message-handlers.js';
import { setupNavigationHandlers, setupPeriodicSync, setupSecurityHandlers } from './src/handlers/background-handlers.js';

// Initialize all handlers
setupMessageHandlers();
setupNavigationHandlers();
setupPeriodicSync();
setupSecurityHandlers();

