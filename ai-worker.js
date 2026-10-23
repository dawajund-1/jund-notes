// Runs the on-phone AI in the background so the app stays smooth.
import { WebWorkerMLCEngineHandler } from './vendor/web-llm.js';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = msg => handler.onmessage(msg);
