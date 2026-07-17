# Lector EPUB (Diseño fijo)

Lector de libros **EPUB** hecho en **HTML, CSS y JavaScript puro** (sin frameworks ni compilación), usando [epub.js](https://github.com/futurepress/epub.js/) para el parseo y renderizado del archivo. Detecta automáticamente los libros de **diseño fijo** (cómics, libros ilustrados, infografías) y mantiene sus animaciones CSS/JS funcionando mientras lees.

## Características

- **Abrir un `.epub`** arrastrándolo a la pantalla o con el botón "Abrir .epub".
- **Detección automática de diseño fijo**: si el libro declara `rendition:layout = pre-paginated` en su metadata, la página se muestra fija a su tamaño original (sin reflujo de texto) y aparece la insignia "Diseño fijo · animaciones".
- **Animaciones CSS/JS activas**: las animaciones `@keyframes`, scripts embebidos y elementos interactivos de cada página del EPUB se re-disparan correctamente cada vez que el lector cambia de página.
- **Videos e hipervínculos en ventana emergente**: cualquier video (archivo directo, YouTube o Vimeo) y cualquier hipervínculo externo dentro del libro se abre **ampliado en una ventana emergente del navegador**, sin salir de la lectura. Los enlaces internos (capítulos del propio libro) siguen navegando con normalidad.
- **Navegación**: flechas `‹ ›` de la barra superior, flechas del teclado, toques a los lados de la página, o pantalla completa.
- **Barra de progreso** de lectura en el pie de página.

## Cómo usar

1. Abre `index.html` en el navegador (necesita conexión a internet la primera vez, para cargar epub.js y JSZip desde CDN).
2. Arrastra un archivo `.epub` a la pantalla, o usa el botón **"Abrir .epub"**.
3. Lee y navega con las flechas, el teclado o tocando los lados de la página.
4. Si el navegador bloquea una ventana emergente al abrir un video o enlace, aparece un aviso indicando que debes permitir ventanas emergentes para este sitio.

## Estructura de archivos

```
EpubReader/
├── index.html   # Estructura de la página y carga de epub.js/JSZip
├── style.css    # Estilos, animaciones y diseño responsivo
└── script.js    # Lógica del lector: carga del EPUB, navegación,
                 # detección de diseño fijo y ventanas emergentes
```

## Tecnologías

- HTML5
- CSS3 (animaciones, flexbox, variables CSS)
- JavaScript (ES6+, sin build step)
- [epub.js](https://github.com/futurepress/epub.js/) `0.3.93` y [JSZip](https://stuk.github.io/jszip/) `3.10.1` vía CDN

## Créditos

Curso de Infografía 2026 · Mg Mario Quiroz Martinez
