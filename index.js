const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const https = require('https');
const crypto = require('crypto');
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

// 📌 NÚMEROS OFICIALES DE NOTIFICACIÓN OBLIGATORIA EN COMPRAS
const NUMERO_ADMIN_PRINCIPAL = '573012964169';
const NUMERO_ASISTENTE = '573113092659'; // +57 311 3092659

// 📌 CONFIGURACIÓN BASE API GHOULFLIX
const GHOULFLIX_BASE_URL = 'https://ghoulflix.com';
// Credenciales privadas del servidor. Nunca servir este archivo como recurso estático.
const GHOULFLIX_SERVER_LOGIN = Object.freeze({
    login_id: process.env.GHOULFLIX_LOGIN_ID || 'tridentbox',
    email: 'box@ghoulflix.com',
    password: process.env.GHOULFLIX_PASSWORD || 'syncbox@1432'
});
let ghoulflixLoginPending = null;
let ghoulflixServerToken = '';


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

// 📌 Validador estricto: Verifica que el número tenga obligatoriamente + y código de país
function validarTelefonoConCodigo(telefono) {
    if (!telefono) return false;
    const limpio = telefono.toString().replace(/\s+/g, '').trim();
    return /^\+[1-9]\d{7,14}$/.test(limpio);
}

// 📌 Función para normalizar teléfonos antiguos que ya estaban en base de datos
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
    return 'MXN';
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
app.use(express.json());
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
    db.run("ALTER TABLE usuarios ADD COLUMN api_token TEXT", (err) => {});
    
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

    // Tabla para guardar credenciales de conexión al servidor de códigos
    db.run("CREATE TABLE IF NOT EXISTS config_ghoulflix (id INTEGER PRIMARY KEY CHECK (id = 1), login_id TEXT, password TEXT, token TEXT, updated_at DATETIME DEFAULT (datetime('now', 'localtime')))");
    db.run("INSERT OR IGNORE INTO config_ghoulflix (id, login_id, password, token) VALUES (1, '', '', '')");

    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por, moneda) VALUES ('admin', '14032021', 'Administrador', NULL, 'MXN')", (err) => {});
    db.run("UPDATE usuarios SET user = 'admin', pass = '14032021' WHERE user = 'dueño'", (err) => {});

    // 🚀 ACTUALIZAR TODOS LOS TELÉFONOS EXISTENTES AGREGANDO +52 SI NO TIENEN EL +
    db.run("UPDATE usuarios SET telefono = '+' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) LIKE '52__________'", (err) => {});
    db.run("UPDATE usuarios SET telefono = '+52' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) NOT LIKE '+%'", (err) => {});
    db.run("UPDATE reservas SET telefono = '+52' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) NOT LIKE '+%'", (err) => {});

    db.run("ALTER TABLE stock_cuentas ADD COLUMN propietario_id INTEGER DEFAULT 1", (err) => {});
    db.run("CREATE TABLE IF NOT EXISTS precios_subadmin (id INTEGER PRIMARY KEY AUTOINCREMENT, subadmin_id INTEGER, paquete INTEGER, precio REAL, UNIQUE(subadmin_id, paquete))");
    db.run("CREATE TABLE IF NOT EXISTS historial_dinero (id INTEGER PRIMARY KEY AUTOINCREMENT, emisor_id INTEGER, receptor_id INTEGER, monto REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
});

// =========================================================================
// 🌐 FUNCIONES DE CONEXIÓN A LA API DE GHOULFLIX (https://ghoulflix.com)
// =========================================================================
function peticionHttpsJson(urlStr, method, headers, bodyObj, signal) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlStr);
        const payload = bodyObj ? JSON.stringify(bodyObj) : null;
        const reqOptions = {
            signal,
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers
            },
            timeout: 65000
        };

        const req = https.request(reqOptions, (res) => {
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(rawData);
                    resolve({ statusCode: res.statusCode, data: parsed, headers: res.headers });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: null, raw: rawData });
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(new Error('Tiempo de espera agotado al conectar con Ghoulflix API')); });
        if (payload) req.write(payload);
        req.end();
    });
}

async function realizarLoginGhoulflixApi() {
    const cfg = GHOULFLIX_SERVER_LOGIN;
    if (!cfg.login_id || !cfg.password) {
        return { success: false, error: 'Credenciales del servidor de códigos no configuradas en el panel.' };
    }
    try {
        const resp = await peticionHttpsJson(`${GHOULFLIX_BASE_URL}/api/auth/login`, 'POST', {}, {
            login_id: cfg.login_id,
            password: cfg.password
        });
        console.log('[Servidor de códigos] Login HTTP:', resp.statusCode, '| autenticado:', !!(resp.data && resp.data.success && resp.data.token));
        if (resp.data && resp.data.success && resp.data.token) {
            ghoulflixServerToken = resp.data.token;
            return { success: true, token: resp.data.token };
        }
        return { success: false, error: (resp.data && resp.data.error) ? resp.data.error : 'No se pudo iniciar sesión en el servidor de códigos.' };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function loginEnGhoulflixApi() {
    if (!ghoulflixLoginPending) {
        ghoulflixLoginPending = realizarLoginGhoulflixApi().finally(() => { ghoulflixLoginPending = null; });
    }
    return ghoulflixLoginPending;
}

async function consultarCodigoGhoulflixApi(email, code_type, signal) {
    const cfg = GHOULFLIX_SERVER_LOGIN;
    let token = ghoulflixServerToken;

    if (!token && cfg && cfg.login_id && cfg.password) {
        const loginRes = await loginEnGhoulflixApi();
        if (!loginRes.success) return { success: false, code: null, link: null, response_time_ms: 0, error: loginRes.error };
        token = loginRes.token;
    }

    if (!token) {
        return { success: false, code: null, link: null, response_time_ms: 0, error: 'Token o credenciales del servidor de códigos no configurados.' };
    }

    try {
        let resp = await peticionHttpsJson(`${GHOULFLIX_BASE_URL}/api/customer/fetch-code`, 'POST', {
            'Authorization': `Bearer ${token}`
        }, {
            email: email.trim().toLowerCase(),
            code_type: code_type
        }, signal);

        // Si el token expiró (401 o error de autenticación), re-autenticar automáticamente 1 vez
        if ((resp.statusCode === 401 || (resp.data && resp.data.error && /authentication required|invalid token|token expired|expired token/i.test(resp.data.error))) && cfg.login_id && cfg.password) {
            const relogin = await loginEnGhoulflixApi();
            if (relogin.success) {
                resp = await peticionHttpsJson(`${GHOULFLIX_BASE_URL}/api/customer/fetch-code`, 'POST', {
                    'Authorization': `Bearer ${relogin.token}`
                }, {
                    email: email.trim().toLowerCase(),
                    code_type: code_type
                }, signal);
            }
        }

        console.log('[Servidor de códigos] Consulta HTTP:', resp.statusCode, '| resultado:', resp.data && resp.data.success && (resp.data.code || resp.data.link) ? 'disponible' : 'sin resultado');
        if ([401, 403, 422, 429].includes(resp.statusCode) || (resp.data && /authentication required|not assigned|not in your|access denied|suspended|disabled|account expired|too many requests|rate limit/i.test(resp.data.error || ''))) {
            return { success: false, source_error: true, terminal: true, error: traducirErrorCodigo(resp.data && resp.data.error, resp.statusCode) };
        }
        if (resp.statusCode >= 200 && resp.statusCode < 300 && resp.data) return resp.data;
        return { success: false, code: null, link: null, response_time_ms: 0, error: `Error HTTP ${resp.statusCode} desdel servidor de códigos.` };
    } catch (err) {
        return { success: false, code: null, link: null, response_time_ms: 0, error: err.message };
    }
}

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
        padding: 12px 14px; border-radius: 10px; font-size: 11px; font-weight: 600; 
        color: var(--text-main); cursor: pointer; transition: 0.25s; text-transform: uppercase; 
        letter-spacing: 0.5px; text-align: center; box-sizing: border-box;
    }
    .action-btn-pill:hover { background: rgba(0, 210, 255, 0.14); border-color: var(--accent); transform: translateY(-1px); }
    
    .api-grid-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 4px; }
    
    .search-input-large { 
        width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); 
        padding: 16px 20px; border-radius: 10px; font-size: 14px; margin-top: 8px; 
        color: var(--text-main); outline: none; box-sizing: border-box; font-family: 'Inter', sans-serif; transition: 0.3s; 
    }
    .search-input-large:focus { border-color: var(--accent); box-shadow: 0 0 20px rgba(0,210,255,0.25); }
    
    .iframe-container { display: none; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; height: 560px; width: 100%; overflow: hidden; box-shadow: var(--shadow-elegant); }
    
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

    function filtrarSelectorUsuarios(inputId, selectId) {
        const input = document.getElementById(inputId);
        const select = document.getElementById(selectId);
        if (!input || !select) return;
        const filtro = input.value.toLowerCase().trim();
        let primerVisible = null;
        for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i];
            if (opt.disabled) continue;
            const texto = opt.text.toLowerCase();
            if (texto.includes(filtro)) {
                opt.style.display = '';
                if (!primerVisible) primerVisible = opt;
            } else {
                opt.style.display = 'none';
            }
        }
        if (filtro && primerVisible) {
            select.value = primerVisible.value;
        }
    }

    let lookupBusyUntil = 0;
    window.addEventListener('message', function(event) { if (event.origin === location.origin && event.data === 'lookup-complete') lookupBusyUntil = 0; });
    function triggerAction(platKey, actionName) {
        if (Date.now() < lookupBusyUntil) return;
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
            if(actionName === 'reset_link') {
                if(!confirm('⚠️ ATENCIÓN: Esta opción enviará una nueva solicitud de restablecimiento de contraseña a la cuenta de Netflix. ¿Deseas continuar?')) {
                    return;
                }
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
            if (['signin_6digit','signin_4digit','household','reset_link'].includes(actionName)) lookupBusyUntil = Date.now() + 65000;
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

// =========================================================================
// 🔑 ENDPOINTS DE API OFICIAL (/api/auth/login y /api/customer/fetch-code)
// =========================================================================
app.post('/api/auth/login', async (req, res) => {
    const login_id = (req.body.login_id || '').toString().trim();
    const password = (req.body.password || '').toString().trim();

    if (!login_id || !password) {
        return res.status(422).json({ success: false, error: 'login_id and password are required.' });
    }

    try {
        let row = await dbGet("SELECT * FROM usuarios WHERE user = ? AND pass = ?", [login_id, password]);
        if (!row && login_id === 'admin' && password === '14032021') {
            row = await dbGet("SELECT * FROM usuarios WHERE user = 'admin'");
        }
        if (!row) {
            return res.status(401).json({ success: false, error: 'Authentication required. Invalid credentials.' });
        }

        const token = crypto.randomBytes(28).toString('hex');
        await dbRun("UPDATE usuarios SET api_token = ? WHERE id = ?", [token, row.id]);

        req.session.uid = row.id;
        req.session.user = row.user;
        req.session.rol = row.rol;

        return res.json({ success: true, token: token });
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Internal server error.' });
    }
});

app.post('/api/customer/fetch-code', async (req, res) => {
    const startMs = Date.now();
    const { email, code_type } = req.body || {};
    const validTypes = ['signin_6digit', 'signin_4digit', 'household', 'reset_link'];

    if (!email || !code_type || typeof email !== 'string' || !validTypes.includes(code_type)) {
        return res.status(422).json({
            success: false,
            code: null,
            link: null,
            response_time_ms: Date.now() - startMs,
            error: 'HTTP 422: Check required JSON fields (email, code_type) and their types.'
        });
    }

    try {
        // Prioridad: Cookie de sesión activa primero, luego Bearer Token (según especificación)
        let currentUser = null;
        if (req.session && req.session.uid) {
            currentUser = await dbGet("SELECT * FROM usuarios WHERE id = ?", [req.session.uid]);
        }
        if (!currentUser) {
            const authHeader = req.headers['authorization'] || '';
            if (authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7).trim();
                if (token) {
                    currentUser = await dbGet("SELECT * FROM usuarios WHERE api_token = ?", [token]);
                }
            }
        }

        if (!currentUser) {
            return res.status(401).json({
                success: false,
                code: null,
                link: null,
                response_time_ms: Date.now() - startMs,
                error: 'Authentication required. Please sign in to fetch codes.'
            });
        }

        const correoLimpio = email.trim().toLowerCase();
        const esAdmin = (currentUser.rol === 'Administrador' || currentUser.user === 'admin' || currentUser.user === 'ruben');

        if (!esAdmin && !['Cliente', 'Subadministrador'].includes(currentUser.rol)) return res.status(403).json({ success: false, error: 'Perfil no autorizado.' });
        if (!esAdmin) {
            if (currentUser.rol === 'Cliente') {
                const asignado = await dbGet("SELECT id FROM correos WHERE user_id = ? AND email = ?", [currentUser.id, correoLimpio]);
                if (!asignado) {
                    return res.status(403).json({
                        success: false,
                        code: null,
                        link: null,
                        response_time_ms: Date.now() - startMs,
                        error: 'Not assigned to your profile.'
                    });
                }
            } else if (currentUser.rol === 'Subadministrador') {
                const enPool = await dbGet(`
                    SELECT c.id FROM correos c 
                    JOIN usuarios u ON c.user_id = u.id 
                    WHERE c.email = ? AND (c.user_id = ? OR u.creado_por = ?)
                `, [correoLimpio, currentUser.id, currentUser.id]);
                const enStockPropio = await dbGet("SELECT id FROM stock_cuentas WHERE email = ? AND propietario_id = ?", [correoLimpio, currentUser.id]);
                if (!enPool && !enStockPropio) {
                    return res.status(403).json({
                        success: false,
                        code: null,
                        link: null,
                        response_time_ms: Date.now() - startMs,
                        error: 'Not in your subadmin pool.'
                    });
                }
            }
        }

        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', disconnected);
        let cutoff;
        let resultado;
        try {
            resultado = await Promise.race([
                buscarCodigoEnAmbasFuentes(correoLimpio, code_type, controller.signal),
                new Promise(resolve => { cutoff = setTimeout(() => {
                    controller.abort();
                    resolve({ success: false, code: null, link: null, sources: [], error: 'Tiempo de búsqueda agotado.' });
                }, 65000); })
            ]);
        } finally {
            clearTimeout(cutoff); controller.abort();
            res.removeListener('close', disconnected);
        }
        if (res.destroyed) return;
        if (resultado.success) {
            dbRun("INSERT INTO registro_codigos (user, email_buscado) VALUES (?, ?)", [currentUser.user, correoLimpio]).catch(() => {});
        }
        console.log('[Busqueda] Consulta finalizada:', resultado.success ? 'resultado disponible' : 'sin resultado');
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ ...resultado, response_time_ms: Date.now() - startMs });

    } catch (err) {
        return res.status(500).json({
            success: false,
            code: null,
            link: null,
            response_time_ms: Date.now() - startMs,
            error: 'Internal server error.'
        });
    }
});

// Middleware de protección de rutas web
app.use(async (req, res, next) => {
    const rutasAbiertas = ['/', '/login', '/logout', '/registrar-cliente', '/api/auth/login', '/api/customer/fetch-code'];
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
            <form action="/registrar-cliente" method="POST" onsubmit="
                const tel = this.telefono.value.replace(/\\s+/g, '');
                if(!/^\\+[1-9]\\d{7,14}$/.test(tel)) {
                    alert('⛔ OBLIGATORIO: Debes incluir el signo + seguido del código de tu país (Ejemplo: +521234567890 o +573001234567).');
                    this.telefono.focus();
                    return false;
                }
                this.telefono.value = tel;
                return true;
            ">
                <div class="input-group"><input type="text" name="user" placeholder="Elige tu Usuario" required></div>
                <div class="input-group">
                    <input type="tel" name="telefono" placeholder="WhatsApp con + y código (Ej: +52...)" pattern="^\\+[1-9]\\d{7,14}$" title="Obligatorio incluir el signo + y el código de tu país (Ej: +52... o +57...)" required>
                    <small style="display:block; text-align:left; color:#00D2FF; font-size:11px; margin-top:5px;">* Obligatorio poner el <b>+</b> y código de país (Ej: +52 o +57)</small>
                </div>
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
    const telLimpio = (telefono || '').toString().replace(/\s+/g, '').trim();

    if (!validarTelefonoConCodigo(telLimpio)) {
        return res.send("<script>alert('⛔ ERROR OBLIGATORIO: Debes colocar el signo + seguido del código de tu país (Ejemplo: +521234567890 o +573001234567). No se permite registrar sin código de país.'); window.location='/?mode=registro';</script>");
    }

    try {
        const monedaDetectada = obtenerMonedaPorTelefono(telLimpio);

        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono, moneda) VALUES (?, ?, 'Cliente', NULL, ?, ?)", [user.trim(), pass, telLimpio, monedaDetectada]);
        
        const fechaObj = new Date();
        const fechaHoraLocal = fechaObj.toLocaleString('es-CO', { timeZone: 'America/Bogota' });

        const mensajeWhatsApp = `¡Hola! Me acabo de registrar en SyncBox.\n\n👤 *Usuario:* ${user.trim()}\n🔑 *Contraseña:* ${pass}\n📱 *Número:* ${telLimpio}\n📅 *Fecha y Hora:* ${fechaHoraLocal}\n\n¡Me gustaría unirme al grupo y conocer los enlaces oficiales!`;
        const linkRedireccion = `https://api.whatsapp.com/send?phone=${NUMERO_ADMIN_PRINCIPAL}&text=${encodeURIComponent(mensajeWhatsApp)}`;

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

// Ruta para guardar configuración del servidor de códigos API desde el panel de Admin
app.post('/admin/config-ghoulflix', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    const { login_id, password, token_manual } = req.body;
    try {
        await dbRun("UPDATE config_ghoulflix SET login_id = ?, password = ?, token = ?, updated_at = datetime('now', 'localtime') WHERE id = 1", [
            (login_id || '').trim(),
            (password || '').trim(),
            (token_manual || '').trim()
        ]);

        if (login_id && password && !token_manual) {
            const loginRes = await loginEnGhoulflixApi();
            if (loginRes.success) {
                return res.send("<script>alert('✅ Conectado exitosamente al servidor de códigos. Token obtenido y guardado.'); window.location='/dash';</script>");
            } else {
                return res.send(`<script>alert('⚠️ Credenciales guardadas, pero el servidor respondió: ${loginRes.error}'); window.location='/dash';</script>`);
            }
        }
        res.send("<script>alert('✅ Configuración de API de códigos actualizada correctamente.'); window.location='/dash';</script>");
    } catch (e) {
        res.redirect('/dash');
    }
});

app.post('/bot/reservar', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    const telLimpio = (req.body.telefono || '').toString().replace(/\s+/g, '').trim();
    if (!validarTelefonoConCodigo(telLimpio)) {
        return res.send("<script>alert('⛔ Debes colocar el signo + y el código de tu país en el número de WhatsApp (Ej: +52... o +57...).'); window.location='/dash';</script>");
    }
    try {
        await dbRun("INSERT INTO reservas (user_id, cantidad, telefono) VALUES (?, ?, ?)", [req.session.uid, req.body.cantidad, telLimpio]);
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
    const telLimpio = (telefono || '').toString().replace(/\s+/g, '').trim();

    if (!validarTelefonoConCodigo(telLimpio)) {
        return res.send("<script>alert('⛔ OBLIGATORIO: Debes ingresar el número con el signo + y el código del país (Ej: +52... o +57...).'); window.location='/dash';</script>");
    }

    try {
        const monedaDetectada = obtenerMonedaPorTelefono(telLimpio);

        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono, moneda) VALUES (?, ?, ?, ?, ?, ?)", [n.trim(), c.trim(), r, req.session.uid, telLimpio, monedaDetectada]);
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

// 🗑️ BORRAR CORREOS MASIVAMENTE DE UN USUARIO ESPECÍFICO
app.post('/admin/borrar-correos-masivo', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { user_id, correos_borrar } = req.body;

    if (!user_id || !correos_borrar) {
        return res.send("<script>alert('⛔ Debes seleccionar al usuario y pegar la lista de correos a borrar.'); window.location='/dash';</script>");
    }

    try {
        const targetUserId = parseInt(user_id, 10);
        const targetUser = await dbGet("SELECT id, user, creado_por FROM usuarios WHERE id = ?", [targetUserId]);

        if (!targetUser) {
            return res.send("<script>alert('⛔ El usuario seleccionado no existe.'); window.location='/dash';</script>");
        }

        if (req.session.rol === 'Subadministrador') {
            if (targetUser.id !== req.session.uid && targetUser.creado_por !== req.session.uid) {
                return res.send("<script>alert('⛔ No tienes permiso para modificar los correos de este usuario.'); window.location='/dash';</script>");
            }
        }

        const coincidencias = String(correos_borrar).match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/g) || [];
        const correosUnicos = [...new Set(coincidencias.map(e => e.trim().toLowerCase()))];

        if (correosUnicos.length === 0) {
            return res.send("<script>alert('⛔ No se detectó ningún correo válido en el texto ingresado.'); window.location='/dash';</script>");
        }

        let eliminados = 0;
        let noEncontrados = 0;

        for (let email of correosUnicos) {
            const asignacion = await dbGet("SELECT id FROM correos WHERE user_id = ? AND LOWER(email) = ?", [targetUserId, email]);
            if (asignacion) {
                await dbRun("DELETE FROM correos WHERE user_id = ? AND LOWER(email) = ?", [targetUserId, email]);
                eliminados++;

                const sigueAsignadoAOtro = await dbGet("SELECT id FROM correos WHERE LOWER(email) = ?", [email]);
                if (!sigueAsignadoAOtro) {
                    await dbRun(
                        "UPDATE stock_cuentas SET estado = 'Disponible', comprador_id = NULL, compra_id = NULL, fecha_compra = NULL WHERE LOWER(email) = ? AND comprador_id = ?",
                        [email, targetUserId]
                    );
                }
            } else {
                noEncontrados++;
            }
        }

        const msg = `🗑️ Proceso completado para @${targetUser.user}:\\n\\n✅ Correos borrados de su cuenta: ${eliminados}\\n⚠️ Correos que no tenía asignados: ${noEncontrados}`;
        res.send(`<script>alert('${msg}'); window.location='/dash';</script>`);
    } catch (err) {
        console.error(err);
        res.send("<script>alert('Error al borrar los correos masivamente.'); window.location='/dash';</script>");
    }
});

// 🔎 NUEVO: RUTA PARA BUSCAR Y AUDITAR CORREOS GLOBALMENTE
app.post('/admin/auditar-cuentas', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.status(403).send('No autorizado.');
    const { correos_auditar } = req.body;
    
    // Extraer correos
    const coincidencias = String(correos_auditar).match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/g) || [];
    const correosUnicos = [...new Set(coincidencias.map(e => e.trim().toLowerCase()))];

    if (correosUnicos.length === 0) {
        return res.send(`<style>body{color:#fff;font-family:sans-serif; background: transparent; padding: 20px;}</style><h3 style="color:#E50914;">⛔ No se detectaron correos válidos en el texto.</h3>`);
    }

    try {
        const placeholders = correosUnicos.map(() => '?').join(',');
        const query = `
            SELECT c.email, u.id as user_id, u.user as dueno, u.creado_por 
            FROM correos c 
            JOIN usuarios u ON c.user_id = u.id 
            WHERE LOWER(c.email) IN (${placeholders})
        `;
        const encontradas = await dbAll(query, correosUnicos);
        
        let cuentasPermitidas = [];
        if (req.session.rol === 'Administrador') {
            cuentasPermitidas = encontradas;
        } else {
            cuentasPermitidas = encontradas.filter(c => c.user_id === req.session.uid || c.creado_por === req.session.uid);
        }

        // Construir la interfaz de respuesta
        let html = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                body { font-family: 'Inter', sans-serif; background: transparent; color: #fff; margin: 0; padding: 20px; }
                .table-modern { width: 100%; border-collapse: collapse; background: rgba(10, 14, 22, 0.95); border-radius: 10px; overflow: hidden; border: 1px solid rgba(255, 115, 0, 0.3); }
                .table-modern th, .table-modern td { padding: 12px 15px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
                .table-modern th { color: #ff7300; font-size: 11px; text-transform: uppercase; background: rgba(255, 255, 255, 0.03); letter-spacing: 1px; }
                .btn-delete { background: #E50914; color: #fff; padding: 14px 20px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 20px; text-transform: uppercase; font-size: 12px; transition: 0.3s; }
                .btn-delete:hover { box-shadow: 0 0 20px rgba(229,9,20,0.6); }
            </style>
            <h3 style="color:#ff7300; margin-top:0; font-size: 22px;">🔎 Resultados de Auditoría</h3>
            <p style="font-size:13px; color:#cbd5e1; margin-bottom: 20px;">Se encontraron <strong>${cuentasPermitidas.length} cuentas asignadas</strong> de las ${correosUnicos.length} ingresadas.</p>
        `;

        if (cuentasPermitidas.length > 0) {
            // Se envía un array de correos para que la ruta de limpieza los procese
            const emailsAEliminar = cuentasPermitidas.map(c => c.email);
            
            // Re-escapar la data JSON para inyectarla segura en el HTML
            const jsonSeguro = JSON.stringify(emailsAEliminar).replace(/"/g, '&quot;');

            html += `
            <form action="/admin/ejecutar-limpieza-global" method="POST" target="_top">
                <input type="hidden" name="emails_json" value="${jsonSeguro}">
                <div style="max-height: 350px; overflow-y: auto; border-radius: 10px; border: 1px solid rgba(255, 115, 0, 0.3);">
                    <table class="table-modern">
                        <thead><tr><th>Correo</th><th>Usuario Dueño</th></tr></thead>
                        <tbody>
                            ${cuentasPermitidas.map(c => `<tr><td style="color:#00D2FF; font-family:monospace; font-weight:600;">${c.email}</td><td>@${c.dueno}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <button type="submit" class="btn-delete" onclick="return confirm('⚠️ ATENCIÓN: Se eliminarán ESTAS ${cuentasPermitidas.length} CUENTAS de sus respectivos dueños simultáneamente. ¿Confirmas la acción?');">
                    🗑️ Eliminar todas estas cuentas de sus dueños
                </button>
            </form>`;
        } else {
            html += `<div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; text-align:center; color: #94a3b8;">Ninguna de las cuentas buscadas pertenece a tus clientes o no están asignadas.</div>`;
        }

        res.send(html);
    } catch (e) {
        console.error(e);
        res.send(`<p style="color:#E50914;">Error interno al procesar la auditoría.</p>`);
    }
});

// 🗑️ NUEVO: EJECUTAR LIMPIEZA GLOBAL DESDE LA AUDITORÍA
app.post('/admin/ejecutar-limpieza-global', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    
    try {
        const emails = JSON.parse(req.body.emails_json || '[]');
        if (!emails.length) return res.send("<script>alert('No hay correos para procesar.'); window.location='/dash';</script>");

        let eliminados = 0;
        for (let email of emails) {
            // Validar asignación real al momento de borrar
            const asig = await dbGet(`
                SELECT c.id, c.user_id, u.creado_por 
                FROM correos c JOIN usuarios u ON c.user_id = u.id 
                WHERE c.email = ?
            `, [email]);

            if (asig) {
                let permitido = req.session.rol === 'Administrador' || (req.session.rol === 'Subadministrador' && (asig.user_id === req.session.uid || asig.creado_por === req.session.uid));
                
                if (permitido) {
                    await dbRun("DELETE FROM correos WHERE id = ?", [asig.id]);
                    
                    // Liberar stock para que vuelva a estar 'Disponible' si ya no tiene dueños
                    const sigueAsignadoAOtro = await dbGet("SELECT id FROM correos WHERE LOWER(email) = ?", [email]);
                    if (!sigueAsignadoAOtro) {
                        await dbRun(
                            "UPDATE stock_cuentas SET estado = 'Disponible', comprador_id = NULL, compra_id = NULL, fecha_compra = NULL WHERE LOWER(email) = ?",
                            [email]
                        );
                    }
                    eliminados++;
                }
            }
        }
        res.send(`<script>alert('✅ Limpieza Global exitosa. Se eliminaron ${eliminados} cuentas de los usuarios.'); window.location='/dash';</script>`);
    } catch(e) {
        console.error(e);
        res.send("<script>alert('Error al ejecutar la limpieza global masiva.'); window.location='/dash';</script>");
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

// 🗑️ ELIMINAR STOCK ESPECÍFICO MASIVAMENTE (ADMIN Y SUBADMIN)
app.post('/stock/eliminar-masivo', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { correos_eliminar } = req.body;
    
    const coincidencias = String(correos_eliminar).match(/[a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/g) || [];
    const correosUnicos = [...new Set(coincidencias.map(e => e.trim().toLowerCase()))];

    if (correosUnicos.length === 0) {
        return res.send("<script>alert('⛔ No se detectó ningún correo válido en el texto ingresado.'); window.location='/dash';</script>");
    }

    let eliminados = 0;
    let noEncontrados = 0;

    try {
        for (let email of correosUnicos) {
            const cuenta = await dbGet("SELECT id FROM stock_cuentas WHERE email = ? AND propietario_id = ?", [email, req.session.uid]);
            if (cuenta) {
                await dbRun("DELETE FROM stock_cuentas WHERE id = ?", [cuenta.id]);
                eliminados++;
            } else {
                noEncontrados++;
            }
        }
        res.send(`<script>alert('🗑️ Proceso de limpieza de stock completado:\\n\\n✅ Cuentas eliminadas de tu inventario: ${eliminados}\\n⚠️ Cuentas no encontradas o que ya no te pertenecen: ${noEncontrados}'); window.location='/dash';</script>`);
    } catch (e) {
        console.error(e);
        res.redirect('/dash');
    }
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

// 🚀 SUBADMIN: CONFIGURAR PRECIOS DE SU TIENDA
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

// 🚀 SISTEMA DE COMPRA MULTINIVEL CON NOTIFICACIÓN OBLIGATORIA (ADMIN + ASISTENTE)
app.post('/tienda/comprar', async (req, res) => {
    if (req.session.rol !== 'Subadministrador' && req.session.rol !== 'Cliente') return res.redirect('/dash');
    const paquete = parseInt(req.body.paquete);
    
    try {
        const comprador = await dbGet("SELECT id, user, telefono, creditos, creado_por, moneda FROM usuarios WHERE id = ?", [req.session.uid]);
        const esSubAdmin = req.session.rol === 'Subadministrador';
        
        const proveedor_id = esSubAdmin ? 1 : (comprador.creado_por || 1);
        
        let costoMXN = PRECIOS_BASE[paquete];
        if (!costoMXN) return res.send("<script>alert('Paquete inválido'); window.location='/dash';</script>");

        if (!esSubAdmin && comprador.creado_por) {
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
        const adminPhone = provTelFormateado ? provTelFormateado.replace(/\s+/g, '').replace('+', '') : NUMERO_ADMIN_PRINCIPAL;
        const proveedorMoneda = (proveedor && proveedor.moneda) ? proveedor.moneda : 'MXN';
        
        const fechaObj = new Date();
        const msgAdmin = `*NUEVA COMPRA EN TU TIENDA*\n\n👤 *Cliente:* ${comprador.user}\n📱 *Tel:* ${comprador.telefono || 'N/A'}\n📅 *Fecha:* ${fechaObj.toLocaleDateString('es-CO')} ${fechaObj.toLocaleTimeString('es-CO')}\n🛒 *Paquete:* ${paquete} cuentas\n💵 *Valor:* ${formatearDinero(costoMXN, proveedorMoneda)}\n\n*Cuentas entregadas:*\n${correosEntregados.join('\n')}\n\n🪙 *Dinero restante del cliente:* ${formatearDinero(nuevoSaldoMXN, proveedorMoneda)}`;
        
        const linkAdmin = `https://api.whatsapp.com/send?phone=${adminPhone}&text=${encodeURIComponent(msgAdmin)}`;
        const linkAsistente = `https://api.whatsapp.com/send?phone=${NUMERO_ASISTENTE}&text=${encodeURIComponent(msgAdmin)}`;

        const costoCompradorText = formatearDinero(costoMXN, comprador.moneda);

        res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Confirmación Obligatoria de Compra</title>
            <style>
                body { background: #050505; color: #fff; font-family: 'Inter', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                .card-confirm { background: rgba(12, 15, 22, 0.96); border: 1px solid rgba(0, 210, 255, 0.35); border-radius: 16px; padding: 30px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.95); }
                .step-btn { display: block; width: 100%; padding: 16px; border-radius: 10px; font-weight: 700; font-size: 14px; text-decoration: none; margin-top: 14px; box-sizing: border-box; cursor: pointer; border: none; transition: 0.25s; text-transform: uppercase; letter-spacing: 0.5px; }
                .btn-wa-1 { background: #25d366; color: #000; box-shadow: 0 4px 15px rgba(37,211,102,0.35); }
                .btn-wa-2 { background: #00D2FF; color: #000; box-shadow: 0 4px 15px rgba(0,210,255,0.35); }
                .btn-panel { background: rgba(255,255,255,0.08); color: #64748b; border: 1px solid rgba(255,255,255,0.1); cursor: not-allowed; margin-top: 22px; }
                .btn-panel.unlocked { background: #E50914; color: #fff; border-color: #E50914; cursor: pointer; box-shadow: 0 5px 20px rgba(229,9,20,0.5); }
                .status-badge { display: inline-block; padding: 4px 10px; border-radius: 50px; font-size: 11px; font-weight: 700; margin-bottom: 10px; background: rgba(229,9,20,0.15); color: #E50914; border: 1px solid #E50914; }
            </style>
        </head>
        <body>
            <div class="card-confirm">
                <div class="status-badge">⚠️ PASO OBLIGATORIO DE SEGURIDAD</div>
                <h2 style="color:#25d366; margin: 5px 0 10px 0;">✅ Compra Procesada (${costoCompradorText})</h2>
                <p style="color:#cbd5e1; font-size:13px; line-height:1.5; margin-bottom:20px;">
                    Para liberar y visualizar tus cuentas en el panel, es <b>estrictamente obligatorio</b> enviar el comprobante de entrega por WhatsApp al Administrador y al Asistente:
                </p>

                <a href="${linkAdmin}" target="_blank" id="btnPaso1" onclick="marcarPaso1()" class="step-btn btn-wa-1">
                    1️⃣ Enviar Comprobante al Administrador
                </a>

                <a href="${linkAsistente}" target="_blank" id="btnPaso2" onclick="marcarPaso2()" class="step-btn btn-wa-2">
                    2️⃣ Enviar Copia al Asistente (+57 311 3092659)
                </a>

                <button id="btnVolver" onclick="irAlPanel()" class="step-btn btn-panel" disabled>
                    🔒 Completa los 2 envíos para ir al Panel
                </button>
            </div>

            <script>
                let paso1OK = false;
                let paso2OK = false;

                setTimeout(() => {
                    window.open('${linkAdmin}', '_blank');
                    marcarPaso1();
                }, 400);

                function marcarPaso1() {
                    paso1OK = true;
                    const b1 = document.getElementById('btnPaso1');
                    b1.innerHTML = '✅ 1️⃣ Enviado al Administrador (Click para reenviar)';
                    b1.style.opacity = '0.85';
                    verificarDesbloqueo();
                }

                function marcarPaso2() {
                    paso2OK = true;
                    const b2 = document.getElementById('btnPaso2');
                    b2.innerHTML = '✅ 2️⃣ Enviado al Asistente (Click para reenviar)';
                    b2.style.opacity = '0.85';
                    verificarDesbloqueo();
                }

                function verificarDesbloqueo() {
                    if (paso1OK && paso2OK) {
                        const btn = document.getElementById('btnVolver');
                        btn.disabled = false;
                        btn.classList.add('unlocked');
                        btn.innerHTML = '🔓 Entrar al Panel y Ver Mis Cuentas';
                    }
                }

                function irAlPanel() {
                    if (paso1OK && paso2OK) {
                        window.location.href = '/dash';
                    } else {
                        alert('⛔ Debes enviar obligatoriamente el mensaje al Administrador y al Asistente antes de continuar.');
                    }
                }
            </script>
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

            let query = esAdminPrincipal 
                ? "SELECT * FROM usuarios WHERE creado_por IS NULL OR creado_por = ? OR id = ?" 
                : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
            let params = [req.session.uid, req.session.uid];
            const usuarios = await dbAll(query, params);
            const correos = await dbAll("SELECT * FROM correos", []);
            const registros = await dbAll("SELECT * FROM registro_codigos ORDER BY id DESC LIMIT 5", []);
            
            const garantias = await dbAll(`SELECT g.*, u.user as cliente_nombre FROM garantias g JOIN usuarios u ON g.user_id = u.id ORDER BY g.estado ASC, g.id DESC`);
            const reservas = await dbAll(`SELECT r.*, u.user as cliente_nombre FROM reservas r JOIN usuarios u ON r.user_id = u.id ORDER BY r.estado ASC, r.id DESC`);

            const proveedor_inventario = esCliente ? (usuarioActual.creado_por || 1) : (esSubAdmin ? req.session.uid : 1);
            const stockDisp = await dbGet("SELECT COUNT(*) as count FROM stock_cuentas WHERE estado = 'Disponible' AND propietario_id = ?", [proveedor_inventario]);
            const stockVend = await dbGet("SELECT COUNT(*) as count FROM stock_cuentas WHERE (estado = 'Vendida' OR estado = 'Asignada') AND propietario_id = ?", [proveedor_inventario]);
            
            const historialAsignaciones = await dbAll("SELECT h.*, u.user as receptor, a.user as admin FROM historial_asignaciones h JOIN usuarios u ON h.receptor_id = u.id JOIN usuarios a ON h.admin_id = a.id ORDER BY h.id DESC");

            const historialCompras = await dbAll(`SELECT c.*, u.user as comprador, u.moneda FROM compras_stock c JOIN usuarios u ON c.subadmin_id = u.id ORDER BY c.id DESC`);
            const detallesComprasDB = await dbAll("SELECT * FROM detalles_compras");
            const cfgGhoulflix = await dbGet("SELECT * FROM config_ghoulflix WHERE id = 1");

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
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 12px; text-align: center; margin-bottom: 8px;">
                        <p style="margin: 0; color: #cbd5e1; font-size: 11px; line-height: 1.5;">
                            Panel Operativo de <strong>${plat.nombre}</strong>. Escribe el correo y elige el tipo de código a extraer.
                        </p>
                    </div>`;

                if (key === 'netflix') {
                    controlesIzquierda += `
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 15px; background: rgba(229, 9, 20, 0.1); padding: 8px; border-radius: 8px; border: 1px solid rgba(229, 9, 20, 0.3);">
                            <img src="${plat.logo}" alt="Netflix" style="height: 16px; filter: drop-shadow(0 0 5px rgba(229,9,20,0.8));">
                            <span style="font-size: 11px; font-weight: 700; color: #E50914; text-transform: uppercase; letter-spacing: 1px;">Códigos Rápidos</span>
                        </div>
                        <div class="api-grid-btns" style="gap: 12px;">
                            <button onclick="triggerAction('${key}', 'signin_6digit')" class="action-btn-pill" style="background: rgba(0, 210, 255, 0.08); border-color: rgba(0, 210, 255, 0.3); color: #fff; padding: 16px 5px; display: flex; flex-direction: column; align-items: center; gap: 8px; border-radius: 12px;">
                                <span style="font-size: 22px;">🔢</span>
                                <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.5px;">CÓD. 6 DÍG.</span>
                            </button>
                            <button onclick="triggerAction('${key}', 'signin_4digit')" class="action-btn-pill" style="background: rgba(0, 210, 255, 0.08); border-color: rgba(0, 210, 255, 0.3); color: #fff; padding: 16px 5px; display: flex; flex-direction: column; align-items: center; gap: 8px; border-radius: 12px;">
                                <span style="font-size: 22px;">📺</span>
                                <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.5px;">CÓD. 4 DÍG.</span>
                            </button>
                            <button onclick="triggerAction('${key}', 'household')" class="action-btn-pill" style="background: rgba(37, 211, 102, 0.1); border-color: rgba(37, 211, 102, 0.3); color: #fff; padding: 16px 5px; display: flex; flex-direction: column; align-items: center; gap: 8px; border-radius: 12px;">
                                <span style="font-size: 22px;">🏠</span>
                                <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.5px;">HOGAR / VIAJE</span>
                            </button>
                            <button onclick="triggerAction('${key}', 'reset_link')" class="action-btn-pill" style="background: rgba(255, 115, 0, 0.1); border-color: rgba(255, 115, 0, 0.3); color: #fff; padding: 16px 5px; display: flex; flex-direction: column; align-items: center; gap: 8px; border-radius: 12px;">
                                <span style="font-size: 22px;">🔑</span>
                                <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.5px;">CONTRASEÑA</span>
                            </button>
                        </div>
                    `;
                } else {
                    controlesIzquierda += `
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill" style="background: var(--accent); color: #000; border: none; padding: 12px; margin-bottom: 8px;">🔎 Extraer Código Original</button>
                    `;
                }

                if (esSubAdmin) {
                    controlesIzquierda += `
                    <button onclick="toggleSubForm('soporte-${key}')" class="action-btn-pill" style="background: rgba(255, 115, 0, 0.12); border-color: rgba(255, 115, 0, 0.5); margin-top: 10px;">🛠️ Pedir Soporte (SubAdmin)</button>
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
                            <h3 style="margin:0; font-size:17px; font-weight:600;">Búsqueda Rápida en ${plat.nombre}</h3>
                            <p style="margin:3px 0 0 0; font-size:12px; color:var(--text-muted);">Ingresa tu correo autorizado y elige el código o enlace en el panel izquierdo.</p>
                        </div>
                    </div>
                    <form id="form-${key}" action="/buscar" method="POST" target="marco_resultados" style="margin:0;" onsubmit="document.getElementById('visor-resultados').style.display='flex';">
                        <input type="hidden" name="plataforma" value="${key}">
                        <input type="text" name="email_search" class="search-input-large" placeholder="Escribe el correo electrónico autorizado aquí..." required ${((esCliente || esSubAdmin) && misCorreos.length === 0) ? 'disabled' : ''}>
                    </form>
                </div>`;
            });

            let clientesOpcionesHtml = usuarios.filter(u => u.rol === 'Cliente' || u.rol === 'Subadministrador').map(u => {
                const totalCuentas = correos.filter(c => c.user_id === u.id).length;
                return `<option value="${u.id}">${u.user} (${u.rol} - ${totalCuentas} correos)</option>`;
            }).join('');

            if (esAdminPrincipal) {
                panelesIzquierdosHtml += `
                <div id="action-api-ghoulflix" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🔌 Conexión del servidor de códigos</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Consulta códigos de acceso y enlaces mediante la conexión privada del servidor y Gmail.</p>
                </div>
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
                <div id="main-api-ghoulflix" class="main-card">
                    <h3 style="color:#67e8f9;">◈ Servidor de códigos + ✉ Gmail</h3>
                    <p style="color:var(--text-muted);font-size:13px;line-height:1.7;">La búsqueda combinada usa la conexión privada configurada en el servidor. No necesitas introducir ni compartir el token aquí. Las credenciales se modifican únicamente en el archivo privado o mediante variables de entorno.</p>
                </div>

                <div id="main-stock-admin" class="main-card">
                    <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color: #00D2FF;">📦 Cargar Stock y Ver Historial</h3>
                    <form action="/stock/cargar" method="POST">
                        <select name="plataforma" class="input-classic" required>
                            <option value="netflix">Netflix</option>
                        </select>
                        <textarea name="correos_stock" class="input-classic" placeholder="correo1@gmail.com:clave123&#10;cuenta2@hotmail.com:pass456..." rows="5" required></textarea>
                        <button type="submit" class="btn-submit">Ingresar al Inventario Seguro</button>
                    </form>

                    <h4 style="margin:25px 0 10px 0; font-size:15px; font-weight:600; color: #E50914;">🗑️ Borrar Cuentas Específicas del Stock</h4>
                    <form action="/stock/eliminar-masivo" method="POST">
                        <textarea name="correos_eliminar" class="input-classic" placeholder="Pega aquí los correos que subiste por error para borrarlos de tu inventario (correo1@gmail.com&#10;correo2@hotmail.com...)" rows="3" required></textarea>
                        <button type="submit" class="btn-submit" style="background: rgba(229, 9, 20, 0.12); border: 1px solid #E50914; color: #E50914;" onclick="return confirm('¿Seguro que deseas eliminar estas cuentas específicas de tu inventario?');">Borrar Cuentas Ingresadas</button>
                    </form>

                    <div style="margin-top: 25px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <form action="/admin/vaciar-stock-disponible" method="POST" style="flex: 1; min-width: 200px;" onsubmit="return confirm('¿Seguro que deseas ELIMINAR TODO EL STOCK DISPONIBLE (No Vendido)? Esta acción no se puede deshacer.');">
                            <button type="submit" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.12); border-color: #E50914; color: #E50914;">🗑️ Borrar TODO Stock NO Vendido</button>
                        </form>
                        <form action="/admin/vaciar-stock-vendido" method="POST" style="flex: 1; min-width: 200px;" onsubmit="return confirm('¿Seguro que deseas ELIMINAR TODO EL STOCK VENDIDO/ASIGNADO? Esto limpiará la lista visual pero los clientes conservarán sus correos.');">
                            <button type="submit" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.12); border-color: #E50914; color: #E50914;">🗑️ Borrar TODO Stock Vendido</button>
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

                const miProveedorId = esSubAdmin ? 1 : (usuarioActual.creado_por || 1);
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

                    <h4 style="margin:25px 0 10px 0; font-size:15px; font-weight:600; color: #E50914;">🗑️ Borrar Cuentas Específicas de mi Stock</h4>
                    <form action="/stock/eliminar-masivo" method="POST">
                        <textarea name="correos_eliminar" class="input-classic" placeholder="Pega aquí los correos que subiste por error (correo1@gmail.com&#10;correo2@hotmail.com...)" rows="3" required></textarea>
                        <button type="submit" class="btn-submit" style="background: rgba(229, 9, 20, 0.12); border: 1px solid #E50914; color: #E50914;" onclick="return confirm('¿Seguro que deseas eliminar estas cuentas de tu inventario?');">Borrar Cuentas Ingresadas</button>
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

            panelesIzquierdosHtml += `
            <div id="action-crear-user" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">👤 Crear Usuario</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Crea nuevas cuentas de clientes o subadministradores para darles acceso al panel SyncBox.</p></div>
            <div id="action-usuarios" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">📧 Asignar Correos</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Vincula los correos de las plataformas al perfil de un cliente.</p></div>
            <div id="action-borrar-correos-masivo" class="action-panel"><h4 style="margin:0; font-size:11px; color:#E50914; text-transform:uppercase;">🗑️ Borrado Masivo</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Busca a un usuario (ej. Juan), pega sin límite los correos que no eran para él y bórralos de su perfil en un solo clic.</p></div>
            <div id="action-auditoria-global" class="action-panel"><h4 style="margin:0; font-size:11px; color:#ff7300; text-transform:uppercase;">🔎 Limpieza Global</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Pega una lista de correos mezclados. El sistema detectará quiénes son los dueños y te permitirá borrarlos todos de una vez.</p></div>
            <div id="action-base-datos" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🗄️ Base de Datos</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Consulta y administra tus usuarios directos y registros públicos.</p></div>
            `;
            
            let tablaUsuariosHtml = "";
            let terminoBusqueda = (req.query.buscar_dueno || "").trim().toLowerCase();
            
            if (esAdminPrincipal || esSubAdmin) {
                let usuariosVisibles = esAdminPrincipal 
                    ? usuarios.filter(u => u.user !== 'admin' && u.user !== 'ruben' && u.user !== 'dueño') 
                    : usuarios.filter(u => u.creado_por === req.session.uid);
                
                if (usuariosVisibles.length === 0) {
                    tablaUsuariosHtml = "<tr><td colspan='5' style='padding: 20px; text-align: center; color: var(--text-muted);'>No hay usuarios registrados aún.</td></tr>";
                } else {
                    let renderRow = (u) => {
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

                        let idCreadorTexto = u.creado_por ? 'Creado por Ti' : 'Registro Público';
                        let icon = u.rol === 'Subadministrador' ? '👑' : '👤';
                        let dateFormated = u.fecha_creacion ? u.fecha_creacion.split('.')[0] : 'Desconocida';
                        let telMostrado = u.telefono ? formatearTelefono(u.telefono) : 'N/A';

                        return `<tr>
                            <td style="font-weight: 500; padding-left: 15px;">
                                <span style="color: #fff; font-size: 13px; font-weight:600;">${icon} ${u.user}</span>
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
                                <form action="/admin/eliminar-usuario" method="POST" onsubmit="return confirm('¿Seguro que deseas eliminar a este usuario?');" style="margin:0;">
                                    <input type="hidden" name="user_id" value="${u.id}">
                                    <button type="submit" style="background: rgba(229,9,20,0.12); border:1px solid #E50914; color:#E50914; padding:6px 10px; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='#E50914'; this.style.color='#fff';" onmouseout="this.style.background='rgba(229,9,20,0.12)'; this.style.color='#E50914';">Eliminar</button>
                                </form>
                            </td>
                        </tr>`;
                    };

                    if (esAdminPrincipal) {
                        let subadmins = usuariosVisibles.filter(u => u.rol === 'Subadministrador');
                        let clientesDirectos = usuariosVisibles.filter(u => u.rol !== 'Subadministrador');

                        if (subadmins.length > 0) {
                            tablaUsuariosHtml += `<tr><td colspan="5" style="background: rgba(0, 210, 255, 0.08); text-align: center; font-size: 11px; color: #00D2FF; font-weight: 700; padding: 10px; letter-spacing: 1px;">MIS SUBADMINISTRADORES</td></tr>`;
                            subadmins.forEach(sa => { tablaUsuariosHtml += renderRow(sa); });
                        }

                        if (clientesDirectos.length > 0) {
                            tablaUsuariosHtml += `<tr><td colspan="5" style="background: rgba(0, 210, 255, 0.08); text-align: center; font-size: 11px; color: #00D2FF; font-weight: 700; padding: 10px; letter-spacing: 1px;">MIS CLIENTES DIRECTOS Y PÚBLICOS</td></tr>`;
                            clientesDirectos.forEach(c => { tablaUsuariosHtml += renderRow(c); });
                        }
                    } else {
                        usuariosVisibles.forEach(u => tablaUsuariosHtml += renderRow(u));
                    }
                }
            }

            // AÑADIMOS EL PANEL CENTRAL DE LA AUDITORÍA GLOBAL
            if (esAdminPrincipal || esSubAdmin) {
                panelesCentroHtml += `
                <div id="main-auditoria-global" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; font-weight:600; color:#ff7300;">🔎 Buscar y Limpiar Cuentas Masivamente</h3>
                    <p style="color:var(--text-muted); font-size:12px; margin-bottom:18px;">
                        Pega 20, 30 o más cuentas (incluso de clientes diferentes). El sistema te mostrará en el visor de abajo <b>a qué usuarios pertenecen</b> y te dará la opción de <b>quitárselas a todos</b> de una vez.
                    </p>
                    <form action="/admin/auditar-cuentas" method="POST" target="marco_resultados" style="background: rgba(0,0,0,0.5); padding: 18px; border-radius: 10px; border: 1px solid rgba(255, 115, 0, 0.35);" onsubmit="document.getElementById('visor-resultados').style.display='flex';">
                        <div style="margin-bottom: 15px;">
                            <label style="color: #ff7300; font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">Pega la lista de correos a investigar / borrar:</label>
                            <textarea name="correos_auditar" class="input-classic" style="margin-bottom:0;" placeholder="correo1@gmail.com&#10;correo2@hotmail.com..." rows="8" required></textarea>
                        </div>
                        <button type="submit" class="btn-submit" style="background: #ff7300; color: #fff;">🔎 Buscar Dueños de estas Cuentas</button>
                    </form>
                </div>
                `;
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
                        <a href="https://wa.me/${NUMERO_ADMIN_PRINCIPAL}" target="_blank" class="contact-btn whatsapp">
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
                            <form action="/admin/crear" method="POST" onsubmit="
                                const tel = this.telefono.value.replace(/\\s+/g, '');
                                if(!/^\\+[1-9]\\d{7,14}$/.test(tel)) {
                                    alert('⛔ OBLIGATORIO: Debes incluir el signo + seguido del código de país (Ejemplo: +521234567890 o +573001234567).');
                                    this.telefono.focus();
                                    return false;
                                }
                                this.telefono.value = tel;
                                return true;
                            ">
                                <input name="n" class="input-classic" placeholder="Nombre de Usuario" required>
                                <input name="c" class="input-classic" placeholder="Contraseña" required>
                                <input type="tel" name="telefono" class="input-classic" placeholder="WhatsApp con + y código (Ej: +52...)" pattern="^\\+[1-9]\\d{7,14}$" title="Obligatorio incluir el signo + y el código de país" required>
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

                        <div id="main-borrar-correos-masivo" class="main-card">
                            <h3 style="margin:0 0 8px 0; font-size:19px; font-weight:600; color:#E50914;">🗑️ Borrar Correos Masivamente a un Usuario</h3>
                            <p style="color:var(--text-muted); font-size:12px; margin-bottom:18px;">
                                Busca al usuario (ej. Juan), selecciónalo y pega sin límite todos los correos que deseas quitarle de su cuenta (20, 50 o los que necesites).
                            </p>
                            <form action="/admin/borrar-correos-masivo" method="POST" style="background: rgba(0,0,0,0.5); padding: 18px; border-radius: 10px; border: 1px solid rgba(229, 9, 20, 0.35);">
                                <div style="margin-bottom: 14px;">
                                    <label style="color: #00D2FF; font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">1. Buscar y seleccionar usuario:</label>
                                    <input type="text" id="buscador-user-borrar" class="input-classic" placeholder="🔎 Escribe aquí para filtrar el nombre (ej: juan)..." oninput="filtrarSelectorUsuarios('buscador-user-borrar', 'select-user-borrar')" style="margin-bottom: 8px; border-color: rgba(0, 210, 255, 0.4);">
                                    <select id="select-user-borrar" name="user_id" class="input-classic" style="margin-bottom:0;" required>
                                        <option value="" disabled selected>-- Selecciona al usuario --</option>
                                        ${clientesOpcionesHtml}
                                    </select>
                                </div>
                                <div style="margin-bottom: 15px;">
                                    <label style="color: #E50914; font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">2. Pega los correos que le vas a borrar (sin límite):</label>
                                    <textarea name="correos_borrar" class="input-classic" style="margin-bottom:0;" placeholder="correo1@gmail.com&#10;correo2@gmail.com&#10;correo3@hotmail.com..." rows="8" required></textarea>
                                </div>
                                <button type="submit" class="btn-submit" style="background: #E50914; color: #fff;" onclick="return confirm('⚠️ ¿Seguro que deseas borrarle todos estos correos al usuario seleccionado?');">🗑️ Borrarle estos correos al usuario</button>
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
                                        <th>Origen</th>
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
                                <button class="menu-btn-item" data-tab="api-ghoulflix" onclick="openTab('api-ghoulflix')" style="color: #25d366;">🔌 Servidor de códigos</button>
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
                                <button class="menu-btn-item" data-tab="borrar-correos-masivo" onclick="openTab('borrar-correos-masivo')" style="color: #E50914;">🗑️ Borrado Masivo</button>
                                <button class="menu-btn-item" data-tab="auditoria-global" onclick="openTab('auditoria-global')" style="color: #ff7300;">🔎 Limpieza Global</button>
                                <button class="menu-btn-item" data-tab="base-datos" onclick="openTab('base-datos')">🗄️ Ver Base de Datos</button>
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


// BEGIN DUAL LOOKUP HELPERS
function traducirErrorCodigo(message, status) {
    const text = String(message || '').toLowerCase();
    if (status === 429 || /too many requests|rate limit/.test(text)) return 'El servidor limita las solicitudes. Espera antes de volver a intentar.';
    if (/not assigned|not in your|access denied/.test(text)) return 'Esta cuenta no está autorizada para el usuario de la conexión.';
    if (status === 401 || /authentication required|invalid credentials|invalid token/.test(text)) return 'No se pudo autenticar la conexión. Revisa las credenciales del servidor.';
    if (/suspended|banned/.test(text)) return 'El perfil de la conexión está suspendido.';
    if (/pending.*approval/.test(text)) return 'El perfil de la conexión está pendiente de aprobación.';
    if (/account expired/.test(text)) return 'La asignación de esta cuenta está vencida.';
    if (/disabled/.test(text)) return 'Este tipo de consulta no está habilitado para el perfil.';
    if (status >= 500) return 'El servidor de códigos no está disponible en este momento.';
    return 'No se encontró un código válido. Comprueba el envío del correo y los permisos de la cuenta.';
}

function escapeResultado(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function enlaceNetflixSeguro(value) {
    try {
        const u = new URL(value);
        return u.protocol === 'https:' && !u.username && !u.password &&
            (u.hostname === 'netflix.com' || u.hostname.endsWith('.netflix.com')) ? u.href : null;
    } catch (_) { return null; }
}
function normalizarResultadoFuente(data, fuente, tipo) {
    const value = data && typeof data === 'object' ? data : {};
    let code = value.code == null ? null : String(value.code);
    const pattern = tipo === 'signin_6digit' ? /^\d{6}$/ : tipo === 'signin_4digit' ? /^\d{4}$/ : /^\d{4,6}$/;
    if (!pattern.test(code || '') || tipo === 'reset_link') code = null;
    let link = enlaceNetflixSeguro(value.link);
    if (tipo === 'signin_6digit' || tipo === 'signin_4digit') link = null;
    const success = value.success === true && !!(code || link);
    return { source: fuente, success, code: success ? code : null, link: success ? link : null,
        status: success ? 'found' : value.source_error ? 'error' : 'not_found',
        error: success ? null : fuente === 'Gmail' ? 'No se encontró un resultado reciente válido en Gmail.' : value.terminal ? value.error : traducirErrorCodigo(value.error, 0) };
}
function extraerCodigoGmail(mail, tipo) {
    if (!mail) return { success: false };
    // Los mensajes antiguos no se presentan como una búsqueda nueva.
    const received = new Date(mail.date).getTime();
    if (!Number.isFinite(received) || received < Date.now() - 5 * 60000 || received > Date.now() + 60000) return { success: false };
    const sender = mail.from && mail.from.value || [];
    if (!sender.some(x => /@(?:[a-z0-9-]+\.)*netflix\.com$/i.test(x.address || ''))) return { success: false };
    const html = String(mail.html || '');
    const text = mail.text || html.replace(/<[^>]*>/g, ' ');
    let code = null, link = null;
    const pattern = tipo === 'signin_6digit' ? /\b(\d{6})\b/ : tipo === 'signin_4digit' ? /\b(\d{4})\b/ : /\b(\d{4,6})\b/;
    if (tipo !== 'reset_link') { const match = text.match(pattern); if (match) code = match[1]; }
    if (tipo === 'household' || tipo === 'reset_link') {
        const urls = (html + '\n' + text).match(/https:\/\/[^\s"'<>]+/gi) || [];
        link = urls.map(x => enlaceNetflixSeguro(x.replace(/&amp;/g, '&'))).find(x => x &&
            (tipo === 'reset_link' ? /password|loginhelp/i : /travel|household|update-primary-location/i).test(x)) || null;
    }
    return { success: !!(code || link), code, link };
}
async function buscarCodigoEnAmbasFuentes(email, tipo, externalSignal) {
    const controller = new AbortController();
    const deadline = Date.now() + 60000;
    const stop = () => controller.abort();
    if (externalSignal) {
        externalSignal.addEventListener('abort', stop, { once: true });
        if (externalSignal.aborted) stop();
    }
    const sources = ['Servidor de códigos', 'Gmail'].map(source => ({ source, success: false, code: null, link: null, status: 'searching', error: 'Búsqueda en curso.' }));
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const timer = setTimeout(stop, 60000);
    controller.signal.addEventListener('abort', () => resolveDone(), { once: true });
    let finished = 0;
    const pause = () => new Promise(resolve => {
        if (controller.signal.aborted) return resolve();
        const finish = () => { clearTimeout(t); controller.signal.removeEventListener('abort', finish); resolve(); };
        const t = setTimeout(finish, Math.min(5000, Math.max(0, deadline - Date.now())));
        controller.signal.addEventListener('abort', finish, { once: true });
    });
    const poll = async index => {
        try {
            let attempts = 0;
            while (!controller.signal.aborted && Date.now() < deadline) {
                if (index === 0 && tipo === 'reset_link' && attempts > 0) break;
                attempts++;
                console.log('[Busqueda] Fuente:', sources[index].source, '| intento:', attempts);
                let value;
                try {
                    if (index === 0) value = await consultarCodigoGhoulflixApi(email, tipo, controller.signal);
                    else {
                        const response = await buscarEnBuzonImap('darciogarces@gmail.com', email, 'netflix', email.split('@'), tipo, controller.signal);
                        value = extraerCodigoGmail(response && response.mail, tipo);
                    }
                } catch (_) { value = { success: false, source_error: true }; }
                if (controller.signal.aborted) break;
                sources[index] = normalizarResultadoFuente(value, sources[index].source, tipo);
                if (sources[index].success) { resolveDone(); return; }
                if (value && value.terminal) break;
                await pause();
            }
        } finally {
            finished++;
            if (finished === 2) resolveDone();
        }
    };
    const tasks = [poll(0), poll(1)];
    // Errors are observed even if the other provider finishes first.
    tasks.forEach(task => task.catch(() => resolveDone()));
    try { if (!controller.signal.aborted) await done; }
    finally {
        clearTimeout(timer); controller.abort();
        if (externalSignal) externalSignal.removeEventListener('abort', stop);
    }
    const best = sources.find(x => x.success);
    return { success: !!best, code: best ? best.code : null, link: best ? best.link : null,
        source: best ? best.source : null, sources: sources.map(x => x.status === 'searching' ? { ...x, status: 'stopped', error: best ? 'Consulta detenida al encontrar un resultado en la otra fuente.' : 'Tiempo de búsqueda finalizado.' } : x),
        error: best ? null : 'No se encontró un resultado válido durante la búsqueda. Comprueba el envío del correo y los permisos.' };
}
function renderBusquedaCliente(email, tipo, etiqueta) {
    const payload = JSON.stringify({ email, code_type: tipo }).replace(/</g, '\\u003c');
    return `<main class="lookup-shell"><div class="lookup-top">BÚSQUEDA AUTOMÁTICA</div><h2>${escapeResultado(etiqueta)}</h2><p class="lookup-email">${escapeResultado(email)}</p><section id="lookup-progress"><div id="lookup-seconds">60 s</div><p id="lookup-status">Buscando en Gmail y el servidor de códigos…</p><p class="lookup-muted">La búsqueda se repite automáticamente. No necesitas pulsar otra vez.</p></section><div id="lookup-results" aria-live="polite"></div></main>
    <style>.lookup-shell{box-sizing:border-box;max-width:850px;padding:28px;margin:20px auto;background:linear-gradient(135deg,#101d30,#0b1320);border:1px solid #2b4059;border-radius:22px;color:#edf6ff;font-family:Inter,sans-serif}.lookup-top{font-size:11px;color:#67e8f9;letter-spacing:2px}.lookup-shell h2{font-size:23px;margin:14px 0 8px}.lookup-email{font-size:13px;color:#a9bdd3;overflow-wrap:anywhere}#lookup-progress{text-align:center;padding:20px}#lookup-seconds{font-size:52px;font-weight:700;color:#9cffe2}.lookup-muted{font-size:12px;color:#91a7c0;line-height:1.7}.lookup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.lookup-card{padding:20px;border:1px solid #30465f;border-radius:14px;background:#101c2b;min-width:0}.lookup-card.found{border-color:#34d399;background:#102b2a}.lookup-card h3{font-size:15px;margin:0 0 14px}.lookup-code{font:700 35px monospace;letter-spacing:4px;color:#b1ffe6;padding:18px 0;user-select:all}.lookup-button{display:inline-block;margin:8px 8px 0 0;padding:11px 15px;border:1px solid #3c6079;border-radius:9px;background:#19364c;color:#eefbff;text-decoration:none;font:600 12px Inter,sans-serif;cursor:pointer}.lookup-error{padding:16px;background:#382126;border:1px solid #8a434c;border-radius:12px;color:#ffd8de;line-height:1.7}@media(max-width:600px){.lookup-grid{grid-template-columns:1fr}.lookup-shell{padding:18px;margin:10px}.lookup-code{font-size:29px}}</style>
    <script>
    (async function(){
        const requestBody=${payload};
        const controller=new AbortController();
        const started=Date.now();
        let finished=false;
        const results=document.getElementById('lookup-results');
        const progress=document.getElementById('lookup-progress');
        function node(tag,text,cls){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;}
        function release(){window.parent.postMessage('lookup-complete',location.origin);}
        const ticker=setInterval(function(){const left=Math.max(0,60-Math.floor((Date.now()-started)/1000));document.getElementById('lookup-seconds').textContent=left>0?left+' s':'Terminando la consulta…';},250);
        const deadline=setTimeout(function(){controller.abort();},70000);
        window.addEventListener('pagehide',function(){controller.abort();},{once:true});
        try{
            const response=await fetch('/api/customer/fetch-code',{
                method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
                headers:{'Content-Type':'application/json'},body:JSON.stringify(requestBody)
            });
            const data=await response.json().catch(function(){throw new Error('El servidor devolvió una respuesta no válida. Revisa la terminal de Node.');});
            if(!response.ok)throw new Error(response.status===401?'Tu sesión venció. Vuelve a iniciar sesión.':response.status===403?'No tienes permiso para consultar esta cuenta.':'La consulta falló (HTTP '+response.status+').');
            const sources=Array.isArray(data.sources)?data.sources:[];
            if(!sources.length && data.success!==true)throw new Error(data.error||'La búsqueda terminó sin un resultado.');
            const title=node('h2',data.success?'Resultado disponible':'Búsqueda finalizada sin código');results.append(title);
            const grid=node('div',null,'lookup-grid');results.append(grid);
            sources.forEach(function(item){
                const card=node('section',null,'lookup-card'+(item.success?' found':''));grid.append(card);
                card.append(node('h3',item.source==='Gmail'?'✉ Gmail':'◈ Servidor de códigos'));
                let code=item.code==null?'':String(item.code),link=null;
                const validCode=requestBody.code_type==='signin_6digit'?/^[0-9]{6}$/:requestBody.code_type==='signin_4digit'?/^[0-9]{4}$/:/^[0-9]{4,6}$/;
                if(!validCode.test(code)||requestBody.code_type==='reset_link')code='';
                if(item.link){try{const u=new URL(item.link);if(u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='netflix.com'||u.hostname.endsWith('.netflix.com')))link=u.href;}catch(e){}}
                if(item.success&&(code||link)){
                    card.append(node('p','✓ Encontrado','lookup-muted'));
                    if(code)card.append(node('div',code,'lookup-code'));
                    if(link){const a=node('a','Abrir enlace ↗','lookup-button');a.href=link;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
                    const copy=node('button',code?'Copiar código':'Copiar enlace','lookup-button');copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(code||link);copy.textContent='✓ Copiado';}catch(e){copy.textContent='Selecciona y copia el resultado';}});card.append(copy);
                }else card.append(node('p',item.error||'No se encontró un resultado.','lookup-muted'));
            });
            results.append(node('p','Búsqueda terminada en '+((Date.now()-started)/1000).toFixed(1)+' s. Gmail revisa mensajes de los últimos 5 minutos.','lookup-muted'));
        }catch(error){
            results.append(node('h2','No se pudo completar la búsqueda'));
            results.append(node('p',error.name==='AbortError'?'La conexión superó el tiempo de espera. No sigas pulsando: revisa la terminal del servidor y vuelve a intentarlo después.':error.message,'lookup-error'));
        }finally{
            finished=true;clearInterval(ticker);clearTimeout(deadline);progress.hidden=true;release();
        }
    })();
    </script>`;
}

function renderEsperaAutomatica() {
    return `<div id="lookup-wait" style="max-width:660px;margin:30px auto;padding:32px;border:1px solid #28465a;border-radius:20px;background:#101b2d;text-align:center;color:#e6f9ff;font-family:Inter,sans-serif"><div style="font-size:12px;color:#67e8f9;letter-spacing:2px">BÚSQUEDA AUTOMÁTICA</div><h2>Buscando tu código…</h2><div id="lookup-seconds" style="font-size:48px;font-weight:700;color:#9cffe2">60 s</div><p style="color:#a6b6cc;line-height:1.7">Revisando Gmail y el servidor de códigos.<br>No necesitas volver a pulsar el botón.</p></div><script>window.lookupStarted=Date.now();window.lookupClock=setInterval(function(){var left=Math.max(0,60-Math.floor((Date.now()-window.lookupStarted)/1000));var el=document.getElementById('lookup-seconds');if(el)el.textContent=left>0?left+' s':'Finalizando…';if(left===0)clearInterval(window.lookupClock);},250);</script>`;
}
function renderBusquedaCombinada(resultado, email, etiqueta, tiempo) {
    const cards = resultado.sources.map(item => {
        const content = item.success
            ? (item.code ? `<div class="dual-code">${escapeResultado(item.code)}</div>` : '<p>Enlace de verificación disponible</p>') +
              (item.link ? `<a class="dual-button" href="${escapeResultado(item.link)}" target="_blank" rel="noopener noreferrer">Abrir enlace ↗</a>` : '') +
              `<button class="dual-button dual-copy" data-copy="${escapeResultado(item.code || item.link)}">Copiar ${item.code ? 'código' : 'enlace'}</button>`
            : `<p class="dual-note">${escapeResultado(item.error)}</p>`;
        return `<section class="dual-card ${item.success ? 'found' : ''}"><div class="dual-card-top"><strong>${item.source === 'Gmail' ? '✉ Gmail' : '◈ Servidor de códigos'}</strong><span class="dual-status">${item.success ? 'Encontrado' : item.status === 'stopped' ? 'Finalizada' : 'Sin resultado'}</span></div>${content}</section>`;
    }).join('');
    return `<style>
    .dual-wrap{max-width:880px;margin:24px auto;padding:24px;box-sizing:border-box;background:linear-gradient(135deg,#101b2d,#0a101d);border:1px solid #26374d;border-radius:22px;color:#f1f5f9}
    .dual-eyebrow{font-size:11px;letter-spacing:2px;color:#67e8f9;font-weight:700}.dual-wrap h2{font-size:25px;margin:12px 0}.dual-note{color:#a6b6cc;font-size:13px;line-height:1.7;overflow-wrap:anywhere}
    .dual-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:24px}.dual-card{padding:22px;background:#101827;border:1px solid #2b3b51;border-radius:15px;min-width:0}.dual-card.found{border-color:#32c998;background:linear-gradient(145deg,#102b2a,#101827)}
    .dual-card-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.dual-status{font-size:10px;padding:6px 9px;border-radius:99px;background:#243249;color:#becbde}.found .dual-status{background:#164936;color:#87f7cc}
    .dual-code{font:700 clamp(27px,5vw,42px) monospace;letter-spacing:5px;padding:26px 0;color:#b0fff0;user-select:all}.dual-button{border:1px solid #395068;background:#172b41;color:#e5faff;border-radius:9px;padding:11px 14px;cursor:pointer;text-decoration:none;display:inline-block;margin:6px 6px 0 0;font:600 12px Inter,sans-serif}
    .dual-footer{margin-top:20px;color:#8296af;font-size:11px;line-height:1.7}@media(max-width:600px){.dual-grid{grid-template-columns:1fr}.dual-wrap{padding:18px;margin:10px}}
    </style><main class="dual-wrap"><div class="dual-eyebrow">BÚSQUEDA COMBINADA · NETFLIX</div><h2>${resultado.success ? 'Tu resultado está disponible' : 'Todavía no hay un resultado válido'}</h2><p class="dual-note">${escapeResultado(etiqueta)}<br>${escapeResultado(email)}</p><div class="dual-grid">${cards}</div><div class="dual-footer">Búsqueda automática · ${(tiempo / 1000).toFixed(1)} s<br>Gmail: mensajes de los últimos 5 minutos. Servidor de códigos: resultado autorizado por su API; no garantiza que sea un código nuevo.</div></main>
    <script>window.parent.postMessage('lookup-complete',location.origin);document.querySelectorAll('.dual-copy').forEach(function(button){button.addEventListener('click',async function(){try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='✓ Copiado';}catch(e){button.textContent='Selecciona y copia el resultado';}});});</script>`;
}
// END DUAL LOOKUP HELPERS

async function buscarEnBuzonImap(correoBuzon, correoIngresado, plataforma, partes, accion, signal) {
    const passwordSeleccionado = CUENTAS_GMAIL_MAP[correoBuzon];
    if (!passwordSeleccionado) return null;

    const config = { imap: { user: correoBuzon, password: passwordSeleccionado, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 15000 } };
    let connection = null;
    const close = () => { if (connection) { try { connection.end(); } catch (_) {} } };
    if (signal && signal.aborted) return null;
    if (signal) signal.addEventListener('abort', close, { once: true });
    try {
        connection = await imaps.connect(config);
        if (signal && signal.aborted) { close(); return null; }
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

            if (['signin_4digit', 'signin_6digit', 'household', 'reset_link'].includes(accion)) {
                for (const candidate of searchResults.slice(0, 10)) {
                    if (signal && signal.aborted) return null;
                    const received = new Date(candidate.attributes.date).getTime();
                    if (Number.isFinite(received) && received < Date.now() - 5 * 60000) continue;
                    const fetched = await connection.search([['UID', candidate.attributes.uid]], { bodies: [''], struct: true });
                    if (!fetched.length) continue;
                    const part = fetched[0].parts.find(p => p.which === '');
                    if (!part) continue;
                    const parsed = await simpleParser(part.body);
                    if (extraerCodigoGmail(parsed, accion).success) return { messages: fetched, mail: parsed, buzón: correoBuzon };
                }
                return null;
            }
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
    } finally {
        if (signal) signal.removeEventListener('abort', close);
        close();
    }
}

app.post('/buscar', async (req, res) => {
    const { email_search, accion, plataforma } = req.body;
    const tiposApiGhoulflix = ['signin_6digit', 'signin_4digit', 'household', 'reset_link'];
    
    const cssIframe = `<style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        body, html { 
            font-family: 'Inter', sans-serif !important; 
            background: transparent !important; 
            color: #f8fafc;
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

        .api-result-box {
            max-width: 520px;
            margin: 35px auto;
            background: rgba(10, 14, 22, 0.95);
            border: 1px solid rgba(0, 210, 255, 0.35);
            border-radius: 16px;
            padding: 30px;
            text-align: center;
            box-shadow: 0 15px 40px rgba(0, 0, 0, 0.9);
        }
        .code-pill {
            font-family: monospace;
            font-size: 40px;
            font-weight: 700;
            letter-spacing: 6px;
            color: #00D2FF;
            background: #000;
            border: 1px solid rgba(0, 210, 255, 0.4);
            padding: 18px 28px;
            border-radius: 12px;
            display: inline-block;
            margin: 18px 0;
            user-select: all;
        }
        .btn-copy-api {
            background: #00D2FF;
            color: #000;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 700;
            cursor: pointer;
            text-transform: uppercase;
            font-size: 12px;
            text-decoration: none;
            display: inline-block;
            margin-top: 10px;
        }
    </style>`;

    try {
        let correoIngresado = (email_search || "").trim().toLowerCase();
        
        const esAdminPrincipal = (req.session.user === 'admin' || req.session.user === 'ruben');
        const esCliente = (req.session.rol === 'Cliente');
        const esSubAdmin = (req.session.rol === 'Subadministrador');
        if (!req.session.uid || (!esAdminPrincipal && !esCliente && !esSubAdmin && req.session.rol !== 'Administrador')) return res.status(403).send('Perfil no autorizado.');
        if (!/^[^\s@<>"\x27]+@[^\s@<>"\x27]+\.[^\s@<>"\x27]+$/.test(correoIngresado) || correoIngresado.length > 254) return res.status(422).send('Correo no válido.');


        // Validación de permisos por rol según las reglas de Customer y Subadmin Pool
        if (esCliente && !esAdminPrincipal) {
            const tieneAcceso = await dbGet("SELECT id FROM correos WHERE user_id = ? AND email = ?", [req.session.uid, correoIngresado]);
            if (!tieneAcceso) {
                return res.send(`${cssIframe}<div class="api-result-box" style="border-color:#E50914;"><h2 style="color:#E50914; margin-top:0;">⛔ Not assigned to your profile</h2><p style="color:#cbd5e1; font-size:13px;">No tienes este correo asignado a tu perfil. Solicítalo a tu administrador o subadministrador.</p></div>`);
            }
        } else if (esSubAdmin && !esAdminPrincipal) {
            const enPool = await dbGet(`
                SELECT c.id FROM correos c 
                JOIN usuarios u ON c.user_id = u.id 
                WHERE c.email = ? AND (c.user_id = ? OR u.creado_por = ?)
            `, [correoIngresado, req.session.uid, req.session.uid]);
            const enStockPropio = await dbGet("SELECT id FROM stock_cuentas WHERE email = ? AND propietario_id = ?", [correoIngresado, req.session.uid]);
            if (!enPool && !enStockPropio) {
                return res.send(`${cssIframe}<div class="api-result-box" style="border-color:#E50914;"><h2 style="color:#E50914; margin-top:0;">⛔ Not in your subadmin pool</h2><p style="color:#cbd5e1; font-size:13px;">El correo <strong>${correoIngresado}</strong> no pertenece a tu pool de subadministrador.</p></div>`);
            }
        }

        // 🚀 SI SE USÓ UNO DE LOS 4 BOTONES DE CÓDIGO TIPO API (signin_6digit, signin_4digit, household, reset_link)
        if (tiposApiGhoulflix.includes(accion)) {
            const startMs = Date.now();
            const etiquetasTipo = {
                'signin_6digit': '🔢 Código de Inicio de Sesión (6 Dígitos)',
                'signin_4digit': '📺 Código de TV / Dispositivo (4 Dígitos)',
                'household': '🏠 Verificación de Hogar / Viaje',
                'reset_link': '🔑 Enlace de Restablecimiento de Contraseña'
            };

            if (plataforma !== 'netflix') {
                return res.send(`${cssIframe}<div class="api-result-box">La búsqueda combinada de códigos está disponible para Netflix.</div>`);
            }
            res.setHeader('Cache-Control', 'no-store');
            return res.send(cssIframe + renderBusquedaCliente(correoIngresado, accion, etiquetasTipo[accion]));
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

        // 🚀 LÓGICA DE DETECCIÓN INTELUGUENTE DE PAÍS
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

    } catch (err) { if (res.headersSent) { if (!res.destroyed) res.end('<p>La búsqueda se interrumpió. Vuelve a intentarlo.</p>'); return; } res.send(`${cssIframe}<h2 style="color:#00D2FF; text-align:center; padding:20px; font-weight:300;">Error en la Búsqueda</h2>`); }
});

app.listen(10000, () => {
    console.log("🚀 SISTEMA CENTRAL INICIADO EN EL PUERTO 10000");
});
