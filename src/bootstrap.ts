import('./main').catch(error => {
  const app = document.querySelector('#app');
  if (app) app.textContent = `Spiel konnte nicht starten: ${String(error)}`;
});
