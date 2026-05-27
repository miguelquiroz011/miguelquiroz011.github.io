/* =============================================
   VILLATINA — Sistema de Información Territorial
   scripts.js — v4.0
   =============================================
   CAMBIOS v4.0:
   - Simbología categórica mejorada (coberturas)
   - Street View flotante interno (sin window.open)
   - Comparador swipe propio (sin plugin externo)
   - Rásteres independientes con caché
   - Nueva herramienta de medición desde cero
   - Ortofotos de Medellín como basemaps
   - Dashboard mejorado (modo auto + personalizado)
   - Tabla de atributos solo manual
   - Sin parpadeos ni conflictos
   ============================================= */

'use strict';

// =============================================
// ESTADO GLOBAL
// =============================================
let globalFeatureId       = 0;
let featuresSeleccionados = new Set();
let capasLeaflet          = {};
let capasAtributosModificados = {};
let drawHandler           = null;
let streetViewActivo      = false;
let tablaLayerKeyActual   = null;
let tablaDataActual       = [];
let tablaSortCol          = null;
let tablaSortDir          = 'asc';
let tablaCamposActual     = [];
let tablaVistaActual      = [];
let tablaRenderToken      = 0;
let tablaSearchTimer      = null;
let sidebarVisible        = true;
let dashboardMode         = 'auto';   // 'auto' | 'custom'
let dashboardCharts       = {};
let capasRasterLeaflet    = {};
let georasterCache        = {};       // raw georaster objects para re-uso
let svLatLngActual        = null;
let streetViewProveedor   = 'google';
let capasTotal            = 0;
let capacargadas          = 0;
let legendaDebounceTimer  = null;
let dashboardCustomChart  = null;
let estiloUpdateRaf       = null;
let dashboardColorOverrides = {};
let rasterActiveOrder     = [];
let ortofotoMetadataCache = {};
let lastCustomDashboardConfig = null;
const capasPendientesEstilo = new Set();
const TABLA_RENDER_BATCH  = 220;
const MOBILE_MEDIA_QUERY  = '(max-width: 768px)';

// =============================================
// LOADING SCREEN
// =============================================
function actualizarLoading(msg, pct) {
    const bar = document.getElementById('loading-bar');
    const txt = document.getElementById('loading-msg');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = msg;
}

function ocultarLoading() {
    const screen = document.getElementById('loading-screen');
    const app    = document.getElementById('app');
    if (screen) screen.classList.add('fade-out');
    if (app)    app.classList.add('visible');
    setTimeout(() => { if (screen) screen.style.display = 'none'; }, 700);
}

// =============================================
// PALETA COBERTURAS — CORINE Land Cover Colombia
// =============================================
const coberturasPaleta = {
    // Territorios artificializados → ROJO
    'tejido urbano continuo':    '#c62828',
    'tejido urbano discontinuo': '#e53935',
    'zona urbana':               '#e53935',
    'urbano':                    '#d32f2f',
    'asentamiento':              '#ef5350',
    'zona industrial':           '#b71c1c',
    'construccion':              '#c62828',
    'construido':                '#e53935',
    // Bosques y vegetación natural → VERDE
    'bosque denso':              '#1b5e20',
    'bosque fragmentado':        '#2e7d32',
    'bosque ripario':            '#388e3c',
    'bosque':                    '#2e7d32',
    'vegetacion secundaria':     '#43a047',
    'vegetacion':                '#388e3c',
    'arbustal':                  '#558b2f',
    'herbazal':                  '#7cb342',
    'natural':                   '#43a047',
    'pastos':                    '#8bc34a',
    'pasto':                     '#9ccc65',
    // Superficies de agua → AZUL
    'cuerpo de agua':            '#0d47a1',
    'rio':                       '#1565c0',
    'agua':                      '#1565c0',
    'laguna':                    '#1976d2',
    'humedal':                   '#006064',
    'pantano':                   '#00838f',
    'zonas inundables':          '#0288d1',
    // Territorios agrícolas → AMARILLO/NARANJA
    'cultivos':                  '#f57f17',
    'agricola':                  '#f9a825',
    'cultivo':                   '#fbc02d',
    'mosaico':                   '#ffb300',
    'plantacion':                '#ff8f00',
    // Suelos desnudos → MARRÓN
    'suelo desnudo':             '#6d4c41',
    'erosion':                   '#795548',
    'desnudo':                   '#8d6e63',
    'afloramiento':              '#a1887f',
    'tierras desnudas':          '#6d4c41',
    // Zonas degradadas
    'degradado':                 '#9e9d24',
    // Default
    'default':                   '#90a4ae'
};

function getColorCobertura(valor) {
    if (!valor) return coberturasPaleta.default;
    const v = String(valor).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    // Exacto primero
    if (coberturasPaleta[v]) return coberturasPaleta[v];
    // Contiene subclave
    for (const [clave, color] of Object.entries(coberturasPaleta)) {
        if (clave !== 'default' && v.includes(clave)) return color;
    }
    return coberturasPaleta.default;
}

// =============================================
// PALETA CLASIFICACIÓN DEL SUELO
// =============================================
const sueloPaleta = {
    'urbano':     '#e53935',
    'rural':      '#66bb6a',
    'expansion':  '#ff7043',
    'proteccion': '#26a69a',
    'suburbano':  '#ab47bc',
    'default':    '#78909c'
};

function getColorSuelo(valor) {
    if (!valor) return sueloPaleta.default;
    const v = String(valor).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [k, c] of Object.entries(sueloPaleta)) {
        if (k !== 'default' && v.includes(k)) return c;
    }
    return sueloPaleta.default;
}

// =============================================
// ESTILOS BASE DE MAPA
// =============================================
const estilosMapa = {
    hidrografia:    { color: '#0ea5e9', weight: 2,   fillColor: '#0ea5e9',  fillOpacity: 0.55 },
    administrativo: { color: '#e879f9', weight: 2,   fillColor: '#e879f9',  fillOpacity: 0.12 },
    catastro:       { color: '#22c55e', weight: 1,   fillColor: '#22c55e',  fillOpacity: 0.30 },
    manzana:        { color: '#f59e0b', weight: 1.5, fillColor: '#fbbf24',  fillOpacity: 0.35 },
    influencia:     { color: '#ef4444', weight: 2,   fillColor: '#f97316',  fillOpacity: 0.28 },
    limite:         { color: '#db2777', weight: 2.5, fillColor: '#db2777',  fillOpacity: 0.06 },
    cobertura:      { color: '#333333', weight: 0.5, fillColor: '#16a34a',  fillOpacity: 0.82 },
    suelo:          { color: '#555555', weight: 0.8, fillColor: '#fbbf24',  fillOpacity: 0.70 },
    construcciones: { color: '#7c3aed', weight: 1,   fillColor: '#a78bfa',  fillOpacity: 0.55 },
    resaltado:      { color: '#f59e0b', weight: 3.5, fillColor: '#f59e0b',  fillOpacity: 0.65 },
    default:        { color: '#6366f1', weight: 2,   fillColor: '#6366f1',  fillOpacity: 0.35 }
};

function obtenerEstiloOriginal(nombre) {
    const k = nombre.toLowerCase();
    if (k.includes('hidrograf'))                                                 return { ...estilosMapa.hidrografia };
    if (k.includes('influencia') || k.includes('area'))                          return { ...estilosMapa.influencia };
    if (k.includes('comun') || k.includes('barrio') || k.includes('villatina')
        || k.includes('san antonio'))                                             return { ...estilosMapa.administrativo };
    if (k.includes('municipio') || k.includes('limite'))                         return { ...estilosMapa.limite };
    if (k.includes('manzana'))                                                   return { ...estilosMapa.manzana };
    if (k.includes('predio'))                                                    return { ...estilosMapa.catastro };
    if (k.includes('cobertura') || k.includes('1983') || k.includes('2004') || k.includes('2025'))
                                                                                 return { ...estilosMapa.cobertura };
    if (k.includes('suelo') || k.includes('clasificac'))                         return { ...estilosMapa.suelo };
    if (k.includes('construc'))                                                  return { ...estilosMapa.construcciones };
    return { ...estilosMapa.default };
}

// =============================================
// INICIALIZACIÓN DEL MAPA
// =============================================
const map = L.map('map', {
    zoomControl: false,
    preferCanvas: true  // mejor rendimiento para muchas features
}).setView([6.24, -75.58], 14);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Panes dedicados para swipe
map.createPane('swipeLeftPane');
map.createPane('swipeRightPane');
map.createPane('rasterPane');
map.createPane('ortofotoPane');
map.getPane('swipeLeftPane').style.zIndex  = 400;
map.getPane('swipeRightPane').style.zIndex = 400;
map.getPane('rasterPane').style.zIndex     = 350;
map.getPane('ortofotoPane').style.zIndex   = 330;

// Coordenadas en tiempo real (throttled)
const coordText = document.getElementById('coord-text');
let coordRaf = null;
map.on('mousemove', (e) => {
    if (coordRaf) return;
    coordRaf = requestAnimationFrame(() => {
        coordText.innerHTML = `${e.latlng.lat.toFixed(5)}&nbsp;&nbsp;|&nbsp;&nbsp;${e.latlng.lng.toFixed(5)}`;
        coordRaf = null;
    });
});

// =============================================
// MAPAS BASE — ESTÁNDAR
// =============================================
const baseLayers = {
    'satelital': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri World Imagery', maxZoom: 19
    }),
    'oscuro': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB', maxZoom: 20
    }),
    'calles': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
    }),
    'topo': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap', maxZoom: 17
    })
};

// =============================================
// ORTOFOTOS DE MEDELLIN - ImageServer estable desde el geovisor g
// =============================================
const ortofotosConfig = [
    { key: 'ortofoto_2024', label: 'Ortofoto 2024', año: '2024',
      url: 'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/Ortofoto_Medellin_2024/ImageServer',
      color: '#0881a8' },
    { key: 'ortofoto_2021', label: 'Ortofoto 2021', año: '2021',
      url: 'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/Ortofoto_Medellin_2021_MAGNA_Medellin/ImageServer',
      color: '#0891b2' },
    { key: 'ortofoto_2019', label: 'Ortofoto 2019', año: '2019',
      url: 'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/Ortofoto_Medellin_2019/ImageServer',
      color: '#0e7490' },
    { key: 'ortofoto_2016', label: 'Ortofoto 2016', año: '2016',
      url: 'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/Ortofoto_Medellin_2016_Centro/ImageServer',
      color: '#065f46' },
    { key: 'ortofoto_2008', label: 'QuickBird 2008', año: '2008',
      url: 'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/QuickBird_2008/ImageServer',
      color: '#92400e' },
    { key: 'ortofoto_2004', label: 'Ortofoto 2004', año: '2004',
      url: 'https://www.medellin.gov.co/servidormapas/rest/services/ServiciosImagen/Ortofotos_2004_SIGMA/ImageServer',
      color: '#78350f' }
];

const ortofotasLayers = {};
if (typeof L.esri !== 'undefined') {
    ortofotosConfig.forEach(cfg => {
        ortofotasLayers[cfg.key] = L.esri.imageMapLayer({
            url: cfg.url,
            opacity: 0.92,
            pane: 'ortofotoPane',
            attribution: `© Alcaldía de Medellín ${cfg.año}`
        });
    });
} else {
    console.warn('[Villatina] Esri Leaflet no esta disponible; las ortofotos ImageServer no se cargaran.');
}

let basemapActivo = 'satelital';
baseLayers['satelital'].addTo(map);

// UI: cards de mapas base
const baseInfo = {
    satelital: { label: 'Satelital', icon: 'fa-satellite', thumbClass: 'basemap-thumb-satelital' },
    oscuro:    { label: 'Oscuro',    icon: 'fa-moon',      thumbClass: 'basemap-thumb-oscuro' },
    calles:    { label: 'Calles',    icon: 'fa-road',      thumbClass: 'basemap-thumb-calles' },
    topo:      { label: 'Topo',      icon: 'fa-mountain',  thumbClass: 'basemap-thumb-topo' }
};

const baseContainer = document.getElementById('basemaps-container');
Object.keys(baseLayers).forEach(key => {
    const info = baseInfo[key] || { label: key, icon: 'fa-map', thumbClass: '' };
    const card = document.createElement('div');
    card.className = 'basemap-card' + (key === 'satelital' ? ' active' : '');
    card.id = `basemap-card-${key}`;
    card.title = info.label;
    card.innerHTML = `
        <div class="basemap-thumb ${info.thumbClass}"></div>
        <span class="basemap-label">${info.label}</span>
    `;
    card.onclick = () => activarBasemap(key, card);
    baseContainer.appendChild(card);
});

function activarBasemap(key, cardEl) {
    // Solo cambia el mapa base; las ortofotos quedan como capas superpuestas.
    Object.values(baseLayers).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });

    if (baseLayers[key]) {
        baseLayers[key].addTo(map).bringToBack();
        basemapActivo = key;
    }

    document.querySelectorAll('.basemap-card').forEach(c => c.classList.remove('active'));
    if (cardEl) cardEl.classList.add('active');
    poblarSelectsSwipe();
}

// UI: grid de ortofotos como overlays ImageServer
const ortofotosGrid = document.getElementById('ortofotos-grid');
ortofotosConfig.forEach(cfg => {
    const card = document.createElement('div');
    card.className = 'ortofoto-card';
    card.id = `ortofoto-card-${cfg.key}`;
    card.innerHTML = `
        <div class="ortofoto-thumb" style="background:linear-gradient(135deg,${cfg.color}44,${cfg.color}88);">
            <i class="fa-solid fa-satellite-dish" style="color:${cfg.color};font-size:1.5rem;"></i>
        </div>
        <div class="ortofoto-info">
            <span class="ortofoto-label">${cfg.label}</span>
            <span class="ortofoto-año">${cfg.año}</span>
        </div>
        <label class="orto-toggle" title="Activar/Desactivar capa">
            <input type="checkbox" id="chk-orto-${cfg.key}">
            <span class="orto-track"></span>
        </label>
        <button class="layer-action-btn" type="button" title="Zoom a la ortofoto"
            onclick="event.stopPropagation(); zoomToOrtofoto('${cfg.key}')">
            <i class="fa-solid fa-magnifying-glass-location"></i>
        </button>
    `;
    const chk = card.querySelector('input');
    chk.checked = false;
    card.classList.remove('active-orto');
    chk.addEventListener('change', (e) => {
        const layer = ortofotasLayers[cfg.key];
        card.classList.toggle('active-orto', e.target.checked);
        if (!layer) {
            e.target.checked = false;
            card.classList.remove('active-orto');
            return;
        }
        if (e.target.checked) {
            layer.addTo(map);
            ordenarOrtofotosActivas();
        } else if (map.hasLayer(layer)) {
            map.removeLayer(layer);
            if (VillatinaSwipe.isActive) desactivarSwipe(true);
        }
        poblarSelectsSwipe();
    });
    ortofotosGrid.appendChild(card);
});

// =============================================
// CONFIGURACIÓN GRUPOS DE CAPAS
// =============================================
const gruposCapas = [
    { id: 'catastro',       nombre: 'Catastro',               icono: 'fa-city',                color: '#22c55e', capas: ['Villatina Predios', 'San Antonio Predios', 'Villatina Manzanas', 'San Antonio Manzanas'] },
    { id: 'hidrografia',    nombre: 'Hidrografía',            icono: 'fa-water',               color: '#0ea5e9', capas: ['Villatina Hidrografia', 'San Antonio Hidrografia'] },
    { id: 'administrativa', nombre: 'División Administrativa', icono: 'fa-map',                 color: '#e879f9', capas: ['comunas', 'Barrios', 'Villatina', 'San Antonio'] },
    { id: 'riesgo',         nombre: 'Riesgo',                  icono: 'fa-triangle-exclamation',color: '#ef4444', capas: ['Area de Influencia'] },
    { id: 'limite',         nombre: 'Límite Municipal',        icono: 'fa-border-all',          color: '#db2777', capas: ['limite_municipio'] },
    { id: 'cobertura',      nombre: 'Coberturas del Suelo',    icono: 'fa-tree',                color: '#16a34a', capas: ['cobertura_1983', 'cobertura_2004', 'cobertura_2025'] },
    { id: 'suelo_uso',      nombre: 'Clasificación del Suelo', icono: 'fa-layer-group',         color: '#d97706', capas: ['clasificacion_suelo'] },
    { id: 'construcciones', nombre: 'Construcciones',          icono: 'fa-building',            color: '#7c3aed', capas: ['construcciones_2025'] }
];

// =============================================
// CONFIGURACIÓN CAPAS GEOGRÁFICAS
// =============================================
const capasConfig = [
    { key: 'comunas',              nombre: 'Comunas',                 url: 'data/comunas.json' },
    { key: 'Barrios',              nombre: 'Barrios',                 url: 'data/Barrios.json' },
    { key: 'Villatina',            nombre: 'Villatina',               url: 'data/Villatina.json' },
    { key: 'San Antonio',          nombre: 'San Antonio',             url: 'data/SanAntonio.json' },
    { key: 'San Antonio Hidrografia', nombre: 'Hidrografía San Antonio', url: 'data/Hidrografia_SanAntonio.json' },
    { key: 'Villatina Hidrografia',   nombre: 'Hidrografía Villatina',   url: 'data/Hidrografia_Villahermosa.json' },
    { key: 'San Antonio Predios',  nombre: 'Predios San Antonio',    url: 'data/SanAntonio_Predios.json' },
    { key: 'Villatina Predios',    nombre: 'Predios Villatina',      url: 'data/Villatina_Predios.json' },
    { key: 'San Antonio Manzanas', nombre: 'Manzanas San Antonio',   url: 'data/SanAntonio_Manzanas.geojson' },
    { key: 'Villatina Manzanas',   nombre: 'Manzanas Villatina',     url: 'data/Villatina_Manzanas.json' },
    { key: 'Area de Influencia',   nombre: 'Área de Influencia (50 m)', url: 'data/Area_Influencia.json' },
    { key: 'limite_municipio',     nombre: 'Límite Municipal',       url: 'data/Limitemunicipio.json' },
    {
        key: 'cobertura_1983', nombre: 'Cobertura 1983', url: 'data/1983.geojson',
        categorica: { campo: 'cobertura', fn: getColorCobertura }
    },
    {
        key: 'cobertura_2004', nombre: 'Cobertura 2004', url: 'data/2004.geojson',
        categorica: { campo: 'COBERTURAS', fn: getColorCobertura }
    },
    {
        key: 'cobertura_2025', nombre: 'Cobertura 2025', url: 'data/2025.geojson',
        categorica: { campo: 'Coberturas', fn: getColorCobertura }
    },
    {
        key: 'clasificacion_suelo', nombre: 'Clasificación del Suelo', url: 'data/clasificaciondelsuelo.geojson',
        categorica: { campo: 'clase_suel', fn: getColorSuelo }
    },
    {
        key: 'construcciones_2025', nombre: 'Construcciones 2025', url: 'data/construcciones2025.geojson',
        defaultRenderer: { type: 'graduated', field: 'numero_pis' }
    }
];

// =============================================
// CAPAS RÁSTER — GeoTIFF
// =============================================
const capasRasterConfig = [
    { key: 'raster_2004', nombre: 'Imagen Satelital 2004', url: 'data/raster/2004.tif', opacity: 0.9, zIndex: 351 },
    { key: 'raster_2025', nombre: 'Imagen Satelital 2025', url: 'data/raster/2024geo.tif', opacity: 0.9, zIndex: 352 },
    { key: 'raster_1983', nombre: 'Imagen Satelital 1983', url: 'data/raster/1983ANA.tif', opacity: 0.9, zIndex: 353 }
];

// =============================================
// UTILIDAD: ESTILO DE FEATURE
// =============================================
function normalizarNumero(valor) {
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
    if (valor === null || valor === undefined) return NaN;
    let s = String(valor).trim();
    if (!s) return NaN;
    s = s.replace(/\s/g, '');
    if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    else if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s);
}

function getLayerFeatures(key) {
    const layer = capasLeaflet[key];
    if (!layer) return [];
    try { return layer.toGeoJSON().features || []; }
    catch (e) { return []; }
}

function getLayerFields(key) {
    const features = getLayerFeatures(key);
    const fieldSet = new Set();
    features.slice(0, 40).forEach(f => {
        Object.keys(f.properties || {}).forEach(c => {
            if (!c.startsWith('_nova')) fieldSet.add(c);
        });
    });
    return [...fieldSet];
}

function esCampoNumerico(features, field) {
    const sample = features.slice(0, 80).map(f => normalizarNumero(f.properties?.[field]));
    const validos = sample.filter(v => !isNaN(v));
    return validos.length > 0 && validos.length >= Math.max(3, sample.length * 0.45);
}

function elegirCampoSugerido(key, config) {
    if (config?.categorica?.campo) return config.categorica.campo;
    if (config?.defaultRenderer?.field) return config.defaultRenderer.field;

    const fields = getLayerFields(key);
    const preferidos = ['riesgo', 'amenaza', 'nivel', 'categoria', 'altura', 'pisos', 'numero_pis', 'Formalidad', 'clase', 'tipo'];
    const porNombre = fields.find(f => preferidos.some(p => f.toLowerCase().includes(p.toLowerCase())));
    if (porNombre) return porNombre;

    const features = getLayerFeatures(key);
    return fields.find(f => {
        const uniques = new Set(features.slice(0, 80).map(ft => ft.properties?.[f]).filter(v => v !== null && v !== undefined && v !== '')).size;
        return uniques > 1 && uniques <= 30;
    }) || fields[0] || '';
}

function getCategoryKey(field, value) {
    return `${field}::${String(value ?? 'default')}`;
}

function getCategorySettings(mod, field, value, config) {
    const key = getCategoryKey(field, value);
    return mod?.categorias?.[key] || (config?.categorica?.campo === field ? mod?.categorias?.[value] : null);
}

function setCategorySettings(layerKey, field, value, changes) {
    const config = capasConfig.find(c => c.key === layerKey);
    const mod = capasAtributosModificados[layerKey];
    const catKey = getCategoryKey(field, value);
    const fallback = config?.categorica?.campo === field && config.categorica.fn
        ? config.categorica.fn(value)
        : generarColorChart(`${field}-${value}`);
    if (!mod.categorias[catKey]) {
        mod.categorias[catKey] = { color: fallback, visible: true };
    }
    Object.assign(mod.categorias[catKey], changes);
}

function getDefaultRenderer(key) {
    const config = capasConfig.find(c => c.key === key);
    const features = getLayerFeatures(key);
    const field = elegirCampoSugerido(key, config);

    if (config?.defaultRenderer) return { ...config.defaultRenderer };
    if (config?.categorica) return { type: 'unique', field: config.categorica.campo };
    if (field && esCampoNumerico(features, field) && /altura|piso|riesgo|amenaza|area|shape_area/i.test(field)) {
        return { type: 'graduated', field };
    }
    return { type: 'simple', field };
}

function initCapaAtributosModificados(key, preservarRenderer = false) {
    const original = obtenerEstiloOriginal(key);
    const previo = capasAtributosModificados[key];
    capasAtributosModificados[key] = {
        general: { ...original, opacity: original.opacity ?? 1 },
        categorias: preservarRenderer ? { ...(previo?.categorias || {}) } : {},
        graduated: preservarRenderer ? { ...(previo?.graduated || {}) } : {},
        renderer: preservarRenderer && previo?.renderer ? { ...previo.renderer } : getDefaultRenderer(key)
    };
}

function getRampColor(index, total) {
    const ramp = ['#2a9d8f', '#8ab17d', '#e9c46a', '#f4a261', '#e76f51', '#b91c1c'];
    if (total <= 1) return ramp[2];
    const pos = Math.round((index / (total - 1)) * (ramp.length - 1));
    return ramp[pos];
}

function getGraduatedBreaks(layerKey, field) {
    if (!capasAtributosModificados[layerKey]) initCapaAtributosModificados(layerKey);
    const mod = capasAtributosModificados[layerKey];
    if (mod.graduated?.[field]?.breaks?.length) return mod.graduated[field].breaks;

    const valores = getLayerFeatures(layerKey)
        .map(f => normalizarNumero(f.properties?.[field]))
        .filter(v => !isNaN(v))
        .sort((a, b) => a - b);

    if (!valores.length) {
        mod.graduated[field] = { breaks: [] };
        return [];
    }

    const min = valores[0];
    const max = valores[valores.length - 1];
    const total = min === max ? 1 : 5;
    const step = total === 1 ? 1 : (max - min) / total;
    const breaks = [];

    for (let i = 0; i < total; i++) {
        const bMin = total === 1 ? min : min + step * i;
        const bMax = total === 1 ? max : (i === total - 1 ? max : min + step * (i + 1));
        breaks.push({
            min: bMin,
            max: bMax,
            color: getRampColor(i, total),
            visible: true,
            label: total === 1
                ? `${formatNumeroCorto(min)}`
                : `${formatNumeroCorto(bMin)} - ${formatNumeroCorto(bMax)}`
        });
    }

    mod.graduated[field] = { breaks };
    return breaks;
}

function formatNumeroCorto(valor) {
    return Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 1 });
}

function getGraduatedStyle(layerKey, field, value) {
    const breaks = getGraduatedBreaks(layerKey, field);
    if (!breaks.length || isNaN(value)) return null;
    return breaks.find((b, i) => value >= b.min && (value <= b.max || i === breaks.length - 1)) || breaks[breaks.length - 1];
}

function getFeatureStyle(key, feature) {
    const config = capasConfig.find(c => c.key === key);
    const mod = capasAtributosModificados[key];
    const gen = mod?.general || { ...obtenerEstiloOriginal(key), opacity: 1 };
    const renderer = mod?.renderer || getDefaultRenderer(key);

    if (renderer.type === 'graduated' && renderer.field) {
        const clase = getGraduatedStyle(key, renderer.field, normalizarNumero(feature.properties?.[renderer.field]));
        if (clase && clase.visible === false) return { weight: 0, fillOpacity: 0, opacity: 0 };
        if (clase) {
            return {
                color: gen.color || 'rgba(0,0,0,0.45)',
                weight: typeof gen.weight !== 'undefined' ? gen.weight : 0.8,
                fillColor: clase.color,
                fillOpacity: typeof gen.fillOpacity !== 'undefined' ? gen.fillOpacity : 0.75,
                opacity: typeof gen.opacity !== 'undefined' ? gen.opacity : 1
            };
        }
    }

    // Categorias con color/visibilidad individual, configurable por cualquier atributo.
    if (renderer.type === 'unique' && renderer.field) {
        const val = feature.properties?.[renderer.field] ?? 'default';
        const catSettings = getCategorySettings(mod, renderer.field, val, config);

        if (catSettings && catSettings.visible === false) {
            return { weight: 0, fillOpacity: 0, opacity: 0 };
        }

        const defaultColor = config?.categorica?.campo === renderer.field && config.categorica.fn
            ? config.categorica.fn(val)
            : generarColorChart(`${renderer.field}-${val}`);

        return {
            color: gen.color || 'rgba(0,0,0,0.4)',
            weight: typeof gen.weight !== 'undefined' ? gen.weight : 0.5,
            fillColor: catSettings?.color || defaultColor,
            fillOpacity: typeof gen.fillOpacity !== 'undefined' ? gen.fillOpacity : 0.85,
            opacity: typeof gen.opacity !== 'undefined' ? gen.opacity : 1
        };
    }

    return { ...gen };
}

function getFeatureCenter(leafletLayer, feature) {
    try {
        if (leafletLayer.getCenter)  return leafletLayer.getCenter();
        if (leafletLayer.getLatLng)  return leafletLayer.getLatLng();
        if (feature.geometry?.type === 'Point') {
            const [lng, lat] = feature.geometry.coordinates;
            return L.latLng(lat, lng);
        }
        const b = leafletLayer.getBounds?.();
        return b ? b.getCenter() : L.latLng(6.24, -75.58);
    } catch (e) {
        return L.latLng(6.24, -75.58);
    }
}

function boundsSonValidos(bounds) {
    return bounds && bounds.isValid && bounds.isValid();
}

function ajustarMapaABounds(bounds, maxZoom = 19) {
    if (!boundsSonValidos(bounds)) return false;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    if (sw.equals(ne)) {
        map.setView(sw, Math.min(maxZoom, 18), { animate: true });
    } else {
        map.fitBounds(bounds, { padding: [20, 20], maxZoom, animate: true });
    }
    return true;
}

function extenderBounds(base, extra) {
    if (!boundsSonValidos(extra)) return base;
    if (!base) return L.latLngBounds(extra.getSouthWest(), extra.getNorthEast());
    base.extend(extra.getSouthWest());
    base.extend(extra.getNorthEast());
    return base;
}

function boundsDesdeEsriExtent(extent) {
    if (!extent) return null;
    try {
        if (L.esri?.Util?.extentToBounds) {
            const b = L.esri.Util.extentToBounds(extent);
            if (boundsSonValidos(b)) return b;
        }
        const wkid = extent.spatialReference?.latestWkid || extent.spatialReference?.wkid;
        if ((wkid === 3857 || wkid === 102100 || Math.abs(extent.xmin) > 180) && L.CRS?.EPSG3857) {
            const sw = L.CRS.EPSG3857.unproject(L.point(extent.xmin, extent.ymin));
            const ne = L.CRS.EPSG3857.unproject(L.point(extent.xmax, extent.ymax));
            return L.latLngBounds(sw, ne);
        }
        return L.latLngBounds([extent.ymin, extent.xmin], [extent.ymax, extent.xmax]);
    } catch (e) {
        return null;
    }
}

function obtenerBoundsVector(layerKey) {
    const layer = capasLeaflet[layerKey];
    if (!layer) return null;
    try {
        const b = layer.getBounds?.();
        return boundsSonValidos(b) ? b : null;
    } catch (e) {
        return null;
    }
}

function obtenerBoundsRaster(layerKey) {
    const layer = capasRasterLeaflet[layerKey];
    try {
        const b = layer?.getBounds?.();
        if (boundsSonValidos(b)) return b;
    } catch (e) {}

    const gr = georasterCache[layerKey];
    if (gr && [gr.ymin, gr.xmin, gr.ymax, gr.xmax].every(v => typeof v === 'number')) {
        const b = L.latLngBounds([gr.ymin, gr.xmin], [gr.ymax, gr.xmax]);
        return boundsSonValidos(b) ? b : null;
    }
    return null;
}

function obtenerBoundsOrtofoto(layerKey) {
    if (ortofotoMetadataCache[layerKey]) {
        return Promise.resolve(ortofotoMetadataCache[layerKey]);
    }
    const layer = ortofotasLayers[layerKey];
    if (!layer) return Promise.resolve(null);

    return new Promise(resolve => {
        if (typeof layer.metadata !== 'function') {
            resolve(null);
            return;
        }
        layer.metadata((err, meta) => {
            if (err || !meta) {
                resolve(null);
                return;
            }
            const bounds = boundsDesdeEsriExtent(meta.fullExtent || meta.extent);
            if (boundsSonValidos(bounds)) ortofotoMetadataCache[layerKey] = bounds;
            resolve(boundsSonValidos(bounds) ? bounds : null);
        });
    });
}

function zoomToVectorLayer(layerKey) {
    const cfg = capasConfig.find(c => c.key === layerKey);
    const bounds = obtenerBoundsVector(layerKey);
    if (!ajustarMapaABounds(bounds)) console.warn(`[Villatina] Sin extensión válida para ${cfg?.nombre || layerKey}`);
}

async function zoomToRasterLayer(layerKey) {
    const cfg = capasRasterConfig.find(c => c.key === layerKey);
    if (!cfg) return;
    if (!capasRasterLeaflet[layerKey]) {
        await cargarRaster(cfg);
        const chk = document.getElementById(`chk-${CSS.escape(layerKey)}`);
        if (chk) chk.checked = true;
    }
    const bounds = obtenerBoundsRaster(layerKey);
    if (!ajustarMapaABounds(bounds)) console.warn(`[Villatina] Sin extensión válida para ${cfg?.nombre || layerKey}`);
}

async function zoomToOrtofoto(layerKey) {
    const cfg = ortofotosConfig.find(c => c.key === layerKey);
    let bounds = await obtenerBoundsOrtofoto(layerKey);
    if (!boundsSonValidos(bounds)) {
        bounds = obtenerBoundsVector('Villatina') || obtenerBoundsVector('Barrios');
    }
    if (!ajustarMapaABounds(bounds)) console.warn(`[Villatina] Sin extensión válida para ${cfg?.label || layerKey}`);
}

async function zoomToActiveLayers() {
    let bounds = null;
    capasConfig.forEach(c => {
        if (capasLeaflet[c.key] && map.hasLayer(capasLeaflet[c.key])) {
            bounds = extenderBounds(bounds, obtenerBoundsVector(c.key));
        }
    });
    capasRasterConfig.forEach(c => {
        if (capasRasterLeaflet[c.key] && map.hasLayer(capasRasterLeaflet[c.key])) {
            bounds = extenderBounds(bounds, obtenerBoundsRaster(c.key));
        }
    });
    for (const cfg of ortofotosConfig) {
        const layer = ortofotasLayers[cfg.key];
        if (layer && map.hasLayer(layer)) {
            bounds = extenderBounds(bounds, await obtenerBoundsOrtofoto(cfg.key));
        }
    }
    ajustarMapaABounds(bounds);
}

function filtrarCapasPanel(query) {
    const q = String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    document.querySelectorAll('#layers-container .layer-item, #raster-container .layer-item').forEach(item => {
        const label = item.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        item.style.display = !q || label.includes(q) ? '' : 'none';
    });
    document.querySelectorAll('#layers-container .layer-group, #raster-container .layer-group').forEach(group => {
        const visibles = [...group.querySelectorAll('.layer-item')].some(item => item.style.display !== 'none');
        group.style.display = visibles ? '' : 'none';
    });
}

// =============================================
// CARGA DE CAPAS GEOGRÁFICAS
// =============================================
capasTotal = capasConfig.length;
actualizarLoading('Inicializando mapa…', 5);

const layersContainer = document.getElementById('layers-container');
const selectorEstilos = document.getElementById('estilos-capa-selector');

// Construir accordion de grupos
gruposCapas.forEach(grupo => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'layer-group';
    groupDiv.id = `grupo-${grupo.id}`;
    groupDiv.innerHTML = `
        <div class="layer-group-header" onclick="toggleGrupo('${grupo.id}')">
            <input type="checkbox" id="chk-grp-${grupo.id}" class="layer-group-master-chk"
                onclick="event.stopPropagation()"
                onchange="toggleCapasGrupo('${grupo.id}', this.checked)">
            <div class="layer-group-icon" style="background:${grupo.color}20;color:${grupo.color};">
                <i class="fa-solid ${grupo.icono}"></i>
            </div>
            <span class="layer-group-name">${grupo.nombre}</span>
            <span class="layer-group-count">${grupo.capas.length}</span>
            <i class="fa-solid fa-chevron-down layer-group-toggle"></i>
        </div>
        <div class="layer-group-body" id="body-${grupo.id}"></div>
    `;
    layersContainer.appendChild(groupDiv);

    const body = document.getElementById(`body-${grupo.id}`);
    grupo.capas.forEach(capaKey => {
        const cfg = capasConfig.find(c => c.key === capaKey);
        if (!cfg) return;
        const itemDiv = document.createElement('div');
        itemDiv.className = 'layer-item';
        itemDiv.id = `item-${CSS.escape(capaKey)}`;
        itemDiv.innerHTML = `
            <input type="checkbox" id="chk-${CSS.escape(capaKey)}">
            <div class="layer-item-dot" style="background:${grupo.color};border-color:${grupo.color};"></div>
            <label for="chk-${CSS.escape(capaKey)}" title="${cfg.nombre}">${cfg.nombre}</label>
            <button class="layer-action-btn" type="button" title="Zoom a la capa"
                onclick="event.stopPropagation(); zoomToVectorLayer('${capaKey}')">
                <i class="fa-solid fa-magnifying-glass-location"></i>
            </button>
        `;
        body.appendChild(itemDiv);

        // Opción en selector de estilos
        const opt = document.createElement('option');
        opt.value = capaKey;
        opt.textContent = cfg.nombre;
        selectorEstilos.appendChild(opt);
    });
});

// Cargar GeoJSON de cada capa
capasConfig.forEach(config => {
    const grupoId = gruposCapas.find(g => g.capas.includes(config.key))?.id;

    // Inicializar estilo unificado (general + categorias)
    initCapaAtributosModificados(config.key);

    fetch(config.url)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(data => {
            const layer = L.geoJSON(data, {
                style: (feature) => getFeatureStyle(config.key, feature),
                pointToLayer: (feature, latlng) => {
                    return L.circleMarker(latlng, {
                        radius: 6,
                        ...getFeatureStyle(config.key, feature)
                    });
                },
                onEachFeature: (feature, l) => {
                    feature.properties._nova_id = ++globalFeatureId;
                    l._nova_id  = feature.properties._nova_id;
                    l._layerKey = config.key;

                    l.on('mouseover', () => {
                        if (!featuresSeleccionados.has(l._nova_id)) {
                            const cur = getFeatureStyle(config.key, feature);
                            l.setStyle({
                                weight:      (cur.weight || 1) + 1.5,
                                fillOpacity: Math.min((cur.fillOpacity || 0.3) + 0.15, 0.98)
                            });
                            if (l.bringToFront) l.bringToFront();
                        }
                    });

                    l.on('mouseout', () => {
                        if (!featuresSeleccionados.has(l._nova_id)) {
                            layer.resetStyle(l);
                        }
                    });

                    l.on('click', (e) => {
                        L.DomEvent.stopPropagation(e);

                        // Modo Street View: abrir panel aquí
                        if (streetViewActivo) {
                            const c = getFeatureCenter(l, feature);
                            abrirStreetView(c.lat, c.lng);
                            return;
                        }

                        // Modo Medición: agregar punto
                        if (medicionActiva) {
                            return; // el click en el mapa lo maneja el listener global
                        }

                        toggleSeleccion(l, config.key);
                        mostrarPopup(l, feature, config);
                        // NO abrir tabla automáticamente
                    });
                }
            });

            capasLeaflet[config.key] = layer;
            layer.setStyle((feature) => getFeatureStyle(config.key, feature));

            // Checkbox de capa
        const chk = document.getElementById(`chk-${CSS.escape(config.key)}`);
        if (chk) {
            chk.checked = false;
            chk.onchange = (e) => {
                    if (e.target.checked) {
                        layer.addTo(map);
                        actualizarLeyendaDebounced();
                    } else {
                        map.removeLayer(layer);
                        actualizarLeyendaDebounced();
                    }
                    actualizarCheckGrupo(grupoId);
                    poblarSelectsSwipe();
                    actualizarSelectoresTabla();
                    if (document.getElementById('panelDashboard').style.display !== 'none') {
                        actualizarDashboard();
                    }
                };
            }

            capacargadas++;
            const pct = 5 + Math.round((capacargadas / capasTotal) * 88);
            actualizarLoading(`Cargando ${config.nombre}…`, pct);

            if (capacargadas === capasTotal) {
                actualizarLoading('¡Listo!', 100);
                setTimeout(() => {
                    ocultarLoading();
                    poblarSelectsSwipe();
                    inicializarRasterSidebar();
                    actualizarSelectoresTabla();
                }, 500);
            }
        })
        .catch(err => {
            console.warn(`[Villatina] Capa no cargada: ${config.url}`, err.message);
            capacargadas++;
            if (capacargadas === capasTotal) {
                actualizarLoading('¡Listo!', 100);
                setTimeout(() => {
                    ocultarLoading();
                    poblarSelectsSwipe();
                    inicializarRasterSidebar();
                    actualizarSelectoresTabla();
                }, 500);
            }
        });
});

// =============================================
// ACCORDEÓN DE GRUPOS
// =============================================
function toggleGrupo(grupoId) {
    const group = document.getElementById(`grupo-${grupoId}`);
    if (group) group.classList.toggle('open');
}

function toggleCapasGrupo(grupoId, estado) {
    const grupo = gruposCapas.find(g => g.id === grupoId);
    if (!grupo) return;
    grupo.capas.forEach(key => {
        const chk = document.getElementById(`chk-${CSS.escape(key)}`);
        if (chk && chk.checked !== estado) {
            chk.checked = estado;
            chk.dispatchEvent(new Event('change'));
        }
    });
}

function actualizarCheckGrupo(grupoId) {
    if (!grupoId) return;
    const grupo = gruposCapas.find(g => g.id === grupoId);
    if (!grupo) return;
    const chkGrp = document.getElementById(`chk-grp-${grupoId}`);
    if (!chkGrp) return;
    const estados  = grupo.capas.map(k => document.getElementById(`chk-${CSS.escape(k)}`)?.checked ?? false);
    const todasOn  = estados.every(Boolean);
    const algunaOn = estados.some(Boolean);
    chkGrp.checked       = todasOn;
    chkGrp.indeterminate = !todasOn && algunaOn;
}

// =============================================
// POPUP
// =============================================
function mostrarPopup(leafletLayer, feature, config) {
    const props   = feature.properties || {};
    const centro  = getFeatureCenter(leafletLayer, feature);
    const campos  = Object.entries(props).filter(([k]) => !k.startsWith('_nova'));

    let titulo = 'Feature';
    for (const [, v] of campos) {
        if (v && String(v).trim() && !String(v).startsWith('http')) {
            titulo = String(v);
            break;
        }
    }
    if (titulo.length > 42) titulo = titulo.substring(0, 42) + '…';

    let rows = '';
    campos.forEach(([k, v]) => {
        const val = (v === null || v === undefined) ? '<span style="opacity:0.35">—</span>' : String(v);
        rows += `<tr><td class="pk">${k}</td><td class="pv">${val}</td></tr>`;
    });

    const html = `
        <div class="popup-header">
            <div class="popup-layer-name">${config.nombre}</div>
            <div class="popup-feature-title">${titulo}</div>
            <div class="popup-coords"><i class="fa-solid fa-location-crosshairs" style="opacity:0.6;margin-right:4px;"></i>${centro.lat.toFixed(5)}, ${centro.lng.toFixed(5)}</div>
        </div>
        <table class="popup-table"><tbody>${rows}</tbody></table>
    `;

    L.popup({ maxWidth: 360, maxHeight: 380, className: 'villatina-popup', autoPanPadding: [40, 60] })
        .setLatLng(centro).setContent(html).openOn(map);
}

// =============================================
// SELECCIÓN DE FEATURES
// =============================================
function toggleSeleccion(layer, layerKey) {
    const id = layer._nova_id;
    if (featuresSeleccionados.has(id)) {
        featuresSeleccionados.delete(id);
        if (capasLeaflet[layerKey]) capasLeaflet[layerKey].resetStyle(layer);
    } else {
        featuresSeleccionados.add(id);
        layer.setStyle(estilosMapa.resaltado);
        if (layer.bringToFront) layer.bringToFront();
    }
    actualizarHighlightTabla();
    actualizarContadorSeleccion();
}

function actualizarHighlightTabla() {
    document.querySelectorAll('#tablaContenido tbody tr').forEach(r => r.classList.remove('selected-row'));
    featuresSeleccionados.forEach(id => {
        const row = document.getElementById(`row-${id}`);
        if (row) row.classList.add('selected-row');
    });
}

function reactivarSeleccionCapa(key) {
    const layer = capasLeaflet[key];
    if (!layer) return;
    layer.eachLayer(l => {
        if (featuresSeleccionados.has(l._nova_id)) {
            l.setStyle(estilosMapa.resaltado);
            if (l.bringToFront) l.bringToFront();
        }
    });
}

function programarActualizacionEstilo(key) {
    if (!key) return;
    capasPendientesEstilo.add(key);
    if (estiloUpdateRaf) return;

    estiloUpdateRaf = requestAnimationFrame(() => {
        const pendientes = [...capasPendientesEstilo];
        capasPendientesEstilo.clear();
        estiloUpdateRaf = null;

        pendientes.forEach(layerKey => {
            if (capasLeaflet[layerKey]) {
                capasLeaflet[layerKey].setStyle((f) => getFeatureStyle(layerKey, f));
                reactivarSeleccionCapa(layerKey);
            }
        });
        actualizarLeyendaDebounced();
        if (document.getElementById('panelDashboard')?.style.display !== 'none') {
            actualizarDashboard();
        }
    });
}

function actualizarContadorSeleccion() {
    const n = featuresSeleccionados.size;
    const txt = n > 0 ? `${n} seleccionado${n > 1 ? 's' : ''}` : '';
    document.querySelectorAll('#tabla-selected-count, #tabla-selected-count-header').forEach(el => {
        if (el) el.textContent = txt;
    });
    const floatingBar = document.getElementById('floating-bar');
    if (floatingBar) floatingBar.style.display = n > 0 ? 'flex' : 'none';
}

function clearSelection() {
    featuresSeleccionados.clear();
    Object.keys(capasLeaflet).forEach(k => {
        if (capasLeaflet[k] && map.hasLayer(capasLeaflet[k])) {
            capasLeaflet[k].setStyle((feature) => getFeatureStyle(k, feature));
        }
    });
    actualizarHighlightTabla();
    actualizarContadorSeleccion();
    map.closePopup();
}

function seleccionarDesdeTabla(id, layerKey) {
    const layer = capasLeaflet[layerKey];
    if (!layer) return;
    layer.eachLayer(l => {
        if (l._nova_id === id) {
            toggleSeleccion(l, layerKey);
            if (l.getBounds)   map.fitBounds(l.getBounds(), { padding: [40, 40] });
            else if (l.getLatLng) map.panTo(l.getLatLng());
        }
    });
}

// =============================================
// TABLA DE ATRIBUTOS (solo apertura manual)
// =============================================
function toggleTabla() {
    const ventana = document.getElementById('tablaAtributos');
    if (ventana.style.display === 'none' || ventana.style.display === '') {
        ventana.style.display = 'flex';
        if (!ventana._posicionada) {
            const sidebarW = sidebarVisible ? 300 : 0;
            ventana.style.left   = (sidebarW + 20) + 'px';
            ventana.style.top    = '70px';
            ventana.style.right  = 'auto';
            ventana.style.bottom = 'auto';
            ventana._posicionada = true;
        }
        ventana.classList.remove('minimized');
        // Si hay una capa activa y la tabla está vacía, cargar la primera capa disponible
        if (!tablaLayerKeyActual) {
            const primera = capasConfig.find(c => capasLeaflet[c.key] && map.hasLayer(capasLeaflet[c.key]));
            if (primera) mostrarTablaAtributos(primera.key);
        }
        document.getElementById('btn-tabla')?.classList.add('active');
    } else {
        ventana.style.display = 'none';
        document.getElementById('btn-tabla')?.classList.remove('active');
    }
}

function minimizarTabla() {
    document.getElementById('tablaAtributos').classList.toggle('minimized');
}

function actualizarSelectoresTabla() {
    const sel = document.getElementById('tabla-capa-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Seleccionar capa —</option>';
    capasConfig.forEach(c => {
        if (capasLeaflet[c.key] && map.hasLayer(capasLeaflet[c.key])) {
            const o = document.createElement('option');
            o.value = c.key;
            o.textContent = c.nombre;
            sel.appendChild(o);
        }
    });
    if (prev) sel.value = prev;
}

function cambiarCapaTabla(key) {
    if (!key) return;
    mostrarTablaAtributos(key);
}

function mostrarTablaAtributos(layerKey) {
    const contenedor  = document.getElementById('tablaContenido');
    const badge       = document.getElementById('tabla-titulo-capa');
    const layerGroup  = capasLeaflet[layerKey];

    if (!layerGroup || !map.hasLayer(layerGroup)) {
        contenedor.innerHTML = '<p class="empty-msg"><i class="fa-solid fa-circle-info"></i> Activa la capa primero.</p>';
        if (badge)  badge.textContent = '';
        return;
    }

    const features = layerGroup.toGeoJSON().features;
    if (!features || features.length === 0) {
        contenedor.innerHTML = '<p class="empty-msg">Esta capa no tiene atributos.</p>';
        return;
    }

    const config = capasConfig.find(c => c.key === layerKey);
    if (badge) badge.textContent = config ? config.nombre : layerKey;

    const campos = Object.keys(features[0].properties).filter(c => c !== '_nova_id');
    tablaLayerKeyActual = layerKey;
    tablaDataActual     = features;
    tablaCamposActual   = campos;
    tablaSortCol        = null;
    tablaSortDir        = 'asc';

    const searchInput = document.getElementById('tabla-search');
    if (searchInput) searchInput.value = '';

    renderTabla(features, campos);
    actualizarConteoTabla(features.length);

    // Actualizar selector de capa en la tabla
    const sel = document.getElementById('tabla-capa-select');
    if (sel) sel.value = layerKey;
}

function renderTabla(features, campos) {
    const contenedor = document.getElementById('tablaContenido');
    if (!contenedor) return;
    const token = ++tablaRenderToken;
    tablaVistaActual = features;
    tablaCamposActual = campos;
    const fragment = document.createDocumentFragment();

    const table = document.createElement('table');

    // Thead
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    campos.forEach(c => {
        const th = document.createElement('th');
        const isSortCol = tablaSortCol === c;
        const sortIcon  = isSortCol ? (tablaSortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
        th.className = isSortCol ? `sort-${tablaSortDir}` : '';
        th.innerHTML = `${c} <i class="fa-solid ${sortIcon} sort-icon"></i>`;
        th.onclick = () => sortTabla(c);
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    fragment.appendChild(table);

    contenedor.innerHTML = '';
    contenedor.appendChild(fragment);
    actualizarConteoTabla(features.length);

    let i = 0;
    const renderChunk = () => {
        if (token !== tablaRenderToken) return;

        const frag = document.createDocumentFragment();
        const limite = Math.min(i + TABLA_RENDER_BATCH, features.length);
        for (; i < limite; i++) {
            const f = features[i];
            const id = f.properties._nova_id;
            const tr = document.createElement('tr');
            tr.id = `row-${id}`;
            if (featuresSeleccionados.has(id)) tr.className = 'selected-row';
            tr.onclick = () => seleccionarDesdeTabla(id, tablaLayerKeyActual);
            campos.forEach(c => {
                const td = document.createElement('td');
                const v = f.properties[c] ?? '';
                const txt = String(v);
                td.title = txt;
                td.textContent = txt;
                tr.appendChild(td);
            });
            frag.appendChild(tr);
        }
        tbody.appendChild(frag);

        if (i < features.length) {
            requestAnimationFrame(renderChunk);
        } else {
            actualizarHighlightTabla();
        }
    };

    requestAnimationFrame(renderChunk);
}

function buscarEnTabla(query) {
    if (!tablaDataActual.length) return;
    clearTimeout(tablaSearchTimer);
    tablaSearchTimer = setTimeout(() => {
        let features = obtenerFeaturesTablaFiltradas(query);
        if (tablaSortCol) features = ordenarFeaturesTabla(features, tablaSortCol, tablaSortDir);
        renderTabla(features, tablaCamposActual);
    }, 120);
}

function sortTabla(campo) {
    if (!tablaLayerKeyActual) return;
    tablaSortDir = (tablaSortCol === campo && tablaSortDir === 'asc') ? 'desc' : 'asc';
    tablaSortCol = campo;

    const query = document.getElementById('tabla-search')?.value || '';
    const features = ordenarFeaturesTabla(obtenerFeaturesTablaFiltradas(query), campo, tablaSortDir);
    renderTabla(features, tablaCamposActual);
}

function obtenerFeaturesTablaFiltradas(query = '') {
    const q = query.trim().toLowerCase();
    if (!q) return [...tablaDataActual];
    return tablaDataActual.filter(f =>
        tablaCamposActual.some(c => String(f.properties[c] ?? '').toLowerCase().includes(q))
    );
}

function ordenarFeaturesTabla(features, campo, dir) {
    return [...features].sort((a, b) => {
        const va = a.properties[campo] ?? '', vb = b.properties[campo] ?? '';
        const na = parseFloat(va), nb = parseFloat(vb);
        const r = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb), 'es');
        return dir === 'asc' ? r : -r;
    });
}

function actualizarConteoTabla(visible) {
    const total = tablaDataActual.length;
    const query = document.getElementById('tabla-search')?.value?.trim();
    const cnt = query ? `${visible} / ${total} registros` : `${visible} registros`;
    document.querySelectorAll('#tabla-count, #tabla-count-footer').forEach(el => {
        if (el) el.textContent = cnt;
    });
}

function exportarCSV() {
    if (!tablaDataActual.length) return;
    const campos = Object.keys(tablaDataActual[0].properties).filter(c => c !== '_nova_id');
    const csv = [
        campos.join(','),
        ...tablaDataActual.map(f => campos.map(c => `"${String(f.properties[c] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `villatina_${tablaLayerKeyActual || 'capa'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// =============================================
// LEYENDA
// =============================================
function actualizarLeyendaDebounced() {
    clearTimeout(legendaDebounceTimer);
    legendaDebounceTimer = setTimeout(actualizarLeyenda, 200);
}

function actualizarLeyenda() {
    const contenedor = document.getElementById('leyenda-contenido');
    if (!contenedor) return;

    const capasActivas = capasConfig.filter(c => capasLeaflet[c.key] && map.hasLayer(capasLeaflet[c.key]));

    if (capasActivas.length === 0) {
        contenedor.innerHTML = '<p class="empty-msg"><i class="fa-solid fa-circle-info"></i> Activa capas para ver la leyenda.</p>';
        return;
    }

    let html = '';
    capasActivas.forEach(config => {
        const mod = capasAtributosModificados[config.key];
        const renderer = mod?.renderer || getDefaultRenderer(config.key);

        if (renderer.type === 'unique' && renderer.field) {
            const layer = capasLeaflet[config.key];
            const categorias = new Map();

            layer.eachLayer(l => {
                const val = l.feature?.properties?.[renderer.field] ?? 'default';
                if (!categorias.has(val)) {
                    const customCat = getCategorySettings(mod, renderer.field, val, config);
                    if (!customCat || customCat.visible !== false) {
                        const fallback = config.categorica?.campo === renderer.field && config.categorica.fn
                            ? config.categorica.fn(val)
                            : generarColorChart(`${renderer.field}-${val}`);
                        categorias.set(val, customCat?.color || fallback);
                    }
                }
            });

            html += `<div class="leyenda-grupo">
                <div class="leyenda-grupo-title"><i class="fa-solid fa-layer-group"></i> ${config.nombre}</div>`;

            categorias.forEach((color, label) => {
                html += `<div class="leyenda-item">
                    <div class="leyenda-swatch" style="background:${color};border:1px solid rgba(0,0,0,0.25);opacity:1;"></div>
                    <span class="leyenda-nombre">${label}</span>
                </div>`;
            });

            html += `</div>`;
        } else if (renderer.type === 'graduated' && renderer.field) {
            const breaks = getGraduatedBreaks(config.key, renderer.field).filter(b => b.visible !== false);
            html += `<div class="leyenda-grupo">
                <div class="leyenda-grupo-title"><i class="fa-solid fa-layer-group"></i> ${config.nombre}</div>`;
            breaks.forEach(brk => {
                html += `<div class="leyenda-item">
                    <div class="leyenda-swatch" style="background:${brk.color};border:1px solid rgba(0,0,0,0.25);opacity:1;"></div>
                    <span class="leyenda-nombre">${escapeHtml(brk.label)}</span>
                </div>`;
            });
            html += `</div>`;
        } else {
            const estilo = capasAtributosModificados[config.key]?.general || estilosMapa.default;
            const fill   = estilo.fillColor || estilo.color || '#888';
            const stroke = estilo.color || fill;
            const op     = typeof estilo.opacity !== 'undefined' ? estilo.opacity : Math.min(1, (estilo.fillOpacity ?? 0.4) + 0.3);
            html += `<div class="leyenda-item">
                <div class="leyenda-swatch" style="background:${fill};opacity:${op};border-color:${stroke};"></div>
                <span class="leyenda-nombre">${config.nombre}</span>
            </div>`;
        }
    });
    contenedor.innerHTML = html;
}

// =============================================
// SIDEBAR TOGGLE
// =============================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebarVisible = !sidebarVisible;
    sidebar.classList.toggle('collapsed', !sidebarVisible);
    const btn = document.getElementById('btn-sidebar-toggle');
    if (btn) btn.title = sidebarVisible ? 'Colapsar panel' : 'Expandir panel';
    setTimeout(() => map.invalidateSize(), 300);
}

function aplicarLayoutResponsive() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const isMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
    if (isMobile && !sidebar.dataset.mobileReady) {
        sidebarVisible = false;
        sidebar.classList.add('collapsed');
        sidebar.dataset.mobileReady = '1';
    }
    setTimeout(() => map.invalidateSize(), 120);
}

window.addEventListener('resize', aplicarLayoutResponsive);
aplicarLayoutResponsive();

function toggleDarkTheme() {
    const html  = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    const btn = document.getElementById('btn-darktheme');
    if (btn) btn.querySelector('i').className = `fa-solid fa-${isDark ? 'moon' : 'sun'}`;
}

// =============================================
// STREET VIEW — VENTANA FLOTANTE INTERNA
// =============================================
function toggleStreetView() {
    streetViewActivo = !streetViewActivo;
    const btn = document.getElementById('btn-streetview');
    const ind = document.getElementById('sv-indicator');
    btn?.classList.toggle('active', streetViewActivo);
    if (ind) ind.style.display = streetViewActivo ? 'flex' : 'none';
    map.getContainer().style.cursor = streetViewActivo ? 'crosshair' : '';
    if (!streetViewActivo) {
        document.getElementById('panelStreetView').style.display = 'none';
    }
}

function abrirStreetView(lat, lng) {
    svLatLngActual = { lat, lng };

    // Integrado desde el geovisor g: URL Street View estable sin API key.
    const url = streetViewProveedor === 'mapillary'
        ? `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17`
        : `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&output=svembed`;

    const iframe  = document.getElementById('sv-iframe');
    const panel   = document.getElementById('panelStreetView');
    const badge   = document.getElementById('sv-coords-badge');
    const footer  = document.getElementById('sv-footer-coords');
    const loading = document.getElementById('sv-loading');
    const errMsg  = document.getElementById('sv-error');

    // Mostrar loader
    if (loading) loading.style.display = 'flex';
    if (errMsg)  errMsg.style.display  = 'none';

    // Cambiar src
    if (iframe) {
        iframe.src = 'about:blank';
        setTimeout(() => {
            iframe.src = url;
            iframe.onload = () => {
                if (loading) loading.style.display = 'none';
            };
            iframe.onerror = () => {
                if (loading) loading.style.display = 'none';
                if (errMsg) errMsg.style.display = 'flex';
            };
        }, 80);
    }

    const coordStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (badge) badge.textContent = coordStr;
    if (footer) footer.innerHTML = `<i class="fa-solid fa-location-crosshairs" style="margin-right:4px;color:var(--accent);"></i>${coordStr}`;

    panel.style.display = 'flex';
    if (!panel._posicionado) {
        panel.style.top   = '70px';
        panel.style.right = '20px';
        panel.style.left  = 'auto';
        panel._posicionado = true;
    }

    // Desactivar modo cursor sin cerrar el panel
    if (streetViewActivo) {
        streetViewActivo = false;
        document.getElementById('btn-streetview')?.classList.remove('active');
        document.getElementById('sv-indicator').style.display = 'none';
        map.getContainer().style.cursor = '';
    }
}

function cerrarStreetViewPanel() {
    const panel  = document.getElementById('panelStreetView');
    const iframe = document.getElementById('sv-iframe');
    if (panel)  panel.style.display = 'none';
    if (iframe) iframe.src = 'about:blank';
    svLatLngActual = null;
    if (streetViewActivo) toggleStreetView();
}

function setSVTab(provider, btn) {
    streetViewProveedor = provider === 'mapillary' ? 'mapillary' : 'google';
    document.querySelectorAll('.sv-tab').forEach(tab => tab.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (svLatLngActual) abrirStreetView(svLatLngActual.lat, svLatLngActual.lng);
}

function abrirStreetViewExterno() {
    if (!svLatLngActual) return;
    const { lat, lng } = svLatLngActual;
    const url = streetViewProveedor === 'mapillary'
        ? `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17`
        : `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=12,0,,0,0`;
    window.open(url, '_blank');
}

// =============================================
// GOOGLE EARTH / KML - funciones faltantes de v4 + exportacion del geovisor g
// =============================================
function toggleGoogleEarth() {
    const panel = document.getElementById('panelGoogleEarth');
    const btn = document.getElementById('btn-googleearth');
    if (!panel) return;

    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        if (!panel._posicionado) {
            panel.style.top = '70px';
            panel.style.right = '20px';
            panel.style.left = 'auto';
            panel._posicionado = true;
        }
        btn?.classList.add('active');
    } else {
        panel.style.display = 'none';
        btn?.classList.remove('active');
    }
}

function mostrarGoogleEarthStatus(msg) {
    const el = document.getElementById('ge-status');
    if (el) {
        el.innerHTML = msg;
        el.style.display = 'flex';
    }
}

function abrirGoogleEarthWeb() {
    const center = map.getCenter();
    const url = `https://earth.google.com/web/search/${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    window.open(url, '_blank');
    mostrarGoogleEarthStatus('<i class="fa-solid fa-check"></i> Google Earth Web abierto con el centro actual del mapa.');
}

function escapeXml(value) {
    return String(value ?? '').replace(/[<>&'"]/g, ch => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
    }[ch]));
}

function coordsToKml(coords) {
    return coords.map(coord => `${coord[0]},${coord[1]},0`).join(' ');
}

function geometryToKml(geom) {
    if (!geom) return '';
    if (geom.type === 'Point') {
        return `<Point><coordinates>${geom.coordinates[0]},${geom.coordinates[1]},0</coordinates></Point>`;
    }
    if (geom.type === 'LineString') {
        return `<LineString><coordinates>${coordsToKml(geom.coordinates)}</coordinates></LineString>`;
    }
    if (geom.type === 'MultiLineString') {
        return `<MultiGeometry>${geom.coordinates.map(line => `<LineString><coordinates>${coordsToKml(line)}</coordinates></LineString>`).join('')}</MultiGeometry>`;
    }
    if (geom.type === 'Polygon') {
        return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsToKml(geom.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }
    if (geom.type === 'MultiPolygon') {
        return `<MultiGeometry>${geom.coordinates.map(poly => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsToKml(poly[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`).join('')}</MultiGeometry>`;
    }
    return '';
}

function buildKML(includeLayers = true) {
    const center = map.getCenter();
    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>Villatina_SIG</name>\n`;
    kml += `<LookAt><longitude>${center.lng}</longitude><latitude>${center.lat}</latitude><altitude>0</altitude><range>${Math.round(1000000 / map.getZoom())}</range><tilt>45</tilt><heading>0</heading></LookAt>\n`;

    if (includeLayers) {
        const capasActivas = capasConfig.filter(c => capasLeaflet[c.key] && map.hasLayer(capasLeaflet[c.key]));
        capasActivas.forEach(cfg => {
            kml += `<Folder><name>${escapeXml(cfg.nombre)}</name>\n`;
            capasLeaflet[cfg.key].eachLayer(layer => {
                const geom = layer.feature?.geometry;
                if (!geom) return;
                const props = layer.feature.properties || {};
                const name = props.nombre || props.NOMBRE || props.Name || props.ID || props.id || cfg.nombre;
                const geomKml = geometryToKml(geom);
                if (!geomKml) return;
                kml += `<Placemark><name>${escapeXml(name)}</name>${geomKml}</Placemark>\n`;
            });
            kml += `</Folder>\n`;
        });
    }

    kml += `</Document>\n</kml>`;
    return kml;
}

function descargarKML(nombre, contenido) {
    const blob = new Blob([contenido], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
}

function exportarKML() {
    descargarKML('Villatina_vista.kml', buildKML(false));
    mostrarGoogleEarthStatus('<i class="fa-solid fa-check"></i> KML de la vista actual descargado.');
}

function exportarKMLCapas() {
    descargarKML('Villatina_capas_activas.kml', buildKML(true));
    mostrarGoogleEarthStatus('<i class="fa-solid fa-check"></i> KML con capas activas descargado.');
}

function exportarGoogleEarth() {
    exportarKMLCapas();
}

// Click en el mapa en modo Street View
map.on('click', (e) => {
    if (streetViewActivo) {
        abrirStreetView(e.latlng.lat, e.latlng.lng);
    }
    if (medicionActiva) {
        agregarPuntoMedicion(e.latlng);
    }
});

map.on('dblclick', (e) => {
    if (medicionActiva && medicionPuntos.length >= 2) {
        L.DomEvent.stop(e);
        finalizarMedicion();
    }
});

// =============================================
// COMPARADOR SWIPE — IMPLEMENTACIÓN PROPIA
// =============================================
// No depende de plugins externos. Usa CSS clip-rect en los contenedores de capa.

const VillatinaSwipe = (() => {
    let _active       = false;
    let _pos          = 0.5;
    let _leftLayer    = null;
    let _rightLayer   = null;
    let _leftEl       = null;
    let _rightEl      = null;
    let _dividerEl    = null;
    let _dragging     = false;
    let _leftOrigPane = null;
    let _rightOrigPane = null;
    let _addedLeft    = false;
    let _addedRight   = false;

    function _getContainerEl(layer) {
        if (!layer) return null;
        if (layer._container) return layer._container;          // TileLayer
        if (layer._image)     return layer._image.parentElement;// ImageOverlay
        if (layer._currentImage?._image) return layer._currentImage._image.parentElement;
        if (layer._currentImage?._container) return layer._currentImage._container;
        return null;
    }

    function _setupVectorInPane(layer, paneName) {
        const wasOn = map.hasLayer(layer);
        if (wasOn) map.removeLayer(layer);
        const prev = layer.options.pane;
        layer.options.pane = paneName;
        layer.addTo(map);
        return prev;
    }

    function _restoreVectorPane(layer, origPane, wasOn) {
        map.removeLayer(layer);
        layer.options.pane = origPane || 'overlayPane';
        if (wasOn) layer.addTo(map);
    }

    function _createDivider() {
        _dividerEl = document.createElement('div');
        _dividerEl.className = 'swipe-divider-overlay';
        _dividerEl.innerHTML = `
            <div class="swipe-label-left"><i class="fa-solid fa-arrow-left"></i> Izquierdo</div>
            <div class="swipe-handle-grip"><i class="fa-solid fa-grip-lines-vertical"></i></div>
            <div class="swipe-label-right">Derecho <i class="fa-solid fa-arrow-right"></i></div>
        `;
        map.getContainer().appendChild(_dividerEl);

        const grip = _dividerEl.querySelector('.swipe-handle-grip');
        grip.addEventListener('mousedown',  _onMouseDown);
        _dividerEl.addEventListener('mousedown', _onMouseDown);
        grip.addEventListener('touchstart',  _onTouchStart, { passive: true });
    }

    function _onMouseDown(e) {
        if (e.target.tagName === 'BUTTON') return;
        e.preventDefault(); e.stopPropagation();
        _dragging = true;
        map.dragging.disable();
        document.addEventListener('mousemove', _onMouseMove);
        document.addEventListener('mouseup',   _onMouseUp);
    }

    function _onMouseMove(e) {
        if (!_dragging) return;
        const rect = map.getContainer().getBoundingClientRect();
        _pos = Math.max(0.04, Math.min(0.96, (e.clientX - rect.left) / rect.width));
        _updateClip();
    }

    function _onMouseUp() {
        _dragging = false;
        map.dragging.enable();
        document.removeEventListener('mousemove', _onMouseMove);
        document.removeEventListener('mouseup',   _onMouseUp);
    }

    function _onTouchStart(e) {
        map.dragging.disable();
        document.addEventListener('touchmove',  _onTouchMove, { passive: false });
        document.addEventListener('touchend',   _onTouchEnd);
    }

    function _onTouchMove(e) {
        e.preventDefault();
        const t    = e.touches[0];
        const rect = map.getContainer().getBoundingClientRect();
        _pos = Math.max(0.04, Math.min(0.96, (t.clientX - rect.left) / rect.width));
        _updateClip();
    }

    function _onTouchEnd() {
        map.dragging.enable();
        document.removeEventListener('touchmove', _onTouchMove);
        document.removeEventListener('touchend',  _onTouchEnd);
    }

    function _updateClip() {
        const size = map.getSize();
        const x    = Math.round(size.x * _pos);

        if (_dividerEl) _dividerEl.style.left = x + 'px';

        if (_leftEl)  _leftEl.style.clip  = `rect(0px ${x}px ${size.y}px 0px)`;
        if (_rightEl) _rightEl.style.clip = `rect(0px ${size.x}px ${size.y}px ${x}px)`;
    }

    function _refreshLayerEls() {
        const nextLeft = _getContainerEl(_leftLayer);
        const nextRight = _getContainerEl(_rightLayer);
        if (nextLeft && nextLeft !== _leftEl) {
            if (_leftEl) _leftEl.style.clip = '';
            _leftEl = nextLeft;
        }
        if (nextRight && nextRight !== _rightEl) {
            if (_rightEl) _rightEl.style.clip = '';
            _rightEl = nextRight;
        }
    }

    function _onMapMove() {
        _refreshLayerEls();
        _updateClip();
    }

    return {
        activate(leftLayer, rightLayer) {
            this.deactivate();
            _leftLayer  = leftLayer;
            _rightLayer = rightLayer;
            _active     = true;
            _pos        = 0.5;

            // Asegurar que ambas capas estén en el mapa
            _addedLeft  = !map.hasLayer(leftLayer);
            _addedRight = !map.hasLayer(rightLayer);

            // Para tile/ortofoto layers: clip directo al container
            const leftTileEl  = _getContainerEl(leftLayer);
            const rightTileEl = _getContainerEl(rightLayer);

        if (leftTileEl && leftLayer !== rightLayer) {
            if (_addedLeft) leftLayer.addTo(map);
            leftLayer.bringToFront?.();
            _leftEl = leftTileEl;
            } else if (!leftTileEl && typeof leftLayer.eachLayer === 'function') {
                // GeoJSON — mover a pane dedicado
                _leftOrigPane = _setupVectorInPane(leftLayer, 'swipeLeftPane');
                _leftEl = map.getPane('swipeLeftPane');
                _addedLeft = false; // ya está en el mapa
            } else {
                if (_addedLeft) leftLayer.addTo(map);
                _leftEl = _getContainerEl(leftLayer);
            }

            if (rightTileEl && rightLayer !== leftLayer) {
                if (_addedRight) rightLayer.addTo(map);
                rightLayer.bringToFront?.();
                _rightEl = rightTileEl;
            } else if (!rightTileEl && typeof rightLayer.eachLayer === 'function') {
                _rightOrigPane = _setupVectorInPane(rightLayer, 'swipeRightPane');
                _rightEl = map.getPane('swipeRightPane');
                _addedRight = false;
            } else {
                if (_addedRight) rightLayer.addTo(map);
                _rightEl = _getContainerEl(rightLayer);
            }

            _createDivider();
            map.on('move zoom resize', _onMapMove);
            setTimeout(() => {
                _leftEl = _leftEl || _getContainerEl(_leftLayer);
                _rightEl = _rightEl || _getContainerEl(_rightLayer);
                _updateClip();
            }, 250);
            _updateClip();
        },

        deactivate() {
            if (!_active) return;
            _active = false;

            // Quitar clip
            if (_leftEl)  { _leftEl.style.clip  = ''; _leftEl  = null; }
            if (_rightEl) { _rightEl.style.clip = ''; _rightEl = null; }

            // Restaurar panes de GeoJSON si se movieron
            if (_leftOrigPane !== null && _leftLayer) {
                _restoreVectorPane(_leftLayer, _leftOrigPane, true);
                _leftOrigPane = null;
            }
            if (_rightOrigPane !== null && _rightLayer) {
                _restoreVectorPane(_rightLayer, _rightOrigPane, true);
                _rightOrigPane = null;
            }

            // Quitar capas que se agregaron solo para el swipe
            if (_addedLeft && _leftLayer && map.hasLayer(_leftLayer)) {
                // No quitar: el usuario puede querer verla
            }

            // Quitar divisor
            if (_dividerEl) { _dividerEl.remove(); _dividerEl = null; }
            map.off('move zoom resize', _onMapMove);

            document.removeEventListener('mousemove', _onMouseMove);
            document.removeEventListener('mouseup',   _onMouseUp);
            map.dragging.enable();

            _leftLayer = _rightLayer = null;
            _addedLeft = _addedRight = false;
        },

        get isActive() { return _active; }
    };
})();

function getActiveOrtofotos() {
    return ortofotosConfig.filter(cfg => {
        const layer = ortofotasLayers[cfg.key];
        return layer && map.hasLayer(layer);
    });
}

function ordenarOrtofotosActivas() {
    getActiveOrtofotos().forEach((cfg, index) => {
        const layer = ortofotasLayers[cfg.key];
        const z = 331 + index;
        if (layer?.setZIndex) layer.setZIndex(z);
        const container = layer?.getContainer?.() || layer?._container;
        if (container) container.style.zIndex = String(z);
    });
}

function poblarSelectsSwipe() {
    const leftSel  = document.getElementById('swipe-left-select');
    const rightSel = document.getElementById('swipe-right-select');
    if (!leftSel || !rightSel) return;

    const prevL = leftSel.value;
    const prevR = rightSel.value;

    leftSel.innerHTML  = '';
    rightSel.innerHTML = '';

    const blank = () => { const o = document.createElement('option'); o.value = ''; o.textContent = '— Seleccionar capa —'; return o; };
    leftSel.appendChild(blank());
    rightSel.appendChild(blank());

    const activas = getActiveOrtofotos();
    activas.forEach(cfg => {
        [leftSel, rightSel].forEach(sel => {
            const o = document.createElement('option');
            o.value = `orto:${cfg.key}`;
            o.textContent = cfg.label;
            sel.appendChild(o);
        });
    });

    if (prevL && [...leftSel.options].some(o => o.value === prevL)) leftSel.value = prevL;
    if (prevR && [...rightSel.options].some(o => o.value === prevR)) rightSel.value = prevR;

    const btn = document.getElementById('btn-activar-swipe');
    if (btn) btn.disabled = activas.length < 2;
    if (activas.length < 2) {
        mostrarSwipeStatus('<i class="fa-solid fa-circle-info"></i> Activa al menos dos ortofotos para comparar.');
    } else {
        ocultarSwipeStatus();
    }
}

function resolverCapaSwipe(valor) {
    if (!valor) return null;
    if (valor.startsWith('orto:'))   return ortofotasLayers[valor.slice(5)] || null;
    return null;
}

function activarSwipe() {
    const leftVal  = document.getElementById('swipe-left-select').value;
    const rightVal = document.getElementById('swipe-right-select').value;

    if (!leftVal || !rightVal) {
        mostrarSwipeStatus('<i class="fa-solid fa-triangle-exclamation"></i> Selecciona dos ortofotos activas antes de activar.');
        return;
    }
    if (leftVal === rightVal) {
        mostrarSwipeStatus('<i class="fa-solid fa-triangle-exclamation"></i> Selecciona capas diferentes para comparar.');
        return;
    }

    const layerL = resolverCapaSwipe(leftVal);
    const layerR = resolverCapaSwipe(rightVal);

    if (!layerL || !layerR) {
        mostrarSwipeStatus('<i class="fa-solid fa-triangle-exclamation"></i> Una de las capas no está disponible.');
        return;
    }

    const activeValues = getActiveOrtofotos().map(cfg => `orto:${cfg.key}`);
    if (!activeValues.includes(leftVal) || !activeValues.includes(rightVal)) {
        mostrarSwipeStatus('<i class="fa-solid fa-triangle-exclamation"></i> El comparador solo usa ortofotos activas.');
        poblarSelectsSwipe();
        return;
    }

    VillatinaSwipe.activate(layerL, layerR);
    document.getElementById('btn-activar-swipe').style.display    = 'none';
    document.getElementById('btn-desactivar-swipe').style.display = '';
    mostrarSwipeStatus('<i class="fa-solid fa-check"></i> Comparador activo. Arrastra el divisor central.');
}

function desactivarSwipe(silencioso = false) {
    VillatinaSwipe.deactivate();
    document.getElementById('btn-activar-swipe').style.display    = '';
    document.getElementById('btn-desactivar-swipe').style.display = 'none';
    if (!silencioso) {
        mostrarSwipeStatus('<i class="fa-solid fa-stop"></i> Comparador desactivado.');
        setTimeout(ocultarSwipeStatus, 2500);
    }
}

function mostrarSwipeStatus(msg) {
    const el = document.getElementById('swipe-status');
    if (el) { el.innerHTML = msg; el.style.display = 'flex'; }
}
function ocultarSwipeStatus() {
    const el = document.getElementById('swipe-status');
    if (el) el.style.display = 'none';
}

// =============================================
// CAPAS RÁSTER — GeoTIFF (instancias independientes)
// =============================================
function inicializarRasterSidebar() {
    const container = document.getElementById('raster-container');
    if (!container || capasRasterConfig.length === 0) return;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'layer-group';
    groupDiv.id = 'grupo-raster';
    groupDiv.innerHTML = `
        <div class="layer-group-header" onclick="toggleGrupo('raster')">
            <div class="layer-group-icon" style="background:#6366f120;color:#6366f1;">
                <i class="fa-solid fa-image"></i>
            </div>
            <span class="layer-group-name">Imágenes GeoTIFF</span>
            <span class="layer-group-count">${capasRasterConfig.length}</span>
            <i class="fa-solid fa-chevron-down layer-group-toggle"></i>
        </div>
        <div class="layer-group-body" id="body-raster"></div>
    `;
    container.appendChild(groupDiv);

    const body = document.getElementById('body-raster');

    capasRasterConfig.forEach(config => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'layer-item';
        itemDiv.id = `item-${config.key}`;
        itemDiv.innerHTML = `
            <input type="checkbox" id="chk-${CSS.escape(config.key)}">
            <div class="layer-item-dot raster-dot"></div>
            <label for="chk-${CSS.escape(config.key)}" title="${config.nombre}">${config.nombre}</label>
            <div class="layer-actions">
                <button class="layer-action-btn" type="button" title="Zoom a la imagen"
                    onclick="event.stopPropagation(); zoomToRasterLayer('${config.key}')">
                    <i class="fa-solid fa-magnifying-glass-location"></i>
                </button>
                <span class="raster-badge">TIF</span>
                <span class="raster-spinner" id="spin-${config.key}" style="display:none;">
                    <i class="fa-solid fa-spinner fa-spin" style="color:var(--accent);font-size:0.75rem;"></i>
                </span>
            </div>
            <div class="raster-controls">
                <label for="opacity-${config.key}">Opacidad</label>
                <input type="range" id="opacity-${config.key}" min="0" max="100" value="${Math.round((config.opacity ?? 0.9) * 100)}"
                    oninput="setRasterOpacity('${config.key}', this.value)">
            </div>
        `;
        body.appendChild(itemDiv);

        const chk = document.getElementById(`chk-${CSS.escape(config.key)}`);
        if (chk) {
            chk.checked = false;
            chk.addEventListener('change', async (e) => {
                const spinner = document.getElementById(`spin-${config.key}`);
                if (e.target.checked) {
                    if (spinner) spinner.style.display = 'inline';
                    await cargarRaster(config);
                    if (spinner) spinner.style.display = 'none';
                    poblarSelectsSwipe();
                } else {
                    if (capasRasterLeaflet[config.key] && map.hasLayer(capasRasterLeaflet[config.key])) {
                        map.removeLayer(capasRasterLeaflet[config.key]);
                    }
                    rasterActiveOrder = rasterActiveOrder.filter(k => k !== config.key);
                    ordenarRasterActivos();
                    // No destruir la capa; mantenerla para re-activación rápida
                    poblarSelectsSwipe();
                }
            });
        }
    });
}

async function cargarRaster(config) {
    try {
        if (!config) return;
        if (typeof parseGeoraster === 'undefined' || typeof GeoRasterLayer === 'undefined') {
            console.warn('[Villatina] georaster/GeoRasterLayer no disponibles.');
            return;
        }

        // Cargar y cachear el georaster (datos crudos)
        if (!georasterCache[config.key]) {
            const response = await fetch(config.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer    = await response.arrayBuffer();
            georasterCache[config.key] = await parseGeoraster(arrayBuffer);
        }

        const gr = georasterCache[config.key];

        // Quitar instancia previa si existe
        if (capasRasterLeaflet[config.key] && map.hasLayer(capasRasterLeaflet[config.key])) {
            map.removeLayer(capasRasterLeaflet[config.key]);
        }

        // Crear NUEVA instancia GeoRasterLayer (evita conflictos)
        const nodata = gr.noDataValue;
        capasRasterLeaflet[config.key] = new GeoRasterLayer({
            georaster:  gr,
            opacity:    config.opacity ?? 0.9,
            resolution: 256,
            pane:       'rasterPane',
            zIndex:     config.zIndex ?? 350,
            pixelValuesToColorFn: (values) => {
                // Manejar NoData y negro transparente
                if (!values || values.length === 0) return null;
                if (nodata !== undefined && values.some(v => v === nodata)) return null;
                // RGB (3+ bandas)
                if (values.length >= 3) {
                    const [r, g, b] = values;
                    if (r === 0 && g === 0 && b === 0) return 'rgba(0,0,0,0)';
                    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},1)`;
                }
                // Banda única → escala de grises
                const v = values[0];
                if (v === 0 || v === nodata) return null;
                const c = Math.round(Math.min(255, Math.max(0, v)));
                return `rgba(${c},${c},${c},1)`;
            }
        });

        capasRasterLeaflet[config.key].addTo(map);
        rasterActiveOrder = rasterActiveOrder.filter(k => k !== config.key);
        rasterActiveOrder.push(config.key);
        ordenarRasterActivos();
        setTimeout(() => {
            map.fire('moveend');
        }, 150);

        console.info(`[Villatina] Ráster cargado: ${config.nombre}`);

    } catch (e) {
        console.warn(`[Villatina] No se pudo cargar ráster: ${config.url}`, e.message);
        const chk = document.getElementById(`chk-${CSS.escape(config.key)}`);
        if (chk) chk.checked = false;
    }
}

function ordenarRasterActivos() {
    rasterActiveOrder.forEach((key, index) => {
        const layer = capasRasterLeaflet[key];
        if (!layer || !map.hasLayer(layer)) return;
        const z = 351 + index;
        if (layer.setZIndex) layer.setZIndex(z);
        const container = layer.getContainer?.() || layer._container;
        if (container) container.style.zIndex = String(z);
    });
}

function setRasterOpacity(layerKey, value) {
    const cfg = capasRasterConfig.find(c => c.key === layerKey);
    const opacity = Math.max(0, Math.min(1, Number(value) / 100));
    if (cfg) cfg.opacity = opacity;
    const layer = capasRasterLeaflet[layerKey];
    if (layer?.setOpacity) layer.setOpacity(opacity);
    else if (layer) layer.options.opacity = opacity;
}

// =============================================
// DASHBOARD ESTADÍSTICO (modo auto + personalizado)
// =============================================
function toggleDashboard() {
    const panel = document.getElementById('panelDashboard');
    const btn   = document.getElementById('btn-dashboard');
    if (!panel) return;

    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        if (!panel._posicionado) {
            panel.style.left   = '310px';
            panel.style.top    = '70px';
            panel.style.right  = 'auto';
            panel._posicionado = true;
        }
        btn?.classList.add('active');
        actualizarDashboard();
    } else {
        panel.style.display = 'none';
        btn?.classList.remove('active');
    }
}

function toggleDashboardMode() {
    const autoDiv   = document.getElementById('dashboard-auto');
    const customDiv = document.getElementById('dashboard-custom');
    const btnMode   = document.getElementById('btn-dash-mode');

    if (dashboardMode === 'auto') {
        dashboardMode = 'custom';
        autoDiv.style.display   = 'none';
        customDiv.style.display = 'flex';
        btnMode?.querySelector('i').setAttribute('class', 'fa-solid fa-chart-bar');
        cargarCapasDashCustom();
    } else {
        dashboardMode = 'auto';
        autoDiv.style.display   = 'flex';
        customDiv.style.display = 'none';
        btnMode?.querySelector('i').setAttribute('class', 'fa-solid fa-sliders');
        actualizarDashboard();
    }
}

function getDashboardColor(scope, key, fallback) {
    if (!dashboardColorOverrides[scope]) dashboardColorOverrides[scope] = {};
    return dashboardColorOverrides[scope][key] || fallback || '#0881a8';
}

function setDashboardColor(scope, key, color, refresh = true) {
    if (!dashboardColorOverrides[scope]) dashboardColorOverrides[scope] = {};
    dashboardColorOverrides[scope][key] = color;
    if (!refresh) return;
    if (dashboardMode === 'custom') generarGraficaCustom();
    else actualizarDashboard();
}

function colorConAlpha(color, alpha = 0.82) {
    if (!color) return `rgba(8,129,168,${alpha})`;
    if (/^#([0-9a-f]{3})$/i.test(color)) {
        const [, short] = color.match(/^#([0-9a-f]{3})$/i);
        const hex = short.split('').map(ch => ch + ch).join('');
        return colorConAlpha(`#${hex}`, alpha);
    }
    if (/^#([0-9a-f]{6})$/i.test(color)) {
        const [, hex] = color.match(/^#([0-9a-f]{6})$/i);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    return color;
}

function colorBaseParaValor(config, field, value) {
    const mod = capasAtributosModificados[config.key];
    const renderer = mod?.renderer || getDefaultRenderer(config.key);
    if (renderer.type === 'unique') {
        const custom = getCategorySettings(mod, field, value, config);
        if (custom?.color) return custom.color;
        if (config.categorica?.campo === field && config.categorica.fn) return config.categorica.fn(value);
    }
    if (renderer.type === 'graduated' && renderer.field === field) {
        const brk = getGraduatedStyle(config.key, field, normalizarNumero(value));
        if (brk?.color) return brk.color;
    }
    return generarColorChart(`${field}-${value}`);
}

function crearDashboardColorControls(scope, items) {
    const box = document.createElement('div');
    box.className = 'dash-color-controls';
    items.slice(0, 18).forEach(item => {
        const label = document.createElement('label');
        label.className = 'dash-color-chip';
        label.title = item.fullLabel || item.label;
        label.innerHTML = `
            <input type="color" value="${item.color}">
            <span>${escapeHtml(item.label)}</span>
        `;
        const input = label.querySelector('input');
        input.addEventListener('input', e => setDashboardColor(scope, item.key, e.target.value, false));
        input.addEventListener('change', e => setDashboardColor(scope, item.key, e.target.value, true));
        box.appendChild(label);
    });
    return box;
}

function crearTablaResumenCategorias(scope, entries, total, fallbackColors = {}) {
    const table = document.createElement('div');
    table.className = 'dash-summary-table';
    entries.slice(0, 12).forEach(([label, value]) => {
        const color = getDashboardColor(scope, label, fallbackColors[label] || generarColorChart(label));
        const pct = total ? (value / total) * 100 : 0;
        const row = document.createElement('div');
        row.className = 'dash-summary-row';
        row.innerHTML = `
            <span class="dash-summary-swatch" style="background:${color};"></span>
            <span class="dash-summary-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <span class="dash-summary-value">${value.toLocaleString('es-CO')}</span>
            <span class="dash-summary-pct">${pct.toLocaleString('es-CO', { maximumFractionDigits: 1 })}%</span>
        `;
        table.appendChild(row);
    });
    return table;
}

function cargarCapasDashCustom() {
    const sel = document.getElementById('dash-custom-layer');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccionar capa —</option>';
    capasConfig.forEach(c => {
        if (capasLeaflet[c.key] && map.hasLayer(capasLeaflet[c.key])) {
            const o = document.createElement('option');
            o.value = c.key;
            o.textContent = c.nombre;
            sel.appendChild(o);
        }
    });
}

function cargarCamposDashCustom(layerKey) {
    const sel   = document.getElementById('dash-custom-field');
    if (!sel || !layerKey) return;
    const layer = capasLeaflet[layerKey];
    if (!layer) return;
    const features = layer.toGeoJSON().features;
    if (!features.length) return;

    const campos = Object.keys(features[0].properties).filter(c => c !== '_nova_id');
    sel.innerHTML = '';
    campos.forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c; sel.appendChild(o);
    });
}

function generarGraficaCustom() {
    const layerKey   = document.getElementById('dash-custom-layer').value;
    const campo      = document.getElementById('dash-custom-field').value;
    const chartType  = document.getElementById('dash-custom-chart').value;
    const chartsEl   = document.getElementById('dashboard-custom-charts');

    if (!layerKey || !campo || !chartsEl) return;

    const layer    = capasLeaflet[layerKey];
    if (!layer) return;
    const features = layer.toGeoJSON().features;
    const config   = capasConfig.find(c => c.key === layerKey);

    // Destruir gráfica previa
    if (dashboardCustomChart) { try { dashboardCustomChart.destroy(); } catch(e){} }
    chartsEl.innerHTML = '';

    const freq = {};
    features.forEach(f => {
        const v = String(f.properties[campo] ?? '(sin valor)');
        freq[v] = (freq[v] || 0) + 1;
    });

    const sorted  = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const fullLabels = sorted.map(([k]) => k);
    const labels  = fullLabels.map(k => k.length > 18 ? k.slice(0, 18) + '…' : k);
    const vals    = sorted.map(([, v]) => v);
    const scope   = `custom:${layerKey}:${campo}`;
    const fallbackColors = {};
    fullLabels.forEach(label => {
        fallbackColors[label] = config ? colorBaseParaValor(config, campo, label) : generarColorChart(label);
    });
    const colors  = fullLabels.map(label => getDashboardColor(scope, label, fallbackColors[label]));

    const wrap = document.createElement('div');
    wrap.className = 'dash-chart-wrap';
    wrap.innerHTML = `
        <div class="dash-chart-title"><i class="fa-solid fa-chart-bar"></i> ${campo} — ${config?.nombre || layerKey}</div>
        <canvas id="chart-custom-main" height="200"></canvas>
    `;
    chartsEl.appendChild(wrap);
    wrap.appendChild(crearDashboardColorControls(scope, fullLabels.map((label, i) => ({
        key: label,
        label: label.length > 16 ? label.slice(0, 16) + '…' : label,
        fullLabel: label,
        color: colors[i]
    }))));
    wrap.appendChild(crearTablaResumenCategorias(scope, sorted, vals.reduce((s, v) => s + v, 0), fallbackColors));

    const ctx = document.getElementById('chart-custom-main');
    if (ctx) {
        dashboardCustomChart = new Chart(ctx, {
            type: chartType === 'bar' ? 'bar' : chartType,
            data: {
                labels,
                datasets: [{
                    label: campo,
                    data: vals,
                    backgroundColor: colors.map(c => colorConAlpha(c, 0.82)),
                    borderColor: colors,
                    borderWidth: 1.5
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: chartType !== 'bar' } },
                scales: chartType === 'bar' ? {
                    y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(128,128,128,0.12)' } },
                    x: { ticks: { font: { size: 9 }, maxRotation: 45 }, grid: { display: false } }
                } : {}
            }
        });
    }
}

function actualizarDashboard() {
    const capasActivas = capasConfig.filter(c => capasLeaflet[c.key] && map.hasLayer(capasLeaflet[c.key]));

    const kpisEl   = document.getElementById('dashboard-kpis');
    const emptyEl  = document.getElementById('dashboard-empty');
    const headerEl = document.getElementById('dash-chart-header');
    const chartsEl = document.getElementById('dashboard-charts');

    if (capasActivas.length === 0) {
        if (kpisEl)   kpisEl.innerHTML   = '';
        if (chartsEl) chartsEl.innerHTML = '';
        if (headerEl) headerEl.style.display = 'none';
        if (emptyEl)  emptyEl.style.display  = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // KPIs
    let kpiHtml = '', totalFeatures = 0;
    capasActivas.forEach(config => {
        const layer = capasLeaflet[config.key];
        const count = layer.toGeoJSON().features.length;
        totalFeatures += count;
        const estilo = capasAtributosModificados[config.key]?.general || estilosMapa.default;
        const color  = getDashboardColor('kpi', config.key, estilo.fillColor || estilo.color || '#6366f1');
        kpiHtml += `
            <div class="dash-kpi">
                <div class="dash-kpi-dot" style="background:${color};"></div>
                <div class="dash-kpi-info">
                    <span class="dash-kpi-count">${count.toLocaleString('es-CO')}</span>
                    <span class="dash-kpi-label">${config.nombre}</span>
                </div>
                <input class="dash-kpi-color" type="color" value="${color}" title="Color de estadistica"
                    oninput="setDashboardColor('kpi','${config.key}',this.value,false)"
                    onchange="setDashboardColor('kpi','${config.key}',this.value,true)">
            </div>`;
    });
    kpiHtml = `
        <div class="dash-kpi dash-kpi-total">
            <div class="dash-kpi-icon"><i class="fa-solid fa-shapes"></i></div>
            <div class="dash-kpi-info">
                <span class="dash-kpi-count">${totalFeatures.toLocaleString('es-CO')}</span>
                <span class="dash-kpi-label">Total geometrías activas</span>
            </div>
        </div>` + kpiHtml;
    if (kpisEl) kpisEl.innerHTML = kpiHtml;

    // Selector de capa
    if (headerEl) {
        headerEl.style.display = 'flex';
        const sel = document.getElementById('dash-layer-select');
        if (sel) {
            const prev = sel.value;
            sel.innerHTML = '';
            capasActivas.forEach(c => {
                const o = document.createElement('option');
                o.value = c.key; o.textContent = c.nombre; sel.appendChild(o);
            });
            if (prev && capasActivas.find(c => c.key === prev)) sel.value = prev;
            else {
                const conCat = capasActivas.find(c => c.categorica);
                if (conCat) sel.value = conCat.key;
            }
        }
    }

    const layerKey = document.getElementById('dash-layer-select')?.value;
    if (layerKey) renderDashboardCharts(layerKey);
}

function renderDashboardCharts(layerKey) {
    const chartsEl = document.getElementById('dashboard-charts');
    if (!chartsEl) return;

    // Destruir gráficas anteriores
    Object.values(dashboardCharts).forEach(ch => { try { ch.destroy(); } catch(e){} });
    dashboardCharts = {};
    chartsEl.innerHTML = '';

    const config  = capasConfig.find(c => c.key === layerKey);
    const layer   = capasLeaflet[layerKey];
    if (!config || !layer) return;

    const features = layer.toGeoJSON().features;
    if (!features.length) return;

    const campos = Object.keys(features[0].properties).filter(c => c !== '_nova_id');

    // Detectar campo categórico y numérico
    let campoCateg = config.categorica?.campo;
    let campoNum   = null;

    if (!campoCateg) {
        campoCateg = campos.find(c => {
            const vals = features.slice(0, 20).map(f => f.properties[c]);
            const uniques = new Set(vals.filter(v => v != null)).size;
            return uniques > 1 && uniques < 20;
        }) || campos[0];
    }

    campoNum = campos.find(c => {
        const vals = features.slice(0, 30).map(f => parseFloat(f.properties[c]));
        return vals.filter(v => !isNaN(v)).length > vals.length * 0.5;
    });

    if (campoCateg) {
        const freq = {};
        features.forEach(f => {
            const v = String(f.properties[campoCateg] ?? '(sin valor)');
            freq[v] = (freq[v] || 0) + 1;
        });
        const sorted    = Object.entries(freq).sort((a, b) => b[1] - a[1]);
        const topBars   = sorted.slice(0, 12);
        const labels    = topBars.map(([k]) => k.length > 16 ? k.slice(0,16)+'…' : k);
        const vals      = topBars.map(([,v]) => v);
        const scope     = `chart:${layerKey}:${campoCateg}`;
        const fallbackColors = {};
        sorted.forEach(([k]) => { fallbackColors[k] = colorBaseParaValor(config, campoCateg, k); });
        const colors    = sorted.map(([k]) => getDashboardColor(scope, k, fallbackColors[k]));

        // Gráfica de barras
        const wrapBar = document.createElement('div');
        wrapBar.className = 'dash-chart-wrap';
        wrapBar.innerHTML = `
            <div class="dash-chart-title">
                <i class="fa-solid fa-chart-bar"></i>
                Distribución — ${campoCateg}
                <em class="dash-chart-sub">(top ${topBars.length})</em>
            </div>
            <canvas id="chart-bar-${layerKey}" height="180"></canvas>`;
        chartsEl.appendChild(wrapBar);

        const ctxBar = document.getElementById(`chart-bar-${layerKey}`);
        if (ctxBar) {
            dashboardCharts[`bar-${layerKey}`] = new Chart(ctxBar, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ label: campoCateg, data: vals,
                        backgroundColor: colors.slice(0, topBars.length).map(c => colorConAlpha(c, 0.82)),
                        borderColor:     colors.slice(0, topBars.length),
                        borderWidth: 1.5, borderRadius: 4 }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(128,128,128,0.12)' } },
                        x: { ticks: { font: { size: 9 }, maxRotation: 45 }, grid: { display: false } }
                    }
                }
            });
        }
        wrapBar.appendChild(crearDashboardColorControls(scope, topBars.map(([label], i) => ({
            key: label,
            label: label.length > 16 ? label.slice(0, 16) + '…' : label,
            fullLabel: label,
            color: colors[i]
        }))));
        wrapBar.appendChild(crearTablaResumenCategorias(scope, sorted, features.length, fallbackColors));

        // Donut (top 6)
        const topPie  = sorted.slice(0, 6);
        const wrapPie = document.createElement('div');
        wrapPie.className = 'dash-chart-wrap';
        wrapPie.innerHTML = `
            <div class="dash-chart-title"><i class="fa-solid fa-chart-pie"></i> Proporción (top 6)</div>
            <canvas id="chart-pie-${layerKey}" height="180"></canvas>`;
        chartsEl.appendChild(wrapPie);

        const ctxPie = document.getElementById(`chart-pie-${layerKey}`);
        if (ctxPie) {
            const pieLabels = topPie.map(([k]) => k.length > 16 ? k.slice(0,16)+'…' : k);
            const pieVals   = topPie.map(([,v]) => v);
            const pieColors = topPie.map(([k]) => getDashboardColor(scope, k, fallbackColors[k]));
            dashboardCharts[`pie-${layerKey}`] = new Chart(ctxPie, {
                type: 'doughnut',
                data: {
                    labels: pieLabels,
                    datasets: [{ data: pieVals,
                        backgroundColor: pieColors.map(c => colorConAlpha(c, 0.82)),
                        borderColor: pieColors, borderWidth: 1.5 }]
                },
                options: {
                    responsive: true, cutout: '55%',
                    plugins: { legend: { position: 'right', labels: { font: { size: 9 }, boxWidth: 12, padding: 8 } } }
                }
            });
        }
    }

    // Resumen numérico
    if (campoNum) {
        const valores = features.map(f => parseFloat(f.properties[campoNum])).filter(v => !isNaN(v));
        if (valores.length > 0) {
            const suma    = valores.reduce((s, v) => s + v, 0);
            const media   = suma / valores.length;
            const sorted2 = [...valores].sort((a, b) => a - b);
            const mediana = sorted2[Math.floor(sorted2.length / 2)];
            const min     = sorted2[0];
            const max     = sorted2[sorted2.length - 1];
            const fmt     = v => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
            const statScope = `stats:${layerKey}:${campoNum}`;
            const stats = [
                ['Suma', suma],
                ['Media', media],
                ['Mediana', mediana],
                ['Mínimo', min],
                ['Máximo', max],
                ['N válidos', valores.length]
            ];
            const statColors = {
                'Suma': '#0881a8',
                'Media': '#2a9d8f',
                'Mediana': '#8ab17d',
                'Mínimo': '#e9c46a',
                'Máximo': '#e76f51',
                'N válidos': '#6366f1'
            };

            const wrapNum = document.createElement('div');
            wrapNum.className = 'dash-chart-wrap';
            wrapNum.innerHTML = `
                <div class="dash-chart-title"><i class="fa-solid fa-hashtag"></i> Estadísticas — ${campoNum}</div>
                <div class="dash-stats-grid">
                    ${stats.map(([label, value]) => {
                        const color = getDashboardColor(statScope, label, statColors[label]);
                        const display = label === 'N válidos' ? value.toLocaleString('es-CO') : fmt(value);
                        return `<div class="dash-stat" style="border-left:3px solid ${color};">
                            <span class="ds-val" style="color:${color};">${display}</span>
                            <span class="ds-label">${label}</span>
                        </div>`;
                    }).join('')}
                </div>`;
            chartsEl.appendChild(wrapNum);
            wrapNum.appendChild(crearDashboardColorControls(statScope, stats.map(([label]) => ({
                key: label,
                label,
                color: getDashboardColor(statScope, label, statColors[label])
            }))));
        }
    }
}

function generarColorChart(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const palette = [
        '#0881a8', '#2a9d8f', '#8ab17d', '#e9c46a', '#f4a261', '#e76f51',
        '#6366f1', '#7c3aed', '#db2777', '#22c55e', '#0ea5e9', '#f59e0b',
        '#ef4444', '#14b8a6', '#84cc16', '#a855f7', '#64748b', '#d97706'
    ];
    return palette[Math.abs(hash) % palette.length];
}

// =============================================
// HERRAMIENTA DE MEDICIÓN — NUEVA DESDE CERO
// =============================================
let medicionActiva  = false;
let medicionMode    = 'distancia'; // 'distancia' | 'area'
let medicionPuntos  = [];          // L.LatLng[]
let medicionMarkers = [];          // L.CircleMarker[]
let medicionLinea   = null;        // L.Polyline
let medicionPoligon = null;        // L.Polygon
let medicionLabels  = [];          // L.Marker (divIcon)

const R_TIERRA = 6371000; // metros

function haversine(a, b) {
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2 * R_TIERRA * Math.asin(Math.sqrt(h));
}

function calcularAreaPoligono(puntos) {
    if (puntos.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < puntos.length; i++) {
        const j = (i + 1) % puntos.length;
        const xi = puntos[i].lng * (Math.PI/180) * R_TIERRA * Math.cos(puntos[i].lat * Math.PI/180);
        const yi = puntos[i].lat * (Math.PI/180) * R_TIERRA;
        const xj = puntos[j].lng * (Math.PI/180) * R_TIERRA * Math.cos(puntos[j].lat * Math.PI/180);
        const yj = puntos[j].lat * (Math.PI/180) * R_TIERRA;
        area += xi * yj - xj * yi;
    }
    return Math.abs(area) / 2;
}

function formatDistancia(m) {
    return m >= 1000 ? `${(m/1000).toFixed(3)} km` : `${m.toFixed(1)} m`;
}

function formatArea(m2) {
    return m2 >= 10000 ? `${(m2/10000).toFixed(4)} ha` : `${m2.toFixed(1)} m²`;
}

function toggleMedicion() {
    const panel = document.getElementById('panelMedicion');
    const btn   = document.getElementById('btn-medir');

    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        if (!panel._posicionado) {
            panel.style.top   = '70px';
            panel.style.left  = '310px';
            panel.style.right = 'auto';
            panel._posicionado = true;
        }
        btn?.classList.add('active');
        iniciarMedicion();
    } else {
        cerrarMedicion();
    }
}

function cerrarMedicion() {
    limpiarMedicion();
    document.getElementById('panelMedicion').style.display = 'none';
    document.getElementById('btn-medir')?.classList.remove('active');
    cancelarMedicion();
}

function iniciarMedicion() {
    medicionActiva = true;
    map.getContainer().style.cursor = 'crosshair';
    map.doubleClickZoom.disable();
    document.getElementById('medir-indicator').style.display = 'flex';
    document.getElementById('medicion-resultados').style.display = 'none';
    document.getElementById('btn-deshacer-punto').style.display = 'none';
    actualizarMedicionIndicador();
}

function cancelarMedicion() {
    medicionActiva = false;
    map.getContainer().style.cursor = '';
    map.doubleClickZoom.enable();
    document.getElementById('medir-indicator').style.display = 'none';
}

function setMedicionMode(mode) {
    medicionMode = mode;
    limpiarMedicion();
    document.querySelectorAll('.medicion-modo-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-modo-${mode}`)?.classList.add('active');
    iniciarMedicion();
}

function actualizarMedicionIndicador() {
    const msg = document.getElementById('medir-indicator-msg');
    if (!msg) return;
    if (medicionPuntos.length === 0) {
        msg.textContent = `Modo ${medicionMode === 'distancia' ? 'Distancia' : 'Área'} — Haz clic para el primer punto`;
    } else {
        msg.textContent = `${medicionPuntos.length} punto(s) — Doble clic o Enter para finalizar`;
    }
}

function agregarPuntoMedicion(latlng) {
    medicionPuntos.push(latlng);

    // Marcador del punto
    const marker = L.circleMarker(latlng, {
        radius: 5, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 1, weight: 2
    }).addTo(map);
    medicionMarkers.push(marker);

    // Línea actualizada
    if (medicionLinea) map.removeLayer(medicionLinea);
    if (medicionPuntos.length >= 2) {
        medicionLinea = L.polyline(medicionPuntos, {
            color: '#f59e0b', weight: 2.5, dashArray: '6,4', opacity: 0.9
        }).addTo(map);
    }

    // Para área: actualizar polígono provisional
    if (medicionMode === 'area' && medicionPuntos.length >= 3) {
        if (medicionPoligon) map.removeLayer(medicionPoligon);
        medicionPoligon = L.polygon(medicionPuntos, {
            color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.15, weight: 2, dashArray: '5,3'
        }).addTo(map);
    }

    // Etiqueta de segmento
    if (medicionPuntos.length >= 2) {
        const prev = medicionPuntos[medicionPuntos.length - 2];
        const curr = medicionPuntos[medicionPuntos.length - 1];
        const dist = haversine(prev, curr);
        const mid  = L.latLng((prev.lat + curr.lat) / 2, (prev.lng + curr.lng) / 2);
        const lbl  = L.marker(mid, {
            icon: L.divIcon({
                className: 'medicion-segment-label',
                html: `<span>${formatDistancia(dist)}</span>`,
                iconAnchor: [30, 10]
            }),
            interactive: false
        }).addTo(map);
        medicionLabels.push(lbl);
    }

    document.getElementById('btn-deshacer-punto').style.display = '';
    actualizarPanelMedicion();
    actualizarMedicionIndicador();
}

function finalizarMedicion() {
    if (medicionPuntos.length < 2) return;
    actualizarPanelMedicion(true);
    // Mantener herramienta activa para seguir midiendo (limpiar y empezar de nuevo)
    // El usuario usa "Borrar todo" para limpiar
}

function deshacerUltimoPunto() {
    if (medicionPuntos.length === 0) return;
    medicionPuntos.pop();

    // Quitar último marcador
    const lastMarker = medicionMarkers.pop();
    if (lastMarker) map.removeLayer(lastMarker);

    // Quitar última etiqueta
    const lastLabel = medicionLabels.pop();
    if (lastLabel) map.removeLayer(lastLabel);

    // Actualizar línea
    if (medicionLinea) { map.removeLayer(medicionLinea); medicionLinea = null; }
    if (medicionPuntos.length >= 2) {
        medicionLinea = L.polyline(medicionPuntos, {
            color: '#f59e0b', weight: 2.5, dashArray: '6,4', opacity: 0.9
        }).addTo(map);
    }

    // Actualizar polígono
    if (medicionPoligon) { map.removeLayer(medicionPoligon); medicionPoligon = null; }
    if (medicionMode === 'area' && medicionPuntos.length >= 3) {
        medicionPoligon = L.polygon(medicionPuntos, {
            color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.15, weight: 2, dashArray: '5,3'
        }).addTo(map);
    }

    if (medicionPuntos.length === 0) {
        document.getElementById('btn-deshacer-punto').style.display = 'none';
    }

    actualizarPanelMedicion();
    actualizarMedicionIndicador();
}

function limpiarMedicion() {
    medicionPuntos = [];
    medicionMarkers.forEach(m => map.removeLayer(m)); medicionMarkers = [];
    medicionLabels.forEach(l => map.removeLayer(l));  medicionLabels  = [];
    if (medicionLinea)   { map.removeLayer(medicionLinea);   medicionLinea   = null; }
    if (medicionPoligon) { map.removeLayer(medicionPoligon); medicionPoligon = null; }

    document.getElementById('medicion-resultados').style.display = 'none';
    document.getElementById('btn-deshacer-punto').style.display  = 'none';
    actualizarMedicionIndicador();
}

function actualizarPanelMedicion(finalizado = false) {
    if (medicionPuntos.length < 2) return;

    const resultEl = document.getElementById('medicion-resultados');
    const totalEl  = document.getElementById('medicion-total-valor');
    const labelEl  = document.getElementById('medicion-total-label');
    const segmEl   = document.getElementById('medicion-segmentos');

    resultEl.style.display = 'block';

    if (medicionMode === 'distancia') {
        // Calcular distancia total
        let total = 0;
        let segsHtml = '';
        for (let i = 1; i < medicionPuntos.length; i++) {
            const d = haversine(medicionPuntos[i-1], medicionPuntos[i]);
            total += d;
            segsHtml += `<div class="medicion-seg-row">
                <span class="seg-num">Segmento ${i}</span>
                <span class="seg-val">${formatDistancia(d)}</span>
            </div>`;
        }
        labelEl.textContent = 'Distancia total';
        totalEl.textContent = formatDistancia(total);
        segmEl.innerHTML = segsHtml;
    } else {
        // Área
        const area = calcularAreaPoligono(medicionPuntos);
        let perimetro = 0;
        for (let i = 1; i < medicionPuntos.length; i++) perimetro += haversine(medicionPuntos[i-1], medicionPuntos[i]);
        perimetro += haversine(medicionPuntos[medicionPuntos.length-1], medicionPuntos[0]);

        labelEl.textContent = 'Área';
        totalEl.textContent = formatArea(area);
        segmEl.innerHTML = `
            <div class="medicion-seg-row">
                <span class="seg-num">Polígono</span>
                <span class="seg-val">${medicionPuntos.length} vértices</span>
            </div>
            <div class="medicion-seg-row">
                <span class="seg-num">Perímetro</span>
                <span class="seg-val">${formatDistancia(perimetro)}</span>
            </div>
            <div class="medicion-seg-row">
                <span class="seg-num">Área</span>
                <span class="seg-val">${formatArea(area)}</span>
            </div>`;
    }
}

// Tecla Enter para finalizar medición
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && medicionActiva && medicionPuntos.length >= 2) {
        finalizarMedicion();
    }
    if (e.key === 'Escape') {
        if (medicionActiva) cancelarMedicion();
        if (streetViewActivo) toggleStreetView();
    }
});

// =============================================
// HERRAMIENTAS DE DIBUJO
// =============================================
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawStyle = { color: '#0891b2', weight: 2.5, fillColor: '#0891b2', fillOpacity: 0.18 };

function activarDibujo(tipo) {
    cancelarDibujoActivo();
    document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
    const btnActivo = document.querySelector(`.draw-btn[data-tool="${tipo}"]`);
    if (btnActivo) btnActivo.classList.add('active');

    try {
        switch (tipo) {
            case 'polygon':   drawHandler = new L.Draw.Polygon(map,   { shapeOptions: drawStyle, allowIntersection: false }); break;
            case 'polyline':  drawHandler = new L.Draw.Polyline(map,  { shapeOptions: { color: '#0891b2', weight: 2.5 } }); break;
            case 'marker':    drawHandler = new L.Draw.Marker(map);   break;
            case 'rectangle': drawHandler = new L.Draw.Rectangle(map, { shapeOptions: drawStyle }); break;
            case 'circle':    drawHandler = new L.Draw.Circle(map,    { shapeOptions: drawStyle }); break;
            default: return;
        }
        drawHandler.enable();
        mostrarEstadoDibujo(`<i class="fa-solid fa-pencil"></i> Dibujando ${tipo}… Clic para empezar, doble clic para terminar.`);
    } catch (e) {
        console.warn('[Villatina] Error al activar dibujo:', e);
        mostrarEstadoDibujo('<i class="fa-solid fa-triangle-exclamation"></i> Herramienta no disponible.');
    }
}

function cancelarDibujoActivo() {
    if (drawHandler) {
        try { drawHandler.disable(); } catch (e) {}
        drawHandler = null;
    }
    document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
}

function limpiarDibujos() {
    cancelarDibujoActivo();
    drawnItems.clearLayers();
    ocultarEstadoDibujo();
}

function mostrarEstadoDibujo(msg) {
    const el = document.getElementById('draw-status');
    if (el) { el.innerHTML = msg; el.style.display = 'flex'; }
}
function ocultarEstadoDibujo() {
    const el = document.getElementById('draw-status');
    if (el) el.style.display = 'none';
}

map.on(L.Draw.Event.CREATED, (e) => {
    drawnItems.addLayer(e.layer);
    cancelarDibujoActivo();
    mostrarEstadoDibujo('<i class="fa-solid fa-check"></i> Figura añadida. Selecciona otra herramienta para continuar.');
    setTimeout(ocultarEstadoDibujo, 3500);
});

// =============================================
// DRAG — VENTANAS FLOTANTES MOVIBLES
// =============================================
function hacerMovible(idPanel, idHeader) {
    const panel  = document.getElementById(idPanel);
    const header = document.getElementById(idHeader);
    if (!panel || !header) return;

    let startX = 0, startY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, input, select')) return;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        panel.style.left   = rect.left + 'px';
        panel.style.top    = rect.top  + 'px';
        panel.style.right  = 'auto';
        panel.style.bottom = 'auto';

        const onMove = (ev) => {
            panel.style.left = (parseFloat(panel.style.left) + ev.clientX - startX) + 'px';
            panel.style.top  = (parseFloat(panel.style.top)  + ev.clientY - startY) + 'px';
            startX = ev.clientX; startY = ev.clientY;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    });
}

// Registrar todas las ventanas
hacerMovible('tablaAtributos',  'headerTabla');
hacerMovible('panelDibujo',     'headerDibujo');
hacerMovible('panelLeyenda',    'headerLeyenda');
hacerMovible('panelStreetView', 'headerStreetView');
hacerMovible('panelComparar',   'headerComparar');
hacerMovible('panelGoogleEarth','headerGoogleEarth');
hacerMovible('panelDashboard',  'headerDashboard');
hacerMovible('panelMedicion',   'headerMedicion');

// Resize para el panel de Street View
(function() {
    const resizeHandle = document.getElementById('sv-resize');
    const panel = document.getElementById('panelStreetView');
    if (!resizeHandle || !panel) return;
    let resizing = false, startW, startH, startX, startY;
    resizeHandle.addEventListener('mousedown', (e) => {
        resizing = true;
        startX = e.clientX; startY = e.clientY;
        startW = panel.offsetWidth; startH = panel.offsetHeight;
        e.preventDefault();
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup',   onResizeUp);
    });
    function onResizeMove(e) {
        if (!resizing) return;
        panel.style.width  = Math.max(360, startW + e.clientX - startX) + 'px';
        panel.style.height = Math.max(280, startH + e.clientY - startY) + 'px';
    }
    function onResizeUp() {
        resizing = false;
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup',   onResizeUp);
    }
})();

// =============================================
// UI: PANELES FLOTANTES GENÉRICO
// =============================================
function togglePanel(id) {
    const panel = document.getElementById(id);
    if (!panel) return;

    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
        if (!panel._posicionado) {
            if (['panelDibujo','panelLeyenda','panelComparar'].includes(id)) {
                panel.style.top   = '70px';
                panel.style.right = '20px';
                panel.style.left  = 'auto';
            }
            panel._posicionado = true;
        }

        const btnMap = { panelDibujo:'btn-dibujar', panelLeyenda:'btn-leyenda', panelComparar:'btn-comparar' };
        if (btnMap[id]) document.getElementById(btnMap[id])?.classList.add('active');

        if (id === 'panelLeyenda')  actualizarLeyenda();
        if (id === 'panelComparar') poblarSelectsSwipe();
    } else {
        panel.style.display = 'none';
        const btnMap = { panelDibujo:'btn-dibujar', panelLeyenda:'btn-leyenda', panelComparar:'btn-comparar' };
        if (btnMap[id]) document.getElementById(btnMap[id])?.classList.remove('active');
        if (id === 'panelDibujo')  cancelarDibujoActivo();
        if (id === 'panelComparar') desactivarSwipe(true);
    }
}

function minimizarPanel(id) {
    const panel = document.getElementById(id);
    if (panel) panel.classList.toggle('minimized');
}

// =============================================
// UI: TABS DEL SIDEBAR
// =============================================
function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tab = document.getElementById(`tab-${tabId}`);
    if (tab) tab.classList.add('active');
    if (btn) btn.classList.add('active');
}

// =============================================
// MODIFICADOR DE ESTILOS - fusionado desde el geovisor g
// =============================================
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));
}

function cargarEstilosCapa(key) {
    const simples = document.getElementById('estilos-simples');
    const unique = document.getElementById('estilos-unique-values');
    const campoSel = document.getElementById('estilos-campo-selector');
    const tipoSel = document.getElementById('estilos-tipo-selector');
    if (!simples || !unique) return;

    if (!key) {
        simples.style.display = 'block';
        unique.style.display = 'none';
        if (campoSel) campoSel.innerHTML = '';
        return;
    }

    const config = capasConfig.find(c => c.key === key);
    if (!config) return;
    if (!capasAtributosModificados[key]) initCapaAtributosModificados(key);

    const mod = capasAtributosModificados[key];
    const gen = mod.general;
    const opGlobal = Math.round((gen.opacity !== undefined ? gen.opacity : 1) * 100);

    document.getElementById('rango-opacidad-global').value = opGlobal;
    document.getElementById('val-opacidad-global').textContent = opGlobal;

    const fields = getLayerFields(key);
    if (!mod.renderer) mod.renderer = getDefaultRenderer(key);
    if (!mod.renderer.field && fields.length) mod.renderer.field = elegirCampoSugerido(key, config);
    if (mod.renderer.field && fields.length && !fields.includes(mod.renderer.field)) mod.renderer.field = fields[0];

    if (campoSel) {
        campoSel.innerHTML = '';
        fields.forEach(field => {
            const opt = document.createElement('option');
            opt.value = field;
            opt.textContent = field;
            campoSel.appendChild(opt);
        });
        campoSel.disabled = mod.renderer.type === 'simple' || fields.length === 0;
        if (mod.renderer.field) campoSel.value = mod.renderer.field;
    }
    if (tipoSel) tipoSel.value = mod.renderer.type || 'simple';

    if (mod.renderer.type === 'unique') {
        simples.style.display = 'none';
        unique.style.display = 'block';
        renderUniqueValuesEditor(key, mod.renderer.field);
        return;
    }

    if (mod.renderer.type === 'graduated') {
        simples.style.display = 'none';
        unique.style.display = 'block';
        renderGraduatedEditor(key, mod.renderer.field);
        return;
    }

    simples.style.display = 'block';
    unique.style.display = 'none';

    document.getElementById('color-relleno').value = gen.fillColor || '#22c55e';
    document.getElementById('val-relleno').textContent = gen.fillColor || '#22c55e';
    document.getElementById('rango-opacidad').value = Math.round((gen.fillOpacity ?? 0.5) * 100);
    document.getElementById('opac-val').textContent = Math.round((gen.fillOpacity ?? 0.5) * 100);
    document.getElementById('color-borde').value = gen.color || '#000000';
    document.getElementById('val-borde').textContent = gen.color || '#000000';
    document.getElementById('rango-grosor').value = gen.weight ?? 2;
    document.getElementById('grosor-val').textContent = gen.weight ?? 2;
}

function renderUniqueValuesEditor(layerKey, field) {
    const listDiv = document.getElementById('unique-values-list');
    const config = capasConfig.find(c => c.key === layerKey);
    const mod = capasAtributosModificados[layerKey];
    if (!listDiv || !field) return;

    const conteos = new Map();
    const layer = capasLeaflet[layerKey];
    if (layer) {
        layer.eachLayer(l => {
            const val = l.feature?.properties?.[field] ?? 'default';
            conteos.set(val, (conteos.get(val) || 0) + 1);
        });
    }

    const valores = [...conteos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 120);
    listDiv.innerHTML = `
        <div class="symbol-editor-heading">
            <span><i class="fa-solid fa-tags"></i> Categorias por ${escapeHtml(field)}</span>
            <span>${valores.length}</span>
        </div>
    `;

    valores.forEach(([val, count]) => {
        const catSettings = getCategorySettings(mod, field, val, config);
        const fallback = config?.categorica?.campo === field && config.categorica.fn
            ? config.categorica.fn(val)
            : generarColorChart(`${field}-${val}`);
        const color = catSettings?.color || fallback;
        const isVisible = catSettings ? catSettings.visible !== false : true;

        const row = document.createElement('div');
        row.className = 'unique-value-row';
        row.innerHTML = `
            <div class="uv-color-wrap">
                <input type="color" class="uv-color-picker" value="${color}">
            </div>
            <span class="uv-label" title="${escapeHtml(val)}">${escapeHtml(val)}</span>
            <span class="uv-count">${count.toLocaleString('es-CO')}</span>
            <button class="uv-toggle-btn ${isVisible ? 'active' : ''}" type="button">
                <i class="fa-solid ${isVisible ? 'fa-eye' : 'fa-eye-slash'}"></i>
            </button>
        `;

        row.querySelector('.uv-color-picker').addEventListener('input', (e) => {
            actualizarCategoriaEstilo(layerKey, val, { color: e.target.value }, field);
        });
        row.querySelector('.uv-toggle-btn').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const willBeVisible = !btn.classList.contains('active');
            btn.classList.toggle('active', willBeVisible);
            btn.innerHTML = `<i class="fa-solid ${willBeVisible ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
            actualizarCategoriaEstilo(layerKey, val, { visible: willBeVisible }, field);
        });

        listDiv.appendChild(row);
    });
}

function renderGraduatedEditor(layerKey, field) {
    const listDiv = document.getElementById('unique-values-list');
    if (!listDiv || !field) return;
    const breaks = getGraduatedBreaks(layerKey, field);
    listDiv.innerHTML = `
        <div class="symbol-editor-heading">
            <span><i class="fa-solid fa-layer-group"></i> Graduado por ${escapeHtml(field)}</span>
            <span>${breaks.length}</span>
        </div>
    `;

    if (!breaks.length) {
        listDiv.innerHTML += '<p class="empty-msg"><i class="fa-solid fa-circle-info"></i> El atributo no contiene valores numericos.</p>';
        return;
    }

    breaks.forEach((brk, index) => {
        const row = document.createElement('div');
        row.className = 'unique-value-row graduated-row';
        row.innerHTML = `
            <div class="uv-color-wrap">
                <input type="color" class="uv-color-picker" value="${brk.color}">
            </div>
            <span class="uv-label" title="${escapeHtml(brk.label)}">${escapeHtml(brk.label)}</span>
            <button class="uv-toggle-btn ${brk.visible !== false ? 'active' : ''}" type="button">
                <i class="fa-solid ${brk.visible !== false ? 'fa-eye' : 'fa-eye-slash'}"></i>
            </button>
        `;
        row.querySelector('.uv-color-picker').addEventListener('input', (e) => {
            actualizarClaseGraduada(layerKey, field, index, { color: e.target.value });
        });
        row.querySelector('.uv-toggle-btn').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const willBeVisible = !btn.classList.contains('active');
            btn.classList.toggle('active', willBeVisible);
            btn.innerHTML = `<i class="fa-solid ${willBeVisible ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
            actualizarClaseGraduada(layerKey, field, index, { visible: willBeVisible });
        });
        listDiv.appendChild(row);
    });
}

function cambiarTipoSimbologia(tipo) {
    const key = selectorEstilos.value;
    if (!key) return;
    if (!capasAtributosModificados[key]) initCapaAtributosModificados(key);
    const mod = capasAtributosModificados[key];
    const fields = getLayerFields(key);
    let field = mod.renderer?.field || elegirCampoSugerido(key, capasConfig.find(c => c.key === key));

    if (tipo === 'graduated') {
        const features = getLayerFeatures(key);
        if (!field || !esCampoNumerico(features, field)) {
            field = fields.find(f => esCampoNumerico(features, f)) || field;
        }
    }

    mod.renderer = { type: tipo, field };
    cargarEstilosCapa(key);
    programarActualizacionEstilo(key);
}

function cambiarCampoSimbologia(field) {
    const key = selectorEstilos.value;
    if (!key || !field) return;
    if (!capasAtributosModificados[key]) initCapaAtributosModificados(key);
    const mod = capasAtributosModificados[key];
    const tipoActual = mod.renderer?.type || 'simple';
    const features = getLayerFeatures(key);
    const type = tipoActual === 'graduated' && !esCampoNumerico(features, field) ? 'unique' : tipoActual;
    mod.renderer = { type, field };
    cargarEstilosCapa(key);
    programarActualizacionEstilo(key);
}

function actualizarCategoriaEstilo(layerKey, catVal, changes, fieldOverride = null) {
    if (!capasAtributosModificados[layerKey]) initCapaAtributosModificados(layerKey);
    const config = capasConfig.find(c => c.key === layerKey);
    const field = fieldOverride || capasAtributosModificados[layerKey].renderer?.field || config?.categorica?.campo;
    if (!field) return;

    setCategorySettings(layerKey, field, catVal, changes);

    programarActualizacionEstilo(layerKey);
}

function actualizarClaseGraduada(layerKey, field, index, changes) {
    if (!capasAtributosModificados[layerKey]) initCapaAtributosModificados(layerKey);
    const breaks = getGraduatedBreaks(layerKey, field);
    if (!breaks[index]) return;
    Object.assign(breaks[index], changes);
    programarActualizacionEstilo(layerKey);
}

function actualizarEstiloSimpleDesdeControles() {
    const key = selectorEstilos.value;
    if (!key) return;
    const config = capasConfig.find(c => c.key === key);
    if (!config) return;
    const renderer = capasAtributosModificados[key]?.renderer;
    if (renderer && renderer.type !== 'simple') return;

    if (!capasAtributosModificados[key]) initCapaAtributosModificados(key);
    const general = capasAtributosModificados[key].general;
    general.opacity = parseFloat(document.getElementById('rango-opacidad-global').value) / 100;
    general.color = document.getElementById('color-borde').value;
    general.fillColor = document.getElementById('color-relleno').value;
    general.weight = parseFloat(document.getElementById('rango-grosor').value);
    general.fillOpacity = parseFloat(document.getElementById('rango-opacidad').value) / 100;
    programarActualizacionEstilo(key);
}

document.getElementById('color-relleno')?.addEventListener('input', e => {
    document.getElementById('val-relleno').textContent = e.target.value;
    actualizarEstiloSimpleDesdeControles();
});
document.getElementById('color-borde')?.addEventListener('input', e => {
    document.getElementById('val-borde').textContent = e.target.value;
    actualizarEstiloSimpleDesdeControles();
});
document.getElementById('rango-grosor')?.addEventListener('input', e => {
    document.getElementById('grosor-val').textContent = e.target.value;
    actualizarEstiloSimpleDesdeControles();
});
document.getElementById('rango-opacidad')?.addEventListener('input', e => {
    document.getElementById('opac-val').textContent = e.target.value;
    actualizarEstiloSimpleDesdeControles();
});

document.getElementById('rango-opacidad-global')?.addEventListener('input', e => {
    document.getElementById('val-opacidad-global').textContent = e.target.value;
    const key = selectorEstilos.value;
    if (!key) return;
    if (!capasAtributosModificados[key]) initCapaAtributosModificados(key);
    capasAtributosModificados[key].general.opacity = parseFloat(e.target.value) / 100;
    programarActualizacionEstilo(key);
});

document.getElementById('btn-aplicar-estilo').onclick = () => {
    const key = selectorEstilos.value;
    if (!key) return;
    const config = capasConfig.find(c => c.key === key);
    if (!config) return;

    if (!capasAtributosModificados[key]) initCapaAtributosModificados(key);
    const general = capasAtributosModificados[key].general;
    general.opacity = parseFloat(document.getElementById('rango-opacidad-global').value) / 100;

    if ((capasAtributosModificados[key].renderer?.type || 'simple') === 'simple') {
        actualizarEstiloSimpleDesdeControles();
    }

    if (capasLeaflet[key]) {
        capasLeaflet[key].setStyle((f) => getFeatureStyle(key, f));
        reactivarSeleccionCapa(key);
    }
    actualizarLeyendaDebounced();
};

document.getElementById('btn-resetear-estilo').onclick = () => {
    const key = selectorEstilos.value;
    if (!key) return;
    initCapaAtributosModificados(key);
    if (capasLeaflet[key]) capasLeaflet[key].setStyle((f) => getFeatureStyle(key, f));
    cargarEstilosCapa(key);
    actualizarLeyendaDebounced();
};
