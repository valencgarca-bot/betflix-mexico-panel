const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const path = require('path');
const app = express();

const dbDirectory = process.env.RENDER ? '/var/data' : __dirname;
const dbPath = path.resolve(dbDirectory, 'betflix_mexico_v1.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Error al abrir la base de datos persistente", err.message);
    } else {
        console.log("💾 Base de datos conectada correctamente en:", dbPath);
    }
});

const dbGet = (query, params = []) => new Promise((resolve, reject) => db.get(query, params, (err, row) => err ? reject(err) : resolve(row)));
const dbAll = (query, params = []) => new Promise((resolve, reject) => db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows)));
const dbRun = (query, params = []) => new Promise((resolve, reject) => db.run(query, params, function(err) { err ? reject(err) : resolve(this) }));

// 📌 CORREO REAL RESTAURADO PARA QUE FUNCIONE EL IMAP Y DEVUELVA LA INFORMACIÓN
const CUENTAS_GMAIL_MAP = {
    'darciogarces@gmail.com': 'wkcidkcgtuapcnkh'
};

const PLATAFORMAS = {
    'netflix': { nombre: 'Netflix', color: '#E50914', logo: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg', keyword_from: 'netflix' },
    'disney': { nombre: 'Disney+', color: '#ffffff', logo: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg', keyword_from: 'disneyplus' }
};

// 📌 PRECIOS BASE DEL ADMINISTRADOR PRINCIPAL (ALMACENADOS ESTRICTAMENTE EN MXN)
const PRECIOS_BASE = {
    1: 185,
    2: 370,
    3: 555,
    4: 740,
    5: 832,
    10: 1560
};

// 📌 TASA DE CAMBIO CONFIGURABLE (Ej. 1 MXN = 176 COP)
const TASAS_CAMBIO = {
    'MXN': 1,
    'COP': 176
};

// 📌 Función para normalizar teléfonos agregando +52 a los que no lo tienen
function formatearTelefono(telefono) {
    if (!telefono) return null;
    let tel = telefono.toString().replace(/\s+/g, '').trim();
    if (!tel) return null;
    if (tel.startsWith('+')) return tel;
    if (tel.startsWith('52') && tel.length === 12) return '+' + tel;
    return '+52' + tel;
}

// Funciones Auxiliares para el manejo de Monedas
function obtenerMonedaPorTelefono(telefono) {
    if (!telefono) return 'MXN';
    let tel = telefono.replace(/\s+/g, '');
    if (tel.startsWith('+57')) return 'COP';
    if (tel.startsWith('+52')) return 'MXN';
    return 'MXN'; // Moneda por defecto
}

function convertirLocal(montoMXN, monedaLocal) {
    if (monedaLocal === 'COP') {
        return Math.round((montoMXN * TASAS_CAMBIO.COP) / 100) * 100;
    }
    return Math.round(montoMXN * 100) / 100;
}

function convertirAMXN(montoLocal, monedaLocal) {
    if (monedaLocal === 'COP') return montoLocal / TASAS_CAMBIO.COP;
    return montoLocal;
}

function formatearDinero(montoMXN, monedaLocal) {
    if (!montoMXN) montoMXN = 0;
    const convertido = convertirLocal(montoMXN, monedaLocal);
    return `$${convertido.toLocaleString('es-CO')} ${monedaLocal}`;
}

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'betflix_mexico_ultra_secure_2026_MX_PRO',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ✅ ESTRUCTURA DE BASE DE DATOS
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT UNIQUE, pass TEXT, rol TEXT, creado_por INTEGER, fecha_creacion DATETIME DEFAULT (datetime('now', 'localtime')), telefono TEXT)");
    db.run("ALTER TABLE usuarios ADD COLUMN telefono TEXT", (err) => {});
    db.run("ALTER TABLE usuarios ADD COLUMN creditos REAL DEFAULT 0", (err) => {});
    db.run("ALTER TABLE usuarios ADD COLUMN deuda REAL DEFAULT 0", (err) => {});
    
    // Nueva columna para identificar el país/moneda del usuario
    db.run("ALTER TABLE usuarios ADD COLUMN moneda TEXT DEFAULT 'MXN'", (err) => {
        if (!err) {
            db.run("UPDATE usuarios SET moneda = 'COP' WHERE telefono LIKE '+57%'", (err) => {});
            db.run("UPDATE usuarios SET moneda = 'MXN' WHERE telefono LIKE '+52%'", (err) => {});
        }
    });
    
    db.run("CREATE TABLE IF NOT EXISTS correos (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, user_id INTEGER, fecha_asignacion DATETIME DEFAULT (date('now', 'localtime')))");
    db.run("CREATE TABLE IF NOT EXISTS registro_codigos (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, email_buscado TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    
    db.run("CREATE TABLE IF NOT EXISTS reservas (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, cantidad INTEGER, telefono TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Pendiente')");
    db.run("CREATE TABLE IF NOT EXISTS garantias (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plataforma TEXT, motivo TEXT, detalles TEXT, reemplazo TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Pendiente')");
    db.run("CREATE TABLE IF NOT EXISTS soporte (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, mensaje TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Abierto')");
    
    db.run("CREATE TABLE IF NOT EXISTS stock_cuentas (id INTEGER PRIMARY KEY AUTOINCREMENT, plataforma TEXT, email TEXT UNIQUE, estado TEXT DEFAULT 'Disponible', fecha_carga DATETIME DEFAULT (datetime('now', 'localtime')))");
    db.run("ALTER TABLE stock_cuentas ADD COLUMN comprador_id INTEGER", (err) => {});
    db.run("ALTER TABLE stock_cuentas ADD COLUMN compra_id INTEGER", (err) => {});
    db.run("ALTER TABLE stock_cuentas ADD COLUMN fecha_compra DATETIME", (err) => {});
    db.run("ALTER TABLE stock_cuentas ADD COLUMN password TEXT", (err) => {});

    db.run("CREATE TABLE IF NOT EXISTS compras_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, subadmin_id INTEGER, cantidad INTEGER, creditos_usados REAL, saldo_anterior REAL, saldo_nuevo REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    
    db.run("CREATE TABLE IF NOT EXISTS detalles_compras (id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER, cuenta_id INTEGER, email_cuenta TEXT)");
    db.run("ALTER TABLE detalles_compras ADD COLUMN password_cuenta TEXT", (err) => {});

    db.run("CREATE TABLE IF NOT EXISTS historial_asignaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, receptor_id INTEGER, admin_id INTEGER, fecha DATETIME DEFAULT (datetime('now', 'localtime')), tipo_operacion TEXT DEFAULT 'Asignación manual', estado TEXT DEFAULT 'Asignada')");

    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por, moneda) VALUES ('admin', '14032021', 'Administrador', NULL, 'MXN')", (err) => {});
    db.run("UPDATE usuarios SET user = 'admin', pass = '14032021' WHERE user = 'dueño'", (err) => {});

    // 🚀 ACTUALIZAR TODOS LOS TELÉFONOS AGREGANDO +52 SI NO LO TIENEN
    db.run("UPDATE usuarios SET telefono = '+' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) LIKE '52__________'", (err) => {});
    db.run("UPDATE usuarios SET telefono = '+52' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) NOT LIKE '+%'", (err) => {});
    db.run("UPDATE reservas SET telefono = '+52' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) NOT LIKE '+%'", (err) => {});

    // ✅ NUEVAS TABLAS PARA EL SISTEMA MULTINIVEL
    db.run("ALTER TABLE stock_cuentas ADD COLUMN propietario_id INTEGER DEFAULT 1", (err) => {});
    db.run("CREATE TABLE IF NOT EXISTS precios_subadmin (id INTEGER PRIMARY KEY AUTOINCREMENT, subadmin_id INTEGER, paquete INTEGER, precio REAL, UNIQUE(subadmin_id, paquete))");
    db.run("CREATE TABLE IF NOT EXISTS historial_dinero (id INTEGER PRIMARY KEY AUTOINCREMENT, emisor_id INTEGER, receptor_id INTEGER, monto REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
});

// 🧹 FUNCIÓN DE PURGA INMEDIATA
async function purgarUsuariosInactivos() {
    try {
        await dbRun(`
            DELETE FROM usuarios 
            WHERE rol = 'Cliente' 
            AND id NOT IN (SELECT DISTINCT user_id FROM correos) 
            AND datetime(fecha_creacion, '+24 hours') <= datetime('now', 'localtime')
        `);
    } catch(err) {}
}
purgarUsuariosInactivos();
setInterval(purgarUsuariosInactivos, 15 * 60 * 1000);

const CSS_MODERNO = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    :root {
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --card-bg: rgba(8, 10, 15, 0.94);
        --card-border: rgba(255, 255, 255, 0.12);
        --accent: #00D2FF;
        --accent-hover: #0099CC;
        --btn-bg: rgba(0, 210, 255, 0.08);
        --shadow-elegant: 0 15px 40px rgba(0, 0, 0, 0.9);
        --blur-effect: blur(12px);
        --radius: 14px;
    }
    @keyframes pureSeriesSlideshow {
        0% { background-image: linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.75)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
        33% { background-image: linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.75)), url('https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=2000&auto=format&fit=crop'); }
        66% { background-image: linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.75)), url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2000&auto=format&fit=crop'); }
        100% { background-image: linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.75)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
    }
    body { 
        background-size: cover; background-position: center; background-attachment: fixed; 
        animation: pureSeriesSlideshow 18s ease infinite; background-color: #050505; 
        color: var(--text-main); font-family: 'Inter', sans-serif; 
        margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; min-height: 100vh; 
    }
    .top-header { 
        background: rgba(0, 0, 0, 0.6); 
        border-bottom: 1px solid var(--card-border);
        backdrop-filter: var(--blur-effect);
        padding: 16px 35px; 
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        position: sticky;
        top: 0;
        z-index: 50;
    }
    .user-pill { 
        display: flex; align-items: center; gap: 12px; background: rgba(255, 255, 255, 0.03); 
        padding: 10px 16px; border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); 
        border-radius: 12px; cursor: pointer; transition: 0.25s; width: 100%; box-sizing: border-box;
    }
    .user-pill:hover { border-color: #E50914; background: rgba(229, 9, 20, 0.1); }
    .user-pill img { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 1px solid var(--accent); }
    .user-pill .info { display: flex; flex-direction: column; overflow: hidden; }
    .user-pill .info strong { color: var(--text-main); font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .user-pill .info span { color: var(--text-muted); font-size: 11px; margin-top: 2px; }
    .brand-logo { font-size: 20px; font-weight: 300; display:flex; align-items:center; gap: 10px; letter-spacing: 2px; text-transform: uppercase; color: #fff;}
    .brand-logo strong { font-weight: 700; color: var(--accent); }
    .search-top input { 
        background: rgba(0, 0, 0, 0.8); border: 1px solid var(--card-border); padding: 10px 20px; 
        width: 250px; border-radius: 50px; color: #fff; font-size: 12px; outline: none; transition: 0.3s; 
    }
    .search-top input:focus { border-color: var(--accent); width: 290px; box-shadow: 0 0 15px rgba(0,210,255,0.2); }
    
    .dashboard-grid { 
        display: grid; 
        grid-template-columns: 290px 1fr 290px; 
        gap: 22px; 
        padding: 25px 35px 40px 35px; 
        align-items: start; 
        max-width: 1650px;
        margin: 0 auto;
    }
    .left-sidebar { display: flex; flex-direction: column; gap: 16px; }
    .right-sidebar { display: flex; flex-direction: column; gap: 18px; }
    .center-panel { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
    
    .action-panel { 
        background: var(--card-bg); border-radius: var(--radius); padding: 22px; 
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); 
        backdrop-filter: var(--blur-effect); display: none; flex-direction: column; gap: 10px;
    }
    .action-panel.active { display: flex; }
    
    .main-card { 
        background: var(--card-bg); border-radius: var(--radius); padding: 25px; 
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); 
        backdrop-filter: var(--blur-effect); display: none; flex-direction: column;
    }
    .main-card.active { display: flex; }
    
    .action-btn-pill { 
        width: 100%; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--card-border); 
        padding: 13px 15px; border-radius: 10px; font-size: 11px; font-weight: 600; 
        color: var(--text-main); cursor: pointer; transition: 0.25s; text-transform: uppercase; 
        letter-spacing: 0.5px; text-align: center; box-sizing: border-box;
    }
    .action-btn-pill:hover { background: rgba(0, 210, 255, 0.14); border-color: var(--accent); transform: translateY(-1px); }
    
    .search-input-large { 
        width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); 
        padding: 16px 20px; border-radius: 10px; font-size: 14px; margin-top: 8px; 
        color: var(--text-main); outline: none; box-sizing: border-box; font-family: 'Inter', sans-serif; transition: 0.3s; 
    }
    .search-input-large:focus { border-color: var(--accent); box-shadow: 0 0 20px rgba(0,210,255,0.25); }
    
    .iframe-container { display: none; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius); height: 560px; width: 100%; overflow: hidden; box-shadow: var(--shadow-elegant); }
    
    .side-card { background: var(--card-bg); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); }
    .side-card h4 { margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent); font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px; display: flex; align-items: center; gap: 6px; }
    
    .menu-group-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1.2px;
        color: var(--text-muted);
        margin: 12px 0 4px 6px;
        font-weight: 700;
    }
    .menu-group-label:first-child { margin-top: 0; }
    
    .plat-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .plat-mini-btn { background: #000000; border: 1px solid var(--card-border); padding: 12px; border-radius: 10px; cursor: pointer; display: flex; justify-content: center; align-items: center; height: 52px; transition: 0.25s; }
    .plat-mini-btn:hover, .plat-mini-btn.active-plat { background: rgba(0, 210, 255, 0.15); border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,210,255,0.25); }
    .plat-mini-btn img { max-height: 24px; max-width: 85%; object-fit: contain; }
    
    .provider-contact { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
    .contact-wrapper { display: flex; flex-direction: column; gap: 4px; }
    .contact-label { font-size: 10px; color: var(--text-muted); text-align: center; }
    .contact-btn { background: #000; border: 1px solid var(--card-border); padding: 10px 8px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; color: #fff; font-size: 11px; font-weight: 600; transition: 0.25s; box-sizing: border-box; }
    .contact-btn.telegram:hover { background: rgba(0, 136, 204, 0.2); border-color: #0088cc; }
    .contact-btn.whatsapp:hover { background: rgba(37, 211, 102, 0.2); border-color: #25d366; }
    
    .menu-list { display: flex; flex-direction: column; gap: 4px; }
    .menu-btn-item { 
        background: rgba(255, 255, 255, 0.02); 
        border: 1px solid transparent; 
        padding: 10px 12px; 
        border-radius: 8px; 
        font-size: 12px; 
        font-weight: 500;
        color: var(--text-main); 
        cursor: pointer; 
        text-align: left; 
        transition: 0.2s; 
        font-family: 'Inter', sans-serif;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .menu-btn-item:hover { background: rgba(0, 210, 255, 0.12); border-color: rgba(0, 210, 255, 0.35); transform: translateX(3px); }
    .menu-btn-item.active-menu { background: rgba(0, 210, 255, 0.18); border-color: var(--accent); color: #fff; font-weight: 600; }
    
    .activity-list { display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; padding-right: 4px; }
    .activity-item { background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); padding: 10px 12px; border-radius: 8px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
    .activity-item strong { color: var(--text-main); font-weight: 500; word-break: break-all; font-size: 11px; }
    .activity-meta { display: flex; justify-content: space-between; align-items: center; color: var(--text-muted); font-size: 10px; }
    .activity-user { color: var(--accent); font-weight: 600; }
    
    .input-classic { width: 100%; padding: 12px 14px; margin-bottom: 12px; border-radius: 8px; border: 1px solid var(--card-border); background: #000000; color: white; box-sizing: border-box; outline: none; font-size: 13px; font-family: 'Inter', sans-serif; }
    .input-classic:focus { border-color: var(--accent); box-shadow: 0 0 12px rgba(0,210,255,0.2); }
    
    .btn-submit { background: var(--accent); color: #000; border: none; padding: 13px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; transition: 0.25s; text-transform: uppercase; letter-spacing: 0.8px; font-size: 12px; }
    .btn-submit:hover { background: var(--accent-hover); box-shadow: 0 0 20px rgba(0, 210, 255, 0.4); color: #fff; }
    
    .sub-form { display: none; background: rgba(0,0,0,0.75); padding: 15px; border-radius: 10px; margin-top: 6px; border: 1px solid rgba(255,255,255,0.12); }
    
    .table-wrapper { background: #000000; border: 1px solid var(--card-border); border-radius: 10px; overflow-x: auto; margin-top: 15px; }
    .table-modern { width: 100%; border-collapse: collapse; text-align: left; }
    .table-modern th { padding: 13px 15px; font-size: 10px; color: var(--accent); border-bottom: 1px solid rgba(255,255,255,0.12); text-transform: uppercase; letter-spacing: 1px; background: rgba(255,255,255,0.02); }
    .table-modern td { padding: 12px 15px; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #f8fafc; vertical-align: top; }
    .badge-status { padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; display: inline-block; }
    .badge-status.disp { background: rgba(37,211,102,0.15); color: #25d366; border: 1px solid #25d366; }
    .badge-status.vendida { background: rgba(229,9,20,0.15); color: #E50914; border: 1px solid #E50914; }

    @media (max-width: 1100px) {
        .dashboard-grid { grid-template-columns: 1fr !important; padding: 15px !important; gap: 18px !important; }
        .top-header { flex-direction: column; gap: 12px; padding: 15px; text-align: center; }
        .brand-logo { justify-content: center; width: 100%; }
        .search-top { width: 100%; }
        .search-top input { width: 100% !important; box-sizing: border-box; }
        .iframe-container { height: 420px; }
        .action-panel, .main-card, .side-card { padding: 18px !important; }
    }
</style>

<script>
    function toggleSubForm(id) {
        document.querySelectorAll('.sub-form').forEach(f => { if(f.id !== id) f.style.display = 'none'; });
        let el = document.getElementById(id);
        el.style.display = (el.style.display === 'none' || el.style.display === '') ? 'block' : 'none';
    }

    function triggerAction(platKey, actionName) {
        let form = document.getElementById('form-' + platKey);
        if(form) {
            let emailInput = form.querySelector('input[name="email_search"]');
            if(!emailInput.value.trim()) {
                emailInput.style.borderColor = "#E50914";
                emailInput.style.boxShadow = "0 0 15px rgba(229,9,20,0.6)";
                emailInput.placeholder = "¡ESCRIBE EL CORREO PRIMERO!";
                emailInput.focus();
                return;
            }
            emailInput.style.borderColor = "var(--accent)";
            emailInput.style.boxShadow = "none";
            
            let actionInput = form.querySelector('input[name="accion"]');
            if(!actionInput) {
                actionInput = document.createElement('input');
                actionInput.type = 'hidden';
                actionInput.name = 'accion';
                form.appendChild(actionInput);
            }
            actionInput.value = actionName;
            
            document.getElementById('visor-resultados').style.display = 'flex';
            form.submit();
        }
    }

    function openTab(tabId) {
        document.querySelectorAll('.main-card').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.action-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.sub-form').forEach(f => f.style.display = 'none');
        document.querySelectorAll('.menu-btn-item').forEach(b => b.classList.remove('active-menu'));
        document.querySelectorAll('.plat-mini-btn').forEach(b => b.classList.remove('active-plat'));
        
        let selectedMain = document.getElementById('main-' + tabId);
        let selectedAction = document.getElementById('action-' + tabId);
        let selectedBtn = document.querySelector('[data-tab="' + tabId + '"]');
        
        if(selectedMain) selectedMain.classList.add('active');
        if(selectedAction) selectedAction.classList.add('active');
        if(selectedBtn) {
            if(selectedBtn.classList.contains('plat-mini-btn')) selectedBtn.classList.add('active-plat');
            else selectedBtn.classList.add('active-menu');
        }
        
        localStorage.setItem('activeBetflixTab', tabId);
    }

    document.addEventListener('DOMContentLoaded', () => {
        let active = localStorage.getItem('activeBetflixTab');
        const urlParams = new URLSearchParams(window.location.search);
        if(urlParams.has('buscar_dueno')) { active = 'base-datos'; }
        if(!active || !document.getElementById('main-' + active)) active = 'netflix'; 
        openTab(active);
    });
</script>
`;

app.use(async (req, res, next) => {
    const rutasAbiertas = ['/', '/login', '/logout', '/registrar-cliente'];
    if (rutasAbiertas.includes(req.path)) return next();
    if (req.session && req.session.uid) {
        try {
            const row = await dbGet("SELECT id FROM usuarios WHERE id = ?", [req.session.uid]);
            if (!row) {
                req.session.destroy();
                return res.send("<script>alert('⛔ ACCESO DENEGADO'); window.location='/';</script>");
            }
            next();
        } catch (err) { 
            console.error(err);
            return res.send("<script>alert('Error Interno de Sesión'); window.location='/';</script>");
        }
    } else { return res.redirect('/'); }
});

app.get('/', (req, res) => {
    let mode = req.query.mode;
    let contenidoForm = "";

    let logosReconocidos = `
        <div style="display: flex; justify-content: center; gap: 15px; margin-bottom: 25px; flex-wrap: wrap; align-items: center;">
            <img src="https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg" height="24" alt="Netflix" style="filter: drop-shadow(0 0 5px rgba(229,9,20,0.8));">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg" height="30" alt="Disney+" style="filter: drop-shadow(0 0 5px rgba(255,255,255,0.8));">
            <img src="https://upload.wikimedia.org/wikipedia/commons/1/11/Amazon_Prime_Video_logo.svg" height="18" alt="Prime Video" style="filter: drop-shadow(0 0 5px rgba(0,168,225,0.8));">
            <img src="https://upload.wikimedia.org/wikipedia/commons/c/ce/Max_logo.svg" height="20" alt="Max" style="filter: drop-shadow(0 0 5px rgba(0,43,231,0.8));">
            <img src="https://upload.wikimedia.org/wikipedia/commons/2/26/Spotify_logo_with_text.svg" height="24" alt="Spotify" style="filter: drop-shadow(0 0 5px rgba(30,215,96,0.8));">
        </div>
    `;

    let mensajeBienvenida = `
        <div style="text-align: center; margin-bottom: 25px;">
            <h3 style="color: #00D2FF; margin: 0 0 5px 0; font-size: 18px; font-weight: 600;">¡Bienvenido a SyncBox!</h3>
            <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.5;">Somos nuevos en el mercado pero con las mejores cuentas.</p>
        </div>
    `;

    if (mode === 'registro') {
        contenidoForm = `
            ${mensajeBienvenida}
            <form action="/registrar-cliente" method="POST">
                <div class="input-group"><input type="text" name="user" placeholder="Elige tu Usuario" required></div>
                <div class="input-group"><input type="tel" name="telefono" placeholder="Número de WhatsApp (Ej: +52...)" required></div>
                <div class="input-group"><input type="password" name="pass" placeholder="Elige tu Contraseña" required></div>
                <button type="submit" class="btn-submit">Completar Registro</button>
            </form>
            <div style="margin-top: 20px;"><a href="/" style="color: #00D2FF; font-size: 12px; text-decoration: none;">← Volver al Login</a></div>
        `;
    } else {
        contenidoForm = `
            ${mensajeBienvenida}
            <form action="/login" method="POST">
                <div class="input-group"><input type="text" name="user" placeholder="Usuario" required></div>
                <div class="input-group"><input type="password" name="pass" placeholder="Contraseña" required></div>
                <button type="submit" class="btn-submit">Ingresar</button>
            </form>
            <div style="margin-top: 20px;"><a href="/?mode=registro" style="color: #00D2FF; font-size: 12px; text-decoration: none;">¿No tienes cuenta? Regístrate aquí</a></div>
        `;
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Acceso - SyncBox</title>
        ${CSS_MODERNO}
        <style>
            body { display: flex; justify-content: center; align-items: center; }
            .login-box { position: relative; z-index: 2; background: rgba(0, 0, 0, 0.92); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px; padding: 40px 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.98); text-align: center; margin: 15px; }
            .input-group { margin-bottom: 20px; }
            .input-group input { width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; height: 52px; padding: 0 20px; box-sizing: border-box; font-size: 14px; border-radius: 8px; outline: none; transition: 0.3s; }
            .input-group input:focus { border-color: #00D2FF; box-shadow: 0 0 15px rgba(0,210,255,0.2);}
            .help-text { color: #888; font-size: 12px; margin-top: 20px; margin-bottom: 5px; line-height: 1.6; font-weight: 300; }
        </style>
    </head>
    <body>
        <div class="login-box">
            ${logosReconocidos}
            ${contenidoForm}
            <div class="help-text">Panel cifrado. Conexión segura.</div>
        </div>
    </body>
    </html>
    `);
});

app.post('/registrar-cliente', async (req, res) => {
    const { user, pass, telefono } = req.body;
    try {
        const telSeguro = formatearTelefono(telefono);
        const monedaDetectada = obtenerMonedaPorTelefono(telSeguro);

        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono, moneda) VALUES (?, ?, 'Cliente', NULL, ?, ?)", [user.trim(), pass, telSeguro, monedaDetectada]);
        
        const fechaObj = new Date();
        const fechaHoraLocal = fechaObj.toLocaleString('es-CO', { timeZone: 'America/Bogota' });

        const mensajeWhatsApp = `¡Hola! Me acabo de registrar en SyncBox.\n\n👤 *Usuario:* ${user.trim()}\n🔑 *Contraseña:* ${pass}\n📱 *Número:* ${telSeguro}\n📅 *Fecha y Hora:* ${fechaHoraLocal}\n\n¡Me gustaría unirme al grupo y conocer los enlaces oficiales!`;
        const linkRedireccion = `https://api.whatsapp.com/send?phone=573012964169&text=${encodeURIComponent(mensajeWhatsApp)}`;

        res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Redirigiendo a WhatsApp...</title>
            <style>
                body { background: #000; color: #fff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
                h2 { color: #25d366; font-size: 24px; }
                p { color: #a3a3a3; font-size: 14px; margin-bottom: 30px; }
                .btn { background: #25d366; color: #000; padding: 18px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 5px 20px rgba(37,211,102,0.4); }
            </style>
        </head>
        <body>
            <h2>✅ ¡Registro Exitoso!</h2>
            <p>Se ha creado tu cuenta. Haz clic abajo para enviar tus datos por WhatsApp y activar tu acceso.</p>
            <a href="${linkRedireccion}" class="btn">Confirmar por WhatsApp</a>
            <script>
                window.location.replace('${linkRedireccion}');
            </script>
        </body>
        </html>
        `);
    } catch(err) {
        res.send("<script>alert('⛔ El nombre de usuario ya está en uso. Elige otro.'); window.location='/?mode=registro';</script>");
    }
});

app.post('/login', async (req, res) => {
    const user = (req.body.user || '').trim();
    const pass = (req.body.pass || '').trim();
    
    try {
        const row = await dbGet("SELECT * FROM usuarios WHERE user = ? AND pass = ?", [user, pass]);
        if (row) {
            req.session.uid = row.id; 
            req.session.user = row.user; 
            req.session.rol = row.rol;
            req.session.save(() => res.redirect('/dash'));
        } else if (user === 'admin' && pass === '14032021') {
            req.session.uid = 1;
            req.session.user = 'admin';
            req.session.rol = 'Administrador';
            req.session.save(() => res.redirect('/dash'));
        } else { 
            res.send("<script>alert('⛔ Datos incorrectos.'); window.location='/';</script>"); 
        }
    } catch (err) { 
        res.send("<script>alert('Error de base de datos en Login'); window.location='/';</script>"); 
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.post('/bot/reservar', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    try {
        const telSeguro = formatearTelefono(req.body.telefono);
        await dbRun("INSERT INTO reservas (user_id, cantidad, telefono) VALUES (?, ?, ?)", [req.session.uid, req.body.cantidad, telSeguro]);
        res.send("<script>alert('🛒 Reserva enviada exitosamente. El administrador la revisará pronto.'); window.location='/dash';</script>");
    } catch(err) { res.redirect('/dash'); }
});

app.post('/bot/garantia', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    try {
        await dbRun("INSERT INTO garantias (user_id, plataforma, motivo, detalles) VALUES (?, ?, ?, ?)", [req.session.uid, req.body.plataforma, req.body.motivo, req.body.detalles]);
        res.send("<script>alert('🚨 Garantía reportada en sistema. Mantente atento para recibir el reemplazo.'); window.location='/dash';</script>");
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/resolver-garantia', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    try {
        await dbRun("UPDATE garantias SET estado = 'Resuelto', reemplazo = ? WHERE id = ?", [req.body.reemplazo, req.body.garantia_id]);
        res.redirect('/dash');
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/completar-reserva', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    try {
        await dbRun("UPDATE reservas SET estado = 'Atendido' WHERE id = ?", [req.body.reserva_id]);
        res.redirect('/dash');
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/cambiar-rol', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    try {
        await dbRun("UPDATE usuarios SET rol = ? WHERE id = ?", [req.body.nuevo_rol, req.body.user_id]);
        res.redirect('/dash');
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/crear', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { n, c, r, telefono } = req.body;
    try {
        const telSeguro = formatearTelefono(telefono);
        const monedaDetectada = obtenerMonedaPorTelefono(telSeguro);

        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono, moneda) VALUES (?, ?, ?, ?, ?, ?)", [n.trim(), c.trim(), r, req.session.uid, telSeguro, monedaDetectada]);
        res.redirect('/dash');
    } catch(err) {
        res.send("<script>alert('Error al crear usuario o ya existe.'); window.location='/dash';</script>");
    }
});

app.post('/admin/asignar-correo', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { user_id, email } = req.body;
    const lista = email.split(/[\s,]+/).filter(e => e.includes('@'));
    
    let asignados = 0;
    let denegados = 0;
    let msjDenegados = [];

    try {
        for (let mail of lista) {
            let e = mail.trim().toLowerCase();
            let dueñosActuales = await dbAll("SELECT u.id, u.user, u.rol FROM correos c JOIN usuarios u ON c.user_id = u.id WHERE c.email = ?", [e]);
            
            if (req.session.rol === 'Administrador') {
                let dueñoDiferente = dueñosActuales.find(d => d.id !== parseInt(user_id));
                if (dueñoDiferente) {
                    denegados++;
                    msjDenegados.push(`- ${e} (Ya lo tiene asignado: ${dueñoDiferente.user})`);
                } else {
                    let yaLoTiene = dueñosActuales.find(d => d.id === parseInt(user_id));
                    if (!yaLoTiene) {
                        await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [e, user_id]);
                        asignados++;
                    }
                }
            } else if (req.session.rol === 'Subadministrador') {
                let esMiCliente = await dbGet("SELECT id FROM usuarios WHERE id = ? AND creado_por = ?", [user_id, req.session.uid]);
                if (esMiCliente) {
                    let yoLoTengo = dueñosActuales.find(d => d.id === req.session.uid);
                    if (yoLoTengo) {
                        let otroCliente = dueñosActuales.find(d => d.id !== req.session.uid && d.id !== parseInt(user_id));
                        if (otroCliente) {
                            denegados++;
                            msjDenegados.push(`- ${e} (Ya lo tiene tu cliente: ${otroCliente.user})`);
                        } else {
                            let yaLoTieneElClienteDestino = dueñosActuales.find(d => d.id === parseInt(user_id));
                            if (!yaLoTieneElClienteDestino) {
                                await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [e, user_id]);
                                asignados++;
                            }
                        }
                    } else {
                        denegados++;
                        msjDenegados.push(`- ${e} (No te pertenece)`);
                    }
                } else {
                    denegados++;
                    msjDenegados.push(`- ${e} (No es tu cliente)`);
                }
            }
        }
        
        if (denegados > 0) {
            let erroresStr = msjDenegados.slice(0, 5).join('\\n');
            if (msjDenegados.length > 5) erroresStr += '\\n... y otros más.';
            let alertMsg = "✅ Asignados: " + asignados + "\\n⛔ Denegados o duplicados: " + denegados + "\\n\\nMotivo:\\n" + erroresStr;
            res.send("<script>alert('" + alertMsg + "'); window.location='/dash';</script>");
        } else {
            res.send("<script>alert('✅ Se asignaron exitosamente los correos a este usuario.'); window.location='/dash';</script>");
        }
    } catch(err) {
        res.redirect('/dash');
    }
});

app.post('/admin/eliminar-correo', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    try {
        if (req.session.rol === 'Administrador') {
            await dbRun("DELETE FROM correos WHERE id = ?", [req.body.correo_id]);
        } else {
            let target = await dbGet("SELECT c.user_id, u.creado_por FROM correos c JOIN usuarios u ON c.user_id = u.id WHERE c.id = ?", [req.body.correo_id]);
            if (target && (target.user_id === req.session.uid || target.creado_por === req.session.uid)) {
                await dbRun("DELETE FROM correos WHERE id = ?", [req.body.correo_id]);
            }
        }
        res.redirect('/dash');
    } catch(err) {
        res.redirect('/dash');
    }
});

app.post('/admin/eliminar-usuario', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    try {
        if (req.session.rol === 'Administrador') {
            await dbRun("DELETE FROM correos WHERE user_id = ?", [req.body.user_id]);
            await dbRun("DELETE FROM usuarios WHERE id = ?", [req.body.user_id]);
        } else {
            let target = await dbGet("SELECT id FROM usuarios WHERE id = ? AND creado_por = ?", [req.body.user_id, req.session.uid]);
            if (target) {
                await dbRun("DELETE FROM correos WHERE user_id = ?", [req.body.user_id]);
                await dbRun("DELETE FROM usuarios WHERE id = ?", [req.body.user_id]);
            }
        }
        res.redirect('/dash');
    } catch(err) {
        res.redirect('/dash');
    }
});

// 🚀 CARGA DE STOCK DINÁMICA (ADMIN Y SUBADMIN)
app.post('/stock/cargar', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { correos_stock, plataforma } = req.body;
    const lineas = correos_stock.split(/[\n\r]+/).filter(l => l.trim() !== '');
    
    let duplicadas = 0;
    let agregadas = 0;

    try {
        for (let linea of lineas) {
            let match = linea.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)[\s:;|/,]*(.*)/);
            if (match) {
                let e = match[1].toLowerCase().trim();
                let p = match[2].trim() || null;
                
                let existsStock = await dbGet("SELECT id FROM stock_cuentas WHERE email = ?", [e]);
                let existsCorreos = await dbGet("SELECT id FROM correos WHERE email = ?", [e]);
                
                if(existsStock || existsCorreos) { duplicadas++; } 
                else {
                    await dbRun("INSERT INTO stock_cuentas (plataforma, email, password, propietario_id) VALUES (?, ?, ?, ?)", [plataforma, e, p, req.session.uid]);
                    agregadas++;
                }
            }
        }
        res.send(`<script>alert('✅ Se agregaron ${agregadas} cuentas a tu stock.\\n⚠️ Duplicadas ignoradas: ${duplicadas}'); window.location='/dash';</script>`);
    } catch(e) { res.redirect('/dash'); }
});

app.post('/admin/vaciar-stock-disponible', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    try {
        await dbRun("DELETE FROM stock_cuentas WHERE estado = 'Disponible'");
        res.send("<script>alert('✅ Todo el stock NO VENDIDO (Disponible) ha sido eliminado correctamente.'); window.location='/dash';</script>");
    } catch(e) { res.redirect('/dash'); }
});

app.post('/admin/vaciar-stock-vendido', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    try {
        await dbRun("DELETE FROM stock_cuentas WHERE estado IN ('Vendida', 'Asignada')");
        res.send("<script>alert('✅ Todo el stock VENDIDO y ASIGNADO ha sido eliminado de la tabla principal. (Los clientes conservan sus accesos)'); window.location='/dash';</script>");
    } catch(e) { res.redirect('/dash'); }
});

// 🚀 ASIGNACIÓN DE DINERO POR PARTE DEL ADMIN (CONVIERTE A MXN)
app.post('/admin/asignar-dinero', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    const { subadmin_id, cantidad } = req.body;
    
    try {
        const user = await dbGet("SELECT user, telefono, creditos, moneda FROM usuarios WHERE id = ?", [subadmin_id]);
        if(!user) return res.redirect('/dash');

        const admin = await dbGet("SELECT moneda FROM usuarios WHERE id = ?", [req.session.uid]);
        const monedaOrigen = admin ? admin.moneda : 'MXN';

        const montoIngresado = parseFloat(cantidad);
        const montoEnMXN = convertirAMXN(montoIngresado, monedaOrigen);

        const nuevoSaldoMXN = user.creditos + montoEnMXN;
        await dbRun("UPDATE usuarios SET creditos = ? WHERE id = ?", [nuevoSaldoMXN, subadmin_id]);
        await dbRun("INSERT INTO historial_dinero (emisor_id, receptor_id, monto) VALUES (?, ?, ?)", [req.session.uid, subadmin_id, montoEnMXN]);

        let telFormateado = formatearTelefono(user.telefono);
        let telefonoLimpio = telFormateado ? telFormateado.replace('+', '').replace(/\s/g, '') : '';
        const saldoMostrado = formatearDinero(nuevoSaldoMXN, user.moneda);
        const asignadoMostrado = formatearDinero(montoEnMXN, user.moneda);

        const msg = `Hola, ${user.user}.\n\nSe te ha asignado un saldo de *${asignadoMostrado}* para realizar compras de cuentas en el sistema.\n\n*Dinero disponible:* ${saldoMostrado}\n\nTu saldo se irá descontando automáticamente en cada compra.`;
        const link = `https://api.whatsapp.com/send?phone=${telefonoLimpio}&text=${encodeURIComponent(msg)}`;

        res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Aviso de Dinero</title>
            <style>
                body { background: #000; color: #fff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
                h2 { color: #00D2FF; font-size: 24px; }
                .btn { background: #00D2FF; color: #000; padding: 18px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 5px 20px rgba(0,210,255,0.4); margin-top: 20px;}
            </style>
        </head>
        <body>
            <h2>✅ Dinero Asignado: ${saldoMostrado}</h2>
            <p>Se actualizó el saldo de ${user.user}. Haz clic abajo para enviarle el comprobante a su WhatsApp.</p>
            <a href="${link}" class="btn">Notificar al Cliente</a>
            <br><br>
            <a href="/dash" style="color:var(--text-muted); font-size: 12px;">Volver al Panel sin notificar</a>
            <script>window.location.replace('${link}');</script>
        </body>
        </html>
        `);
    } catch(e) { res.redirect('/dash'); }
});

app.post('/admin/asignar-manual', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    const { correos_asignar, receptor_id } = req.body;

    if (!correos_asignar || !receptor_id) {
        return res.send("<script>alert('⛔ Debes ingresar las cuentas y seleccionar el usuario receptor.'); window.location='/dash';</script>");
    }

    const lista = correos_asignar.split(/[\s,]+/).filter(e => e.includes('@'));
    
    let asignadasOK = 0;
    let fallidas = 0;
    let msjFallidas = [];

    try {
        for (let mail of lista) {
            let email = mail.trim().toLowerCase();
            
            const cuenta = await dbGet("SELECT id, email FROM stock_cuentas WHERE email = ? AND estado = 'Disponible'", [email]);
            
            if (!cuenta) {
                fallidas++;
                msjFallidas.push(`- ${email} (No en stock)`);
                continue;
            }

            const yaVinculada = await dbGet("SELECT id FROM correos WHERE email = ?", [cuenta.email]);
            if (yaVinculada) {
                await dbRun("UPDATE stock_cuentas SET estado = 'Asignada', comprador_id = ? WHERE id = ?", [receptor_id, cuenta.id]);
                fallidas++;
                msjFallidas.push(`- ${email} (Ya vinculada)`);
                continue;
            }

            await dbRun("UPDATE stock_cuentas SET estado = 'Asignada', comprador_id = ?, fecha_compra = datetime('now', 'localtime') WHERE id = ?", [receptor_id, cuenta.id]);
            await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [cuenta.email, receptor_id]);
            await dbRun("INSERT INTO historial_asignaciones (email, receptor_id, admin_id, tipo_operacion, estado) VALUES (?, ?, ?, 'Asignación manual', 'Asignada')", [cuenta.email, receptor_id, req.session.uid]);
            asignadasOK++;
        }

        let alertMsg = "✅ Asignación masiva completada.\\n\\nCuentas asignadas exitosamente: " + asignadasOK + "\\nCuentas no procesadas: " + fallidas;
        if (fallidas > 0) {
            let erroresStr = msjFallidas.slice(0, 8).join('\\n');
            if (msjFallidas.length > 8) erroresStr += '\\n... y otras más.';
            alertMsg += "\\n\\nMotivos:\\n" + erroresStr;
        }

        res.send("<script>alert('" + alertMsg + "'); window.location='/dash';</script>");

    } catch(e) {
        res.send("<script>alert('Error en la asignación masiva'); window.location='/dash';</script>");
    }
});

// 🚀 SUBADMIN: CONFIGURAR PRECIOS DE SU TIENDA (RECIBE EN MONEDA LOCAL, GUARDA EN MXN)
app.post('/subadmin/configurar-precios', async (req, res) => {
    if (req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    try {
        const subadmin = await dbGet("SELECT moneda FROM usuarios WHERE id = ?", [req.session.uid]);
        const paquetes = [1, 2, 3, 4, 5, 10];
        
        for (let p of paquetes) {
            let precioIngresadoLocal = parseFloat(req.body[`precio_${p}`]);
            let precioNuevoMXN = convertirAMXN(precioIngresadoLocal, subadmin.moneda);
            
            if (precioNuevoMXN && precioNuevoMXN >= PRECIOS_BASE[p]) {
                await dbRun("INSERT INTO precios_subadmin (subadmin_id, paquete, precio) VALUES (?, ?, ?) ON CONFLICT(subadmin_id, paquete) DO UPDATE SET precio = excluded.precio", [req.session.uid, p, precioNuevoMXN]);
            }
        }
        res.send("<script>alert('✅ Precios de venta actualizados correctamente en tu tienda.'); window.location='/dash';</script>");
    } catch(err) {
        res.send("<script>alert('Error al guardar precios.'); window.location='/dash';</script>");
    }
});

// 🚀 SUBADMIN: ASIGNAR DINERO A SUS CLIENTES
app.post('/subadmin/asignar-dinero', async (req, res) => {
    if (req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { cliente_id, cantidad } = req.body;

    try {
        const subadmin = await dbGet("SELECT user, creditos, moneda FROM usuarios WHERE id = ?", [req.session.uid]);
        const cliente = await dbGet("SELECT id, user, creditos, moneda FROM usuarios WHERE id = ? AND creado_por = ?", [cliente_id, req.session.uid]);
        
        if (!cliente) return res.send("<script>alert('⛔ Cliente no válido.'); window.location='/dash';</script>");

        const montoIngresado = parseFloat(cantidad);
        const montoMXN = convertirAMXN(montoIngresado, subadmin.moneda);

        if (montoMXN > 0 && subadmin.creditos < montoMXN) {
            return res.send("<script>alert('⛔ No tienes dinero suficiente para asignar esta cantidad.'); window.location='/dash';</script>");
        }

        const nuevoSaldoSubadminMXN = subadmin.creditos - montoMXN;
        const nuevoSaldoClienteMXN = cliente.creditos + montoMXN;

        await dbRun("UPDATE usuarios SET creditos = ? WHERE id = ?", [nuevoSaldoSubadminMXN, req.session.uid]);
        await dbRun("UPDATE usuarios SET creditos = ? WHERE id = ?", [nuevoSaldoClienteMXN, cliente_id]);
        await dbRun("INSERT INTO historial_dinero (emisor_id, receptor_id, monto) VALUES (?, ?, ?)", [req.session.uid, cliente_id, montoMXN]);

        const saldoActualizadoLocal = formatearDinero(nuevoSaldoSubadminMXN, subadmin.moneda);
        res.send(`<script>alert('✅ Operación exitosa. Dinero transferido. Te quedan ${saldoActualizadoLocal}.'); window.location='/dash';</script>`);
    } catch(err) {
        res.send("<script>alert('Error en transferencia financiera.'); window.location='/dash';</script>");
    }
});

// 🚀 SISTEMA DE COMPRA MULTINIVEL
app.post('/tienda/comprar', async (req, res) => {
    if (req.session.rol !== 'Subadministrador' && req.session.rol !== 'Cliente') return res.redirect('/dash');
    const paquete = parseInt(req.body.paquete);
    
    try {
        const comprador = await dbGet("SELECT id, user, telefono, creditos, creado_por, moneda FROM usuarios WHERE id = ?", [req.session.uid]);
        const esSubAdmin = req.session.rol === 'Subadministrador';
        
        const proveedor_id = esSubAdmin ? 1 : comprador.creado_por;
        
        let costoMXN = PRECIOS_BASE[paquete];
        if (!costoMXN) return res.send("<script>alert('Paquete inválido'); window.location='/dash';</script>");

        if (!esSubAdmin) {
            const precioPersonalizado = await dbGet("SELECT precio FROM precios_subadmin WHERE subadmin_id = ? AND paquete = ?", [proveedor_id, paquete]);
            if (precioPersonalizado) costoMXN = precioPersonalizado.precio;
        }

        if (comprador.creditos < costoMXN) return res.send("<script>alert('Dinero insuficiente en tu balance.'); window.location='/dash';</script>");

        const disponibles = await dbAll("SELECT id, email, password FROM stock_cuentas WHERE estado = 'Disponible' AND plataforma = 'netflix' AND propietario_id = ? LIMIT ?", [proveedor_id, paquete]);
        
        if (disponibles.length < paquete) return res.send("<script>alert('El proveedor no tiene stock suficiente en este momento.'); window.location='/dash';</script>");

        const nuevoSaldoMXN = comprador.creditos - costoMXN;
        await dbRun("UPDATE usuarios SET creditos = ? WHERE id = ?", [nuevoSaldoMXN, req.session.uid]);

        const compraInfo = await dbRun("INSERT INTO compras_stock (subadmin_id, cantidad, creditos_usados, saldo_anterior, saldo_nuevo) VALUES (?, ?, ?, ?, ?)", [req.session.uid, paquete, costoMXN, comprador.creditos, nuevoSaldoMXN]);
        const compraId = compraInfo.lastID;

        let correosEntregados = [];
        for (let cuenta of disponibles) {
            await dbRun("UPDATE stock_cuentas SET estado = 'Vendida', comprador_id = ?, compra_id = ?, fecha_compra = datetime('now', 'localtime') WHERE id = ?", [req.session.uid, compraId, cuenta.id]);
            await dbRun("INSERT INTO detalles_compras (compra_id, cuenta_id, email_cuenta, password_cuenta) VALUES (?, ?, ?, ?)", [compraId, cuenta.id, cuenta.email, cuenta.password]);
            await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [cuenta.email, req.session.uid]);
            correosEntregados.push(`${cuenta.email} : ${cuenta.password || 'Sin clave'}`);
        }

        const proveedor = await dbGet("SELECT telefono, moneda FROM usuarios WHERE id = ?", [proveedor_id]);
        const provTelFormateado = proveedor && proveedor.telefono ? formatearTelefono(proveedor.telefono) : null;
        const adminPhone = provTelFormateado ? provTelFormateado.replace(/\s+/g, '').replace('+', '') : '573012964169';
        const proveedorMoneda = (proveedor && proveedor.moneda) ? proveedor.moneda : 'MXN';
        
        const fechaObj = new Date();
        const msgAdmin = `*NUEVA COMPRA EN TU TIENDA*\n\n👤 *Cliente:* ${comprador.user}\n📅 *Fecha:* ${fechaObj.toLocaleDateString('es-CO')} ${fechaObj.toLocaleTimeString('es-CO')}\n🛒 *Paquete:* ${paquete} cuentas\n💵 *Valor:* ${formatearDinero(costoMXN, proveedorMoneda)}\n\n*Cuentas entregadas:*\n${correosEntregados.join('\n')}\n\n🪙 *Dinero restante del cliente:* ${formatearDinero(nuevoSaldoMXN, proveedorMoneda)}`;
        const linkAdmin = `https://api.whatsapp.com/send?phone=${adminPhone}&text=${encodeURIComponent(msgAdmin)}`;

        const costoCompradorText = formatearDinero(costoMXN, comprador.moneda);

        res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head><title>Compra Exitosa</title><style>body{background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:50px;} .btn{background:#25d366;color:#000;padding:15px 20px;text-decoration:none;border-radius:10px;font-weight:bold;margin-top:20px;display:inline-block;}</style></head>
        <body>
            <h2 style="color:#25d366;">✅ Compra Exitosa</h2>
            <p>Se descontaron ${costoCompradorText}. Las cuentas están en tu panel.</p>
            <a href="${linkAdmin}" class="btn">Notificar al Proveedor por WhatsApp</a>
            <br><br><a href="/dash" style="color:#888;">Volver al Panel</a>
            <script>window.location.replace('${linkAdmin}');</script>
        </body>
        </html>
        `);
    } catch(e) {
        res.send(`<script>alert('Error en la transacción'); window.location='/dash';</script>`);
    }
});

app.get('/dash', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'admin' || req.session.user === 'ruben');
    const esSubAdmin = (req.session.rol === 'Subadministrador');
    const esCliente = (req.session.rol === 'Cliente');

    if (esAdminPrincipal || esSubAdmin || esCliente) {
        try {
            const usuarioActual = await dbGet("SELECT * FROM usuarios WHERE id = ?", [req.session.uid]);
            let misCorreos = [];
            if (esCliente || esSubAdmin) { misCorreos = await dbAll("SELECT * FROM correos WHERE user_id = ?", [req.session.uid]); }

            let query = esAdminPrincipal ? "SELECT * FROM usuarios" : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
            let params = esAdminPrincipal ? [] : [req.session.uid, req.session.uid];
            const usuarios = await dbAll(query, params);
            const correos = await dbAll("SELECT * FROM correos", []);
            const registros = await dbAll("SELECT * FROM registro_codigos ORDER BY id DESC LIMIT 5", []);
            
            const garantias = await dbAll(`SELECT g.*, u.user as cliente_nombre FROM garantias g JOIN usuarios u ON g.user_id = u.id ORDER BY g.estado ASC, g.id DESC`);
            const reservas = await dbAll(`SELECT r.*, u.user as cliente_nombre FROM reservas r JOIN usuarios u ON r.user_id = u.id ORDER BY r.estado ASC, r.id DESC`);

            const proveedor_inventario = esCliente ? usuarioActual.creado_por : (esSubAdmin ? req.session.uid : 1);
            const stockDisp = await dbGet("SELECT COUNT(*) as count FROM stock_cuentas WHERE estado = 'Disponible' AND propietario_id = ?", [proveedor_inventario]);
            const stockVend = await dbGet("SELECT COUNT(*) as count FROM stock_cuentas WHERE (estado = 'Vendida' OR estado = 'Asignada') AND propietario_id = ?", [proveedor_inventario]);
            
            const historialAsignaciones = await dbAll("SELECT h.*, u.user as receptor, a.user as admin FROM historial_asignaciones h JOIN usuarios u ON h.receptor_id = u.id JOIN usuarios a ON h.admin_id = a.id ORDER BY h.id DESC");

            const historialCompras = await dbAll(`SELECT c.*, u.user as comprador, u.moneda FROM compras_stock c JOIN usuarios u ON c.subadmin_id = u.id ORDER BY c.id DESC`);
            const detallesComprasDB = await dbAll("SELECT * FROM detalles_compras");

            let actividadesHtml = "";
            if (registros.length > 0) {
                registros.forEach(r => { 
                    actividadesHtml += `
                    <div class="activity-item">
                        <strong>${r.email_buscado}</strong>
                        <div class="activity-meta">
                            <span>${r.fecha}</span>
                            <span class="activity-user">@${r.user}</span>
                        </div>
                    </div>`; 
                });
            } else { 
                actividadesHtml = `<div class="activity-item"><span style="color:var(--text-muted);">No hay actividades recientes.</span></div>`; 
            }

            let botonesPlataformaHtml = "";
            Object.keys(PLATAFORMAS).forEach(key => {
                let plat = PLATAFORMAS[key];
                botonesPlataformaHtml += `
                <div class="plat-mini-btn" data-tab="${key}" onclick="openTab('${key}')" title="Abrir ${plat.nombre}">
                    <img src="${plat.logo}" alt="${plat.nombre}">
                </div>`;
            });

            let panelesCentroHtml = "";
            let panelesIzquierdosHtml = "";

            Object.keys(PLATAFORMAS).forEach(key => {
                let plat = PLATAFORMAS[key];
                
                let controlesIzquierda = `
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 12px; text-align: center; margin-bottom: 10px;">
                        <p style="margin: 0; color: #cbd5e1; font-size: 11px; line-height: 1.5;">
                            Panel Operativo de <strong>${plat.nombre}</strong>. Selecciona una opción después de escribir tu correo.
                        </p>
                    </div>`;

                if (key === 'netflix') {
                    controlesIzquierda += `
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.15); color: #fff; border: 1px solid #E50914; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px;">
                            <img src="${plat.logo}" alt="Netflix" style="height: 15px;"> DAR CLICK AQUÍ
                        </button>
                        <button onclick="triggerAction('${key}', 'pais')" class="action-btn-pill" style="background: rgba(0, 210, 255, 0.1); color: #00D2FF; border: 1px solid rgba(0, 210, 255, 0.5);">🌍 Ver País de la Cuenta</button>
                    `;
                } else {
                    controlesIzquierda += `
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill" style="background: var(--accent); color: #000; border: none;">🔎 Extraer Código Original</button>
                        <button onclick="triggerAction('${key}', 'pais')" class="action-btn-pill" style="background: rgba(0, 210, 255, 0.1); color: #00D2FF; border: 1px solid rgba(0, 210, 255, 0.5);">🌍 Ver País de la Cuenta</button>
                    `;
                }
                
                controlesIzquierda += `
                    <button onclick="toggleSubForm('reserva-${key}')" class="action-btn-pill">🛒 Reservar Cuentas (Manual)</button>
                    <div id="reserva-${key}" class="sub-form">
                        <form action="/bot/reservar" method="POST">
                            <h5 style="margin: 0 0 10px 0; color: var(--accent);">🛒 Pedido Manual</h5>
                            <input type="number" name="cantidad" min="1" max="10" placeholder="Cantidad (1 a 10)" class="input-classic" required>
                            <input type="tel" name="telefono" placeholder="WhatsApp (Ej: +52...)" class="input-classic" required>
                            <button type="submit" class="btn-submit">Enviar Pedido</button>
                        </form>
                    </div>
                `;

                if (esAdminPrincipal || esSubAdmin) {
                    controlesIzquierda += `
                    <button onclick="toggleSubForm('garantia-${key}')" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.12); border-color: rgba(229, 9, 20, 0.5); color: #fff;">🛡️ Pedir Garantía</button>
                    <div id="garantia-${key}" class="sub-form" style="border-color: #E50914;">
                        <form action="/bot/garantia" method="POST">
                            <h5 style="margin: 0 0 10px 0; color: #E50914;">🛡️ Reportar Caída</h5>
                            <input type="hidden" name="plataforma" value="${key}">
                            <input type="text" name="motivo" placeholder="Motivo (Ej. Clave Incorrecta)" class="input-classic" required>
                            <textarea name="detalles" placeholder="Detalles de la cuenta..." class="input-classic" rows="3" required></textarea>
                            <button type="submit" class="btn-submit" style="background: #E50914; color: #fff;">Reportar Falla</button>
                        </form>
                    </div>
                    `;
                }

                if (esSubAdmin) {
                    controlesIzquierda += `
                    <button onclick="toggleSubForm('soporte-${key}')" class="action-btn-pill" style="background: rgba(255, 115, 0, 0.12); border-color: rgba(255, 115, 0, 0.5);">🛠️ Pedir Soporte (SubAdmin)</button>
                    <div id="soporte-${key}" class="sub-form" style="border-color: #ff7300;">
                        <p style="font-size: 11px; margin-bottom: 10px;">Comunícate directo con el jefe por pagos o ayudas técnicas.</p>
                        <textarea class="input-classic" rows="2" placeholder="Describe el problema..."></textarea>
                        <button type="button" class="btn-submit" style="background: #ff7300; color: #fff;" onclick="alert('Ticket de soporte enviado.')">Enviar Ticket</button>
                    </div>`;
                }

                panelesIzquierdosHtml += `
                <div id="action-${key}" class="action-panel">
                    <h4 style="margin:0 0 6px 0; font-size:11px; color:var(--accent); text-transform:uppercase; letter-spacing:1px;">⚡ Opciones ${plat.nombre}</h4>
                    ${controlesIzquierda}
                </div>`;

                let avisoSinCorreo = "";
                if ((esCliente || esSubAdmin) && misCorreos.length === 0) {
                    avisoSinCorreo = `<div style="background: rgba(229,9,20,0.18); border: 1px solid #E50914; padding: 12px 15px; border-radius: 10px; margin-bottom: 15px; font-size: 12px; color: #f8fafc;">⚠️ Aún no tienes cuentas asignadas. Comunícate mediante los botones de contacto (Tu cuenta se eliminará en 24h si no se asigna).</div>`;
                }

                panelesCentroHtml += `
                <div id="main-${key}" class="main-card">
                    ${avisoSinCorreo}
                    <div style="display:flex; align-items:center; gap:15px; margin-bottom:12px;">
                        <div style="background:#000000; padding:10px 16px; border-radius:10px; border:1px solid var(--card-border);">
                            <img src="${plat.logo}" alt="${plat.nombre}" style="display:block; height:24px; width:auto; max-width:100px; object-fit:contain;">
                        </div>
                        <div>
                            <h3 style="margin:0; font-size:17px; font-weight:600;">Búsqueda en ${plat.nombre}</h3>
                            <p style="margin:3px 0 0 0; font-size:12px; color:var(--text-muted);">Ingresa el correo registrado y selecciona una acción en el panel izquierdo.</p>
                        </div>
                    </div>
                    <form id="form-${key}" action="/buscar" method="POST" target="marco_resultados" style="margin:0;" onsubmit="document.getElementById('visor-resultados').style.display='flex';">
                        <input type="hidden" name="plataforma" value="${key}">
                        <input type="text" name="email_search" class="search-input-large" placeholder="Escribe el correo electrónico aquí..." required ${((esCliente || esSubAdmin) && misCorreos.length === 0) ? 'disabled' : ''}>
                    </form>
                </div>`;
            });

            let clientesOpcionesHtml = usuarios.filter(u => u.rol === 'Cliente' || u.rol === 'Subadministrador').map(u => `<option value="${u.id}">${u.user} (${u.rol})</option>`).join('');

            if (esAdminPrincipal) {
                panelesIzquierdosHtml += `
                <div id="action-stock-admin" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">📦 Control de Inventario</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Carga masiva de cuentas al sistema para la venta automática a subadministradores.</p>
                    <div style="margin-top:10px; background: rgba(0, 210, 255, 0.08); padding: 16px; border-radius: 10px; border: 1px solid rgba(0, 210, 255, 0.25);">
                        <div style="font-size: 26px; font-weight: 700; color: #00D2FF;">${stockDisp.count}</div>
                        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Cuentas Disponibles</div>
                        <hr style="border:none; border-top:1px solid rgba(255,255,255,0.1); margin: 12px 0;">
                        <div style="font-size: 20px; font-weight: 700; color: #fff;">${stockVend.count}</div>
                        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Cuentas Vendidas / Asignadas</div>
                    </div>
                </div>
                <div id="action-asignacion-manual" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🎯 Asignación Directa</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Pega y asigna múltiples cuentas del stock a un usuario simultáneamente.</p>
                </div>
                <div id="action-dinero-admin" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">💰 Economía Global</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Asigna dinero a tus subadministradores y controla el balance general de fondos.</p>
                </div>
                <div id="action-historial-compras" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🧾 Auditoría General</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Registro inmutable de todas las cuentas reclamadas por subadministradores.</p>
                </div>`;

                let historialAsigRows = "";
                if (historialAsignaciones.length === 0) {
                    historialAsigRows = "<tr><td colspan='6' style='text-align:center; padding:18px; color:var(--text-muted);'>No hay asignaciones manuales registradas.</td></tr>";
                } else {
                    historialAsignaciones.forEach(h => {
                        let fechaObj = new Date(h.fecha);
                        let fechaFormatted = fechaObj.toLocaleDateString('es-CO');
                        let horaFormatted = fechaObj.toLocaleTimeString('es-CO');
                        historialAsigRows += `
                        <tr>
                            <td style="font-family:monospace; color:#E50914; font-weight:600;">${h.email}</td>
                            <td><span style="color:#00D2FF; font-weight:600;">@${h.receptor}</span></td>
                            <td><span style="color:var(--text-muted);">@${h.admin}</span></td>
                            <td><small style="color:#fff;">${fechaFormatted} ${horaFormatted}</small></td>
                            <td><span style="color:var(--accent); font-size:11px;">${h.tipo_operacion}</span></td>
                            <td><span class="badge-status disp">${h.estado}</span></td>
                        </tr>`;
                    });
                }

                let subadminsOpcionesHtml = usuarios.filter(u => u.rol === 'Subadministrador' || u.rol === 'Cliente').map(u => `<option value="${u.id}">${u.user} (${formatearDinero(u.creditos, u.moneda)})</option>`).join('');

                let historialGlobalHtml = "";
                if(historialCompras.length === 0) {
                    historialGlobalHtml = "<tr><td colspan='4' style='text-align:center; padding:18px; color:var(--text-muted);'>No hay compras registradas.</td></tr>";
                } else {
                    historialCompras.forEach(c => {
                        let cuentasEntregadas = detallesComprasDB.filter(d => d.compra_id === c.id).map(d => `<div style="font-family:monospace; color:#E50914; padding:2px 0;">${d.email_cuenta}</div>`).join('');
                        historialGlobalHtml += `
                        <tr>
                            <td><span style="color:#00D2FF; font-weight:600;">@${c.comprador}</span><br><small style="color:var(--text-muted);">${c.fecha}</small></td>
                            <td style="text-align:center; font-weight:bold; color:#fff;">${c.cantidad}</td>
                            <td><span style="color:#E50914;">-${formatearDinero(c.creditos_usados, c.moneda)}</span><br><small style="color:var(--text-muted);">Quedan: ${formatearDinero(c.saldo_nuevo, c.moneda)}</small></td>
                            <td><div style="max-height:80px; overflow-y:auto; font-size:11px;">${cuentasEntregadas}</div></td>
                        </tr>`;
                    });
                }

                const stockDB = await dbAll(`SELECT s.*, u.user as comprador FROM stock_cuentas s LEFT JOIN usuarios u ON s.comprador_id = u.id ORDER BY s.id DESC`);
                let stockAdnHtml = "";
                if(stockDB.length === 0) {
                    stockAdnHtml = "<tr><td colspan='4' style='text-align:center; padding:18px; color:var(--text-muted);'>No hay stock en la base de datos.</td></tr>";
                } else {
                    stockDB.forEach(s => {
                        let estadoBadge = s.estado === 'Disponible' 
                            ? '<span class="badge-status disp">Libre</span>' 
                            : (s.estado === 'Asignada' 
                                ? '<span class="badge-status vendida" style="border-color:#00D2FF; color:#00D2FF; background:rgba(0,210,255,0.15);">Asignada</span>' 
                                : '<span class="badge-status vendida">Vendida</span>');
                        let compradorTxt = s.comprador ? `<span style="color:#00D2FF;">@${s.comprador}</span><br><small style="color:var(--text-muted);">${s.fecha_compra || 'N/A'}</small>` : '<span style="color:var(--text-muted);">Nadie</span>';
                        
                        stockAdnHtml += `
                        <tr>
                            <td style="font-family:monospace;">
                                ${s.email}<br>
                                <small style="color:var(--accent); font-weight:600;">${s.password ? '🔑 '+s.password : ''}</small>
                            </td>
                            <td>${estadoBadge}</td>
                            <td>${compradorTxt}</td>
                            <td><small style="color:var(--text-muted);">${s.fecha_carga}</small></td>
                        </tr>`;
                    });
                }

                panelesCentroHtml += `
                <div id="main-stock-admin" class="main-card">
                    <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color: #00D2FF;">📦 Cargar Stock y Ver Historial</h3>
                    <form action="/stock/cargar" method="POST">
                        <select name="plataforma" class="input-classic" required>
                            <option value="netflix">Netflix</option>
                        </select>
                        <textarea name="correos_stock" class="input-classic" placeholder="correo1@gmail.com:clave123&#10;cuenta2@hotmail.com:pass456..." rows="5" required></textarea>
                        <button type="submit" class="btn-submit">Ingresar al Inventario Seguro</button>
                    </form>

                    <div style="margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <form action="/admin/vaciar-stock-disponible" method="POST" style="flex: 1; min-width: 200px;" onsubmit="return confirm('¿Seguro que deseas ELIMINAR TODO EL STOCK DISPONIBLE (No Vendido)? Esta acción no se puede deshacer.');">
                            <button type="submit" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.12); border-color: #E50914; color: #E50914;">🗑️ Borrar Stock NO Vendido</button>
                        </form>
                        <form action="/admin/vaciar-stock-vendido" method="POST" style="flex: 1; min-width: 200px;" onsubmit="return confirm('¿Seguro que deseas ELIMINAR TODO EL STOCK VENDIDO/ASIGNADO? Esto limpiará la lista visual pero los clientes conservarán sus correos.');">
                            <button type="submit" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.12); border-color: #E50914; color: #E50914;">🗑️ Borrar Stock Vendido</button>
                        </form>
                    </div>

                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Correo (ADN)</th><th>Estado</th><th>Comprador / Receptor</th><th>Fecha Carga</th></tr></thead>
                            <tbody>${stockAdnHtml}</tbody>
                        </table>
                    </div>
                </div>

                <div id="main-asignacion-manual" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; font-weight:600; color: #00D2FF;">🎯 Asignación Manual Masiva</h3>
                    <p style="color:var(--text-muted); font-size:12px; margin-bottom:18px;">
                        Pega todas las cuentas que quieras asignar a la vez. El sistema verificará que estén disponibles en el stock, las asignará al cliente y las descontará automáticamente del inventario.
                    </p>
                    
                    <form action="/admin/asignar-manual" method="POST" style="background: rgba(0,0,0,0.5); padding: 18px; border-radius: 10px; border: 1px solid var(--card-border);">
                        <div style="margin-bottom: 15px;">
                            <label style="color: #00D2FF; font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">1. Seleccionar Usuario receptor (Cliente / Subadmin):</label>
                            <select name="receptor_id" class="input-classic" style="margin-bottom:0;" required>
                                <option value="" disabled selected>-- Selecciona al usuario --</option>
                                ${clientesOpcionesHtml}
                            </select>
                        </div>

                        <div style="margin-bottom: 15px;">
                            <label style="color: #00D2FF; font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">2. Pegar cuentas del stock (separadas por espacio o salto de línea):</label>
                            <textarea name="correos_asignar" class="input-classic" style="margin-bottom:0;" placeholder="cuenta1@gmail.com&#10;cuenta2@gmail.com&#10;cuenta3@gmail.com..." rows="5" required></textarea>
                        </div>
                        
                        <button type="submit" class="btn-submit" onclick="return confirm('¿Confirmas la asignación masiva de estas cuentas al usuario seleccionado? Las cuentas se eliminarán de tu inventario disponible.');">Asignar Cuentas al Cliente</button>
                    </form>

                    <div style="margin-top: 25px;">
                        <h4 style="margin:0 0 10px 0; font-size:13px; color:#00D2FF; text-transform:uppercase; letter-spacing:1px;">📋 Historial de Asignación Manual</h4>
                        <div class="table-wrapper">
                            <table class="table-modern">
                                <thead>
                                    <tr>
                                        <th>Cuenta</th>
                                        <th>Usuario Receptor</th>
                                        <th>Administrador</th>
                                        <th>Fecha y Hora</th>
                                        <th>Tipo</th>
                                        <th>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${historialAsigRows}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div id="main-dinero-admin" class="main-card">
                    <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color: #00D2FF;">💰 Asignación de Dinero</h3>
                    <form action="/admin/asignar-dinero" method="POST">
                        <select name="subadmin_id" class="input-classic" required>
                            <option value="" disabled selected>Selecciona al Usuario/Subadmin...</option>
                            ${subadminsOpcionesHtml}
                        </select>
                        <input type="number" step="0.01" name="cantidad" class="input-classic" placeholder="Cantidad de Dinero a Asignar (Ej: 1000)" required>
                        <p style="font-size:11px; color:var(--text-muted); margin-top:-4px; margin-bottom:15px;">* El valor que ingreses corresponde a tu moneda local o la base (MXN).</p>
                        <button type="submit" class="btn-submit">Actualizar Saldo y Notificar por WhatsApp</button>
                    </form>
                </div>

                <div id="main-historial-compras" class="main-card">
                    <h3 style="margin:0 0 10px 0; font-size:19px; font-weight:600; color: #00D2FF;">🧾 Historial Global de Tienda</h3>
                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Subadmin / Cliente</th><th style="text-align:center;">Cant.</th><th>Dinero Descontado</th><th>Cuentas Entregadas</th></tr></thead>
                            <tbody>${historialGlobalHtml}</tbody>
                        </table>
                    </div>
                </div>
                `;
            }

            // 🎯 TIENDA DE CUENTAS VISIBLE PARA CLIENTES Y SUBADMINISTRADORES
            if (esSubAdmin || esCliente) {
                panelesIzquierdosHtml += `
                <div id="action-comprar-stock" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🛒 Tienda de Cuentas</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Compra cuentas de Netflix de forma instantánea usando tu dinero disponible.</p>
                </div>
                <div id="action-mis-compras" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🧾 Mi Inventario</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Revisa las cuentas y contraseñas que has comprado anteriormente.</p>
                </div>`;

                let misComprasHtml = "";
                let misComprasLog = historialCompras.filter(c => c.subadmin_id === req.session.uid);
                if(misComprasLog.length === 0) {
                    misComprasHtml = "<tr><td colspan='4' style='text-align:center; padding:18px; color:var(--text-muted);'>Aún no has realizado compras.</td></tr>";
                } else {
                    misComprasLog.forEach(c => {
                        let cuentasEntregadas = detallesComprasDB.filter(d => d.compra_id === c.id).map(d => `<div style="font-family:monospace; color:#E50914; padding:2px 0;">${d.email_cuenta} <span style="color:#00D2FF; margin-left: 5px;">${d.password_cuenta ? '🔑 '+d.password_cuenta : ''}</span></div>`).join('');
                        misComprasHtml += `
                        <tr>
                            <td><span style="color:#00D2FF; font-weight:600;">#${c.id}</span><br><small style="color:var(--text-muted);">${c.fecha}</small></td>
                            <td style="text-align:center; font-weight:bold; color:#fff;">${c.cantidad} Netflix</td>
                            <td><span style="color:#E50914;">-${formatearDinero(c.creditos_usados, usuarioActual.moneda)}</span></td>
                            <td><div style="max-height:80px; overflow-y:auto; font-size:12px;">${cuentasEntregadas}</div></td>
                        </tr>`;
                    });
                }

                const miProveedorId = esSubAdmin ? 1 : usuarioActual.creado_por;
                const misPreciosDB = await dbAll("SELECT paquete, precio FROM precios_subadmin WHERE subadmin_id = ?", [miProveedorId]);
                
                const paquetesNetflix = [1, 2, 3, 4, 5, 10].map(cant => {
                    let pCustom = misPreciosDB.find(p => p.paquete === cant);
                    return { cant, costo: pCustom ? pCustom.precio : PRECIOS_BASE[cant] };
                });

                let tarjetasTienda = paquetesNetflix.map(p => `
                    <div style="background: #000; border: 1px solid var(--card-border); border-radius: 12px; padding: 22px; text-align: center; transition: 0.25s;" onmouseover="this.style.borderColor='var(--accent)';" onmouseout="this.style.borderColor='var(--card-border)';">
                        <img src="${PLATAFORMAS['netflix'].logo}" height="28" style="margin-bottom: 12px; filter: drop-shadow(0 0 8px rgba(229,9,20,0.5));">
                        <h2 style="margin: 0 0 5px 0; color: #fff; font-size: 20px;">${p.cant} Cuenta${p.cant > 1 ? 's' : ''}</h2>
                        <p style="color: #00D2FF; font-weight: 700; font-size: 17px; margin: 0 0 16px 0;">${formatearDinero(p.costo, usuarioActual.moneda)}</p>
                        <form action="/tienda/comprar" method="POST" style="margin:0;">
                            <input type="hidden" name="paquete" value="${p.cant}">
                            <button type="submit" class="btn-submit" style="font-size: 11px;" onclick="return confirm('¿Seguro que deseas comprar ${p.cant} cuenta${p.cant > 1 ? 's' : ''} por ${formatearDinero(p.costo, usuarioActual.moneda)}? Las cuentas se asignarán a tu panel automáticamente.');">Comprar Ahora</button>
                        </form>
                    </div>
                `).join('');

                panelesCentroHtml += `
                <div id="main-comprar-stock" class="main-card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
                        <h3 style="margin:0; font-size:19px; font-weight:600; color: #00D2FF;">🛒 Tienda de Cuentas</h3>
                        <div style="background: rgba(0,210,255,0.1); border: 1px solid rgba(0,210,255,0.3); padding: 8px 16px; border-radius: 50px; font-size: 12px; font-weight: 600; color: #fff;">
                            Dinero Disponible: <span style="color:#00D2FF;">${formatearDinero(usuarioActual.creditos, usuarioActual.moneda)}</span>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 16px;">
                        ${tarjetasTienda}
                    </div>
                </div>

                <div id="main-mis-compras" class="main-card">
                    <h3 style="margin:0 0 10px 0; font-size:19px; font-weight:600; color: #00D2FF;">🧾 Mis Compras</h3>
                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>ID / Fecha</th><th style="text-align:center;">Paquete</th><th>Descuento</th><th>Cuentas Entregadas</th></tr></thead>
                            <tbody>${misComprasHtml}</tbody>
                        </table>
                    </div>
                </div>
                `;
            }

            // 🚀 PANELES EXCLUSIVOS PARA SUBADMINISTRADORES
            if (esSubAdmin) {
                const misPrecios = await dbAll("SELECT paquete, precio FROM precios_subadmin WHERE subadmin_id = ?", [req.session.uid]);
                let inputsPrecios = [1, 2, 3, 4, 5, 10].map(cant => {
                    let actualMXN = misPrecios.find(p => p.paquete === cant)?.precio || PRECIOS_BASE[cant];
                    let minLocal = convertirLocal(PRECIOS_BASE[cant], usuarioActual.moneda);
                    let actualLocal = convertirLocal(actualMXN, usuarioActual.moneda);

                    return `<div>
                        <label style="color:#00D2FF; font-size:11px; font-weight:600; display:block; margin-bottom:5px;">Paquete ${cant} Cuentas (Min: $${minLocal.toLocaleString('es-CO')} ${usuarioActual.moneda})</label>
                        <input type="number" step="0.01" name="precio_${cant}" min="${minLocal}" value="${actualLocal}" class="input-classic" style="margin-bottom:0;" required>
                    </div>`;
                }).join('');

                let misClientesOptions = usuarios.filter(u => u.creado_por === req.session.uid && u.rol === 'Cliente').map(u => `<option value="${u.id}">${u.user} (${formatearDinero(u.creditos, u.moneda)})</option>`).join('');

                panelesCentroHtml += `
                <div id="main-mi-tienda" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; color:#00D2FF;">⚙️ Configurar Precios de Mi Tienda</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin-bottom:18px;">Establece los precios a los que le venderás a tus clientes en tu moneda (${usuarioActual.moneda}). El sistema impide colocar precios menores a lo que te cobra el Administrador.</p>
                    <form action="/subadmin/configurar-precios" method="POST">
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:18px;">${inputsPrecios}</div>
                        <button type="submit" class="btn-submit">Guardar Precios de Venta</button>
                    </form>
                </div>
                
                <div id="main-mi-stock" class="main-card">
                    <h3 style="margin:0 0 15px 0; font-size:19px; color:#00D2FF;">📦 Cargar Mi Inventario Propio</h3>
                    <div style="background: rgba(0, 210, 255, 0.08); border: 1px solid rgba(0, 210, 255, 0.25); padding: 15px; border-radius: 10px; text-align:center; margin-bottom:18px;">
                        <strong style="color: #00D2FF; font-size:26px;">${stockDisp.count}</strong><br><small style="color:var(--text-muted); text-transform:uppercase; font-size:11px;">Disponibles en mi Tienda</small>
                    </div>
                    <form action="/stock/cargar" method="POST">
                        <input type="hidden" name="plataforma" value="netflix">
                        <textarea name="correos_stock" class="input-classic" placeholder="correo@gmail.com:clave123..." rows="5" required></textarea>
                        <button type="submit" class="btn-submit">Subir Cuentas a mi Inventario</button>
                    </form>
                </div>

                <div id="main-dinero-clientes" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; color:#00D2FF;">💸 Asignar Dinero a Mis Clientes</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin-bottom:18px;">Transfiere de tu saldo (${formatearDinero(usuarioActual.creditos, usuarioActual.moneda)}) a las cuentas de tus clientes.</p>
                    <form action="/subadmin/asignar-dinero" method="POST">
                        <select name="cliente_id" class="input-classic" required>
                            <option value="" disabled selected>Selecciona a tu cliente...</option>
                            ${misClientesOptions}
                        </select>
                        <input type="number" step="0.01" name="cantidad" class="input-classic" placeholder="Monto a transferir en tu moneda (${usuarioActual.moneda})" required>
                        <button type="submit" class="btn-submit">Transferir Dinero</button>
                    </form>
                </div>`;
                
                panelesIzquierdosHtml += `
                <div id="action-mi-tienda" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">⚙️ Administración Tienda</h4><p style="font-size:12px; color:#cbd5e1; margin-top:6px;">Controla tus márgenes de ganancia por paquete.</p></div>
                <div id="action-mi-stock" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">📦 Inventario Privado</h4><p style="font-size:12px; color:#cbd5e1; margin-top:6px;">Gestiona las cuentas que vendes directamente a tus clientes.</p></div>
                <div id="action-dinero-clientes" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">💸 Billetera</h4><p style="font-size:12px; color:#cbd5e1; margin-top:6px;">Reparte tu saldo entre tus clientes registrados.</p></div>
                `;
            }

            if (esAdminPrincipal || esSubAdmin) {
                let listadoReservas = "";
                let reservasPendientes = reservas.filter(r => r.estado === 'Pendiente');
                if(reservasPendientes.length === 0) {
                    listadoReservas = "<p style='color:var(--text-muted); font-size:12px;'>No hay reservas pendientes en este momento.</p>";
                } else {
                    reservasPendientes.forEach(r => {
                        listadoReservas += `
                        <div style="background: rgba(0, 210, 255, 0.08); border: 1px solid rgba(0, 210, 255, 0.25); padding: 15px; border-radius: 10px; margin-bottom: 12px;">
                            <strong style="color: var(--accent);">🛒 PEDIDO MANUAL: ${r.cantidad} Cuentas</strong>
                            <p style="margin: 6px 0; font-size: 12px;"><strong>Cliente:</strong> ${r.cliente_nombre} | <strong>WhatsApp:</strong> ${formatearTelefono(r.telefono) || 'N/A'}</p>
                            <p style="margin: 4px 0 12px 0; font-size: 11px; color: var(--text-muted);"><strong>Fecha:</strong> ${r.fecha}</p>
                            <form action="/admin/completar-reserva" method="POST" style="margin:0;">
                                <input type="hidden" name="reserva_id" value="${r.id}">
                                <button type="submit" class="btn-submit" style="background: #25d366; width: auto; padding: 8px 16px; font-size:11px;">Marcar como Atendido</button>
                            </form>
                        </div>`;
                    });
                }

                panelesCentroHtml += `
                <div id="main-reservas-admin" class="main-card">
                    <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color: var(--accent);">🛒 Reservas (Proceso Manual)</h3>
                    <div style="max-height: 420px; overflow-y: auto; padding-right: 6px;">
                        ${listadoReservas}
                    </div>
                </div>`;
            }

            if (esAdminPrincipal || esSubAdmin) {
                let listadoGarantias = "";
                if(garantias.length === 0) listadoGarantias = "<p style='color:var(--text-muted); font-size:12px;'>No hay garantías activas.</p>";
                garantias.forEach(g => {
                    if(g.estado === 'Pendiente') {
                        listadoGarantias += `
                        <div style="background: rgba(229, 9, 20, 0.12); border: 1px solid #E50914; padding: 15px; border-radius: 10px; margin-bottom: 12px;">
                            <strong style="color: #E50914;">🔴 ALERTA: Caída de ${g.plataforma.toUpperCase()}</strong>
                            <p style="margin: 6px 0; font-size: 12px;"><strong>Cliente:</strong> ${g.cliente_nombre} | <strong>Motivo:</strong> ${g.motivo}</p>
                            <p style="margin: 4px 0 12px 0; font-size: 12px; color: #cbd5e1;"><strong>Detalles:</strong> ${g.detalles}</p>
                            <form action="/admin/resolver-garantia" method="POST" style="display:flex; gap:10px; margin:0;">
                                <input type="hidden" name="garantia_id" value="${g.id}">
                                <input type="text" name="reemplazo" class="input-classic" style="margin:0; padding:10px;" placeholder="Pega aquí la nueva cuenta..." required>
                                <button type="submit" class="btn-submit" style="background: #25d366; width: auto; padding: 0 18px;">Solucionar</button>
                            </form>
                        </div>`;
                    } else {
                        listadoGarantias += `
                        <div style="background: rgba(37, 211, 102, 0.08); border: 1px solid rgba(37, 211, 102, 0.4); padding: 12px; border-radius: 10px; margin-bottom: 10px;">
                            <strong style="color: #25d366; font-size:12px;">🟢 RESUELTO (${g.plataforma.toUpperCase()})</strong>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: #cbd5e1;"><strong>Cliente:</strong> ${g.cliente_nombre} | <strong>Entregada:</strong> ${g.reemplazo}</p>
                        </div>`;
                    }
                });

                panelesCentroHtml += `
                <div id="main-garantias-admin" class="main-card">
                    <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color: #E50914;">🚨 Central de Garantías</h3>
                    <div style="max-height: 420px; overflow-y: auto; padding-right: 6px;">
                        ${listadoGarantias}
                    </div>
                </div>`;
            }

            panelesIzquierdosHtml += `
            <div id="action-crear-user" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">👤 Crear Usuario</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Crea nuevas cuentas de clientes o subadministradores para darles acceso al panel SyncBox.</p></div>
            <div id="action-usuarios" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">📧 Asignar Correos</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Vincula los correos de las plataformas al perfil de un cliente.</p></div>
            <div id="action-base-datos" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🗄️ Base de Datos</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Consulta y administra todos los usuarios y correos registrados en el sistema.</p></div>
            <div id="action-garantias-admin" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🚨 Garantías</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Gestiona alertas de caídas y entrega reemplazos en tiempo real.</p></div>
            <div id="action-reservas-admin" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🛒 Reservas</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Revisa las peticiones manuales enviadas por tus clientes.</p></div>
            `;
            
            let tablaUsuariosHtml = "";
            let terminoBusqueda = (req.query.buscar_dueno || "").trim().toLowerCase();
            
            if (esAdminPrincipal || esSubAdmin) {
                let usuariosVisibles = esAdminPrincipal ? usuarios.filter(u => u.user !== 'admin' && u.user !== 'ruben' && u.user !== 'dueño') : usuarios.filter(u => u.creado_por === req.session.uid);
                
                if (usuariosVisibles.length === 0) {
                    tablaUsuariosHtml = "<tr><td colspan='5' style='padding: 20px; text-align: center; color: var(--text-muted);'>No hay usuarios registrados aún.</td></tr>";
                } else {
                    let renderRow = (u, isChild = false) => {
                        let correosDelUsuario = correos.filter(c => c.user_id === u.id);
                        let listaCorreosHtml = "";
                        if (correosDelUsuario.length > 0) {
                            listaCorreosHtml = correosDelUsuario.map(c => {
                                let esBuscado = terminoBusqueda && c.email.toLowerCase().includes(terminoBusqueda);
                                let estiloFondo = esBuscado ? "background: rgba(0, 210, 255, 0.2); border: 1px solid rgba(0, 210, 255, 0.4);" : "background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);";
                                return `<div style="display:flex; align-items:center; justify-content:space-between; ${estiloFondo} padding:6px 10px; border-radius:6px; font-size:11px; margin-bottom:4px;">
                                    <span>${c.email}</span>
                                    <form action="/admin/eliminar-correo" method="POST" style="margin:0;"><input type="hidden" name="correo_id" value="${c.id}"><button type="submit" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">✕</button></form>
                                </div>`;
                            }).join('');
                        } else { listaCorreosHtml = "<span style='color:var(--text-muted); font-size:11px; font-style: italic;'>Sin correos (Auto-eliminación 24h)</span>"; }

                        let selectorRol = "";
                        if (esAdminPrincipal) {
                            selectorRol = `
                            <form action="/admin/cambiar-rol" method="POST" style="display: flex; flex-direction: column; gap: 5px; margin:0;">
                                <input type="hidden" name="user_id" value="${u.id}">
                                <select name="nuevo_rol" style="background: #000; color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 5px; border-radius: 5px; font-size: 11px; outline: none; width: 100%;">
                                    <option value="Cliente" ${u.rol === 'Cliente' ? 'selected' : ''}>Cliente</option>
                                    <option value="Subadministrador" ${u.rol === 'Subadministrador' ? 'selected' : ''}>Subadmin</option>
                                </select>
                                <button type="submit" style="background: var(--accent); color: #000; border: none; border-radius: 5px; padding: 5px 8px; font-size: 10px; font-weight:700; cursor: pointer; width: 100%;">Cambiar</button>
                            </form>`;
                        } else {
                            selectorRol = `<small style="color:var(--text-muted); font-size:11px; display:block;">${u.rol}</small>`;
                        }

                        let idCreadorTexto = esAdminPrincipal && u.creado_por ? 'Subadmin ID: ' + u.creado_por : (u.creado_por ? 'Tú' : 'Registro Público');
                        let icon = u.rol === 'Subadministrador' ? '👑' : '👤';
                        let rowStyle = isChild ? 'background: rgba(0, 210, 255, 0.04);' : 'background: transparent;';
                        let paddingL = isChild ? '35px' : '15px';
                        let dateFormated = u.fecha_creacion ? u.fecha_creacion.split('.')[0] : 'Desconocida';
                        let telMostrado = u.telefono ? formatearTelefono(u.telefono) : 'N/A';

                        return `<tr style="${rowStyle}">
                            <td style="font-weight: 500; padding-left: ${paddingL}; position: relative;">
                                ${isChild ? '<div style="position:absolute; left: 18px; top: 0; bottom: 0; width: 2px; background: rgba(0, 210, 255, 0.3);"></div>' : ''}
                                <span style="${isChild ? 'color: #cbd5e1;' : 'color: #fff;'} font-size: 13px; font-weight:600;">${icon} ${u.user}</span>
                                <div style="margin-top: 5px; line-height: 1.4;">
                                    <small style="color:var(--accent); font-weight:600; font-size:10px; display:block;">🔑 Pass: ${u.pass}</small>
                                    <small style="color:var(--text-muted); font-size:10px; display:block;">📱 Tel: ${telMostrado}</small>
                                    <small style="color:var(--text-muted); font-size:10px; display:block;">📅 Reg: ${dateFormated}</small>
                                    ${esAdminPrincipal ? `<small style="color:#25d366; font-weight:600; font-size:10px; display:block;">🪙 Dinero: ${formatearDinero(u.creditos, u.moneda)}</small>
                                    <small style="color:#E50914; font-weight:600; font-size:10px; display:block;">🔴 Deuda: ${formatearDinero(u.deuda, u.moneda)}</small>` : ''}
                                </div>
                            </td>
                            <td style="width: 110px;">${selectorRol}</td>
                            <td style="width: 38%;"><div style="max-height: 120px; overflow-y: auto; padding-right: 6px;">${listaCorreosHtml}</div></td>
                            <td style="font-size: 11px; color: var(--text-muted);">${idCreadorTexto}</td>
                            <td style="text-align: center;">
                                <form action="/admin/eliminar-usuario" method="POST" onsubmit="return confirm('¿Seguro que deseas eliminar a este usuario? ${u.rol === 'Subadministrador' ? '¡ESTO BORRARÁ TAMBIÉN A TODOS SUS CLIENTES Y DATOS!' : ''}');" style="margin:0;">
                                    <input type="hidden" name="user_id" value="${u.id}">
                                    <button type="submit" style="background: rgba(229,9,20,0.12); border:1px solid #E50914; color:#E50914; padding:6px 10px; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='#E50914'; this.style.color='#fff';" onmouseout="this.style.background='rgba(229,9,20,0.12)'; this.style.color='#E50914';">Eliminar</button>
                                </form>
                            </td>
                        </tr>`;
                    };

                    if (esAdminPrincipal) {
                        let subadmins = usuariosVisibles.filter(u => u.rol === 'Subadministrador');
                        let otrosClientes = usuariosVisibles.filter(u => u.rol !== 'Subadministrador');

                        subadmins.forEach(sa => {
                            tablaUsuariosHtml += renderRow(sa, false);
                            let children = otrosClientes.filter(c => c.creado_por === sa.id);
                            if (children.length > 0) {
                                children.forEach(child => {
                                    tablaUsuariosHtml += renderRow(child, true);
                                });
                            }
                        });

                        let huerfanos = otrosClientes.filter(c => !c.creado_por || !subadmins.find(sa => sa.id === c.creado_por));
                        if (huerfanos.length > 0) {
                            tablaUsuariosHtml += `<tr><td colspan="5" style="background: rgba(0, 210, 255, 0.08); text-align: center; font-size: 11px; color: #00D2FF; font-weight: 700; padding: 10px; letter-spacing: 1px;">CLIENTES DIRECTOS / PÚBLICOS</td></tr>`;
                            huerfanos.forEach(h => tablaUsuariosHtml += renderRow(h, false));
                        }
                    } else {
                        usuariosVisibles.forEach(u => tablaUsuariosHtml += renderRow(u, false));
                    }
                }
            }

            let botonesContactoProveedor = "";
            if (esAdminPrincipal || esSubAdmin) {
                botonesContactoProveedor = `
                <div class="provider-contact" style="grid-template-columns: repeat(3, 1fr);">
                    <div class="contact-wrapper">
                        <span class="contact-label">Telegram</span>
                        <a href="https://t.me/SyncBox701" target="_blank" class="contact-btn telegram">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="#0088cc"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.14-.261.26-.536.26l.213-3.05 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.654-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z"/></svg> Chat
                        </a>
                    </div>
                    <div class="contact-wrapper">
                        <span class="contact-label">WhatsApp</span>
                        <a href="https://wa.me/573012964169" target="_blank" class="contact-btn whatsapp">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="#25d366"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg> WA
                        </a>
                    </div>
                    <div class="contact-wrapper">
                        <span class="contact-label">Grupo Oficial</span>
                        <a href="https://chat.whatsapp.com/HZ5XGqXqajW5V2UICj8A7g?s=cl&p=i&mlu=4&ilr=4" target="_blank" class="contact-btn whatsapp">
                            <svg viewBox="0 0 24 24" fill="#25d366" width="14" height="14"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm-2.025 15.34l-3.32-3.32 1.414-1.414 1.906 1.906 5.234-5.234 1.414 1.414-6.648 6.648z"/></svg> Unirse
                        </a>
                    </div>
                </div>`;
            } else if (esCliente && usuarioActual.creado_por) {
                const creador = usuarios.find(u => u.id === usuarioActual.creado_por);
                if (creador && creador.telefono) {
                    let telFormateado = formatearTelefono(creador.telefono);
                    let telefonoLimpio = telFormateado.replace(/\s+/g, '').replace('+', '');
                    botonesContactoProveedor = `
                    <div class="provider-contact" style="grid-template-columns: 1fr;">
                        <div class="contact-wrapper">
                            <span class="contact-label">Soporte Directo</span>
                            <a href="https://wa.me/${telefonoLimpio}" target="_blank" class="contact-btn whatsapp" style="width: 100%; height: 40px; font-size: 12px;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="#25d366"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg> WhatsApp Proveedor
                            </a>
                        </div>
                    </div>`;
                }
            }

            res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Panel - SyncBox</title>
                ${CSS_MODERNO}
            </head>
            <body>
                <div class="top-header">
                    <div class="brand-logo">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00D2FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 8px rgba(0,210,255,0.6));">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                            <line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg>
                        <strong>SYNC</strong>BOX
                    </div>
                    <div class="search-top"><input type="text" placeholder="Buscar en el sistema..."></div>
                </div>

                <div class="dashboard-grid">
                    
                    <div class="left-sidebar">
                        <div class="side-card" style="padding: 16px;">
                            <h4>📺 Plataformas</h4>
                            <div class="plat-mini-grid">
                                ${botonesPlataformaHtml}
                            </div>
                        </div>

                        ${panelesIzquierdosHtml}
                        
                        <div class="side-card" style="padding: 14px;">
                            <div class="user-pill" onclick="window.location='/logout'" title="Click para cerrar sesión">
                                <img src="https://i.pravatar.cc/150?u=${req.session.user}" alt="Avatar">
                                <div class="info">
                                    <strong>${req.session.user}</strong>
                                    <span>${req.session.rol} ${(esSubAdmin || esCliente) ? `• 🪙 ${formatearDinero(usuarioActual.creditos, usuarioActual.moneda)}` : ''}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="center-panel">
                        ${panelesCentroHtml}
                        
                        ${(esAdminPrincipal || esSubAdmin) ? `
                        <div id="main-crear-user" class="main-card">
                            <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color:#00D2FF;">👤 Crear Nuevo Usuario</h3>
                            <form action="/admin/crear" method="POST">
                                <input name="n" class="input-classic" placeholder="Nombre de Usuario" required>
                                <input name="c" class="input-classic" placeholder="Contraseña" required>
                                <input type="tel" name="telefono" class="input-classic" placeholder="WhatsApp (Ej: +52...)">
                                <select name="r" class="input-classic">
                                    <option value="Cliente">Cliente Normal</option>
                                    ${esAdminPrincipal ? '<option value="Subadministrador">Subadministrador</option>' : ''}
                                </select>
                                <button class="btn-submit">Guardar Usuario en DB</button>
                            </form>
                        </div>

                        <div id="main-usuarios" class="main-card">
                            <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color:#00D2FF;">📧 Asignación de Correos</h3>
                            <form action="/admin/asignar-correo" method="POST">
                                <select name="user_id" class="input-classic" required><option value="" disabled selected>Selecciona un usuario...</option>${clientesOpcionesHtml}</select>
                                <textarea name="email" class="input-classic" placeholder="Pega los correos separados por espacio o salto de línea" rows="5" required></textarea>
                                <button type="submit" class="btn-submit">Asignar Correos</button>
                            </form>
                        </div>

                        <div id="main-base-datos" class="main-card">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                                <h3 style="margin:0; font-size:19px; font-weight:600; color:#00D2FF;">🗄️ Base de Datos SyncBox</h3>
                                <form action="/dash" method="GET" style="display:flex; gap:8px; margin:0;">
                                    <input type="text" name="buscar_dueno" value="${terminoBusqueda}" class="input-classic" placeholder="Buscar correo..." style="margin:0; padding: 9px 14px; width: 200px;">
                                    <button type="submit" class="btn-submit" style="padding: 9px 18px; width:auto;">Buscar</button>
                                </form>
                            </div>
                            <div class="table-wrapper">
                                <table class="table-modern">
                                    <thead><tr>
                                        <th>Usuario</th>
                                        <th>Rol</th>
                                        <th style="width: 38%;">Correos Vinculados</th>
                                        <th>Creador</th>
                                        <th style="text-align:center;">Acción</th>
                                    </tr></thead>
                                    <tbody>${tablaUsuariosHtml}</tbody>
                                </table>
                            </div>
                        </div>` : ''}

                        <div class="iframe-container" id="visor-resultados">
                            <iframe name="marco_resultados" allowtransparency="true" style="width: 100%; height: 100%; border: none; background: transparent;"></iframe>
                        </div>
                    </div>

                    <div class="right-sidebar">
                        <div class="side-card">
                            <h4>🧭 Menú del Sistema</h4>
                            <div class="menu-list">
                                ${(esAdminPrincipal) ? `
                                <div class="menu-group-label">Inventario y Finanzas</div>
                                <button class="menu-btn-item" data-tab="stock-admin" onclick="openTab('stock-admin')">📦 Gestión de Stock</button>
                                <button class="menu-btn-item" data-tab="asignacion-manual" onclick="openTab('asignacion-manual')" style="color: #00D2FF;">🎯 Asignación Manual</button>
                                <button class="menu-btn-item" data-tab="dinero-admin" onclick="openTab('dinero-admin')">💰 Asignar Dinero</button>
                                <button class="menu-btn-item" data-tab="historial-compras" onclick="openTab('historial-compras')">🧾 Movimientos de Tienda</button>
                                ` : ''}

                                ${(esSubAdmin) ? `
                                <div class="menu-group-label">Mi Negocio</div>
                                <button class="menu-btn-item" data-tab="mi-tienda" onclick="openTab('mi-tienda')">⚙️ Precios de Venta</button>
                                <button class="menu-btn-item" data-tab="mi-stock" onclick="openTab('mi-stock')">📦 Mi Inventario</button>
                                <button class="menu-btn-item" data-tab="dinero-clientes" onclick="openTab('dinero-clientes')">💸 Billetera Clientes</button>
                                ` : ''}

                                ${(esSubAdmin || esCliente) ? `
                                <div class="menu-group-label">Tienda Automática</div>
                                <button class="menu-btn-item" data-tab="comprar-stock" onclick="openTab('comprar-stock')" style="color: #00D2FF;">🛒 Tienda de Cuentas</button>
                                <button class="menu-btn-item" data-tab="mis-compras" onclick="openTab('mis-compras')">🧾 Mis Compras</button>
                                ` : ''}

                                ${(esAdminPrincipal || esSubAdmin) ? `
                                <div class="menu-group-label">Gestión de Usuarios</div>
                                <button class="menu-btn-item" data-tab="crear-user" onclick="openTab('crear-user')">👤 Crear Usuario</button>
                                <button class="menu-btn-item" data-tab="usuarios" onclick="openTab('usuarios')">📧 Asignar Correos</button>
                                <button class="menu-btn-item" data-tab="base-datos" onclick="openTab('base-datos')">🗄️ Ver Base de Datos</button>
                                
                                <div class="menu-group-label">Soporte y Pedidos</div>
                                <button class="menu-btn-item" data-tab="reservas-admin" onclick="openTab('reservas-admin')" style="color: var(--accent);">🛒 Reservas Manuales</button>
                                <button class="menu-btn-item" data-tab="garantias-admin" onclick="openTab('garantias-admin')" style="color: #E50914;">🚨 Alertas y Garantías</button>
                                ` : ''}
                            </div>

                            ${botonesContactoProveedor ? `<div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08);">${botonesContactoProveedor}</div>` : ''}
                        </div>

                        ${esAdminPrincipal ? `
                        <div class="side-card">
                            <h4>⚡ Actividad Reciente</h4>
                            <div class="activity-list">${actividadesHtml}</div>
                        </div>` : ''}
                    </div>
                </div>
            </body>
            </html>
            `);
        } catch (err) { 
            console.error(err);
            res.send(`<script>alert('Error crítico de servidor: ${err.message}'); window.location='/';</script>`); 
        }
    }
});

async function buscarEnBuzonImap(correoBuzon, correoIngresado, plataforma, partes, accion) {
    const passwordSeleccionado = CUENTAS_GMAIL_MAP[correoBuzon];
    if (!passwordSeleccionado) return null;

    const config = { imap: { user: correoBuzon, password: passwordSeleccionado, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 15000 } };
    let connection = null;

    try {
        connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        
        let searchResults = await connection.search([['X-GM-RAW', `"${correoIngresado}"`]], { bodies: ['HEADER.FIELDS (DATE)'] });
        
        if (searchResults.length === 0) {
            searchResults = await connection.search([['TEXT', correoIngresado]], { bodies: ['HEADER.FIELDS (DATE)'] });
        }

        if (searchResults.length === 0 && partes && partes.length > 0) {
            searchResults = await connection.search([['TEXT', partes[0]]], { bodies: ['HEADER.FIELDS (DATE)'] });
        }

        let messages = [];
        let mail = null;

        if (searchResults.length > 0) {
            searchResults.sort((a, b) => {
                let dateA = new Date(a.attributes.date || 0).getTime();
                let dateB = new Date(b.attributes.date || 0).getTime();
                if (dateB !== dateA) { return dateB - dateA; }
                return b.attributes.uid - a.attributes.uid;
            });

            let latestUid = searchResults[0].attributes.uid; 
            
            let fetchedMsg = await connection.search([['UID', latestUid]], { bodies: [''], struct: true });
            if (fetchedMsg.length > 0) {
                messages = fetchedMsg;
                mail = await simpleParser(messages[0].parts.find(p => p.which === '').body);
            }
        }
        
        connection.end();
        if (messages.length > 0 && mail) { return { messages, mail, buzón: correoBuzon }; }
        return null;

    } catch (err) {
        console.log(`⚠ Advertencia IMAP (${correoBuzon}):`, err.message);
        if (connection) connection.end();
        return null;
    }
}

app.post('/buscar', async (req, res) => {
    const { email_search, accion, plataforma } = req.body;
    
    const cssIframe = `<style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        body, html { 
            font-family: 'Inter', sans-serif !important; 
            background: transparent !important; 
            margin: 0; padding: 0; 
        } 
        
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(0, 210, 255, 0.5); border-radius: 10px; }

        .magic-email-wrapper table, .magic-email-wrapper td, .magic-email-wrapper tr, .magic-email-wrapper body, .magic-email-wrapper div {
            background-color: transparent !important; background: transparent !important; border: none !important;
        }
        
        .magic-email-wrapper * {
            font-family: 'Inter', sans-serif !important;
            color: #f8fafc !important;
            line-height: 1.6 !important;
            box-shadow: none !important;
        }

        .magic-email-wrapper h1, 
        .magic-email-wrapper h2, 
        .magic-email-wrapper h3, 
        .magic-email-wrapper strong {
            color: #00D2FF !important; 
            text-shadow: 0 0 8px rgba(0, 210, 255, 0.8), 0 0 15px rgba(0, 210, 255, 0.5) !important;
        }
        
        .magic-email-wrapper a {
            background-color: #E50914 !important;
            color: #fff !important;
            padding: 10px 20px !important;
            border-radius: 4px !important;
            display: inline-block !important;
            text-decoration: none !important;
            text-shadow: none !important;
            font-weight: bold !important;
        }

        .magic-email-wrapper p, 
        .magic-email-wrapper span {
            text-shadow: 0 0 5px rgba(255, 255, 255, 0.3) !important;
            font-size: 15px !important;
        }

        .magic-email-wrapper img {
            filter: drop-shadow(0 0 15px rgba(229, 9, 20, 0.9)) !important;
            border-radius: 4px !important;
            max-width: 100% !important;
        }

        .magic-email-wrapper { 
            width: 100%; 
            display: flex;
            justify-content: center;
            padding: 20px 0;
        }
        
        .magic-email-wrapper > * {
            max-width: 600px;
            width: 100%;
        }
    </style>`;

    try {
        let correoIngresado = (email_search || "").trim().toLowerCase();
        
        const esAdminPrincipal = (req.session.user === 'admin' || req.session.user === 'ruben');
        const esCliente = (req.session.rol === 'Cliente' || req.session.rol === 'Subadministrador');

        if (esCliente && !esAdminPrincipal) {
            const tieneAcceso = await dbGet("SELECT id FROM correos WHERE user_id = ? AND email = ?", [req.session.uid, correoIngresado]);
            if (!tieneAcceso) {
                return res.send(`${cssIframe}<div style="text-align:center; padding:40px; background: transparent;"><h2 style="color:var(--accent);">⛔ Acceso Denegado</h2><p>No tienes este correo asignado a tu cuenta. Solicítalo al proveedor.</p></div>`);
            }
        } else if (!esAdminPrincipal) {
            const dueñocuenta = await dbGet("SELECT c.user_id, u.user, u.creado_por FROM correos c JOIN usuarios u ON c.user_id = u.id WHERE c.email = ?", [correoIngresado]);
            if (dueñocuenta) {
                const esPropia = (dueñocuenta.user_id === req.session.uid);
                const esDeMiCliente = (dueñocuenta.creado_por === req.session.uid);
                if (!esPropia && !esDeMiCliente) {
                    return res.send(`${cssIframe}<div style="text-align:center; padding:40px; background: transparent;"><h2 style="color:var(--accent);">⛔ Acceso Denegado</h2><p>El correo <strong>${correoIngresado}</strong> le pertenece al cliente <strong>${dueñocuenta.user}</strong></p></div>`);
                }
            } else {
                return res.send(`${cssIframe}<div style="text-align:center; padding:40px; background: transparent;"><h2 style="color:var(--accent);">⛔ Acceso Denegado</h2><p>No tienes autorización en la base de datos para consultar este correo.</p></div>`);
            }
        }

        let partes = correoIngresado.split('@');
        let buzonesAbuscar = ['darciogarces@gmail.com']; 
        let resultadoExitoso = null;

        try {
            const promesas = buzonesAbuscar.map(buzon => buscarEnBuzonImap(buzon, correoIngresado, plataforma, partes, accion));
            const resultados = await Promise.all(promesas);
            resultadoExitoso = resultados.find(res => res !== null);
        } catch (error) { console.error("Error en búsqueda:", error); }

        if (!resultadoExitoso) { 
            return res.send(`${cssIframe}<div style="text-align:center; padding:40px; background: transparent;">
                <h2 style="color:#f8fafc; font-weight:300; text-shadow: 0 0 10px rgba(0, 210, 255, 0.6);">Mensaje no encontrado</h2>
                <p>No hay correos recientes para esa opción en el buzón: <br><strong style="color:#00D2FF;">${email_search}</strong></p>
            </div>`); 
        }

        const { mail } = resultadoExitoso;
        const textoBruto = mail.text || String(mail.html).replace(/<[^>]*>?/gm, ' ') || "";
        const textoCorreo = textoBruto.toLowerCase();

        // 🚀 LÓGICA DE DETECCIÓN INTELIGENTE DE PAÍS
        if (accion === 'pais') {
            let paisDetectado = null;
            
            const codigosPais = {
                'US': '🇺🇸 Estados Unidos', 'CO': '🇨🇴 Colombia', 'BR': '🇧🇷 Brasil',
                'JP': '🇯🇵 Japón', 'MX': '🇲🇽 México', 'ES': '🇪🇸 España',
                'AR': '🇦🇷 Argentina', 'CL': '🇨🇱 Chile', 'PE': '🇵🇪 Perú',
                'EC': '🇪🇨 Ecuador', 'VE': '🇻🇪 Venezuela', 'UY': '🇺🇾 Uruguay',
                'PY': '🇵🇾 Paraguay', 'BO': '🇧🇴 Bolivia', 'CR': '🇨🇷 Costa Rica',
                'PA': '🇵🇦 Panamá', 'DO': '🇩🇴 República Dominicana', 'GT': '🇬🇹 Guatemala',
                'HN': '🇭🇳 Honduras', 'SV': '🇸🇻 El Salvador', 'NI': '🇳🇮 Nicaragua',
                'PR': '🇵🇷 Puerto Rico', 'CA': '🇨🇦 Canadá', 'GB': '🇬🇧 Reino Unido',
                'FR': '🇫🇷 Francia', 'DE': '🇩🇪 Alemania', 'IT': '🇮🇹 Italia',
                'PT': '🇵🇹 Portugal', 'TR': '🇹🇷 Turquía', 'IN': '🇮🇳 India',
                'ZA': '🇿🇦 Sudáfrica', 'KR': '🇰🇷 Corea del Sur', 'AU': '🇦🇺 Australia',
                'NL': '🇳🇱 Países Bajos', 'SE': '🇸🇪 Suecia', 'NO': '🇳🇴 Noruega',
                'DK': '🇩🇰 Dinamarca', 'FI': '🇫🇮 Finlandia', 'PL': '🇵🇱 Polonia',
                'CH': '🇨🇭 Suiza', 'AT': '🇦🇹 Austria', 'BE': '🇧🇪 Bélgica',
                'IE': '🇮🇪 Irlanda', 'NZ': '🇳🇿 Nueva Zelanda', 'SG': '🇸🇬 Singapur'
            };

            let matchSrc = textoBruto.match(/_([A-Z]{2})_EVO/);
            if (matchSrc && matchSrc[1]) {
                let codigo = matchSrc[1].toUpperCase();
                paisDetectado = codigosPais[codigo] || ("🌍 Código de País: " + codigo);
            }

            if (!paisDetectado) {
                const reglasPais = [
                    { id: "🇺🇸 Estados Unidos", keys: ['ee. uu.', 'usa', 'united states', 'los gatos', 'california', '1-866-', '1-844-', '1-800-', '1-888-', '1-877-'] },
                    { id: "🇨🇴 Colombia", keys: ['colombia', 'bogota', 'bogotá', '018000', '01 8000'] },
                    { id: "🇧🇷 Brasil", keys: ['brasil', 'brazil', 'são paulo', '0800-'] },
                    { id: "🇯🇵 Japón", keys: ['japan', 'japón', 'tokyo', '合同会社'] },
                    { id: "🇲🇽 México", keys: ['méxico', 'mexico', 'cdmx', '01 800'] },
                    { id: "🇪🇸 España", keys: ['españa', 'spain', 'madrid', '900 '] },
                    { id: "🇦🇷 Argentina", keys: ['argentina', 'buenos aires'] },
                    { id: "🇨🇱 Chile", keys: ['chile', 'santiago'] },
                    { id: "🇵🇪 Perú", keys: ['perú', 'peru', 'lima'] },
                    { id: "🇪🇨 Ecuador", keys: ['ecuador', 'quito', 'guayaquil'] }
                ];
                for (let regla of reglasPais) { 
                    if (regla.keys.some(k => textoCorreo.includes(k))) { 
                        paisDetectado = regla.id; 
                        break; 
                    } 
                }
            }

            let htmlRes = paisDetectado 
                ? `<div style="font-size: 32px; font-weight: 300; margin: 20px auto; padding: 25px; background:transparent; display:inline-block; color:#00D2FF; text-shadow: 0 0 15px rgba(0, 210, 255, 0.8);">${paisDetectado}</div>` 
                : `<div style="margin: 20px auto; padding: 25px; background:transparent; display:inline-block;"><h3 style="color:#00D2FF; margin:0; font-weight:300;">País no detectado en el mensaje</h3></div>`;
            return res.send(`${cssIframe}<div style="text-align:center; padding: 20px; background: transparent;"><h2>Análisis de Origen</h2><p style="color: #94a3b8;">${email_search}</p>${htmlRes}</div>`);
        }

        if (accion === 'ip') {
            const ipsEncontradas = textoCorreo.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g);
            let ipUnicas = ipsEncontradas ? [...new Set(ipsEncontradas)].filter(ip => !ip.startsWith('127.') && !ip.startsWith('10.') && !ip.startsWith('192.168.')) : [];
            let ipContenido = ipUnicas.length > 0 ? ipUnicas.map(ip => `<div style="font-size: 24px; font-weight:300; color:#00D2FF; text-shadow: 0 0 10px rgba(0,210,255,0.6); margin:10px 0; letter-spacing: 1px;">${ip}</div>`).join('') : `<div style="font-size: 15px; color:#94a3b8; margin: 20px 0;">No se detectó ninguna IP pública en el texto.</div>`;
            return res.send(`${cssIframe}<div style="text-align:center; padding: 20px; background: transparent;"><h2>Escáner de Direcciones IP</h2><p style="color: #94a3b8;">${email_search}</p><div style="margin: 20px auto; padding: 25px; background:transparent; display:inline-block;">${ipContenido}</div></div>`);
        }

        if (/\b\d{4,6}\b/.test(textoBruto) && plataforma === 'netflix') {
            try { await dbRun("INSERT INTO registro_codigos (user, email_buscado) VALUES (?, ?)", [req.session.user, email_search.trim()]); } catch(err) {}
        }
        
        res.send(`${cssIframe}
            <div class="magic-email-wrapper">
                ${mail.html ? mail.html : `<pre style="font-family:'Inter', sans-serif; white-space:pre-wrap; word-wrap:break-word; color:#fff; padding: 20px;">${mail.text}</pre>`}
            </div>
        `);

    } catch (err) { res.send(`${cssIframe}<h2 style="color:#00D2FF; text-align:center; padding:20px; font-weight:300;">Error en la Búsqueda</h2>`); }
});

app.listen(10000, () => {
    console.log("🚀 SISTEMA CENTRAL INICIADO EN EL PUERTO 10000");
});
