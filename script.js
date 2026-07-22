const fileInput = document.getElementById('fileInput');
const stage = document.getElementById('stage');
const dropHint = document.getElementById('dropHint');
const spinner = document.getElementById('loadingSpinner');
const viewerEl = document.getElementById('viewer');
const layoutBadge = document.getElementById('layoutBadge');
const fontBadge = document.getElementById('fontBadge');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const statusText = document.getElementById('statusText');
const progressFill = document.getElementById('progressFill');
const popupToast = document.getElementById('popupToast');
const dimensionsBadge = document.getElementById('dimensionsBadge');

let book = null;
let rendition = null;
let toastTimeoutId = null;
let isFixedLayoutBook = false;
let bookAspect = null;
let pendingSizeSync = false;

const setLoading = (isLoading) => {
  spinner.classList.toggle('hidden', !isLoading);
  dropHint.classList.toggle('hidden', isLoading || book !== null);
};

const setStatus = (text) => {
  statusText.textContent = text;
};

// Re-kick page-load style animations/scripts every time epub.js swaps in a
// new page, since it reuses/replaces iframe documents instead of doing a
// full browser navigation (so DOMContentLoaded/load never fire naturally).
const rekickPageAnimations = (_section, view) => {
  try {
    const win = (view && view.window) || (view && view.iframe && view.iframe.contentWindow);
    const doc = win && win.document;
    if (doc && doc.readyState === 'complete') {
      doc.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
      win.dispatchEvent(new Event('load'));
    }
  } catch (err) {
    console.warn('No se pudieron re-disparar los eventos de animación de la página', err);
  }
};

const updateProgress = (location) => {
  if (book.locations && book.locations.length() > 0) {
    const pct = book.locations.percentageFromCfi(location.start.cfi);
    progressFill.style.width = `${Math.round(pct * 100)}%`;
  }
  prevBtn.disabled = location.atStart;
  nextBtn.disabled = location.atEnd;

  // Now that epub.js has a location to redisplay after a resize, it's
  // safe to run any size sync that syncViewerSize() deferred earlier.
  if (pendingSizeSync) {
    pendingSizeSync = false;
    syncViewerSize();
  }
};

// ---- Adapt the viewer to the EPUB's own page format -------------------
//
// Fixed-layout books (comics, illustrated books, infographics) author
// their pages at a specific pixel size, declared either as book-level
// <meta property="rendition:viewport"> in the OPF, or as a per-page
// <meta name="viewport" content="width=W,height=H"> inside each XHTML
// page. Rather than stretching that page into a generic reading pane,
// size the viewer box to the same aspect ratio (like object-fit: contain)
// so it reads as an actual page of the book, at the largest size that
// fits the available space.

const parseViewportMeta = (content) => {
  if (!content) return null;
  const w = content.match(/width\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  const h = content.match(/height\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (!w || !h) return null;
  const width = parseFloat(w[1]);
  const height = parseFloat(h[1]);
  if (!width || !height) return null;
  return { width, height };
};

const fitViewerToBook = () => {
  if (!bookAspect) {
    viewerEl.style.removeProperty('width');
    viewerEl.style.removeProperty('height');
    viewerEl.style.removeProperty('max-width');
    if (dimensionsBadge) dimensionsBadge.classList.add('hidden');
    return;
  }

  if (dimensionsBadge) {
    dimensionsBadge.textContent = `${Math.round(bookAspect.width)}×${Math.round(bookAspect.height)} px`;
    dimensionsBadge.classList.remove('hidden');
  }

  const stageStyles = getComputedStyle(stage);
  const paddingX = parseFloat(stageStyles.paddingLeft) + parseFloat(stageStyles.paddingRight);
  const paddingY = parseFloat(stageStyles.paddingTop) + parseFloat(stageStyles.paddingBottom);
  const availWidth = stage.clientWidth - paddingX;
  const availHeight = stage.clientHeight - paddingY;
  const scale = Math.min(availWidth / bookAspect.width, availHeight / bookAspect.height);

  viewerEl.style.maxWidth = 'none';
  viewerEl.style.width = `${Math.floor(bookAspect.width * scale)}px`;
  viewerEl.style.height = `${Math.floor(bookAspect.height * scale)}px`;
};

// Resizes the viewer to the book's format (if known) and lets epub.js
// resize its own internal layout to match the viewer's actual box.
//
// epub.js only re-displays content after a manager resize if
// `rendition.location` is already set (see Rendition#onResized) — on the
// very first page that isn't true yet, so resizing at that exact moment
// would clear the page and never redraw it. Defer to updateProgress()
// (the 'relocated' handler, which is what actually sets `location`) when
// that's the case; peekBookAspectRatio() sizing the viewer *before*
// renderTo normally avoids ever hitting this path at all.
const syncViewerSize = () => {
  fitViewerToBook();
  if (!rendition) return;
  if (!rendition.location) {
    pendingSizeSync = true;
    return;
  }
  requestAnimationFrame(() => {
    const rect = viewerEl.getBoundingClientRect();
    rendition.resize(rect.width, rect.height);
  });
};

// Peeks at the first page's <meta name="viewport"> before rendering
// anything, so the viewer can already be the right shape by the time
// epub.js measures its container in renderTo() — most fixed-layout EPUBs
// only declare width/height per-page (not at the book level), and there
// is no way to read that without loading a page's markup first.
const peekBookAspectRatio = async (theBook) => {
  try {
    const firstSection = theBook.spine.first();
    if (!firstSection) return null;
    const contents = await firstSection.load(theBook.load.bind(theBook));
    const doc = contents && contents.ownerDocument;
    const meta = doc && doc.querySelector('meta[name="viewport"]');
    return meta && parseViewportMeta(meta.getAttribute('content'));
  } catch (err) {
    console.warn('No se pudo leer el formato de página del EPUB', err);
    return null;
  }
};

// Self-correcting fallback: re-checks the aspect ratio against whichever
// page is actually on screen, in case a book's pages aren't all the same
// size (rare, but allowed by the spec) or the initial peek failed.
const syncBookAspectRatio = (_section, view) => {
  if (!isFixedLayoutBook) return;
  try {
    const win = (view && view.window) || (view && view.iframe && view.iframe.contentWindow);
    const doc = win && win.document;
    const meta = doc && doc.querySelector('meta[name="viewport"]');
    const parsed = meta && parseViewportMeta(meta.getAttribute('content'));
    if (parsed && (!bookAspect || bookAspect.width !== parsed.width || bookAspect.height !== parsed.height)) {
      bookAspect = parsed;
      syncViewerSize();
    }
  } catch (err) {
    console.warn('No se pudo ajustar la pantalla al formato del EPUB', err);
  }
};

// ---- Identify (never override) the book's own typography --------------
//
// This reader deliberately never injects font-family/font-size CSS into
// the EPUB's pages — each page renders inside its own sandboxed iframe
// with the book's original stylesheet, so the author's typography (and
// any font embedded in the EPUB via @font-face) comes through untouched.
// This only *reads* the fonts actually in use, to show the reader which
// ones are active, as proof nothing is being substituted.

const setFontBadge = (text, hasError) => {
  fontBadge.textContent = text;
  fontBadge.classList.toggle('badge-font-error', hasError);
  fontBadge.classList.remove('hidden');
};

// Reports what's actually true about the page's fonts, not just what CSS
// asked for. A page's <link>/<style> can declare a custom @font-face and
// still end up rendering with a fallback font if that font file 404s, is
// missing from the EPUB's manifest (so epub.js never got a chance to
// resolve/inline it), or is in a format the browser can't parse — the
// CSS Font Loading API (`document.fonts`) is the only way to tell the
// difference between "declared" and "actually loaded", since each
// FontFace's `.status` only becomes 'loaded' once the browser has
// genuinely fetched and parsed the font data.
const reportPageFont = (doc) => {
  const customFonts = doc.fonts ? Array.from(doc.fonts) : [];
  const failed = customFonts.filter((f) => f.status === 'error');
  const loaded = customFonts.filter((f) => f.status === 'loaded');

  if (failed.length > 0) {
    const names = [...new Set(failed.map((f) => f.family.replace(/["']/g, '')))];
    console.warn(
      `El EPUB declara la fuente incrustada "${names.join(', ')}" pero no se pudo cargar `
      + '(revisa que el archivo de la fuente exista y esté declarado en el manifiesto del EPUB); '
      + 'el texto se está mostrando con una fuente de reemplazo.',
    );
    setFontBadge(`Fuente incrustada no cargó: ${names.join(', ')}`, true);
    return;
  }

  if (loaded.length > 0) {
    const names = [...new Set(loaded.map((f) => f.family.replace(/["']/g, '')))];
    setFontBadge(`Fuente incrustada: ${names.join(', ')}`, false);
    return;
  }

  // No @font-face at all: report whichever font-family the book's own
  // CSS (or the browser's default) actually resolved to for the body.
  const bodyFont = doc.body && getComputedStyle(doc.body).fontFamily;
  const first = bodyFont && bodyFont.split(',')[0].replace(/["']/g, '').trim();
  if (first) {
    setFontBadge(`Fuente: ${first}`, false);
  } else {
    fontBadge.classList.add('hidden');
  }
};

const syncFontBadge = (_section, view) => {
  try {
    const win = (view && view.window) || (view && view.iframe && view.iframe.contentWindow);
    const doc = win && win.document;
    if (!doc) return;

    fontBadge.classList.add('hidden');

    // doc.fonts.ready resolves once every font-face actually needed by
    // the page's rendered text has finished attempting to load (success
    // or failure) — reading .status any earlier could catch fonts still
    // mid-fetch and misreport them.
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(() => reportPageFont(doc)).catch(() => reportPageFont(doc));
    } else {
      reportPageFont(doc);
    }
  } catch (err) {
    console.warn('No se pudo identificar la tipografía de esta página', err);
  }
};

// ---- Video/hyperlink popup windows -----------------------------------
//
// Any <video> or absolute (external, href contains "://") <a> inside the
// EPUB content opens enlarged in a real browser popup window
// (window.open), instead of navigating away in place or replacing the
// reader. Relative links (chapters within the book) are left alone so
// normal reading navigation keeps working.

const YOUTUBE_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/i;
const VIMEO_RE = /vimeo\.com\/(\d+)/i;
const VIDEO_FILE_RE = /\.(mp4|webm|ogv|ogg|mov)(\?.*)?$/i;

const openPopups = [];

const getVideoEmbedUrl = (href) => {
  const yt = href.match(YOUTUBE_RE);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1`;

  const vm = href.match(VIMEO_RE);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1`;

  return null;
};

const showToast = (message) => {
  popupToast.textContent = message;
  popupToast.classList.remove('hidden');
  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => popupToast.classList.add('hidden'), 4000);
};

// Centers a sensibly large popup window on the user's screen so a video or
// linked page reads as "enlarged", not a cramped little box.
const popupFeatures = () => {
  const width = Math.min(1100, Math.round(window.screen.availWidth * 0.85));
  const height = Math.min(760, Math.round(window.screen.availHeight * 0.85));
  const left = Math.round((window.screen.availWidth - width) / 2);
  const top = Math.round((window.screen.availHeight - height) / 2);
  // Not "noopener" here: that feature makes window.open() return null,
  // which we need for tracking/closing popups and for writing the video
  // player markup into the video/embed ones.
  return `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
};

const trackPopup = (popup) => {
  if (!popup) {
    showToast('El navegador bloqueó la ventana emergente. Permite ventanas emergentes para este sitio y vuelve a intentarlo.');
    return null;
  }
  openPopups.push(popup);
  return popup;
};

const writePopupDocument = (popup, title, bodyHtml) => {
  popup.document.open();
  popup.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #000; }
    body { display: flex; align-items: center; justify-content: center; }
    video, iframe { width: 100%; height: 100%; border: 0; background: #000; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`);
  popup.document.close();
};

const openVideoFilePopup = (src) => {
  const popup = trackPopup(window.open('', '_blank', popupFeatures()));
  if (!popup) return;
  writePopupDocument(popup, 'Video', `<video src="${src}" controls autoplay></video>`);
};

const openVideoEmbedPopup = (embedUrl) => {
  const popup = trackPopup(window.open('', '_blank', popupFeatures()));
  if (!popup) return;
  writePopupDocument(
    popup,
    'Video',
    `<iframe src="${embedUrl}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>`,
  );
};

// Generic external links navigate the popup window directly to the href
// (rather than embedding it in an iframe) so the linked site renders with
// its own layout/scripts intact instead of hitting X-Frame-Options blocks.
const openLinkPopup = (href) => {
  const popup = trackPopup(window.open(href, '_blank', popupFeatures()));
  // Manual opener isolation (instead of the "noopener" window feature,
  // which would make window.open() return null and break tracking above):
  // the external page shouldn't be able to reach back into this reader.
  if (popup) popup.opener = null;
};

const handleExternalLink = (href) => {
  if (VIDEO_FILE_RE.test(href)) {
    openVideoFilePopup(href);
    return;
  }

  const embedUrl = getVideoEmbedUrl(href);
  if (embedUrl) {
    openVideoEmbedPopup(embedUrl);
    return;
  }

  openLinkPopup(href);
};

const closeAllPopups = () => {
  while (openPopups.length) {
    const popup = openPopups.pop();
    if (popup && !popup.closed) popup.close();
  }
};

// Intercepts clicks inside a rendered EPUB page. Attached per-page (in the
// 'rendered' hook) because epub.js swaps in a fresh iframe/document for
// every section. Uses the capture phase so it always runs before epub.js's
// own bubble-phase link handling and any script bundled in the EPUB page.
const attachContentLinkHandling = (_section, view) => {
  try {
    const win = (view && view.window) || (view && view.iframe && view.iframe.contentWindow);
    const doc = win && win.document;
    if (!doc || doc.__popupWindowBound) return;
    doc.__popupWindowBound = true;

    doc.addEventListener('click', (e) => {
      const link = e.target.closest && e.target.closest('a[href]');
      if (link) {
        const rawHref = link.getAttribute('href') || '';
        // Matches epub.js's own definition of "external": epub.js leaves
        // these as normal target="_blank" anchors instead of intercepting
        // them for internal chapter navigation.
        if (rawHref.indexOf('://') > -1) {
          e.preventDefault();
          e.stopPropagation();
          handleExternalLink(link.href);
        }
        return;
      }

      const video = e.target.closest && e.target.closest('video');
      if (video) {
        const source = video.currentSrc || video.getAttribute('src')
          || (video.querySelector('source') && video.querySelector('source').src);
        if (source) {
          e.preventDefault();
          e.stopPropagation();
          video.pause();
          openVideoFilePopup(source);
        }
      }
    }, true);
  } catch (err) {
    console.warn('No se pudo activar la ventana emergente de enlaces/videos en esta página', err);
  }
};

// Verifica nombres de archivo de imágenes: avisa si tienen >15 caracteres,
// espacios o signos especiales (no alfanuméricos, punto, guión o guión bajo).
const checkImageFileNames = (_section, view) => {
  try {
    const win = (view && view.window) || (view && view.iframe && view.iframe.contentWindow);
    const doc = win && win.document;
    if (!doc) return;

    const selectors = 'img[src], video[src], video source[src], audio[src], source[src]';
    const elements = doc.querySelectorAll(selectors);
    const problematic = [];

    elements.forEach((el) => {
      const src = el.getAttribute('src') || '';
      if (!src) return;
      const name = src.split('/').pop().split('?')[0];
      if (!name) return;

      const hasSpaces = /\s/.test(name);
      const hasSpecials = /[^a-zA-Z0-9._-]/.test(name);
      const tooLong = name.length > 15;

      if (tooLong || hasSpaces || hasSpecials) {
        problematic.push(name);
      }
    });

    if (problematic.length > 0) {
      const unique = [...new Set(problematic)];
      showToast(`Aviso: ${unique.length} imagen(es) con nombre problemático (más de 15 caracteres, espacios o signos especiales).`);
      console.warn('Imágenes con nombres problemáticos:', unique);
    }
  } catch (err) {
    console.warn('No se pudieron verificar los nombres de imagen', err);
  }
};

const openBook = async (file) => {
  if (!file) return;

  closeAllPopups();
  setLoading(true);
  viewerEl.innerHTML = '';
  isFixedLayoutBook = false;
  bookAspect = null;
  fitViewerToBook();
  // The viewer must stay laid out (not display:none) while epub.js renders
  // into it, otherwise it measures a 0x0 container and every page comes out
  // collapsed. The spinner overlays on top instead.
  viewerEl.classList.remove('hidden');
  dropHint.classList.add('hidden');
  layoutBadge.classList.add('hidden');
  fontBadge.classList.add('hidden');
  setStatus(`Cargando "${file.name}"...`);

  if (book) {
    book.destroy();
    book = null;
  }

  const arrayBuffer = await file.arrayBuffer();
  book = ePub(arrayBuffer);

  try {
    await book.ready;

    // EPUB3 fixed-layout ("diseño fijo") books declare
    // <meta property="rendition:layout">pre-paginated</meta> in the OPF.
    // epub.js exposes it on book.packaging.metadata.layout once book.ready resolves.
    const layout = (book.packaging && book.packaging.metadata && book.packaging.metadata.layout) || '';
    const isFixedLayout = layout === 'pre-paginated';
    isFixedLayoutBook = isFixedLayout;
    layoutBadge.classList.toggle('hidden', !isFixedLayout);

    // Determine the book's page format *before* rendering, so the viewer
    // is already the right shape by the time epub.js measures its
    // container in renderTo() below (see syncViewerSize() for why doing
    // this reactively, after the first render, doesn't work reliably).
    // Book-level <meta property="rendition:viewport"> is checked first
    // since it's free; falling back to peeking at the first page's own
    // <meta name="viewport"> covers the much more common case.
    if (isFixedLayout) {
      bookAspect = parseViewportMeta(book.packaging.metadata.viewport)
        || await peekBookAspectRatio(book);
    }
    fitViewerToBook();

    rendition = book.renderTo(viewerEl, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      manager: 'default',
      // Allows embedded <script> tags and CSS animations inside the EPUB
      // pages (fixed-layout comics/animated books) to run.
      allowScriptedContent: true,
      spread: isFixedLayout ? 'none' : 'auto',
    });

    rendition.on('rendered', rekickPageAnimations);
    rendition.on('rendered', attachContentLinkHandling);
    rendition.on('rendered', syncBookAspectRatio);
    rendition.on('rendered', syncFontBadge);
    rendition.on('rendered', checkImageFileNames);
    rendition.on('relocated', updateProgress);

    await rendition.display();

    prevBtn.disabled = false;
    nextBtn.disabled = false;
    fullscreenBtn.disabled = false;
    setStatus(`${isFixedLayout ? 'Diseño fijo · ' : 'Reflow · '}${file.name}`);

    book.locations.generate(600).then(() => {
      const cfi = rendition.location && rendition.location.start && rendition.location.start.cfi;
      if (cfi) {
        progressFill.style.width = `${Math.round(book.locations.percentageFromCfi(cfi) * 100)}%`;
      }
    });
  } catch (err) {
    console.error('No se pudo abrir el EPUB', err);
    setStatus('Error al abrir el archivo. ¿Es un .epub válido?');
    viewerEl.classList.add('hidden');
    dropHint.classList.remove('hidden');
    if (dimensionsBadge) dimensionsBadge.classList.add('hidden');
    book = null;
  } finally {
    setLoading(false);
  }
};

fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  openBook(file);
});

stage.addEventListener('dragover', (e) => {
  e.preventDefault();
});

stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) openBook(file);
});

prevBtn.addEventListener('click', () => {
  if (rendition) rendition.prev();
});

nextBtn.addEventListener('click', () => {
  if (rendition) rendition.next();
});

window.addEventListener('keydown', (e) => {
  if (!rendition) return;
  if (e.key === 'ArrowLeft') rendition.prev();
  if (e.key === 'ArrowRight') rendition.next();
});

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    stage.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

// Keep the viewer's size (and epub.js's own layout) matching both the
// available space and the book's own page format as the window changes.
window.addEventListener('resize', syncViewerSize);

// #stage jumps straight to the screen's full size the instant fullscreen
// is entered/exited, but the viewer keeps whatever pixel size it had
// before that (its own CSS doesn't recompute automatically), leaving big
// blank margins around it. No 'resize' event is guaranteed to fire for
// this, so resync explicitly; the rAF lets the fullscreen layout settle
// before #stage is measured.
document.addEventListener('fullscreenchange', () => {
  requestAnimationFrame(syncViewerSize);
});
