import { start } from './app.js';
import { startNet } from './net.js';

startNet();

start().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', '<p style="padding:40px;font:18px system-ui;color:#fff">O admin não conseguiu abrir. Recarregue a página.</p>');
});
