function extraerDatos() {
    const productos = [];
    const items = document.querySelectorAll("article"); 

    items.forEach((item, index) => {
        try {
            //Probado en Chollometro
            const tituloElement = item.querySelector(".thread-title") || item.querySelector("h2 a") || item.querySelector(".title");
            const precioElement = item.querySelector(".thread-price") || item.querySelector(".price") || item.querySelector("span span");
            const imgElement = item.querySelector("img");
            const linkElement = item.querySelector("a");

            const titulo = tituloElement ? tituloElement.innerText.trim() : "Sin título";
            const precio = precioElement ? precioElement.innerText.trim() : "0.00";
            const url = linkElement ? linkElement.href : window.location.href;
            const img = imgElement ? (imgElement.src || imgElement.dataset.src) : "";
            
            //Genero un ID único si la web no lo da explícitamente
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