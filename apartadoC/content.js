let isScrapingActive = false;
const TARGET_COUNT = 1000;

// Recuperar estado al cargar (para persistencia entre páginas)
chrome.storage.local.get(['scrapingState'], function(result) {
    if (result.scrapingState === 'active') {
        console.log("Recuperando sesión de scraping...");
        isScrapingActive = true;
        // Pequeño delay para asegurar carga del DOM
        setTimeout(loopScraping, 2000);
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
    const esAmazon = window.location.hostname.includes("amazon");
    
    // Selectores más amplios
    let items;
    if (esAmazon) {
        // Amazon: Resultados de búsqueda estándar y cuadrícula
        items = document.querySelectorAll(".s-result-item[data-component-type='s-search-result'], .s-result-item");
    } else {
        // Chollometro y genéricos
        items = document.querySelectorAll("article, .thread, .product-card");
    }

    items.forEach((item, index) => {
        try{
            //Ignorar elementos vacíos o de publicidad si no tienen info relevante
            if(item.classList.contains("AdHolder")) return;

            let titulo = "Sin título";
            let precio = "0.00";
            let img = "";
            let url = window.location.href;
            let idUnico = "";

            if(esAmazon){
                //Título
                const tituloEl = item.querySelector("h2 span") || item.querySelector("h2 a") || item.querySelector(".a-text-normal");
                if(tituloEl) titulo = tituloEl.innerText.trim();

                //Precio
                const precioEl = item.querySelector(".a-price .a-offscreen") || item.querySelector(".a-price span");
                if(precioEl) precio = precioEl.innerText.trim();

                //Imagen
                const imgEl = item.querySelector(".s-image");
                if(imgEl) img = imgEl.src;

                //URL
                const linkEl = item.querySelector("a.a-link-normal.s-no-outline") || item.querySelector("h2 a");
                if(linkEl) {
                    url = linkEl.href;
                    //Intenta sacar el ASIN de la URL o del item
                    const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
                    if(asinMatch) idUnico = asinMatch[1];
                }
                
                if(!idUnico) idUnico = item.getAttribute("data-asin");

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
        const esAmazon = window.location.hostname.includes("amazon");
        
        if(esAmazon){
            //Amazon: Scroll al fondo para ver paginación
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 2000));

            //Si no hemos extraído nada en esta vuelta, algo va mal (Captcha o fin)
            if(productosEnPantalla.length === 0 && noNewItemsCount > 1){
                alert("No se detectan productos. Puede que hayas llegado al final o haya un CAPTCHA. \n\nPor favor, resuelve el Captcha o cambia de búsqueda manualmente.");
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            //Selectores múltiples para el botón "Siguiente"
            const nextButton = document.querySelector(".s-pagination-next:not(.s-pagination-disabled)") || 
                               document.querySelector("a.s-pagination-item.s-pagination-next") ||
                               document.querySelector("li.a-last a");

            if(nextButton){
                console.log("Botón siguiente encontrado, clickando...");
                //Forzar navegación si es un link
                if(nextButton.href) {
                    window.location.href = nextButton.href;
                } else {
                    nextButton.click();
                }
                //Esperar carga (el script se detendrá aquí si la página recarga)
                await new Promise(r => setTimeout(r, 5000)); 
            }else{
                console.log("No se encontró botón siguiente en Amazon.");
                
                //INTENTO DE NAVEGACIÓN FORZADA POR URL (Bypass de límite de página 10)
                const currentUrl = new URL(window.location.href);
                let pageParam = currentUrl.searchParams.get("page");
                
                //Si no hay param page pero hay búsqueda, estamos en la 1
                if(!pageParam && window.location.search.includes("k=")) pageParam = "1";

                if(pageParam){
                    const nextPage = parseInt(pageParam) + 1;
                    //Límite de seguridad
                    if(nextPage <= 20){ 
                        console.log(`Intentando forzar navegación a página ${nextPage}...`);
                        currentUrl.searchParams.set("page", nextPage);
                        window.location.href = currentUrl.toString();
                        await new Promise(r => setTimeout(r, 5000));
                    }else{
                        alert("Límite de paginación automática alcanzado. \n\n¡Cambia de búsqueda (ej: de 'portátiles' a 'ratones') para seguir sumando hasta 1000!");
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }else{
                    window.scrollBy(0, -500);
                    await new Promise(r => setTimeout(r, 1000));
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
        chrome.storage.local.set({ scrapingState: 'stopped' });
        sendResponse({ status: "stopped" });
    }
    return true;
});