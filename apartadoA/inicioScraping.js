async function iniciarScraping() {
    console.log("Iniciando proceso de Scraping...");
    
    try {
        const db = await initDB();
        console.log("Base de datos conectada.");

        const listaProductos = extraerDatos();
        console.log(`Se han encontrado ${listaProductos.length} productos.`);

        for (const prod of listaProductos) {
            await guardarProducto(db, prod);
        }

        console.log("Todos los productos han sido guardados en IndexedDB.");
    } catch (error) {
        console.error("Hubo un error:", error);
    }
}

iniciarScraping();