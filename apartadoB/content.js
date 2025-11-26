//Config de IndexedDB
const dbName = "ScrapingDB";
const storeName = "Productos";

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onerror = () => reject("Error al abrir la BD");
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                const objectStore = db.createObjectStore(storeName, { keyPath: "cod_unico" });
                objectStore.createIndex("marca", "marca", { unique: false });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
    });
}

function guardarProducto(db, producto) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(producto);
        request.onsuccess = () => resolve("Producto guardado");
        request.onerror = () => reject("Error al guardar");
    });
}

function extraerDatos() {
    const productos = [];
    const items = document.querySelectorAll("article"); 

    items.forEach((item, index) => {
        try {
            //Selectores para Chollometro y genéricos
            const tituloElement = item.querySelector(".thread-title") || item.querySelector("h2 a") || item.querySelector(".title");
            const precioElement = item.querySelector(".thread-price") || item.querySelector(".price") || item.querySelector("span span");
            const imgElement = item.querySelector("img");
            const linkElement = item.querySelector("a");

            const titulo = tituloElement ? tituloElement.innerText.trim() : "Sin título";
            const precio = precioElement ? precioElement.innerText.trim() : "0.00";
            const url = linkElement ? linkElement.href : window.location.href;
            const img = imgElement ? (imgElement.src || imgElement.dataset.src) : "";
            
            const idUnico = item.getAttribute("id") || `prod_${index}_${Date.now()}`;

            const productoJSON = {
                gtin: null, 
                articulo: titulo,
                cod_unico: idUnico,
                marca: "Desconocida", 
                fabricante: null,
                modelo: null,
                precio: precio,
                descuento: null,
                fecha_limite: null,
                url: url,
                url_img: img,
                fecha_scraping: new Date().toISOString()
            };

            productos.push(productoJSON);
        } catch (e) {
            console.error("Error procesando un item", e);
        }
    });

    return productos;
}

//Escuchamos los mensajes del popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scraping") {
        (async () => {
            try {
                const db = await initDB();
                const listaProductos = extraerDatos();
                
                for (const prod of listaProductos) {
                    await guardarProducto(db, prod);
                }
                
                sendResponse({ mensaje: `¡${listaProductos.length} productos guardados!` });
            } catch (error) {
                console.error(error);
                sendResponse({ mensaje: "Error en el proceso." });
            }
        })();
        return true;
    }
});