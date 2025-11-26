const dbName = "ScrapingDB";
const storeName = "Productos";

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);

        request.onerror = (event) => {
            reject("Error al abrir la BD");
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                const objectStore = db.createObjectStore(storeName, { keyPath: "cod_unico" });
                objectStore.createIndex("marca", "marca", { unique: false });
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
    });
}

function guardarProducto(db, producto) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.put(producto);

        request.onsuccess = () => {
            resolve("Producto guardado");
        };

        request.onerror = () => {
            reject("Error al guardar");
        };
    });
}