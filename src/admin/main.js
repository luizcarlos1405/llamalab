import { start } from './app.js';

start().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', '<p style="padding:40px;font:18px system-ui;color:#fff">O admin não conseguiu abrir. Recarregue a página.</p>');
});
