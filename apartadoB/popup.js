document.getElementById('btnScrape').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = "Iniciando...";

    //Obtiene la pestaña activa
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    //Envía mensaje al content script
    chrome.tabs.sendMessage(tab.id, { action: "scraping" }, (response) => {
        if (chrome.runtime.lastError) {
            statusDiv.textContent = "Error: Recarga la página web e intenta de nuevo.";
            console.error(chrome.runtime.lastError);
        } else {
            statusDiv.textContent = response.mensaje;
        }
    });
});