document.addEventListener('DOMContentLoaded', () => {
    const btnStart = document.getElementById('btnStart');
    const btnStop = document.getElementById('btnStop');
    const statusDiv = document.getElementById('status');
    const countSpan = document.getElementById('count');

    //Escucha mensajes desde content.js
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if(request.action === "updateProgress"){
            countSpan.textContent = request.count;
            statusDiv.textContent = "Escaneando y bajando...";
        }else if(request.action === "finished"){
            statusDiv.textContent = "¡Meta alcanzada o finalizado!";
            toggleButtons(false);
        }
    });

    btnStart.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        //Inyecta y ejecuta
        chrome.tabs.sendMessage(tab.id, { action: "startScraping" }, (response) => {
            if(chrome.runtime.lastError){
                statusDiv.textContent = "Error: Recarga la página.";
            }else{
                statusDiv.textContent = "Iniciando...";
                toggleButtons(true);
            }
        });
    });

    btnStop.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: "stopScraping" });
        statusDiv.textContent = "Deteniendo...";
        toggleButtons(false);
    });

    function toggleButtons(isRunning){
        if(isRunning){
            btnStart.style.display = 'none';
            btnStop.style.display = 'block';
        }else{
            btnStart.style.display = 'block';
            btnStop.style.display = 'none';
        }
    }
});