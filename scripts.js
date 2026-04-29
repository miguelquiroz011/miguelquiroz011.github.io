// =============================
// ESTADO GLOBAL Y CONFIGURACIÓN
// =============================
let globalFeatureId = 0;
let featuresSeleccionados = new Set();
let capasLeaflet = {}; 
let capasAtributosModificados = {}; 

const estilosMapa = {
    hidrografia: { color: '#00f2ff', weight: 2, fillColor: '#00f2ff', fillOpacity: 0.5 },
    administrativo: { color: '#ff007f', weight: 2, fillColor: 'transparent', fillOpacity: 0 },
    catastro: { color: '#39ff14', weight: 1, fillColor: '#39ff14', fillOpacity: 0.3 },
    resaltado: { color: '#fbbf24', weight: 4, fillColor: '#fbbf24', fillOpacity: 0.7 },
    default: { color: '#8a2be2', weight: 2, fillColor: '#8a2be2', fillOpacity: 0.5 }
};

function obtenerEstiloOriginal(nombreCapa) {
    const k = nombreCapa.toLowerCase();
    if (k.includes('hidrografia')) return {...estilosMapa.hidrografia};
    if (k.includes('comunas') || k.includes('barrios') || k.includes('municipios')) return {...estilosMapa.administrativo};
    if (k.includes('predios') || k.includes('manzanas')) return {...estilosMapa.catastro};
    return {...estilosMapa.default};
}

// =============================
// INICIALIZACIÓN DEL MAPA
// =============================
var map = L.map('map', { zoomControl: false }).setView([6.24, -75.58], 13);
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Coordenadas
const coordDiv = document.getElementById('coordinates');
map.on('mousemove', (e) => {
    coordDiv.innerHTML = `Lat: ${e.latlng.lat.toFixed(5)} | Lng: ${e.latlng.lng.toFixed(5)}`;
});

// Mapas Base
var baseLayers = {
    "satelital": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'),
    "oscuro": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'),
    "calles": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
};
baseLayers["oscuro"].addTo(map);

// Llenar selector de mapas base
const baseContainer = document.getElementById('basemaps-container');
Object.keys(baseLayers).forEach(key => {
    let div = document.createElement('div');
    div.className = 'layer-item';
    div.innerHTML = `<input type="radio" name="basemap" value="${key}" ${key === 'oscuro' ? 'checked' : ''}> <label>${key}</label>`;
    div.querySelector('input').onchange = (e) => {
        Object.values(baseLayers).forEach(l => map.removeLayer(l));
        baseLayers[e.target.value].addTo(map).bringToBack();
    };
    baseContainer.appendChild(div);
});

// =============================
// CARGA DE CAPAS
// =============================
var capasConfig = [
    { key: 'comunas', nombre: 'Comunas', url: 'data/comunas.json' },
    { key: 'Barrios', nombre: 'Barrios', url: 'data/Barrios.json' },
    { key: 'Villatina', nombre: 'Villatina', url: 'data/Villatina.json' },
    { key: 'San Antonio Hidrografia', nombre: 'Hidrografía San Antonio', url: 'data/Hidrografia_SanAntonio.json' },
    { key: 'Villatina Hidrografia', nombre: 'Hidrografía Villatina', url: 'data/Hidrografia_Villahermosa.json' },
    { key: 'San Antonio', nombre: 'San Antonio', url: 'data/SanAntonio.json' },
    { key: 'San Antonio Predios', nombre: 'Predios San Antonio', url: 'data/SanAntonio_Predios.json' },
    { key: 'Villatina Predios', nombre: 'Predios Villatina', url: 'data/Villatina_Predios.json' },
    { key: 'San Antonio Manzanas', nombre: 'Manzanas San Antonio', url: 'data/SanAntonio_Manzanas.geojson' },
    { key: 'Villatina Manzanas', nombre: 'Manzanas Villatina', url: 'data/Villatina_Manzanas.json' },
    { key: 'Area de Influencia', nombre: 'Area de Influencia (50 m) de la hidrografia de Villatina', url: 'data/Area_Influencia.json' }
];

const layersContainer = document.getElementById('layers-container');
const selectorEstilos = document.getElementById('estilos-capa-selector');

capasConfig.forEach(config => {
    // Checkbox lateral
    let div = document.createElement('div');
    div.className = 'layer-item';
    div.innerHTML = `<input type="checkbox" id="chk-${config.key}"> <label for="chk-${config.key}">${config.nombre}</label>`;
    layersContainer.appendChild(div);

    // Selector en panel estilos
    let opt = document.createElement('option');
    opt.value = config.key;
    opt.textContent = config.nombre;
    selectorEstilos.appendChild(opt);

    fetch(config.url).then(res => res.json()).then(data => {
        capasAtributosModificados[config.key] = obtenerEstiloOriginal(config.nombre);

        let layer = L.geoJSON(data, {
            style: () => capasAtributosModificados[config.key],
            onEachFeature: (feature, l) => {
                feature.properties._nova_id = ++globalFeatureId;
                l._nova_id = feature.properties._nova_id;
                l.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    toggleSeleccion(l, config.key);
                    mostrarTablaAtributos(config.key); // Actualiza tabla al cliquear objeto
                });
            }
        });
        capasLeaflet[config.key] = layer;

        document.getElementById(`chk-${config.key}`).onchange = (e) => {
            if (e.target.checked) {
                layer.addTo(map);
                mostrarTablaAtributos(config.key);
            } else {
                map.removeLayer(layer);
            }
        };
    }).catch(err => console.warn(`Archivo no encontrado: ${config.url}`));
});

// =============================
// FUNCIONES DE TABLA Y SELECCIÓN
// =============================
function mostrarTablaAtributos(layerKey) {
    const contenedor = document.getElementById('tablaContenido');
    const titulo = document.getElementById('tabla-titulo-capa');
    const layerGroup = capasLeaflet[layerKey];

    if (!map.hasLayer(layerGroup)) {
        contenedor.innerHTML = '<p style="padding:15px">Activa la capa primero.</p>';
        return;
    }

    titulo.innerText = `- ${layerKey.toUpperCase()}`;
    let features = layerGroup.toGeoJSON().features;
    if (features.length === 0) return;

    let campos = Object.keys(features[0].properties).filter(c => c !== '_nova_id');
    
    let html = `<table><thead><tr>${campos.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
    features.forEach(f => {
        let id = f.properties._nova_id;
        let isSel = featuresSeleccionados.has(id) ? 'selected-row' : '';
        html += `<tr id="row-${id}" class="${isSel}" onclick="seleccionarDesdeTabla(${id}, '${layerKey}')">`;
        campos.forEach(c => html += `<td>${f.properties[c] || ''}</td>`);
        html += `</tr>`;
    });
    html += '</tbody></table>';
    
    contenedor.innerHTML = html;
    document.getElementById('tablaAtributos').style.display = 'flex';
}

function seleccionarDesdeTabla(id, layerKey) {
    capasLeaflet[layerKey].eachLayer(l => {
        if (l._nova_id === id) {
            toggleSeleccion(l, layerKey);
            if (l.getBounds) map.fitBounds(l.getBounds());
        }
    });
}

function toggleSeleccion(layer, layerKey) {
    const id = layer._nova_id;
    if (featuresSeleccionados.has(id)) {
        featuresSeleccionados.delete(id);
        layer.setStyle(capasAtributosModificados[layerKey]);
    } else {
        featuresSeleccionados.add(id);
        layer.setStyle(estilosMapa.resaltado);
    }
    actualizarHighlightTabla();
}

function actualizarHighlightTabla() {
    document.querySelectorAll('tr').forEach(r => r.classList.remove('selected-row'));
    featuresSeleccionados.forEach(id => {
        let row = document.getElementById(`row-${id}`);
        if (row) row.classList.add('selected-row');
    });
}

function toggleTabla() {
    let p = document.getElementById('tablaAtributos');
    p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}

function clearSelection() {
    featuresSeleccionados.clear();
    Object.keys(capasLeaflet).forEach(k => {
        if (map.hasLayer(capasLeaflet[k])) {
            capasLeaflet[k].setStyle(capasAtributosModificados[k]);
        }
    });
    actualizarHighlightTabla();
}

// =============================
// MODIFICADOR DE ESTILOS
// =============================
document.getElementById('btn-aplicar-estilo').onclick = () => {
    let key = selectorEstilos.value;
    let nuevoEstilo = {
        color: document.getElementById('color-borde').value,
        fillColor: document.getElementById('color-relleno').value,
        weight: parseFloat(document.getElementById('rango-grosor').value),
        fillOpacity: 0.6
    };

    capasAtributosModificados[key] = nuevoEstilo;

    if (capasLeaflet[key]) {
        capasLeaflet[key].setStyle(nuevoEstilo); // Esto cambia el estilo de todos los elementos
        // Restaurar resaltado si había algo seleccionado
        capasLeaflet[key].eachLayer(l => {
            if (featuresSeleccionados.has(l._nova_id)) l.setStyle(estilosMapa.resaltado);
        });
    }
};

// =============================
// UI Y NAVEGACIÓN
// =============================
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    event.currentTarget.classList.add('active');
}

// Función para mover la ventana (Drag)
function hacerMovible(idPanel, idHeader) {
    const p = document.getElementById(idPanel);
    const h = document.getElementById(idHeader);
    let x = 0, y = 0;
    h.onmousedown = (e) => {
        x = e.clientX; y = e.clientY;
        document.onmousemove = (ev) => {
            p.style.top = (p.offsetTop - (y - ev.clientY)) + "px";
            p.style.left = (p.offsetLeft - (x - ev.clientX)) + "px";
            x = ev.clientX; y = ev.clientY;
            p.style.bottom = "auto"; p.style.right = "auto";
        };
        document.onmouseup = () => document.onmousemove = null;
    };
}
hacerMovible('tablaAtributos', 'headerTabla');

// Inicializar herramientas Leaflet
new L.Control.Measure({ position: 'topright' }).addTo(map);