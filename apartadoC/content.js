let isScrapingActive = false;
let isPaused = false;
const TARGET_COUNT = 1000;

//Limpio el estado al cargar para evitar auto-arranque no deseado

//Persistencia de sesión inteligente
chrome.storage.local.get(['scrapingState', 'navigatingByScript'], function(result) {
    const esWebSoportada = window.location.hostname.includes("pccomponentes") || window.location.hostname.includes("chollometro");
    
    //Si estaba activo y fue una navegación provocada por el script, continúa
    if (result.scrapingState === 'active' && result.navigatingByScript && esWebSoportada) {
        console.log("Continuando scraping tras navegación automática...");
        isScrapingActive = true;
        //Reset de flag de navegación para que un F5 manual lo detenga
        chrome.storage.local.set({ navigatingByScript: false });
        setTimeout(loopScraping, 2000);
    } else {
        //Si estaba activo pero NO fue navegación del script (ej.F5), para
        if(result.scrapingState === 'active') {
            console.log("Scraping detenido por recarga manual o navegación externa.");
        }
        isScrapingActive = false;
        chrome.storage.local.set({ scrapingState: 'stopped', navigatingByScript: false });
    }
});

//Configuración de IndexedDB
const dbName = "ScrapingDB_C"; //Nueva BD
const storeName = "Productos";
let dbInstance = null;

async function initDB(){
    if (dbInstance) return dbInstance;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => reject("Error DB");
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if(!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, { keyPath: "cod_unico" });
                store.createIndex("marca", "marca", { unique: false });
            }
        };
        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };
    });
}

function guardarProducto(producto){
    return new Promise((resolve, reject) => {
        if(!dbInstance) return reject("DB no iniciada");
        const tx = dbInstance.transaction([storeName], "readwrite");
        const store = tx.objectStore(storeName);
        store.put(producto);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject();
    });
}

async function contarProductos(){
    return new Promise((resolve) => {
        if(!dbInstance) return resolve(0);
        const tx = dbInstance.transaction([storeName], "readonly");
        const store = tx.objectStore(storeName);
        const countRequest = store.count();
        countRequest.onsuccess = () => resolve(countRequest.result);
    });
}

//Lógica de Extracción Mejorada y Multi-Web
function extraerDatos(){
    const productos = [];
    const esPcComponentes = window.location.hostname.includes("pccomponentes");
    
    let items;
    if (esPcComponentes) {
        //PcComponentes
        items = document.querySelectorAll(".c-product-card, article.product-card, .product-card");
    } else {
        //Chollometro
        items = document.querySelectorAll("article, .thread, .product-card");
    }

    items.forEach((item, index) => {
        try{
            //Ignora elementos vacíos o de publicidad si no tienen info relevante
            if(item.classList.contains("AdHolder")) return;

            let titulo = "Sin título";
            let precio = "0.00";
            let img = "";
            let url = window.location.href;
            let idUnico = "";

            if(esPcComponentes){
                //Título
                const tituloEl = item.querySelector(".c-product-card__title") || item.querySelector("h3") || item.querySelector(".product-card__title");
                if(tituloEl) titulo = tituloEl.innerText.trim();

                //Precio
                const precioEl = item.querySelector(".c-product-card__price-now") || 
                                 item.querySelector(".c-product-card__prices-actual") || 
                                 item.querySelector(".product-card__price") ||
                                 item.querySelector("span[data-e2e='price-card']") ||
                                 item.querySelector("div[class*='price'] span");
                                 
                if(precioEl) precio = precioEl.innerText.trim();

                //Imagen
                const imgEl = item.querySelector("img.c-product-card__image") || item.querySelector("img");
                if(imgEl) img = imgEl.src || imgEl.dataset.src;

                //URL
                const linkEl = item.querySelector("a.c-product-card__title-link") || item.querySelector("a");
                if(linkEl) {
                    url = linkEl.href;
                    //ID único desde data-id o URL
                    idUnico = item.getAttribute("data-id");
                    if(!idUnico) {
                        const idMatch = url.match(/\/(\d+)-/); // Suele ser /12345-nombre-producto
                        if(idMatch) idUnico = idMatch[1];
                    }
                }

            } else {
                //Título
                const tituloEl = item.querySelector(".thread-title a") || item.querySelector(".thread-title") || item.querySelector("h2 a") || item.querySelector(".title");
                if(tituloEl) titulo = tituloEl.innerText.trim();

                //Precio
                const precioEl = item.querySelector(".thread-price") || item.querySelector(".price") || item.querySelector(".thread-item-price");
                if(precioEl) precio = precioEl.innerText.trim();

                //Imagen
                const imgEl = item.querySelector("img.thread-image") || item.querySelector("img");
                if(imgEl) img = imgEl.src || imgEl.dataset.src;

                //URL
                const linkEl = item.querySelector(".thread-title a") || item.querySelector("a");
                if(linkEl) url = linkEl.href;
                
                //ID
                idUnico = item.getAttribute("id") || item.getAttribute("data-t");
            }

            //Fallback para ID único
            if(!idUnico) {
                idUnico = `gen_${titulo.substring(0,15).replace(/\s/g,'')}_${precio.replace(/\D/g,'')}_${index}`;
            }

            //Validación básica para no guardar basura
            if(titulo !== "Sin título" && titulo.length > 3) { 
                productos.push({
                    gtin: null, 
                    articulo: titulo,
                    cod_unico: idUnico,
                    marca: "Desconocida", 
                    precio: precio,
                    url: url,
                    url_img: img,
                    fecha_scraping: new Date().toISOString()
                });
            }
        }catch(e){ 
            //console.error("Error extrayendo item:", e); 
        }
    });
    return productos;
}

//Función Principal de Auto-Scroll (Infinite Scroll)
async function loopScraping(){
    await initDB();
    
    let lastHeight = document.body.scrollHeight;
    let retries = 0;
    let noNewItemsCount = 0;
    let lastTotal = 0;

    while(isScrapingActive){
        //Pausa
        if(isPaused){
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        //Extrae y Guarda
        const productosEnPantalla = extraerDatos();
        
        //Guarda en lotes
        for (const p of productosEnPantalla) {
            await guardarProducto(p);
        }

        //Actualiza contador
        const total = await contarProductos();
        chrome.runtime.sendMessage({ action: "updateProgress", count: total });

        //Detecta si se ha estancado (no hay nuevos productos guardados)
        if (total === lastTotal) {
            noNewItemsCount++;
        } else {
            noNewItemsCount = 0;
            lastTotal = total;
        }

        //Comprueba meta
        if(total >= TARGET_COUNT){
            isScrapingActive = false;
            chrome.storage.local.set({ scrapingState: 'stopped' });
            chrome.runtime.sendMessage({ action: "finished" });
            alert(`¡Objetivo conseguido! ${total} productos.`);
            break;
        }

        //Navegación / Scroll
        const esPcComponentes = window.location.hostname.includes("pccomponentes");
        
        if(esPcComponentes){
            //Scroll al fondo para ver paginación
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 2000));

            //Si no hemos extraído nada en esta vuelta, algo va mal
            if(productosEnPantalla.length === 0 && noNewItemsCount > 1){
                console.log("No se detectan productos nuevos...");
            }

            const nextButton = document.querySelector("a[data-testid='pagination-next']") || 
                               document.querySelector(".c-pagination__next") ||
                               document.querySelector("a[aria-label='Página siguiente']");

            if(nextButton){
                console.log("Botón siguiente encontrado, clickando...");
                // MARCAR NAVEGACIÓN AUTOMÁTICA
                chrome.storage.local.set({ navigatingByScript: true });

                if(nextButton.href) {
                    window.location.href = nextButton.href;
                } else {
                    nextButton.click();
                }
                await new Promise(r => setTimeout(r, 5000)); 
            }else{
                console.log("No se encontró botón siguiente en PcComponentes.");

                const currentUrl = new URL(window.location.href);
                let pageParam = currentUrl.searchParams.get("page");
                
                if(!pageParam) pageParam = "0";

                //Detectar máximo de páginas
                let maxPages = 50; // Valor por defecto seguro
                const paginationItems = document.querySelectorAll(".c-pagination__item, a[data-testid^='pagination-link-']");
                if(paginationItems.length > 0){
                    //Intentar obtener el último número
                    const lastItem = paginationItems[paginationItems.length - 1];
                    const lastPageNum = parseInt(lastItem.innerText);
                    if(!isNaN(lastPageNum)) maxPages = lastPageNum;
                }
                console.log(`Máximo de páginas detectado: ${maxPages}`);

                if(pageParam || !window.location.search.includes("page=")){
                    const nextPage = pageParam ? parseInt(pageParam) + 1 : 1;
                    
                    if(nextPage <= maxPages){ 
                        console.log(`Intentando forzar navegación a página ${nextPage}...`);
                        // MARCAR NAVEGACIÓN AUTOMÁTICA
                        chrome.storage.local.set({ navigatingByScript: true });

                        currentUrl.searchParams.set("page", nextPage);
                        window.location.href = currentUrl.toString();
                        await new Promise(r => setTimeout(r, 5000));
                    } else {
                        console.log("Se ha alcanzado la última página detectada.");
                        alert("Parece que hemos llegado al final de las páginas disponibles en esta categoría.");
                        isScrapingActive = false;
                        chrome.storage.local.set({ scrapingState: 'stopped' });
                        break;
                    }
                }
            }
        }else{
            //Chollómetro
            //Intentar Scroll Infinito
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 1500));

            //Detectar si nos hemos atascado (altura no cambia)
            let newHeight = document.body.scrollHeight;
            if(newHeight === lastHeight){
                retries++;
                console.log(`Scroll atascado. Intento ${retries}/5`);
                
                //Movimiento para despertar el scroll event
                window.scrollBy({ top: -400, behavior: 'smooth' });
                await new Promise(r => setTimeout(r, 800));
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                
                //Si llevamos varios intentos fallidos, buscamos botones de paginación
                if(retries > 3){
                    console.log("Buscando botones de paginación o 'Cargar más'...");
                    
                    const nextBtn = document.querySelector("button.cept-load-more-button") || 
                                    document.querySelector(".pagination-next") ||
                                    document.querySelector("a.cept-next-page-button") ||
                                    document.querySelector("a[rel='next']");
                                    
                    if(nextBtn){
                        console.log("Botón de siguiente/cargar encontrado. Clickando...");
                        nextBtn.click();
                        //Si es un link, forzamos
                        if(nextBtn.href && nextBtn.tagName === 'A') window.location.href = nextBtn.href;
                        
                        await new Promise(r => setTimeout(r, 4000));
                        retries = 0; //Reset retries si navegamos
                    } else {
                        //Fallback: Intentar manipulación de URL si existe parámetro 'page'
                        const currentUrl = new URL(window.location.href);
                        let pageParam = currentUrl.searchParams.get("page");
                        if(pageParam){
                            const nextPage = parseInt(pageParam) + 1;
                            console.log(`Forzando navegación URL a página ${nextPage}`);
                            // MARCAR NAVEGACIÓN AUTOMÁTICA
                            chrome.storage.local.set({ navigatingByScript: true });

                            currentUrl.searchParams.set("page", nextPage);
                            window.location.href = currentUrl.toString();
                            await new Promise(r => setTimeout(r, 4000));
                        }
                    }
                }
            }else{
                retries = 0;
                lastHeight = newHeight;
            }
        }
    }
}

//Gestión de Mensajes
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if(request.action === "startScraping"){
        if(!isScrapingActive) {
            isScrapingActive = true;
            chrome.storage.local.set({ scrapingState: 'active' });
            loopScraping();
            sendResponse({ status: "started" });
        }
    }else if(request.action === "stopScraping"){
        isScrapingActive = false;
        isPaused = false;
        chrome.storage.local.set({ scrapingState: 'stopped' });
        sendResponse({ status: "stopped" });
    }else if(request.action === "pauseScraping"){
        isPaused = true;
        sendResponse({ status: "paused" });
    }else if(request.action === "resumeScraping"){
        isPaused = false;
        sendResponse({ status: "resumed" });
    }
    return true;
});