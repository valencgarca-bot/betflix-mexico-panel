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
const NUMERO_ASISTENTE = '573113092659';

// 📌 CONFIGURACIÓN BASE API GHOULFLIX
const GHOULFLIX_BASE_URL = 'https://ghoulflix.com';
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

const PAISES_MAPA = {
    'BR': { nombre: 'Brasil', bandera: '🇧🇷' },
    'JP': { nombre: 'Japón', bandera: '🇯🇵' },
    'US': { nombre: 'Estados Unidos', bandera: '🇺🇸' },
    'CA': { nombre: 'Canadá', bandera: '🇨🇦' },
    'MX': { nombre: 'México', bandera: '🇲🇽' },
    'CO': { nombre: 'Colombia', bandera: '🇨🇴' },
    'ES': { nombre: 'España', bandera: '🇪🇸' },
    'AR': { nombre: 'Argentina', bandera: '🇦🇷' },
    'CL': { nombre: 'Chile', bandera: '🇨🇱' },
    'PE': { nombre: 'Perú', bandera: '🇵🇪' },
    'OTRO': { nombre: 'Otro País', bandera: '🌐' }
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

function validarTelefonoConCodigo(telefono) {
    if (!telefono) return false;
    const limpio = telefono.toString().replace(/\s+/g, '').trim();
    return /^\+[1-9]\d{7,14}$/.test(limpio);
}

function formatearTelefono(telefono) {
    if (!telefono) return null;
    let tel = telefono.toString().replace(/\s+/g, '').trim();
    if (!tel) return null;
    if (tel.startsWith('+')) return tel;
    if (tel.startsWith('52') && tel.length === 12) return '+' + tel;
    return '+52' + tel;
}

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

// ✅ ESTRUCTURA DE BASE DE DATOS Y MIGRACIONES PERMANENTES
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
    db.run("ALTER TABLE stock_cuentas ADD COLUMN propietario_id INTEGER DEFAULT 1", (err) => {});
    db.run("ALTER TABLE stock_cuentas ADD COLUMN pais TEXT DEFAULT 'US'", (err) => {});

    db.run("CREATE TABLE IF NOT EXISTS compras_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, subadmin_id INTEGER, cantidad INTEGER, creditos_usados REAL, saldo_anterior REAL, saldo_nuevo REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    
    db.run("CREATE TABLE IF NOT EXISTS detalles_compras (id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER, cuenta_id INTEGER, email_cuenta TEXT)");
    db.run("ALTER TABLE detalles_compras ADD COLUMN password_cuenta TEXT", (err) => {});

    db.run("CREATE TABLE IF NOT EXISTS historial_asignaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, receptor_id INTEGER, admin_id INTEGER, fecha DATETIME DEFAULT (datetime('now', 'localtime')), tipo_operacion TEXT DEFAULT 'Asignación manual', estado TEXT DEFAULT 'Asignada')");

    db.run("CREATE TABLE IF NOT EXISTS config_ghoulflix (id INTEGER PRIMARY KEY CHECK (id = 1), login_id TEXT, password TEXT, token TEXT, updated_at DATETIME DEFAULT (datetime('now', 'localtime')))");
    db.run("INSERT OR IGNORE INTO config_ghoulflix (id, login_id, password, token) VALUES (1, '', '', '')");

    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por, moneda) VALUES ('admin', '14032021', 'Administrador', NULL, 'MXN')", (err) => {});
    db.run("UPDATE usuarios SET user = 'admin', pass = '14032021' WHERE user = 'dueño'", (err) => {});

    db.run("UPDATE usuarios SET telefono = '+' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) LIKE '52__________'", (err) => {});
    db.run("UPDATE usuarios SET telefono = '+52' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) NOT LIKE '+%'", (err) => {});
    db.run("UPDATE reservas SET telefono = '+52' || TRIM(telefono) WHERE telefono IS NOT NULL AND TRIM(telefono) != '' AND TRIM(telefono) NOT LIKE '+%'", (err) => {});

    db.run("CREATE TABLE IF NOT EXISTS precios_subadmin (id INTEGER PRIMARY KEY AUTOINCREMENT, subadmin_id INTEGER, paquete INTEGER, precio REAL, UNIQUE(subadmin_id, paquete))");
    db.run("CREATE TABLE IF NOT EXISTS historial_dinero (id INTEGER PRIMARY KEY AUTOINCREMENT, emisor_id INTEGER, receptor_id INTEGER, monto REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");

    // 🌟 TABLAS NUEVAS
    db.run(`CREATE TABLE IF NOT EXISTS historial_creditos_operaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operador_id INTEGER,
        cliente_id INTEGER,
        tipo TEXT,
        cantidad REAL,
        saldo_anterior REAL,
        saldo_nuevo REAL,
        fecha DATETIME DEFAULT (datetime('now', 'localtime'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS asignaciones_bloques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asignador_id INTEGER,
        cliente_id INTEGER,
        cantidad INTEGER,
        precio_total REAL,
        precio_unitario REAL,
        fecha_asignacion DATETIME DEFAULT (datetime('now', 'localtime')),
        fecha_vencimiento DATETIME,
        estado TEXT DEFAULT 'Activo'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS cuentas_cliente_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bloque_id INTEGER,
        cliente_id INTEGER,
        email TEXT,
        password TEXT,
        pais TEXT DEFAULT 'US',
        fecha_asignacion DATETIME DEFAULT (datetime('now', 'localtime')),
        fecha_vencimiento DATETIME,
        estado TEXT DEFAULT 'Activa',
        es_reemplazo_de TEXT DEFAULT NULL,
        reemplazada_por TEXT DEFAULT NULL,
        fecha_reemplazo DATETIME DEFAULT NULL,
        precio_unitario REAL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS cuentas_caidas_registro (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        cliente_id INTEGER,
        fecha_compra DATETIME,
        fecha_reporte DATETIME DEFAULT (datetime('now', 'localtime')),
        precio REAL,
        pais TEXT DEFAULT 'US',
        estado TEXT DEFAULT 'Pendiente',
        reemplazo_email TEXT DEFAULT NULL,
        fecha_reemplazo DATETIME DEFAULT NULL
    )`);
});

// 🔄 VENCIMIENTO DE CUENTAS CADA 10 MINUTOS
async function verificarVencimientoCuentas() {
    try {
        await dbRun(`
            UPDATE cuentas_cliente_detalle 
            SET estado = 'Vencida' 
            WHERE estado = 'Activa' AND datetime(fecha_vencimiento) <= datetime('now', 'localtime')
        `);
        await dbRun(`
            UPDATE asignaciones_bloques 
            SET estado = 'Vencido' 
            WHERE estado = 'Activo' AND datetime(fecha_vencimiento) <= datetime('now', 'localtime')
        `);
    } catch(e) {}
}
setInterval(verificarVencimientoCuentas, 10 * 60 * 1000);
verificarVencimientoCuentas();

// =========================================================================
// 🌐 API GHOULFLIX
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

    if (!token) return { success: false, code: null, link: null, response_time_ms: 0, error: 'Token o credenciales del servidor de códigos no configurados.' };

    try {
        let resp = await peticionHttpsJson(`${GHOULFLIX_BASE_URL}/api/customer/fetch-code`, 'POST', {
            'Authorization': `Bearer ${token}`
        }, {
            email: email.trim().toLowerCase(),
            code_type: code_type
        }, signal);

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

        if ([401, 403, 422, 429].includes(resp.statusCode) || (resp.data && /authentication required|not assigned|not in your|access denied|suspended|disabled|account expired|too many requests|rate limit/i.test(resp.data.error || ''))) {
            return { success: false, source_error: true, terminal: true, error: traducirErrorCodigo(resp.data && resp.data.error, resp.statusCode) };
        }
        if (resp.statusCode >= 200 && resp.statusCode < 300 && resp.data) return resp.data;
        return { success: false, code: null, link: null, response_time_ms: 0, error: `Error HTTP ${resp.statusCode} desdel servidor de códigos.` };
    } catch (err) {
        return { success: false, code: null, link: null, response_time_ms: 0, error: err.message };
    }
}

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
        --card-bg: rgba(12, 16, 24, 0.94);
        --card-border: rgba(255, 215, 0, 0.25);
        --accent: #FFD700;
        --accent-hover: #FBBF24;
        --btn-bg: rgba(229, 9, 20, 0.15);
        --shadow-elegant: 0 15px 40px rgba(0, 0, 0, 0.9);
        --blur-effect: blur(12px);
        --radius: 14px;
    }
    @keyframes pureSeriesSlideshow {
        0% { background-image: linear-gradient(rgba(10, 0, 0, 0.75), rgba(0, 10, 0, 0.75)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
        33% { background-image: linear-gradient(rgba(10, 0, 0, 0.75), rgba(0, 10, 0, 0.75)), url('https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=2000&auto=format&fit=crop'); }
        66% { background-image: linear-gradient(rgba(10, 0, 0, 0.75), rgba(0, 10, 0, 0.75)), url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2000&auto=format&fit=crop'); }
        100% { background-image: linear-gradient(rgba(10, 0, 0, 0.75), rgba(0, 10, 0, 0.75)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
    }
    body { 
        background-size: cover; background-position: center; background-attachment: fixed; 
        animation: pureSeriesSlideshow 18s ease infinite; background-color: #050505; 
        color: var(--text-main); font-family: 'Inter', sans-serif; 
        margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; min-height: 100vh; 
    }
    
    .snowflake-anim {
        position: absolute; top: -30px; color: rgba(255, 255, 255, 0.9);
        text-shadow: 0 0 8px rgba(255,255,255,0.8);
        animation: fall linear infinite; pointer-events: none;
    }
    @keyframes fall {
        0% { transform: translateY(-20px) translateX(0px) rotate(0deg); opacity: 1; }
        100% { transform: translateY(105vh) translateX(30px) rotate(360deg); opacity: 0.2; }
    }
    .lights-container {
        position: fixed; top: -5px; width: 100%; height: 20px; z-index: 9999;
        pointer-events: none; display: flex; justify-content: space-around;
    }
    .light {
        width: 10px; height: 15px; border-radius: 50%;
        background: #ff0000; box-shadow: 0 5px 15px #ff0000;
        animation: blink 1.5s infinite alternate; margin: 0 5px;
    }
    .light:nth-child(even) { background: #22c55e; box-shadow: 0 5px 15px #22c55e; animation-delay: 0.5s; }
    .light:nth-child(3n) { background: #FFD700; box-shadow: 0 5px 15px #FFD700; animation-delay: 1s; }
    .light:nth-child(4n) { background: #3b82f6; box-shadow: 0 5px 15px #3b82f6; animation-delay: 1.5s; }
    @keyframes blink {
        0% { opacity: 0.3; transform: scale(0.9); }
        100% { opacity: 1; transform: scale(1.2); }
    }

    /* 🎅 PAPÁ NOEL BAILANDO ANIMADO Y FLUIDO */
    .santa-dancer-container {
        position: fixed; bottom: 12px; right: 20px; z-index: 10000;
        display: flex; flex-direction: column; align-items: center;
        pointer-events: none;
    }
    .santa-dancing-avatar {
        width: 110px; height: 110px;
        animation: santaDance 2.4s ease-in-out infinite;
        transform-origin: bottom center;
        filter: drop-shadow(0 10px 18px rgba(0,0,0,0.85));
    }
    .santa-tag {
        background: linear-gradient(135deg, #E50914, #990000);
        color: #fff; border: 2px solid #FFD700;
        padding: 6px 14px; border-radius: 8px; font-weight: 800;
        font-size: 11px; margin-bottom: -10px; z-index: 2;
        box-shadow: 0 4px 15px rgba(0,0,0,0.6); text-transform: uppercase;
        animation: santaTagBob 2.4s ease-in-out infinite;
    }
    @keyframes santaDance {
        0% { transform: translateY(0) rotate(0deg) scale(1); }
        15% { transform: translateY(-16px) rotate(-8deg) scale(1.04); }
        30% { transform: translateY(0) rotate(6deg) scale(0.98); }
        45% { transform: translateY(-18px) rotate(-6deg) scale(1.05); }
        60% { transform: translateY(0) rotate(8deg) scale(0.97); }
        75% { transform: translateY(-14px) rotate(-4deg) scale(1.02); }
        100% { transform: translateY(0) rotate(0deg) scale(1); }
    }
    @keyframes santaTagBob {
        0%, 100% { transform: rotate(-4deg); }
        50% { transform: rotate(4deg); }
    }

    .top-header { 
        background: rgba(10, 0, 0, 0.65); 
        border-bottom: 1px solid var(--card-border);
        backdrop-filter: var(--blur-effect);
        padding: 16px 35px; 
        display: flex; 
        justify-content: space-between; 
        align-items: center; 
        position: sticky; top: 0; z-index: 50;
    }
    .user-pill { 
        display: flex; align-items: center; gap: 12px; background: rgba(255, 255, 255, 0.03); 
        padding: 10px 16px; border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); 
        border-radius: 12px; cursor: pointer; transition: 0.25s; width: 100%; box-sizing: border-box;
    }
    .user-pill:hover { border-color: #E50914; background: rgba(229, 9, 20, 0.15); }
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
    .search-top input:focus { border-color: var(--accent); width: 290px; box-shadow: 0 0 15px rgba(255,215,0,0.2); }
    
    .dashboard-grid { 
        display: grid; 
        grid-template-columns: 290px 1fr 290px; 
        gap: 22px; 
        padding: 25px 35px 40px 35px; 
        align-items: start; 
        max-width: 1750px;
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
    .action-btn-pill:hover { background: var(--btn-bg); border-color: var(--accent); transform: translateY(-1px); }
    
    .api-grid-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 4px; }
    
    .search-input-large { 
        width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); 
        padding: 16px 20px; border-radius: 10px; font-size: 14px; margin-top: 8px; 
        color: var(--text-main); outline: none; box-sizing: border-box; font-family: 'Inter', sans-serif; transition: 0.3s; 
    }
    .search-input-large:focus { border-color: var(--accent); box-shadow: 0 0 20px rgba(255,215,0,0.25); }
    
    .iframe-container { display: none; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; height: 560px; width: 100%; overflow: hidden; box-shadow: var(--shadow-elegant); }
    
    .side-card { background: var(--card-bg); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); }
    .side-card h4 { margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent); font-weight: 700; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px; display: flex; align-items: center; gap: 6px; }
    
    .menu-group-label {
        font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-muted);
        margin: 12px 0 4px 6px; font-weight: 700;
    }
    .menu-group-label:first-child { margin-top: 0; }
    
    .plat-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .plat-mini-btn { background: #000000; border: 1px solid var(--card-border); padding: 12px; border-radius: 10px; cursor: pointer; display: flex; justify-content: center; align-items: center; height: 52px; transition: 0.25s; }
    .plat-mini-btn:hover, .plat-mini-btn.active-plat { background: rgba(255, 215, 0, 0.15); border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 5px 15px rgba(255,215,0,0.25); }
    .plat-mini-btn img { max-height: 24px; max-width: 85%; object-fit: contain; }
    
    .provider-contact { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
    .contact-wrapper { display: flex; flex-direction: column; gap: 4px; }
    .contact-label { font-size: 10px; color: var(--text-muted); text-align: center; }
    .contact-btn { background: #000; border: 1px solid var(--card-border); padding: 10px 8px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; color: #fff; font-size: 11px; font-weight: 600; transition: 0.25s; box-sizing: border-box; }
    .contact-btn.telegram:hover { background: rgba(0, 136, 204, 0.2); border-color: #0088cc; }
    .contact-btn.whatsapp:hover { background: rgba(37, 211, 102, 0.2); border-color: #25d366; }
    
    .menu-list { display: flex; flex-direction: column; gap: 4px; }
    .menu-btn-item { 
        background: rgba(255, 255, 255, 0.02); border: 1px solid transparent; 
        padding: 10px 12px; border-radius: 8px; font-size: 12px; font-weight: 500;
        color: var(--text-main); cursor: pointer; text-align: left; transition: 0.2s; 
        font-family: 'Inter', sans-serif; display: flex; align-items: center; gap: 8px;
    }
    .menu-btn-item:hover { background: rgba(255, 215, 0, 0.12); border-color: rgba(255, 215, 0, 0.35); transform: translateX(3px); }
    .menu-btn-item.active-menu { background: rgba(255, 215, 0, 0.18); border-color: var(--accent); color: #fff; font-weight: 600; }
    
    .activity-list { display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; padding-right: 4px; }
    .activity-item { background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); padding: 10px 12px; border-radius: 8px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
    .activity-item strong { color: var(--text-main); font-weight: 500; word-break: break-all; font-size: 11px; }
    .activity-meta { display: flex; justify-content: space-between; align-items: center; color: var(--text-muted); font-size: 10px; }
    .activity-user { color: var(--accent); font-weight: 600; }
    
    .input-classic { width: 100%; padding: 12px 14px; margin-bottom: 12px; border-radius: 8px; border: 1px solid var(--card-border); background: #000000; color: white; box-sizing: border-box; outline: none; font-size: 13px; font-family: 'Inter', sans-serif; }
    .input-classic:focus { border-color: var(--accent); box-shadow: 0 0 12px rgba(255,215,0,0.2); }
    
    .btn-submit { background: var(--accent); color: #000; border: none; padding: 13px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; transition: 0.25s; text-transform: uppercase; letter-spacing: 0.8px; font-size: 12px; }
    .btn-submit:hover { background: var(--accent-hover); box-shadow: 0 0 20px rgba(255, 215, 0, 0.4); color: #000; }
    
    .sub-form { display: none; background: rgba(0,0,0,0.75); padding: 15px; border-radius: 10px; margin-top: 6px; border: 1px solid rgba(255,255,255,0.12); }
    
    .table-wrapper { background: #000000; border: 1px solid var(--card-border); border-radius: 10px; overflow-x: auto; margin-top: 15px; }
    .table-modern { width: 100%; border-collapse: collapse; text-align: left; }
    .table-modern th { padding: 13px 15px; font-size: 10px; color: var(--accent); border-bottom: 1px solid rgba(255,255,255,0.12); text-transform: uppercase; letter-spacing: 1px; background: rgba(255,255,255,0.02); }
    .table-modern td { padding: 12px 15px; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #f8fafc; vertical-align: top; }
    .badge-status { padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; display: inline-block; }
    .badge-status.disp { background: rgba(37,211,102,0.15); color: #25d366; border: 1px solid #25d366; }
    .badge-status.vendida { background: rgba(229,9,20,0.15); color: #E50914; border: 1px solid #E50914; }
    .badge-status.vencida { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444; }
    .badge-status.garantia { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid #3b82f6; }

    .country-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(255,255,255,0.08); border-radius: 4px; font-size: 11px; }

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
        if (filtro && primerVisible) select.value = primerVisible.value;
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
            if (['signin_6digit','signin_4digit','household','reset_link','buzon_completo'].includes(actionName)) lookupBusyUntil = Date.now() + 65000;
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

const CHRISTMAS_EXTRAS = `
    <div class="santa-dancer-container">
        <div class="santa-tag">🎄 ¡Feliz Navidad! 🎅</div>
        <svg class="santa-dancing-avatar" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="60" cy="85" rx="34" ry="28" fill="#E50914" />
            <rect x="26" y="80" width="68" height="10" fill="#111" rx="3" />
            <rect x="52" y="77" width="16" height="16" fill="#FFD700" rx="3" />
            <rect x="55" y="80" width="10" height="10" fill="#111" rx="2" />
            <circle cx="60" cy="50" r="22" fill="#ffd1b3" />
            <path d="M 40 54 Q 60 90 80 54 Q 60 70 40 54" fill="#ffffff" />
            <ellipse cx="60" cy="56" rx="6" ry="4" fill="#e57373" />
            <circle cx="52" cy="48" r="3" fill="#222" />
            <circle cx="68" cy="48" r="3" fill="#222" />
            <path d="M 38 42 Q 60 12 82 42 Z" fill="#E50914" />
            <rect x="36" y="38" width="48" height="8" rx="4" fill="#ffffff" />
            <circle cx="78" cy="18" r="7" fill="#ffffff" />
            <circle cx="28" cy="98" r="10" fill="#111" />
            <circle cx="92" cy="98" r="10" fill="#111" />
            <circle cx="36" cy="110" r="8" fill="#111" />
            <circle cx="84" cy="110" r="8" fill="#111" />
        </svg>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const snowContainer = document.createElement('div');
            snowContainer.style.position = 'fixed';
            snowContainer.style.top = '0';
            snowContainer.style.left = '0';
            snowContainer.style.width = '100vw';
            snowContainer.style.height = '100vh';
            snowContainer.style.pointerEvents = 'none';
            snowContainer.style.zIndex = '9998';
            snowContainer.style.overflow = 'hidden';
            document.body.appendChild(snowContainer);

            for (let i = 0; i < 35; i++) {
                let flake = document.createElement('div');
                flake.innerHTML = '❄';
                flake.className = 'snowflake-anim';
                flake.style.left = Math.random() * 100 + 'vw';
                flake.style.animationDuration = (Math.random() * 3 + 5) + 's';
                flake.style.animationDelay = (Math.random() * 5) + 's';
                flake.style.fontSize = (Math.random() * 10 + 10) + 'px';
                flake.style.opacity = Math.random() * 0.7 + 0.3;
                snowContainer.appendChild(flake);
            }

            const lightsContainer = document.createElement('div');
            lightsContainer.className = 'lights-container';
            for(let i=0; i<40; i++) {
                let light = document.createElement('div');
                light.className = 'light';
                lightsContainer.appendChild(light);
            }
            document.body.appendChild(lightsContainer);
        });
    </script>
`;

// =========================================================================
// 🔑 ENDPOINTS DE API OFICIAL
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
            success: false, code: null, link: null, response_time_ms: Date.now() - startMs,
            error: 'HTTP 422: Check required JSON fields (email, code_type) and their types.'
        });
    }

    try {
        let currentUser = null;
        if (req.session && req.session.uid) {
            currentUser = await dbGet("SELECT * FROM usuarios WHERE id = ?", [req.session.uid]);
        }
        if (!currentUser) {
            const authHeader = req.headers['authorization'] || '';
            if (authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7).trim();
                if (token) currentUser = await dbGet("SELECT * FROM usuarios WHERE api_token = ?", [token]);
            }
        }

        if (!currentUser) {
            return res.status(401).json({
                success: false, code: null, link: null, response_time_ms: Date.now() - startMs,
                error: 'Authentication required. Please sign in to fetch codes.'
            });
        }

        const correoLimpio = email.trim().toLowerCase();
        const esAdmin = (currentUser.rol === 'Administrador' || currentUser.user === 'admin' || currentUser.user === 'ruben');

        if (!esAdmin && !['Cliente', 'Subadministrador'].includes(currentUser.rol)) return res.status(403).json({ success: false, error: 'Perfil no autorizado.' });
        
        if (!esAdmin) {
            if (currentUser.rol === 'Cliente') {
                const cuentaDetalle = await dbGet("SELECT estado, precio_unitario FROM cuentas_cliente_detalle WHERE cliente_id = ? AND email = ? ORDER BY id DESC LIMIT 1", [currentUser.id, correoLimpio]);
                if (cuentaDetalle && cuentaDetalle.estado === 'Vencida') {
                    return res.status(403).json({
                        success: false, code: null, link: null, response_time_ms: Date.now() - startMs,
                        error: `⚠️ CUENTA VENCIDA. Debes renovarla pagando ${formatearDinero(cuentaDetalle.precio_unitario, currentUser.moneda)} para volver a usarla.`
                    });
                }

                const asignado = await dbGet("SELECT id FROM correos WHERE user_id = ? AND email = ?", [currentUser.id, correoLimpio]);
                if (!asignado) {
                    return res.status(403).json({
                        success: false, code: null, link: null, response_time_ms: Date.now() - startMs,
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
                        success: false, code: null, link: null, response_time_ms: Date.now() - startMs,
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
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ ...resultado, response_time_ms: Date.now() - startMs });

    } catch (err) {
        return res.status(500).json({
            success: false, code: null, link: null, response_time_ms: Date.now() - startMs,
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
            <h3 style="color: var(--accent); margin: 0 0 5px 0; font-size: 18px; font-weight: 600;">¡Bienvenido a SyncBox! 🎄</h3>
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
                    <input type="tel" name="telefono" placeholder="WhatsApp con + y código (Ej: +52...)" pattern="^\\+[1-9]\\d{7,14}$" title="Obligatorio incluir el signo + y el código de tu país" required>
                    <small style="display:block; text-align:left; color:var(--accent); font-size:11px; margin-top:5px;">* Obligatorio poner el <b>+</b> y código de país (Ej: +52 o +57)</small>
                </div>
                <div class="input-group"><input type="password" name="pass" placeholder="Elige tu Contraseña" required></div>
                <button type="submit" class="btn-submit">Completar Registro</button>
            </form>
            <div style="margin-top: 20px;"><a href="/" style="color: var(--accent); font-size: 12px; text-decoration: none;">← Volver al Login</a></div>
        `;
    } else {
        contenidoForm = `
            ${mensajeBienvenida}
            <form action="/login" method="POST">
                <div class="input-group"><input type="text" name="user" placeholder="Usuario" required></div>
                <div class="input-group"><input type="password" name="pass" placeholder="Contraseña" required></div>
                <button type="submit" class="btn-submit">Ingresar</button>
            </form>
            <div style="margin-top: 20px;"><a href="/?mode=registro" style="color: var(--accent); font-size: 12px; text-decoration: none;">¿No tienes cuenta? Regístrate aquí</a></div>
        `;
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Acceso Navideño - SyncBox</title>
        ${CSS_MODERNO}
        <style>
            body { display: flex; justify-content: center; align-items: center; }
            .login-box { position: relative; z-index: 2; background: rgba(0, 0, 0, 0.92); border: 1px solid rgba(255, 215, 0, 0.25); border-radius: 16px; padding: 40px 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.98); text-align: center; margin: 15px; }
            .input-group { margin-bottom: 20px; }
            .input-group input { width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; height: 52px; padding: 0 20px; box-sizing: border-box; font-size: 14px; border-radius: 8px; outline: none; transition: 0.3s; }
            .input-group input:focus { border-color: var(--accent); box-shadow: 0 0 15px rgba(255,215,0,0.2);}
            .help-text { color: #888; font-size: 12px; margin-top: 20px; margin-bottom: 5px; line-height: 1.6; font-weight: 300; }
        </style>
    </head>
    <body>
        <div class="login-box">
            ${logosReconocidos}
            ${contenidoForm}
            <div class="help-text">Panel seguro y cifrado.</div>
        </div>
        ${CHRISTMAS_EXTRAS}
    </body>
    </html>
    `);
});

app.post('/registrar-cliente', async (req, res) => {
    const { user, pass, telefono } = req.body;
    const telLimpio = (telefono || '').toString().replace(/\s+/g, '').trim();

    if (!validarTelefonoConCodigo(telLimpio)) {
        return res.send("<script>alert('⛔ ERROR OBLIGATORIO: Debes colocar el signo + seguido del código de tu país (Ejemplo: +521234567890 o +573001234567).'); window.location='/?mode=registro';</script>");
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
            <title>Registro Exitoso</title>
            ${CSS_MODERNO}
            <style>
                body { background: #000; color: #fff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
                h2 { color: #25d366; font-size: 24px; }
                p { color: #a3a3a3; font-size: 14px; margin-bottom: 30px; }
                .btn { background: #25d366; color: #000; padding: 18px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 5px 20px rgba(37,211,102,0.4); }
            </style>
        </head>
        <body>
            <h2>✅ ¡Registro Exitoso!</h2>
            <p>Se ha creado tu cuenta. Haz clic abajo para confirmar por WhatsApp.</p>
            <a href="${linkRedireccion}" class="btn">Confirmar por WhatsApp</a>
            <script>window.location.replace('${linkRedireccion}');</script>
            ${CHRISTMAS_EXTRAS}
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

// =========================================================================
// 💰 MEJORA 2: GESTIÓN DE CRÉDITOS
// =========================================================================
app.post('/admin/gestionar-creditos', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { cliente_id, accion_credito, cantidad } = req.body;
    const monto = parseFloat(cantidad);

    if (!cliente_id || !monto || monto <= 0) {
        return res.send("<script>alert('⛔ Debes seleccionar un usuario y una cantidad válida.'); window.location='/dash';</script>");
    }

    try {
        const operador = await dbGet("SELECT id, user, rol, creditos, moneda FROM usuarios WHERE id = ?", [req.session.uid]);
        const cliente = await dbGet("SELECT id, user, creditos, moneda, creado_por FROM usuarios WHERE id = ?", [cliente_id]);

        if (!cliente) return res.send("<script>alert('Usuario no encontrado.'); window.location='/dash';</script>");

        if (req.session.rol === 'Subadministrador' && cliente.creado_por !== req.session.uid) {
            return res.send("<script>alert('⛔ No tienes permiso para editar créditos de este usuario.'); window.location='/dash';</script>");
        }

        const montoMXN = convertirAMXN(monto, operador.moneda);
        let nuevoSaldoMXN = cliente.creditos;

        if (accion_credito === 'AGREGAR') {
            if (req.session.rol === 'Subadministrador' && operador.creditos < montoMXN) {
                return res.send("<script>alert('⛔ No tienes saldo suficiente en tu cuenta para asignar.'); window.location='/dash';</script>");
            }
            if (req.session.rol === 'Subadministrador') {
                await dbRun("UPDATE usuarios SET creditos = creditos - ? WHERE id = ?", [montoMXN, operador.id]);
            }
            nuevoSaldoMXN += montoMXN;
        } else if (accion_credito === 'QUITAR') {
            nuevoSaldoMXN = Math.max(0, cliente.creditos - montoMXN);
            if (req.session.rol === 'Subadministrador') {
                await dbRun("UPDATE usuarios SET creditos = creditos + ? WHERE id = ?", [montoMXN, operador.id]);
            }
        }

        await dbRun("UPDATE usuarios SET creditos = ? WHERE id = ?", [nuevoSaldoMXN, cliente.id]);

        await dbRun(`INSERT INTO historial_creditos_operaciones (operador_id, cliente_id, tipo, cantidad, saldo_anterior, saldo_nuevo) 
                    VALUES (?, ?, ?, ?, ?, ?)`, 
                    [operador.id, cliente.id, accion_credito, montoMXN, cliente.creditos, nuevoSaldoMXN]);

        res.send(`<script>alert('✅ Créditos actualizados exitosamente.\\nUsuario: ${cliente.user}\\nOperación: ${accion_credito}\\nNuevo Saldo: ${formatearDinero(nuevoSaldoMXN, cliente.moneda)}'); window.location='/dash';</script>`);

    } catch (e) {
        console.error(e);
        res.send("<script>alert('Error al gestionar créditos.'); window.location='/dash';</script>");
    }
});

// =========================================================================
// 📦 MEJORA 3, 4 Y 12: ASIGNACIÓN DE BLOQUES A CLIENTES (ADMIN Y SUBADMIN)
// =========================================================================
app.post('/admin/asignar-bloque-cliente', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { cliente_id, correos_bloque, precio_total, pais_cuenta } = req.body;

    if (!cliente_id || !correos_bloque) {
        return res.send("<script>alert('⛔ Debes seleccionar el cliente y los correos a asignar.'); window.location='/dash';</script>");
    }

    try {
        const cliente = await dbGet("SELECT id, user, creado_por, moneda FROM usuarios WHERE id = ?", [cliente_id]);
        if (!cliente) return res.send("<script>alert('Cliente no encontrado.'); window.location='/dash';</script>");

        if (req.session.rol === 'Subadministrador' && cliente.creado_por !== req.session.uid) {
            return res.send("<script>alert('⛔ Solo puedes asignar cuentas a tus propios clientes.'); window.location='/dash';</script>");
        }

        const lineas = correos_bloque.split(/[\n\r,]+/).filter(l => l.trim() !== '');
        let cuentasProcesar = [];

        for (let l of lineas) {
            let match = l.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)(?:[\s:;|/,]*(.*))?/);
            if (match) {
                cuentasProcesar.push({ email: match[1].toLowerCase().trim(), pass: match[2] ? match[2].trim() : '' });
            }
        }

        if (cuentasProcesar.length === 0) {
            return res.send("<script>alert('⛔ No se detectaron correos válidos.'); window.location='/dash';</script>");
        }

        const totalCuentas = cuentasProcesar.length;
        const pTotal = parseFloat(precio_total) || 0;
        const pUnitario = totalCuentas > 0 ? (pTotal / totalCuentas) : 0;
        const paisFinal = pais_cuenta || 'US';

        if (req.session.rol === 'Subadministrador') {
            for (let c of cuentasProcesar) {
                const enStock = await dbGet("SELECT id FROM stock_cuentas WHERE email = ? AND propietario_id = ?", [c.email, req.session.uid]);
                const asignadaAMi = await dbGet("SELECT id FROM correos WHERE email = ? AND user_id = ?", [c.email, req.session.uid]);
                if (!enStock && !asignadaAMi) {
                    return res.send(`<script>alert('⛔ La cuenta ${c.email} no te pertenece.'); window.location='/dash';</script>`);
                }
            }
        }

        const fechaActual = new Date();
        const fechaVence = new Date(fechaActual.getTime() + (30 * 24 * 60 * 60 * 1000));
        const fechaVenceSql = fechaVence.toISOString().replace('T', ' ').substring(0, 19);

        const bloqueRes = await dbRun(`
            INSERT INTO asignaciones_bloques (asignador_id, cliente_id, cantidad, precio_total, precio_unitario, fecha_vencimiento, estado)
            VALUES (?, ?, ?, ?, ?, ?, 'Activo')
        `, [req.session.uid, cliente.id, totalCuentas, pTotal, pUnitario, fechaVenceSql]);

        const bloqueId = bloqueRes.lastID;

        for (let c of cuentasProcesar) {
            await dbRun(`
                INSERT INTO cuentas_cliente_detalle (bloque_id, cliente_id, email, password, pais, fecha_vencimiento, estado, precio_unitario)
                VALUES (?, ?, ?, ?, ?, ?, 'Activa', ?)
            `, [bloqueId, cliente.id, c.email, c.pass, paisFinal, fechaVenceSql, pUnitario]);

            const yaEnCorreos = await dbGet("SELECT id FROM correos WHERE user_id = ? AND email = ?", [cliente.id, c.email]);
            if (!yaEnCorreos) {
                await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [c.email, cliente.id]);
            }

            await dbRun("UPDATE stock_cuentas SET estado = 'Asignada', comprador_id = ?, pais = ? WHERE email = ?", [cliente.id, paisFinal, c.email]);
        }

        res.send(`<script>alert('✅ Bloque de ${totalCuentas} cuentas asignado a @${cliente.user}.\\nVence el: ${fechaVenceSql}'); window.location='/dash';</script>`);

    } catch (e) {
        console.error(e);
        res.send("<script>alert('Error al asignar el bloque de cuentas.'); window.location='/dash';</script>");
    }
});

// =========================================================================
// 🔄 MEJORA 4: CONFIRMAR RENOVACIÓN
// =========================================================================
app.post('/admin/renovar-cuentas', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { cliente_id, bloque_id } = req.body;

    try {
        const fechaNueva = new Date();
        const nuevaFechaVence = new Date(fechaNueva.getTime() + (30 * 24 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19);

        if (bloque_id) {
            await dbRun("UPDATE asignaciones_bloques SET estado = 'Activo', fecha_vencimiento = ? WHERE id = ?", [nuevaFechaVence, bloque_id]);
            await dbRun("UPDATE cuentas_cliente_detalle SET estado = 'Activa', fecha_vencimiento = ? WHERE bloque_id = ?", [nuevaFechaVence, bloque_id]);
        } else if (cliente_id) {
            await dbRun("UPDATE asignaciones_bloques SET estado = 'Activo', fecha_vencimiento = ? WHERE cliente_id = ?", [nuevaFechaVence, cliente_id]);
            await dbRun("UPDATE cuentas_cliente_detalle SET estado = 'Activa', fecha_vencimiento = ? WHERE cliente_id = ?", [nuevaFechaVence, cliente_id]);
        }

        res.send("<script>alert('✅ CUENTAS RENOVADAS. Servicio habilitado por 1 mes más.'); window.location='/dash';</script>");
    } catch (e) {
        console.error(e);
        res.send("<script>alert('Error al renovar cuentas.'); window.location='/dash';</script>");
    }
});

// =========================================================================
// 🔴 MEJORA 5: REPORTE DE CUENTA CAÍDA
// =========================================================================
app.post('/admin/reportar-cuenta-caida', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { email_caida } = req.body;
    const correoLimpio = (email_caida || '').trim().toLowerCase();

    try {
        const cuenta = await dbGet(`
            SELECT ccd.*, u.user as cliente_nombre 
            FROM cuentas_cliente_detalle ccd 
            JOIN usuarios u ON ccd.cliente_id = u.id 
            WHERE LOWER(ccd.email) = ? 
            ORDER BY ccd.id DESC LIMIT 1
        `, [correoLimpio]);

        const fechaCompra = cuenta ? cuenta.fecha_asignacion : new Date().toISOString();
        const precio = cuenta ? cuenta.precio_unitario : 0;
        const clienteId = cuenta ? cuenta.cliente_id : null;
        const pais = cuenta ? cuenta.pais : 'US';

        await dbRun(`
            INSERT INTO cuentas_caidas_registro (email, cliente_id, fecha_compra, precio, pais, estado)
            VALUES (?, ?, ?, ?, ?, 'Pendiente')
        `, [correoLimpio, clienteId, fechaCompra, precio, pais]);

        if (cuenta) {
            await dbRun("UPDATE cuentas_cliente_detalle SET estado = 'Caida' WHERE id = ?", [cuenta.id]);
        }
        await dbRun("UPDATE stock_cuentas SET estado = 'Caida' WHERE LOWER(email) = ?", [correoLimpio]);

        res.send("<script>alert('🔴 Cuenta registrada en CUENTAS CAÍDAS.'); window.location='/dash';</script>");
    } catch (e) {
        console.error(e);
        res.send("<script>alert('Error al reportar cuenta caída.'); window.location='/dash';</script>");
    }
});

// =========================================================================
// 🔄 MEJORA 6 Y 7: CAMBIO POR GARANTÍA
// =========================================================================
app.post('/admin/cambiar-por-garantia', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { caida_id, nueva_cuenta_email } = req.body;
    const nuevoEmail = (nueva_cuenta_email || '').trim().toLowerCase();

    try {
        const caida = await dbGet("SELECT * FROM cuentas_caidas_registro WHERE id = ?", [caida_id]);
        if (!caida) return res.send("<script>alert('Registro no encontrado.'); window.location='/dash';</script>");

        const fechaReemplazo = new Date().toISOString().replace('T', ' ').substring(0, 19);

        await dbRun(`
            UPDATE cuentas_caidas_registro 
            SET estado = 'Reemplazada', reemplazo_email = ?, fecha_reemplazo = ? 
            WHERE id = ?
        `, [nuevoEmail, fechaReemplazo, caida.id]);

        if (caida.cliente_id) {
            const detalleOriginal = await dbGet("SELECT * FROM cuentas_cliente_detalle WHERE email = ? AND cliente_id = ? ORDER BY id DESC LIMIT 1", [caida.email, caida.cliente_id]);
            
            const bloqueId = detalleOriginal ? detalleOriginal.bloque_id : null;
            const fechaVence = detalleOriginal ? detalleOriginal.fecha_vencimiento : null;
            const paisConservado = caida.pais || (detalleOriginal ? detalleOriginal.pais : 'US');

            await dbRun(`
                INSERT INTO cuentas_cliente_detalle (bloque_id, cliente_id, email, password, pais, fecha_asignacion, fecha_vencimiento, estado, es_reemplazo_de, precio_unitario)
                VALUES (?, ?, ?, '', ?, ?, ?, 'Activa', ?, ?)
            `, [bloqueId, caida.cliente_id, nuevoEmail, paisConservado, caida.fecha_compra, fechaVence, caida.email, caida.precio]);

            if (detalleOriginal) {
                await dbRun("UPDATE cuentas_cliente_detalle SET reemplazada_por = ?, fecha_reemplazo = ? WHERE id = ?", [nuevoEmail, fechaReemplazo, detalleOriginal.id]);
            }

            await dbRun("DELETE FROM correos WHERE email = ? AND user_id = ?", [caida.email, caida.cliente_id]);
            await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [nuevoEmail, caida.cliente_id]);
        }

        await dbRun("UPDATE stock_cuentas SET estado = 'Asignada', comprador_id = ? WHERE email = ?", [caida.cliente_id, nuevoEmail]);

        res.send("<script>alert('✅ CAMBIO POR GARANTÍA EXITOSO.\\nLa cuenta nueva fue vinculada y conservó la fecha original de compra.'); window.location='/dash';</script>");
    } catch (e) {
        console.error(e);
        res.send("<script>alert('Error al ejecutar cambio por garantía.'); window.location='/dash';</script>");
    }
});

// =========================================================================
// 🌎 MEJORA 12: CAMBIAR MANUALMENTE EL PAÍS DE UNA CUENTA
// =========================================================================
app.post('/admin/cambiar-pais-cuenta', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { email_cuenta, nuevo_pais } = req.body;
    const correoLimpio = (email_cuenta || '').trim().toLowerCase();

    try {
        await dbRun("UPDATE stock_cuentas SET pais = ? WHERE LOWER(email) = ?", [nuevo_pais, correoLimpio]);
        await dbRun("UPDATE cuentas_cliente_detalle SET pais = ? WHERE LOWER(email) = ?", [nuevo_pais, correoLimpio]);
        await dbRun("UPDATE cuentas_caidas_registro SET pais = ? WHERE LOWER(email) = ?", [nuevo_pais, correoLimpio]);

        res.send(`<script>alert('✅ País actualizado a ${PAISES_MAPA[nuevo_pais]?.bandera || ''} ${PAISES_MAPA[nuevo_pais]?.nombre || nuevo_pais} para ${correoLimpio}.'); window.location='/dash';</script>`);
    } catch (e) {
        console.error(e);
        res.send("<script>alert('Error al actualizar el país.'); window.location='/dash';</script>");
    }
});

app.post('/admin/config-ghoulflix', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    const { login_id, password, token_manual } = req.body;
    try {
        await dbRun("UPDATE config_ghoulflix SET login_id = ?, password = ?, token = ?, updated_at = datetime('now', 'localtime') WHERE id = 1", [
            (login_id || '').trim(), (password || '').trim(), (token_manual || '').trim()
        ]);
        if (login_id && password && !token_manual) {
            const loginRes = await loginEnGhoulflixApi();
            if (loginRes.success) return res.send("<script>alert('✅ Conectado exitosamente al servidor de códigos.'); window.location='/dash';</script>");
        }
        res.send("<script>alert('✅ Configuración de API actualizada.'); window.location='/dash';</script>");
    } catch (e) { res.redirect('/dash'); }
});

app.post('/bot/reservar', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    const telLimpio = (req.body.telefono || '').toString().replace(/\s+/g, '').trim();
    if (!validarTelefonoConCodigo(telLimpio)) {
        return res.send("<script>alert('⛔ Debes colocar el signo + y el código de país.'); window.location='/dash';</script>");
    }
    try {
        await dbRun("INSERT INTO reservas (user_id, cantidad, telefono) VALUES (?, ?, ?)", [req.session.uid, req.body.cantidad, telLimpio]);
        res.send("<script>alert('🛒 Reserva enviada exitosamente.'); window.location='/dash';</script>");
    } catch(err) { res.redirect('/dash'); }
});

app.post('/bot/garantia', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    try {
        await dbRun("INSERT INTO garantias (user_id, plataforma, motivo, detalles) VALUES (?, ?, ?, ?)", [req.session.uid, req.body.plataforma, req.body.motivo, req.body.detalles]);
        res.send("<script>alert('🚨 Garantía reportada en sistema.'); window.location='/dash';</script>");
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/resolver-garantia', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    try {
        await dbRun("UPDATE garantias SET estado = 'Resuelto', reemplazo = ? WHERE id = ?", [req.body.garantia_id]);
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
        return res.send("<script>alert('⛔ Debes ingresar el número con + y código de país.'); window.location='/dash';</script>");
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

app.post('/admin/auditar-cuentas', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.status(403).send('No autorizado.');
    const { correos_auditar } = req.body;
    
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

        let html = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                body { font-family: 'Inter', sans-serif; background: transparent; color: #fff; margin: 0; padding: 20px; }
                .table-modern { width: 100%; border-collapse: collapse; background: rgba(10, 14, 22, 0.95); border-radius: 10px; overflow: hidden; border: 1px solid rgba(255, 215, 0, 0.3); }
                .table-modern th, .table-modern td { padding: 12px 15px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
                .table-modern th { color: #FFD700; font-size: 11px; text-transform: uppercase; background: rgba(255, 255, 255, 0.03); letter-spacing: 1px; }
                .btn-delete { background: #E50914; color: #fff; padding: 14px 20px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 20px; text-transform: uppercase; font-size: 12px; transition: 0.3s; }
                .btn-delete:hover { box-shadow: 0 0 20px rgba(229,9,20,0.6); }
            </style>
            <h3 style="color:#FFD700; margin-top:0; font-size: 22px;">🔎 Resultados de Auditoría</h3>
            <p style="font-size:13px; color:#cbd5e1; margin-bottom: 20px;">Se encontraron <strong>${cuentasPermitidas.length} cuentas asignadas</strong> de las ${correosUnicos.length} ingresadas.</p>
        `;

        if (cuentasPermitidas.length > 0) {
            const emailsAEliminar = cuentasPermitidas.map(c => c.email);
            const jsonSeguro = JSON.stringify(emailsAEliminar).replace(/"/g, '&quot;');

            html += `
            <form action="/admin/ejecutar-limpieza-global" method="POST" target="_top">
                <input type="hidden" name="emails_json" value="${jsonSeguro}">
                <div style="max-height: 350px; overflow-y: auto; border-radius: 10px; border: 1px solid rgba(255, 215, 0, 0.3);">
                    <table class="table-modern">
                        <thead><tr><th>Correo</th><th>Usuario Dueño</th></tr></thead>
                        <tbody>
                            ${cuentasPermitidas.map(c => `<tr><td style="color:var(--accent); font-family:monospace; font-weight:600;">${c.email}</td><td>@${c.dueno}</td></tr>`).join('')}
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
        res.send(`<p style="color:#E50914;">Error interno al procesar la auditoría.</p>`);
    }
});

app.post('/admin/ejecutar-limpieza-global', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    
    try {
        const emails = JSON.parse(req.body.emails_json || '[]');
        if (!emails.length) return res.send("<script>alert('No hay correos para procesar.'); window.location='/dash';</script>");

        let eliminados = 0;
        for (let email of emails) {
            const asig = await dbGet(`
                SELECT c.id, c.user_id, u.creado_por 
                FROM correos c JOIN usuarios u ON c.user_id = u.id 
                WHERE c.email = ?
            `, [email]);

            if (asig) {
                let permitido = req.session.rol === 'Administrador' || (req.session.rol === 'Subadministrador' && (asig.user_id === req.session.uid || asig.creado_por === req.session.uid));
                
                if (permitido) {
                    await dbRun("DELETE FROM correos WHERE id = ?", [asig.id]);
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
    } catch(err) { res.redirect('/dash'); }
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
    } catch(err) { res.redirect('/dash'); }
});

app.post('/stock/cargar', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { correos_stock, plataforma, pais } = req.body;
    const lineas = correos_stock.split(/[\n\r]+/).filter(l => l.trim() !== '');
    const paisFinal = pais || 'US';
    
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
                    await dbRun("INSERT INTO stock_cuentas (plataforma, email, password, propietario_id, pais) VALUES (?, ?, ?, ?, ?)", [plataforma, e, p, req.session.uid, paisFinal]);
                    agregadas++;
                }
            }
        }
        res.send(`<script>alert('✅ Se agregaron ${agregadas} cuentas a tu stock (${PAISES_MAPA[paisFinal]?.bandera || ''} ${PAISES_MAPA[paisFinal]?.nombre || paisFinal}).\\n⚠️ Duplicadas ignoradas: ${duplicadas}'); window.location='/dash';</script>`);
    } catch(e) { res.redirect('/dash'); }
});

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
        res.send(`<script>alert('🗑️ Proceso completado:\\n\\n✅ Cuentas eliminadas: ${eliminados}\\n⚠️ No encontradas o de otro dueño: ${noEncontrados}'); window.location='/dash';</script>`);
    } catch (e) {
        res.redirect('/dash');
    }
});

app.post('/admin/vaciar-stock-disponible', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    try {
        await dbRun("DELETE FROM stock_cuentas WHERE estado = 'Disponible'");
        res.send("<script>alert('✅ Todo el stock NO VENDIDO ha sido eliminado correctamente.'); window.location='/dash';</script>");
    } catch(e) { res.redirect('/dash'); }
});

app.post('/admin/vaciar-stock-vendido', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    try {
        await dbRun("DELETE FROM stock_cuentas WHERE estado IN ('Vendida', 'Asignada')");
        res.send("<script>alert('✅ Todo el stock VENDIDO y ASIGNADO ha sido eliminado de la lista principal.'); window.location='/dash';</script>");
    } catch(e) { res.redirect('/dash'); }
});

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
            ${CSS_MODERNO}
            <style>
                body { background: #000; color: #fff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
                h2 { color: var(--accent); font-size: 24px; }
                .btn { background: var(--accent); color: #000; padding: 18px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 5px 20px rgba(255,215,0,0.4); margin-top: 20px;}
            </style>
        </head>
        <body>
            <h2>✅ Dinero Asignado: ${saldoMostrado}</h2>
            <p>Se actualizó el saldo de ${user.user}. Haz clic abajo para enviarle el comprobante a su WhatsApp.</p>
            <a href="${link}" class="btn">Notificar al Cliente</a>
            <br><br>
            <a href="/dash" style="color:var(--text-muted); font-size: 12px;">Volver al Panel sin notificar</a>
            <script>window.location.replace('${link}');</script>
            ${CHRISTMAS_EXTRAS}
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

        const disponibles = await dbAll("SELECT id, email, password, pais FROM stock_cuentas WHERE estado = 'Disponible' AND plataforma = 'netflix' AND propietario_id = ? LIMIT ?", [proveedor_id, paquete]);
        
        if (disponibles.length < paquete) return res.send("<script>alert('El proveedor no tiene stock suficiente en este momento.'); window.location='/dash';</script>");

        const nuevoSaldoMXN = comprador.creditos - costoMXN;
        await dbRun("UPDATE usuarios SET creditos = ? WHERE id = ?", [nuevoSaldoMXN, req.session.uid]);

        const compraInfo = await dbRun("INSERT INTO compras_stock (subadmin_id, cantidad, creditos_usados, saldo_anterior, saldo_nuevo) VALUES (?, ?, ?, ?, ?)", [req.session.uid, paquete, costoMXN, comprador.creditos, nuevoSaldoMXN]);
        const compraId = compraInfo.lastID;

        const fechaVence = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
        const bloqueInfo = await dbRun("INSERT INTO asignaciones_bloques (asignador_id, cliente_id, cantidad, precio_total, precio_unitario, fecha_vencimiento, estado) VALUES (?, ?, ?, ?, ?, ?, 'Activo')", [proveedor_id, comprador.id, paquete, costoMXN, (costoMXN/paquete), fechaVence]);

        let correosEntregados = [];
        for (let cuenta of disponibles) {
            await dbRun("UPDATE stock_cuentas SET estado = 'Vendida', comprador_id = ?, compra_id = ?, fecha_compra = datetime('now', 'localtime') WHERE id = ?", [req.session.uid, compraId, cuenta.id]);
            await dbRun("INSERT INTO detalles_compras (compra_id, cuenta_id, email_cuenta, password_cuenta) VALUES (?, ?, ?, ?)", [compraId, cuenta.id, cuenta.email, cuenta.password]);
            await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [cuenta.email, req.session.uid]);
            await dbRun("INSERT INTO cuentas_cliente_detalle (bloque_id, cliente_id, email, password, pais, fecha_vencimiento, estado, precio_unitario) VALUES (?, ?, ?, ?, ?, ?, 'Activa', ?)", [bloqueInfo.lastID, comprador.id, cuenta.email, cuenta.password, cuenta.pais || 'US', fechaVence, (costoMXN/paquete)]);
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
            ${CSS_MODERNO}
            <style>
                body { background: #050505; color: #fff; font-family: 'Inter', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                .card-confirm { background: rgba(12, 15, 22, 0.96); border: 1px solid rgba(255, 215, 0, 0.35); border-radius: 16px; padding: 30px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.95); }
                .step-btn { display: block; width: 100%; padding: 16px; border-radius: 10px; font-weight: 700; font-size: 14px; text-decoration: none; margin-top: 14px; box-sizing: border-box; cursor: pointer; border: none; transition: 0.25s; text-transform: uppercase; letter-spacing: 0.5px; }
                .btn-wa-1 { background: #25d366; color: #000; box-shadow: 0 4px 15px rgba(37,211,102,0.35); }
                .btn-wa-2 { background: var(--accent); color: #000; box-shadow: 0 4px 15px rgba(255,215,0,0.35); }
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
                    Para liberar tus cuentas en el panel, debes enviar el comprobante por WhatsApp:
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
            ${CHRISTMAS_EXTRAS}
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
                    b1.innerHTML = '✅ 1️⃣ Enviado al Administrador';
                    b1.style.opacity = '0.85';
                    verificarDesbloqueo();
                }

                function marcarPaso2() {
                    paso2OK = true;
                    const b2 = document.getElementById('btnPaso2');
                    b2.innerHTML = '✅ 2️⃣ Enviado al Asistente';
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
                        alert('⛔ Debes enviar obligatoriamente el mensaje.');
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

// =========================================================================
// 🖥️ DASHBOARD COMPLETO CONSERVANDO CADA SECCIÓN ORIGINAL
// =========================================================================
app.get('/dash', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'admin' || req.session.user === 'ruben');
    const esSubAdmin = (req.session.rol === 'Subadministrador');
    const esCliente = (req.session.rol === 'Cliente');

    if (esAdminPrincipal || esSubAdmin || esCliente) {
        try {
            const usuarioActual = await dbGet("SELECT * FROM usuarios WHERE id = ?", [req.session.uid]);
            let misCorreos = [];
            let misCuentasVencidas = [];

            if (esCliente || esSubAdmin) {
                misCorreos = await dbAll("SELECT * FROM correos WHERE user_id = ?", [req.session.uid]);
                misCuentasVencidas = await dbAll("SELECT * FROM cuentas_cliente_detalle WHERE cliente_id = ? AND estado = 'Vencida'", [req.session.uid]);
            }

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

            // Nuevos datos para mejoras
            const cuentasCaidas = await dbAll(`SELECT cc.*, u.user as cliente_nombre, u.moneda FROM cuentas_caidas_registro cc LEFT JOIN usuarios u ON cc.cliente_id = u.id ORDER BY cc.id DESC`);
            const asignacionesClientes = await dbAll(`SELECT ccd.*, u.user as cliente_nombre, u.telefono as cliente_telefono, u.moneda FROM cuentas_cliente_detalle ccd JOIN usuarios u ON ccd.cliente_id = u.id ORDER BY ccd.id DESC`);
            const historialCreditos = await dbAll(`SELECT hc.*, op.user as operador_nombre, cl.user as cliente_nombre, cl.moneda FROM historial_creditos_operaciones hc JOIN usuarios op ON hc.operador_id = op.id JOIN usuarios cl ON hc.cliente_id = cl.id ORDER BY hc.id DESC LIMIT 40`);

            const cuentasPorPais = await dbAll(`
                SELECT pais, 
                       COUNT(*) as total,
                       SUM(CASE WHEN estado = 'Disponible' THEN 1 ELSE 0 END) as disp,
                       SUM(CASE WHEN estado IN ('Vendida', 'Asignada') THEN 1 ELSE 0 END) as vend,
                       SUM(CASE WHEN estado = 'Caida' THEN 1 ELSE 0 END) as caidas
                FROM stock_cuentas
                GROUP BY pais
            `);

            let resumenPaisesHtml = "";
            Object.keys(PAISES_MAPA).forEach(k => {
                let data = cuentasPorPais.find(c => c.pais === k) || { total: 0, disp: 0, vend: 0, caidas: 0 };
                resumenPaisesHtml += `
                    <div style="background:#000; border:1px solid var(--card-border); border-radius:10px; padding:15px; text-align:center;">
                        <div style="font-size:28px;">${PAISES_MAPA[k].bandera}</div>
                        <div style="font-weight:700; color:#fff; font-size:13px; margin:4px 0;">${PAISES_MAPA[k].nombre}</div>
                        <div style="color:var(--accent); font-size:18px; font-weight:800;">${data.total} cuentas</div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">
                            Libres: <b style="color:#25d366;">${data.disp}</b> | Vendidas: <b style="color:#E50914;">${data.vend}</b> | Caídas: <b style="color:#ff7300;">${data.caidas}</b>
                        </div>
                    </div>
                `;
            });

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

            let avisoVencimientoCliente = "";
            if (esCliente && misCuentasVencidas.length > 0) {
                let totalRenovar = misCuentasVencidas.reduce((acc, curr) => acc + (curr.precio_unitario || 0), 0);
                avisoVencimientoCliente = `
                    <div style="background: rgba(229, 9, 20, 0.2); border: 2px solid #E50914; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
                        <h3 style="color:#E50914; margin:0 0 6px 0;">⚠️ TIENES ${misCuentasVencidas.length} CUENTA(S) VENCIDA(S)</h3>
                        <p style="font-size:13px; margin:0 0 10px 0; color:#fff;">Tus cuentas cumplieron el mes y han sido bloqueadas. Para reactivarlas debes renovar.</p>
                        <div style="font-size:15px; font-weight:700; color:var(--accent);">Total a pagar para renovar: ${formatearDinero(totalRenovar, usuarioActual.moneda)}</div>
                    </div>
                `;
            }

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
                            <button onclick="triggerAction('${key}', 'buzon_completo')" class="action-btn-pill" style="background: rgba(138, 43, 226, 0.1); border-color: rgba(138, 43, 226, 0.3); color: #fff; padding: 16px 5px; display: flex; flex-direction: column; align-items: center; gap: 8px; border-radius: 12px; grid-column: 1 / -1;">
                                <span style="font-size: 22px;">📥</span>
                                <span style="font-size: 10px; font-weight: 600; letter-spacing: 0.5px;">BUZÓN COMPLETO</span>
                            </button>
                        </div>
                    `;
                } else {
                    controlesIzquierda += `
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill" style="background: var(--accent); color: #000; border: none; padding: 12px; margin-bottom: 8px;">🔎 Extraer Código Original</button>
                    `;
                }

                panelesIzquierdosHtml += `
                <div id="action-${key}" class="action-panel">
                    <h4 style="margin:0 0 6px 0; font-size:11px; color:var(--accent); text-transform:uppercase; letter-spacing:1px;">⚡ Opciones ${plat.nombre}</h4>
                    ${controlesIzquierda}
                </div>`;

                let avisoSinCorreo = "";
                if ((esCliente || esSubAdmin) && misCorreos.length === 0) {
                    avisoSinCorreo = `<div style="background: rgba(229,9,20,0.18); border: 1px solid #E50914; padding: 12px 15px; border-radius: 10px; margin-bottom: 15px; font-size: 12px; color: #f8fafc;">⚠️ Aún no tienes cuentas asignadas. Comunícate con tu proveedor.</div>`;
                }

                panelesCentroHtml += `
                <div id="main-${key}" class="main-card">
                    ${avisoSinCorreo}
                    ${avisoVencimientoCliente}
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

            let opcionesPaisesHtml = Object.keys(PAISES_MAPA).map(k => `<option value="${k}">${PAISES_MAPA[k].bandera} ${PAISES_MAPA[k].nombre}</option>`).join('');

            if (esAdminPrincipal) {
                panelesIzquierdosHtml += `
                <div id="action-api-ghoulflix" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🔌 Conexión del servidor de códigos</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Consulta códigos de acceso y enlaces mediante la conexión privada del servidor y Gmail.</p>
                </div>
                <div id="action-stock-admin" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">📦 Control de Inventario</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Carga masiva de cuentas al sistema para la venta automática a subadministradores.</p>
                    <div style="margin-top:10px; background: rgba(255, 215, 0, 0.08); padding: 16px; border-radius: 10px; border: 1px solid rgba(255, 215, 0, 0.25);">
                        <div style="font-size: 26px; font-weight: 700; color: var(--accent);">${stockDisp.count}</div>
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
                        historialAsigRows += `
                        <tr>
                            <td style="font-family:monospace; color:#E50914; font-weight:600;">${h.email}</td>
                            <td><span style="color:var(--accent); font-weight:600;">@${h.receptor}</span></td>
                            <td><span style="color:var(--text-muted);">@${h.admin}</span></td>
                            <td><small style="color:#fff;">${fechaObj.toLocaleDateString('es-CO')} ${fechaObj.toLocaleTimeString('es-CO')}</small></td>
                            <td><span style="color:#00D2FF; font-size:11px;">${h.tipo_operacion}</span></td>
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
                            <td><span style="color:var(--accent); font-weight:600;">@${c.comprador}</span><br><small style="color:var(--text-muted);">${c.fecha}</small></td>
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
                                ? '<span class="badge-status vendida" style="border-color:var(--accent); color:var(--accent); background:rgba(255,215,0,0.15);">Asignada</span>' 
                                : '<span class="badge-status vendida">Vendida</span>');
                        let compradorTxt = s.comprador ? `<span style="color:var(--accent);">@${s.comprador}</span><br><small style="color:var(--text-muted);">${s.fecha_compra || 'N/A'}</small>` : '<span style="color:var(--text-muted);">Nadie</span>';
                        
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
                    <h3 style="color:var(--accent);">◈ Servidor de códigos + ✉ Gmail</h3>
                    <p style="color:var(--text-muted);font-size:13px;line-height:1.7;">La búsqueda combinada usa la conexión privada configurada en el servidor. No necesitas introducir ni compartir el token aquí.</p>
                </div>

                <div id="main-stock-admin" class="main-card">
                    <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color: var(--accent);">📦 Cargar Stock y Ver Historial</h3>
                    <form action="/stock/cargar" method="POST">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                            <select name="plataforma" class="input-classic" required>
                                <option value="netflix">Netflix</option>
                            </select>
                            <select name="pais" class="input-classic">
                                ${opcionesPaisesHtml}
                            </select>
                        </div>
                        <textarea name="correos_stock" class="input-classic" placeholder="correo1@gmail.com:clave123&#10;cuenta2@hotmail.com:pass456..." rows="5" required></textarea>
                        <button type="submit" class="btn-submit">Ingresar al Inventario Seguro</button>
                    </form>

                    <h4 style="margin:25px 0 10px 0; font-size:15px; font-weight:600; color: #E50914;">🗑️ Borrar Cuentas Específicas del Stock</h4>
                    <form action="/stock/eliminar-masivo" method="POST">
                        <textarea name="correos_eliminar" class="input-classic" placeholder="Pega aquí los correos que subiste por error para borrarlos de tu inventario..." rows="3" required></textarea>
                        <button type="submit" class="btn-submit" style="background: rgba(229, 9, 20, 0.12); border: 1px solid #E50914; color: #E50914;" onclick="return confirm('¿Seguro que deseas eliminar estas cuentas específicas de tu inventario?');">Borrar Cuentas Ingresadas</button>
                    </form>

                    <div style="margin-top: 25px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <form action="/admin/vaciar-stock-disponible" method="POST" style="flex: 1; min-width: 200px;" onsubmit="return confirm('¿Seguro que deseas ELIMINAR TODO EL STOCK DISPONIBLE?');">
                            <button type="submit" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.12); border-color: #E50914; color: #E50914;">🗑️ Borrar TODO Stock NO Vendido</button>
                        </form>
                        <form action="/admin/vaciar-stock-vendido" method="POST" style="flex: 1; min-width: 200px;" onsubmit="return confirm('¿Seguro que deseas ELIMINAR TODO EL STOCK VENDIDO/ASIGNADO?');">
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
                    <h3 style="margin:0 0 8px 0; font-size:19px; font-weight:600; color: var(--accent);">🎯 Asignación Manual Masiva</h3>
                    <p style="color:var(--text-muted); font-size:12px; margin-bottom:18px;">
                        Pega todas las cuentas que quieras asignar a la vez del stock al usuario receptor.
                    </p>
                    <form action="/admin/asignar-manual" method="POST" style="background: rgba(0,0,0,0.5); padding: 18px; border-radius: 10px; border: 1px solid var(--card-border);">
                        <div style="margin-bottom: 15px;">
                            <label style="color: var(--accent); font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">1. Seleccionar Usuario receptor (Cliente / Subadmin):</label>
                            <select name="receptor_id" class="input-classic" style="margin-bottom:0;" required>
                                <option value="" disabled selected>-- Selecciona al usuario --</option>
                                ${clientesOpcionesHtml}
                            </select>
                        </div>

                        <div style="margin-bottom: 15px;">
                            <label style="color: var(--accent); font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">2. Pegar cuentas del stock:</label>
                            <textarea name="correos_asignar" class="input-classic" style="margin-bottom:0;" placeholder="cuenta1@gmail.com&#10;cuenta2@gmail.com..." rows="5" required></textarea>
                        </div>
                        
                        <button type="submit" class="btn-submit" onclick="return confirm('¿Confirmas la asignación masiva de estas cuentas?');">Asignar Cuentas al Cliente</button>
                    </form>

                    <div style="margin-top: 25px;">
                        <h4 style="margin:0 0 10px 0; font-size:13px; color:var(--accent); text-transform:uppercase; letter-spacing:1px;">📋 Historial de Asignación Manual</h4>
                        <div class="table-wrapper">
                            <table class="table-modern">
                                <thead>
                                    <tr>
                                        <th>Cuenta</th><th>Usuario Receptor</th><th>Administrador</th><th>Fecha y Hora</th><th>Tipo</th><th>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>${historialAsigRows}</tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div id="main-dinero-admin" class="main-card">
                    <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color: var(--accent);">💰 Asignación de Dinero</h3>
                    <form action="/admin/asignar-dinero" method="POST">
                        <select name="subadmin_id" class="input-classic" required>
                            <option value="" disabled selected>Selecciona al Usuario/Subadmin...</option>
                            ${subadminsOpcionesHtml}
                        </select>
                        <input type="number" step="0.01" name="cantidad" class="input-classic" placeholder="Cantidad de Dinero a Asignar (Ej: 1000)" required>
                        <p style="font-size:11px; color:var(--text-muted); margin-top:-4px; margin-bottom:15px;">* El valor ingresado corresponde a tu moneda local o base (MXN).</p>
                        <button type="submit" class="btn-submit">Actualizar Saldo y Notificar por WhatsApp</button>
                    </form>
                </div>

                <div id="main-historial-compras" class="main-card">
                    <h3 style="margin:0 0 10px 0; font-size:19px; font-weight:600; color: var(--accent);">🧾 Historial Global de Tienda</h3>
                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Subadmin / Cliente</th><th style="text-align:center;">Cant.</th><th>Dinero Descontado</th><th>Cuentas Entregadas</th></tr></thead>
                            <tbody>${historialGlobalHtml}</tbody>
                        </table>
                    </div>
                </div>
                `;
            }

            if (esSubAdmin || esCliente) {
                panelesIzquierdosHtml += `
                <div id="action-comprar-stock" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🛒 Tienda de Cuentas</h4>
                    <p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Compra cuentas de Netflix usando tu dinero disponible.</p>
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
                        let cuentasEntregadas = detallesComprasDB.filter(d => d.compra_id === c.id).map(d => `<div style="font-family:monospace; color:#E50914; padding:2px 0;">${d.email_cuenta} <span style="color:var(--accent); margin-left: 5px;">${d.password_cuenta ? '🔑 '+d.password_cuenta : ''}</span></div>`).join('');
                        misComprasHtml += `
                        <tr>
                            <td><span style="color:var(--accent); font-weight:600;">#${c.id}</span><br><small style="color:var(--text-muted);">${c.fecha}</small></td>
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
                    <div style="background: #000; border: 1px solid var(--card-border); border-radius: 12px; padding: 22px; text-align: center; transition: 0.25s;">
                        <img src="${PLATAFORMAS['netflix'].logo}" height="28" style="margin-bottom: 12px; filter: drop-shadow(0 0 8px rgba(229,9,20,0.5));">
                        <h2 style="margin: 0 0 5px 0; color: #fff; font-size: 20px;">${p.cant} Cuenta${p.cant > 1 ? 's' : ''}</h2>
                        <p style="color: var(--accent); font-weight: 700; font-size: 17px; margin: 0 0 16px 0;">${formatearDinero(p.costo, usuarioActual.moneda)}</p>
                        <form action="/tienda/comprar" method="POST" style="margin:0;">
                            <input type="hidden" name="paquete" value="${p.cant}">
                            <button type="submit" class="btn-submit" style="font-size: 11px;" onclick="return confirm('¿Seguro que deseas comprar ${p.cant} cuenta(s)?');">Comprar Ahora</button>
                        </form>
                    </div>
                `).join('');

                panelesCentroHtml += `
                <div id="main-comprar-stock" class="main-card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
                        <h3 style="margin:0; font-size:19px; font-weight:600; color: var(--accent);">🛒 Tienda de Cuentas</h3>
                        <div style="background: rgba(255,215,0,0.1); border: 1px solid rgba(255,215,0,0.3); padding: 8px 16px; border-radius: 50px; font-size: 12px; font-weight: 600; color: #fff;">
                            Dinero Disponible: <span style="color:var(--accent);">${formatearDinero(usuarioActual.creditos, usuarioActual.moneda)}</span>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 16px;">
                        ${tarjetasTienda}
                    </div>
                </div>

                <div id="main-mis-compras" class="main-card">
                    <h3 style="margin:0 0 10px 0; font-size:19px; font-weight:600; color: var(--accent);">🧾 Mis Compras</h3>
                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>ID / Fecha</th><th style="text-align:center;">Paquete</th><th>Descuento</th><th>Cuentas Entregadas</th></tr></thead>
                            <tbody>${misComprasHtml}</tbody>
                        </table>
                    </div>
                </div>
                `;
            }

            if (esSubAdmin) {
                const misPrecios = await dbAll("SELECT paquete, precio FROM precios_subadmin WHERE subadmin_id = ?", [req.session.uid]);
                let inputsPrecios = [1, 2, 3, 4, 5, 10].map(cant => {
                    let actualMXN = misPrecios.find(p => p.paquete === cant)?.precio || PRECIOS_BASE[cant];
                    let minLocal = convertirLocal(PRECIOS_BASE[cant], usuarioActual.moneda);
                    let actualLocal = convertirLocal(actualMXN, usuarioActual.moneda);

                    return `<div>
                        <label style="color:var(--accent); font-size:11px; font-weight:600; display:block; margin-bottom:5px;">Paquete ${cant} Cuentas (Min: $${minLocal.toLocaleString('es-CO')} ${usuarioActual.moneda})</label>
                        <input type="number" step="0.01" name="precio_${cant}" min="${minLocal}" value="${actualLocal}" class="input-classic" style="margin-bottom:0;" required>
                    </div>`;
                }).join('');

                let misClientesOptions = usuarios.filter(u => u.creado_por === req.session.uid && u.rol === 'Cliente').map(u => `<option value="${u.id}">${u.user} (${formatearDinero(u.creditos, u.moneda)})</option>`).join('');

                panelesCentroHtml += `
                <div id="main-mi-tienda" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; color:var(--accent);">⚙️ Configurar Precios de Mi Tienda</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin-bottom:18px;">Establece los precios para tus clientes en ${usuarioActual.moneda}.</p>
                    <form action="/subadmin/configurar-precios" method="POST">
                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px; margin-bottom:18px;">${inputsPrecios}</div>
                        <button type="submit" class="btn-submit">Guardar Precios de Venta</button>
                    </form>
                </div>
                
                <div id="main-mi-stock" class="main-card">
                    <h3 style="margin:0 0 15px 0; font-size:19px; color:var(--accent);">📦 Cargar Mi Inventario Propio</h3>
                    <form action="/stock/cargar" method="POST">
                        <input type="hidden" name="plataforma" value="netflix">
                        <select name="pais" class="input-classic" style="margin-bottom:10px;">${opcionesPaisesHtml}</select>
                        <textarea name="correos_stock" class="input-classic" placeholder="correo@gmail.com:clave123..." rows="5" required></textarea>
                        <button type="submit" class="btn-submit">Subir Cuentas a mi Inventario</button>
                    </form>

                    <h4 style="margin:25px 0 10px 0; font-size:15px; font-weight:600; color: #E50914;">🗑️ Borrar Cuentas Específicas de mi Stock</h4>
                    <form action="/stock/eliminar-masivo" method="POST">
                        <textarea name="correos_eliminar" class="input-classic" placeholder="Pega aquí los correos a eliminar..." rows="3" required></textarea>
                        <button type="submit" class="btn-submit" style="background: rgba(229, 9, 20, 0.12); border: 1px solid #E50914; color: #E50914;" onclick="return confirm('¿Seguro que deseas eliminar estas cuentas?');">Borrar Cuentas Ingresadas</button>
                    </form>
                </div>

                <div id="main-dinero-clientes" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; color:var(--accent);">💸 Asignar Dinero a Mis Clientes</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin-bottom:18px;">Transfiere de tu saldo (${formatearDinero(usuarioActual.creditos, usuarioActual.moneda)}) a las cuentas de tus clientes.</p>
                    <form action="/subadmin/asignar-dinero" method="POST">
                        <select name="cliente_id" class="input-classic" required>
                            <option value="" disabled selected>Selecciona a tu cliente...</option>
                            ${misClientesOptions}
                        </select>
                        <input type="number" step="0.01" name="cantidad" class="input-classic" placeholder="Monto a transferir (${usuarioActual.moneda})" required>
                        <button type="submit" class="btn-submit">Transferir Dinero</button>
                    </form>
                </div>`;
                
                panelesIzquierdosHtml += `
                <div id="action-mi-tienda" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">⚙️ Administración Tienda</h4><p style="font-size:12px; color:#cbd5e1; margin-top:6px;">Márgenes por paquete.</p></div>
                <div id="action-mi-stock" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">📦 Inventario Privado</h4><p style="font-size:12px; color:#cbd5e1; margin-top:6px;">Cuentas directas.</p></div>
                <div id="action-dinero-clientes" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">💸 Billetera</h4><p style="font-size:12px; color:#cbd5e1; margin-top:6px;">Transferencias a clientes.</p></div>
                `;
            }

            panelesIzquierdosHtml += `
            <div id="action-crear-user" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">👤 Crear Usuario</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Crea nuevas cuentas de clientes o subadministradores.</p></div>
            <div id="action-usuarios" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">📧 Asignar Correos</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Vincula los correos al perfil de un cliente.</p></div>
            <div id="action-borrar-correos-masivo" class="action-panel"><h4 style="margin:0; font-size:11px; color:#E50914; text-transform:uppercase;">🗑️ Borrado Masivo</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Pega sin límite correos de un usuario y quítalos en un clic.</p></div>
            <div id="action-auditoria-global" class="action-panel"><h4 style="margin:0; font-size:11px; color:#ff7300; text-transform:uppercase;">🔎 Limpieza Global</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Detecta dueños de cuentas mezcladas y elimínalas.</p></div>
            <div id="action-base-datos" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--accent); text-transform:uppercase;">🗄️ Base de Datos</h4><p style="font-size:12px; color:#cbd5e1; line-height:1.5; margin-top:6px;">Consulta y administra usuarios directos.</p></div>
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
                                let estiloFondo = esBuscado ? "background: rgba(255, 215, 0, 0.2); border: 1px solid rgba(255, 215, 0, 0.4);" : "background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);";
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
                                    <button type="submit" style="background: rgba(229,9,20,0.12); border:1px solid #E50914; color:#E50914; padding:6px 10px; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer;">Eliminar</button>
                                </form>
                            </td>
                        </tr>`;
                    };

                    if (esAdminPrincipal) {
                        let subadmins = usuariosVisibles.filter(u => u.rol === 'Subadministrador');
                        let clientesDirectos = usuariosVisibles.filter(u => u.rol !== 'Subadministrador');

                        if (subadmins.length > 0) {
                            tablaUsuariosHtml += `<tr><td colspan="5" style="background: rgba(255, 215, 0, 0.08); text-align: center; font-size: 11px; color: var(--accent); font-weight: 700; padding: 10px;">MIS SUBADMINISTRADORES</td></tr>`;
                            subadmins.forEach(sa => { tablaUsuariosHtml += renderRow(sa); });
                        }

                        if (clientesDirectos.length > 0) {
                            tablaUsuariosHtml += `<tr><td colspan="5" style="background: rgba(255, 215, 0, 0.08); text-align: center; font-size: 11px; color: var(--accent); font-weight: 700; padding: 10px;">MIS CLIENTES DIRECTOS Y PÚBLICOS</td></tr>`;
                            clientesDirectos.forEach(c => { tablaUsuariosHtml += renderRow(c); });
                        }
                    } else {
                        usuariosVisibles.forEach(u => tablaUsuariosHtml += renderRow(u));
                    }
                }
            }

            if (esAdminPrincipal || esSubAdmin) {
                panelesCentroHtml += `
                <div id="main-auditoria-global" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; font-weight:600; color:#ff7300;">🔎 Buscar y Limpiar Cuentas Masivamente</h3>
                    <p style="color:var(--text-muted); font-size:12px; margin-bottom:18px;">
                        Pega cuentas mezcladas. El sistema mostrará quiénes son sus dueños y te permitirá borrarlas simultáneamente.
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

            // 🌟 NUEVOS PANELES DE MEJORAS
            if (esAdminPrincipal || esSubAdmin) {
                let filasHistorialCreditos = historialCreditos.map(h => `
                    <tr>
                        <td><b style="color:var(--accent);">@${h.cliente_nombre}</b></td>
                        <td><span class="badge-status ${h.tipo === 'AGREGAR' ? 'disp' : 'vendida'}">${h.tipo}</span></td>
                        <td style="color:#fff;">${formatearDinero(h.cantidad, h.moneda)}</td>
                        <td>${formatearDinero(h.saldo_anterior, h.moneda)} ➔ <b>${formatearDinero(h.saldo_nuevo, h.moneda)}</b></td>
                        <td><small style="color:var(--text-muted);">${h.fecha}</small></td>
                    </tr>
                `).join('');

                const clientesMap = {};
                asignacionesClientes.forEach(a => {
                    if (!clientesMap[a.cliente_id]) {
                        clientesMap[a.cliente_id] = { nombre: a.cliente_nombre, telefono: a.cliente_telefono, moneda: a.moneda, cuentas: [], vencidas: [], garantias: [] };
                    }
                    clientesMap[a.cliente_id].cuentas.push(a);
                    if (a.estado === 'Vencida') clientesMap[a.cliente_id].vencidas.push(a);
                    if (a.es_reemplazo_de) clientesMap[a.cliente_id].garantias.push(a);
                });

                let filasClientesRenovacion = Object.keys(clientesMap).map(cid => {
                    const c = clientesMap[cid];
                    const cantVencidas = c.vencidas.length;
                    const totalRenovar = c.cuentas.reduce((acc, curr) => acc + (curr.precio_unitario || 0), 0);
                    const correosLista = c.cuentas.map(x => `- ${x.email} ${x.es_reemplazo_de ? '(Garantía de: '+x.es_reemplazo_de+')' : ''}`).join('\n');
                    const fechaLimite = c.cuentas[0] ? c.cuentas[0].fecha_vencimiento : 'Fin de mes';
                    
                    const textoWhatsApp = `Hola ${c.nombre} 🎄,\n\nTe recordamos el estado de tus cuentas en SyncBox:\n\n*Cuentas Registradas:* ${c.cuentas.length}\n*Cuentas Vencidas:* ${cantVencidas}\n*Reemplazos por Garantía:* ${c.garantias.length}\n\n*Detalle de Cuentas:*\n${correosLista}\n\n*Total a pagar de renovación:* ${formatearDinero(totalRenovar, c.moneda)}\n*Fecha límite de pago:* ${fechaLimite}\n\n¡Quedamos atentos a tu comprobante para habilitarlas inmediatamente!`;
                    const telLimpio = c.telefono ? c.telefono.replace('+', '').replace(/\s/g, '') : '';
                    const linkWA = `https://api.whatsapp.com/send?phone=${telLimpio}&text=${encodeURIComponent(textoWhatsApp)}`;

                    return `
                        <tr>
                            <td><b style="color:var(--accent);">@${c.nombre}</b><br><small style="color:var(--text-muted);">${c.telefono || 'Sin tel'}</small></td>
                            <td><b>${c.cuentas.length}</b> (${c.garantias.length} garantías)</td>
                            <td><span class="badge-status ${cantVencidas > 0 ? 'vencida' : 'disp'}">${cantVencidas} Vencidas</span></td>
                            <td><b>${formatearDinero(totalRenovar, c.moneda)}</b></td>
                            <td style="display:flex; gap:6px; flex-wrap:wrap;">
                                <form action="/admin/renovar-cuentas" method="POST" style="margin:0;">
                                    <input type="hidden" name="cliente_id" value="${cid}">
                                    <button type="submit" class="action-btn-pill" style="background:#22c55e; color:#000; padding:6px 12px; font-size:10px;" onclick="return confirm('¿Confirmas renovación?');">✅ CUENTAS RENOVADAS</button>
                                </form>
                                <a href="${linkWA}" target="_blank" class="action-btn-pill" style="background:#25d366; color:#000; text-decoration:none; padding:6px 12px; font-size:10px;">📲 WhatsApp Cobro</a>
                            </td>
                        </tr>
                    `;
                }).join('');

                panelesCentroHtml += `
                <div id="main-admin-creditos" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; color:var(--accent);">💰 Gestión de Créditos a Clientes</h3>
                    <p style="font-size:12px; color:var(--text-muted); margin-bottom:16px;">Agrega o quita créditos. Toda reducción solicita confirmación previa.</p>
                    <form action="/admin/gestionar-creditos" method="POST" style="background:#000; padding:18px; border-radius:10px; border:1px solid var(--card-border);" onsubmit="
                        const accion = this.accion_credito.value;
                        const cant = this.cantidad.value;
                        if(accion === 'QUITAR') {
                            return confirm('⚠️ ATENCIÓN: ¿Confirmas que deseas QUITAR ' + cant + ' créditos a este usuario?');
                        }
                        return true;
                    ">
                        <div style="margin-bottom:12px;">
                            <label style="color:var(--accent); font-size:11px; font-weight:700;">Seleccionar Usuario:</label>
                            <select name="cliente_id" class="input-classic" required>
                                <option value="" disabled selected>-- Elige usuario --</option>
                                ${clientesOpcionesHtml}
                            </select>
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                            <div>
                                <label style="color:var(--accent); font-size:11px; font-weight:700;">Acción:</label>
                                <select name="accion_credito" class="input-classic" required>
                                    <option value="AGREGAR">➕ Agregar Créditos</option>
                                    <option value="QUITAR">➖ Quitar Créditos (Con Confirmación)</option>
                                </select>
                            </div>
                            <div>
                                <label style="color:var(--accent); font-size:11px; font-weight:700;">Cantidad de Créditos:</label>
                                <input type="number" step="0.01" name="cantidad" placeholder="Ej: 500" class="input-classic" required>
                            </div>
                        </div>
                        <button type="submit" class="btn-submit">Ejecutar Operación de Crédito</button>
                    </form>

                    <h4 style="margin:25px 0 10px 0; font-size:14px; color:#fff;">📜 Historial de Créditos Modificados</h4>
                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Usuario</th><th>Operación</th><th>Monto</th><th>Balance</th><th>Fecha</th></tr></thead>
                            <tbody>${filasHistorialCreditos.length ? filasHistorialCreditos : '<tr><td colspan="5" style="text-align:center;">Sin movimientos</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>

                <div id="main-control-clientes" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; color:var(--accent);">📦 Asignar Cuentas a Clientes (1 Mes de Vencimiento)</h3>
                    <form action="/admin/asignar-bloque-cliente" method="POST" style="background:#000; padding:18px; border-radius:10px; border:1px solid var(--card-border);">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
                            <div>
                                <label style="color:var(--accent); font-size:11px; font-weight:700;">Cliente Receptor:</label>
                                <select name="cliente_id" class="input-classic" required>
                                    <option value="" disabled selected>-- Elige cliente --</option>
                                    ${clientesOpcionesHtml}
                                </select>
                            </div>
                            <div>
                                <label style="color:var(--accent); font-size:11px; font-weight:700;">País de las Cuentas:</label>
                                <select name="pais_cuenta" class="input-classic">
                                    ${opcionesPaisesHtml}
                                </select>
                            </div>
                        </div>
                        <div style="margin-bottom:12px;">
                            <label style="color:var(--accent); font-size:11px; font-weight:700;">Precio Total Acordado:</label>
                            <input type="number" step="0.01" name="precio_total" placeholder="Ej: 1560" class="input-classic" required>
                        </div>
                        <div style="margin-bottom:14px;">
                            <label style="color:var(--accent); font-size:11px; font-weight:700;">Correos y contraseñas (10, 20 o más):</label>
                            <textarea name="correos_bloque" rows="5" class="input-classic" placeholder="correo1@gmail.com:clave1&#10;correo2@gmail.com:clave2..." required></textarea>
                        </div>
                        <button type="submit" class="btn-submit">Asignar Cuentas a 1 Mes</button>
                    </form>

                    <h4 style="margin:25px 0 10px 0; font-size:15px; color:#fff;">🧾 Renovaciones y Cobros Mensuales</h4>
                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Cliente</th><th>Cuentas / Garantías</th><th>Estado</th><th>Total a Cobrar</th><th>Acción</th></tr></thead>
                            <tbody>${filasClientesRenovacion.length ? filasClientesRenovacion : '<tr><td colspan="5" style="text-align:center;">No hay asignaciones activas</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>

                <div id="main-cuentas-caidas" class="main-card">
                    <h3 style="margin:0 0 8px 0; font-size:19px; color:#E50914;">🔴 CUENTAS CAÍDAS</h3>
                    <form action="/admin/reportar-cuenta-caida" method="POST" style="background:#000; padding:15px; border-radius:10px; border:1px solid #E50914; display:flex; gap:10px; margin-bottom:20px;">
                        <input type="email" name="email_caida" placeholder="Correo de la cuenta caída..." class="input-classic" style="margin:0;" required>
                        <button type="submit" class="btn-submit" style="background:#E50914; color:#fff; width:auto;">Reportar Caída</button>
                    </form>

                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Correo Caído</th><th>Cliente</th><th>Compra Original</th><th>Fecha Reporte</th><th>Precio</th><th>Estado</th><th>Acción Garantía</th></tr></thead>
                            <tbody>${cuentasCaidas.filter(c => c.estado === 'Pendiente').map(c => `
                                <tr>
                                    <td style="color:#E50914; font-family:monospace; font-weight:700;">${c.email}</td>
                                    <td><b>@${c.cliente_nombre || 'N/A'}</b></td>
                                    <td><small style="color:var(--text-muted);">${c.fecha_compra || 'N/A'}</small></td>
                                    <td><small style="color:#f87171;">${c.fecha_reporte}</small></td>
                                    <td>${formatearDinero(c.precio, c.moneda)}</td>
                                    <td><span class="badge-status vendida">CAÍDA</span></td>
                                    <td>
                                        <form action="/admin/cambiar-por-garantia" method="POST" style="display:flex; gap:6px; margin:0;">
                                            <input type="hidden" name="caida_id" value="${c.id}">
                                            <input type="text" name="nueva_cuenta_email" placeholder="Correo Reemplazo..." class="input-classic" style="margin:0; padding:6px; font-size:11px;" required>
                                            <button type="submit" class="action-btn-pill" style="background:#3b82f6; color:#fff; width:auto; padding:6px 10px; font-size:10px;">CAMBIAR POR GARANTÍA</button>
                                        </form>
                                    </td>
                                </tr>
                            `).join('') || '<tr><td colspan="7" style="text-align:center;">No hay cuentas caídas pendientes.</td></tr>'}</tbody>
                        </table>
                    </div>

                    <h3 style="margin:30px 0 8px 0; font-size:19px; color:#25d366;">🟢 CUENTAS DE GARANTÍA (REEMPLAZOS ENTREGADOS)</h3>
                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Reemplazo Entregado</th><th>Cliente</th><th>Cuenta Caída</th><th>Fecha Original</th><th>Fecha Reemplazo</th><th>Estado</th></tr></thead>
                            <tbody>${cuentasCaidas.filter(c => c.estado === 'Reemplazada').map(g => `
                                <tr>
                                    <td style="color:#25d366; font-family:monospace; font-weight:700;">${g.reemplazo_email}</td>
                                    <td><b>@${g.cliente_nombre || 'N/A'}</b></td>
                                    <td style="color:#ef4444; font-family:monospace;">${g.email}</td>
                                    <td><small style="color:var(--text-muted);">${g.fecha_compra || 'N/A'}</small></td>
                                    <td><small style="color:#22c55e;">${g.fecha_reemplazo}</small></td>
                                    <td><span class="badge-status garantia">VINCULADA</span></td>
                                </tr>
                            `).join('') || '<tr><td colspan="6" style="text-align:center;">No hay reemplazos registrados.</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>

                <div id="main-paises-cuentas" class="main-card">
                    <h3 style="margin:0 0 15px 0; font-size:19px; color:var(--accent);">🌎 PAÍSES DE LAS CUENTAS</h3>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:25px;">
                        ${resumenPaisesHtml}
                    </div>

                    <div class="table-wrapper">
                        <table class="table-modern">
                            <thead><tr><th>Correo</th><th>País Actual</th><th>Estado</th><th>Cliente / Asignado</th><th>Cambiar País Manualmente</th></tr></thead>
                            <tbody>${(await dbAll("SELECT s.*, u.user as comprador FROM stock_cuentas s LEFT JOIN usuarios u ON s.comprador_id = u.id ORDER BY s.id DESC")).map(s => `
                                <tr>
                                    <td style="font-family:monospace;">${s.email}</td>
                                    <td><span class="country-tag">${PAISES_MAPA[s.pais]?.bandera || '🌐'} ${PAISES_MAPA[s.pais]?.nombre || s.pais}</span></td>
                                    <td><span class="badge-status ${s.estado === 'Disponible' ? 'disp' : 'vendida'}">${s.estado}</span></td>
                                    <td>${s.comprador ? '@'+s.comprador : '<span style="color:var(--text-muted);">Sin asignar</span>'}</td>
                                    <td>
                                        <form action="/admin/cambiar-pais-cuenta" method="POST" style="display:flex; gap:6px; margin:0;">
                                            <input type="hidden" name="email_cuenta" value="${s.email}">
                                            <select name="nuevo_pais" class="input-classic" style="margin:0; padding:4px; font-size:11px;">
                                                ${Object.keys(PAISES_MAPA).map(pk => `<option value="${pk}" ${s.pais === pk ? 'selected':''}>${PAISES_MAPA[pk].bandera} ${PAISES_MAPA[pk].nombre}</option>`).join('')}
                                            </select>
                                            <button type="submit" class="action-btn-pill" style="padding:4px 8px; font-size:10px; width:auto;">Cambiar</button>
                                        </form>
                                    </td>
                                </tr>
                            `).join('')}</tbody>
                        </table>
                    </div>
                </div>
                `;
            }

            let botonesContactoProveedor = "";
            if (esAdminPrincipal || esSubAdmin) {
                botonesContactoProveedor = `
                <div class="provider-contact" style="grid-template-columns: repeat(3, 1fr);">
                    <div class="contact-wrapper">
                        <span class="contact-label">Telegram</span>
                        <a href="https://t.me/SyncBox701" target="_blank" class="contact-btn telegram">Chat</a>
                    </div>
                    <div class="contact-wrapper">
                        <span class="contact-label">WhatsApp</span>
                        <a href="https://wa.me/${NUMERO_ADMIN_PRINCIPAL}" target="_blank" class="contact-btn whatsapp">WA</a>
                    </div>
                    <div class="contact-wrapper">
                        <span class="contact-label">Grupo</span>
                        <a href="https://chat.whatsapp.com/HZ5XGqXqajW5V2UICj8A7g" target="_blank" class="contact-btn whatsapp">Unirse</a>
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
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        <strong>SYNC</strong>BOX 🎄
                    </div>
                    <div class="search-top"><input type="text" placeholder="Buscar en el sistema..."></div>
                </div>

                <div class="dashboard-grid">
                    <div class="left-sidebar">
                        <div class="side-card" style="padding: 16px;">
                            <h4>📺 Plataformas</h4>
                            <div class="plat-mini-grid">${botonesPlataformaHtml}</div>
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
                            <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color:var(--accent);">👤 Crear Nuevo Usuario</h3>
                            <form action="/admin/crear" method="POST" onsubmit="
                                const tel = this.telefono.value.replace(/\\s+/g, '');
                                if(!/^\\+[1-9]\\d{7,14}$/.test(tel)) {
                                    alert('⛔ OBLIGATORIO: Debes incluir el signo + seguido del código de país.');
                                    this.telefono.focus();
                                    return false;
                                }
                                this.telefono.value = tel;
                                return true;
                            ">
                                <input name="n" class="input-classic" placeholder="Nombre de Usuario" required>
                                <input name="c" class="input-classic" placeholder="Contraseña" required>
                                <input type="tel" name="telefono" class="input-classic" placeholder="WhatsApp con + y código" required>
                                <select name="r" class="input-classic">
                                    <option value="Cliente">Cliente Normal</option>
                                    ${esAdminPrincipal ? '<option value="Subadministrador">Subadministrador</option>' : ''}
                                </select>
                                <button class="btn-submit">Guardar Usuario en DB</button>
                            </form>
                        </div>

                        <div id="main-usuarios" class="main-card">
                            <h3 style="margin:0 0 18px 0; font-size:19px; font-weight:600; color:var(--accent);">📧 Asignación de Correos</h3>
                            <form action="/admin/asignar-correo" method="POST">
                                <select name="user_id" class="input-classic" required><option value="" disabled selected>Selecciona un usuario...</option>${clientesOpcionesHtml}</select>
                                <textarea name="email" class="input-classic" placeholder="Pega los correos separados por espacio o salto de línea" rows="5" required></textarea>
                                <button type="submit" class="btn-submit">Asignar Correos</button>
                            </form>
                        </div>

                        <div id="main-borrar-correos-masivo" class="main-card">
                            <h3 style="margin:0 0 8px 0; font-size:19px; font-weight:600; color:#E50914;">🗑️ Borrar Correos Masivamente a un Usuario</h3>
                            <form action="/admin/borrar-correos-masivo" method="POST" style="background: rgba(0,0,0,0.5); padding: 18px; border-radius: 10px; border: 1px solid rgba(229, 9, 20, 0.35);">
                                <div style="margin-bottom: 14px;">
                                    <label style="color: var(--accent); font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">1. Buscar y seleccionar usuario:</label>
                                    <input type="text" id="buscador-user-borrar" class="input-classic" placeholder="🔎 Filtrar usuario..." oninput="filtrarSelectorUsuarios('buscador-user-borrar', 'select-user-borrar')">
                                    <select id="select-user-borrar" name="user_id" class="input-classic" required>
                                        <option value="" disabled selected>-- Selecciona al usuario --</option>
                                        ${clientesOpcionesHtml}
                                    </select>
                                </div>
                                <div style="margin-bottom: 15px;">
                                    <label style="color: #E50914; font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">2. Pega los correos que le vas a borrar:</label>
                                    <textarea name="correos_borrar" class="input-classic" rows="8" required></textarea>
                                </div>
                                <button type="submit" class="btn-submit" style="background: #E50914; color: #fff;" onclick="return confirm('⚠️ ¿Seguro que deseas borrarle todos estos correos?');">🗑️ Borrarle estos correos al usuario</button>
                            </form>
                        </div>

                        <div id="main-base-datos" class="main-card">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                                <h3 style="margin:0; font-size:19px; font-weight:600; color:var(--accent);">🗄️ Base de Datos SyncBox</h3>
                                <form action="/dash" method="GET" style="display:flex; gap:8px; margin:0;">
                                    <input type="text" name="buscar_dueno" value="${terminoBusqueda}" class="input-classic" placeholder="Buscar correo..." style="margin:0; padding: 9px 14px; width: 200px;">
                                    <button type="submit" class="btn-submit" style="padding: 9px 18px; width:auto;">Buscar</button>
                                </form>
                            </div>
                            <div class="table-wrapper">
                                <table class="table-modern">
                                    <thead><tr>
                                        <th>Usuario</th><th>Rol</th><th style="width: 38%;">Correos Vinculados</th><th>Origen</th><th style="text-align:center;">Acción</th>
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
                                ${(esAdminPrincipal || esSubAdmin) ? `
                                <div class="menu-group-label">Nuevas Funciones</div>
                                <button class="menu-btn-item" data-tab="admin-creditos" onclick="openTab('admin-creditos')">💰 Créditos (Dar/Quitar)</button>
                                <button class="menu-btn-item" data-tab="control-clientes" onclick="openTab('control-clientes')">📦 Cuentas y Renovaciones</button>
                                <button class="menu-btn-item" data-tab="cuentas-caidas" onclick="openTab('cuentas-caidas')" style="color:#E50914;">🔴 Caídas y Garantías</button>
                                <button class="menu-btn-item" data-tab="paises-cuentas" onclick="openTab('paises-cuentas')" style="color:#60a5fa;">🌎 Países de Cuentas</button>
                                ` : ''}

                                ${(esAdminPrincipal) ? `
                                <div class="menu-group-label">Inventario y Finanzas</div>
                                <button class="menu-btn-item" data-tab="api-ghoulflix" onclick="openTab('api-ghoulflix')" style="color: #25d366;">🔌 Servidor de códigos</button>
                                <button class="menu-btn-item" data-tab="stock-admin" onclick="openTab('stock-admin')">📦 Gestión de Stock</button>
                                <button class="menu-btn-item" data-tab="asignacion-manual" onclick="openTab('asignacion-manual')" style="color: var(--accent);">🎯 Asignación Manual</button>
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
                                <button class="menu-btn-item" data-tab="comprar-stock" onclick="openTab('comprar-stock')" style="color: var(--accent);">🛒 Tienda de Cuentas</button>
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
                ${CHRISTMAS_EXTRAS}
            </body>
            </html>
            `);
        } catch (err) { 
            console.error(err);
            res.send(`<script>alert('Error crítico de servidor: ${err.message}'); window.location='/';</script>`); 
        }
    }
});

// =========================================================================
// 🔎 PROTOCOLO IMAP Y BÚSQUEDA DUAL
// =========================================================================
function traducirErrorCodigo(message, status) {
    const text = String(message || '').toLowerCase();
    if (status === 429 || /too many requests|rate limit/.test(text)) return 'El servidor limita las solicitudes.';
    if (/not assigned|not in your|access denied/.test(text)) return 'Esta cuenta no está autorizada.';
    if (status >= 500) return 'El servidor de códigos no está disponible en este momento.';
    return 'No se encontró un código válido.';
}

function escapeResultado(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function enlaceNetflixSeguro(value) {
    try {
        const u = new URL(value);
        return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'netflix.com' || u.hostname.endsWith('.netflix.com')) ? u.href : null;
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
    return { 
        source: fuente, success, code: success ? code : null, link: success ? link : null, 
        status: success ? 'found' : 'not_found', 
        error: success ? null : fuente === 'Gmail' ? 'No se encontró un resultado reciente en Gmail.' : 'No se encontró código.' 
    };
}

function extraerCodigoGmail(mail, tipo) {
    if (!mail) return { success: false };
    if (tipo === 'buzon_completo') return { success: true };
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
        link = urls.map(x => enlaceNetflixSeguro(x.replace(/&amp;/g, '&'))).find(x => x && (tipo === 'reset_link' ? /password|loginhelp/i : /travel|household|update-primary-location/i).test(x)) || null;
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
    const sources = ['Servidor de códigos', 'Gmail'].map(source => ({ source, success: false, code: null, link: null, status: 'searching' }));
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const timer = setTimeout(stop, 60000);
    controller.signal.addEventListener('abort', () => resolveDone(), { once: true });
    
    let finished = 0;
    const poll = async index => {
        try {
            while (!controller.signal.aborted && Date.now() < deadline) {
                let value;
                try {
                    if (index === 0) value = await consultarCodigoGhoulflixApi(email, tipo, controller.signal);
                    else {
                        const response = await buscarEnBuzonImap('darciogarces@gmail.com', email, 'netflix', email.split('@'), tipo, controller.signal);
                        value = extraerCodigoGmail(response && response.mail, tipo);
                    }
                } catch (_) { value = { success: false }; }
                if (controller.signal.aborted) break;
                sources[index] = normalizarResultadoFuente(value, sources[index].source, tipo);
                if (sources[index].success) { resolveDone(); return; }
                await new Promise(r => setTimeout(r, 4000));
            }
        } finally {
            finished++;
            if (finished === 2) resolveDone();
        }
    };
    poll(0); poll(1);
    try { if (!controller.signal.aborted) await done; }
    finally {
        clearTimeout(timer); controller.abort();
        if (externalSignal) externalSignal.removeEventListener('abort', stop);
    }
    const best = sources.find(x => x.success);
    return { success: !!best, code: best ? best.code : null, link: best ? best.link : null, source: best ? best.source : null, sources };
}

function renderBusquedaCliente(email, tipo, etiqueta) {
    const payload = JSON.stringify({ email, code_type: tipo }).replace(/</g, '\\u003c');
    return `<main class="lookup-shell"><div class="lookup-top">BÚSQUEDA AUTOMÁTICA</div><h2>${escapeResultado(etiqueta)}</h2><p class="lookup-email">${escapeResultado(email)}</p><section id="lookup-progress"><div id="lookup-seconds">60 s</div><p id="lookup-status">Buscando en Gmail y el servidor de códigos…</p></section><div id="lookup-results" aria-live="polite"></div></main>
    <style>.lookup-shell{box-sizing:border-box;max-width:850px;padding:28px;margin:20px auto;background:linear-gradient(135deg,#101d30,#0b1320);border:1px solid #2b4059;border-radius:22px;color:#edf6ff;font-family:Inter,sans-serif}.lookup-top{font-size:11px;color:var(--accent);letter-spacing:2px}.lookup-shell h2{font-size:23px;margin:14px 0 8px}.lookup-email{font-size:13px;color:#a9bdd3;overflow-wrap:anywhere}#lookup-progress{text-align:center;padding:20px}#lookup-seconds{font-size:52px;font-weight:700;color:var(--accent)}.lookup-muted{font-size:12px;color:#91a7c0;line-height:1.7}.lookup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.lookup-card{padding:20px;border:1px solid #30465f;border-radius:14px;background:#101c2b;min-width:0}.lookup-card.found{border-color:#FFD700;background:rgba(255,215,0,0.1)}.lookup-card h3{font-size:15px;margin:0 0 14px}.lookup-code{font:700 35px monospace;letter-spacing:4px;color:#FFD700;padding:18px 0;user-select:all}.lookup-button{display:inline-block;margin:8px 8px 0 0;padding:11px 15px;border:1px solid #3c6079;border-radius:9px;background:#E50914;color:#fff;text-decoration:none;font:600 12px Inter,sans-serif;cursor:pointer}@media(max-width:600px){.lookup-grid{grid-template-columns:1fr}}</style>
    <script>
    (async function(){
        const requestBody=${payload};
        const controller=new AbortController();
        const started=Date.now();
        const results=document.getElementById('lookup-results');
        const progress=document.getElementById('lookup-progress');
        function node(tag,text,cls){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;}
        const ticker=setInterval(function(){const left=Math.max(0,60-Math.floor((Date.now()-started)/1000));document.getElementById('lookup-seconds').textContent=left>0?left+' s':'Terminando la consulta…';},250);
        try{
            const response=await fetch('/api/customer/fetch-code',{
                method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
                headers:{'Content-Type':'application/json'},body:JSON.stringify(requestBody)
            });
            const data=await response.json();
            const sources=Array.isArray(data.sources)?data.sources:[];
            const title=node('h2',data.success?'Resultado disponible':'Búsqueda finalizada sin código');results.append(title);
            const grid=node('div',null,'lookup-grid');results.append(grid);
            sources.forEach(function(item){
                const card=node('section',null,'lookup-card'+(item.success?' found':''));grid.append(card);
                card.append(node('h3',item.source==='Gmail'?'✉ Gmail':'◈ Servidor de códigos'));
                let code=item.code==null?'':String(item.code),link=item.link;
                if(item.success&&(code||link)){
                    card.append(node('p','✓ Encontrado','lookup-muted'));
                    if(code)card.append(node('div',code,'lookup-code'));
                    if(link){const a=node('a','Abrir enlace ↗','lookup-button');a.href=link;a.target='_blank';card.append(a);}
                }else card.append(node('p',item.error||'No se encontró un resultado.','lookup-muted'));
            });
        }catch(error){
            results.append(node('p','Error en la búsqueda','lookup-error'));
        }finally{
            clearInterval(ticker);progress.hidden=true;window.parent.postMessage('lookup-complete',location.origin);
        }
    })();
    </script>`;
}

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

        if (searchResults.length > 0) {
            searchResults.sort((a, b) => new Date(b.attributes.date || 0).getTime() - new Date(a.attributes.date || 0).getTime());
            for (const candidate of searchResults.slice(0, 10)) {
                if (signal && signal.aborted) return null;
                const fetched = await connection.search([['UID', candidate.attributes.uid]], { bodies: [''], struct: true });
                if (!fetched.length) continue;
                const part = fetched[0].parts.find(p => p.which === '');
                if (!part) continue;
                const parsed = await simpleParser(part.body);
                if (extraerCodigoGmail(parsed, accion).success) return { messages: fetched, mail: parsed, buzón: correoBuzon };
            }
        }
        connection.end();
        return null;
    } catch (err) {
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
        body, html { font-family: 'Inter', sans-serif !important; background: transparent !important; color: #f8fafc; margin: 0; padding: 0; }
        .api-result-box { max-width: 520px; margin: 35px auto; background: rgba(10, 14, 22, 0.95); border: 1px solid rgba(255, 215, 0, 0.35); border-radius: 16px; padding: 30px; text-align: center; }
    </style>`;

    try {
        let correoIngresado = (email_search || "").trim().toLowerCase();
        
        const esAdminPrincipal = (req.session.user === 'admin' || req.session.user === 'ruben');
        const esCliente = (req.session.rol === 'Cliente');
        const esSubAdmin = (req.session.rol === 'Subadministrador');
        if (!req.session.uid || (!esAdminPrincipal && !esCliente && !esSubAdmin && req.session.rol !== 'Administrador')) return res.status(403).send('Perfil no autorizado.');

        if (esCliente && !esAdminPrincipal) {
            const tieneAcceso = await dbGet("SELECT id FROM correos WHERE user_id = ? AND email = ?", [req.session.uid, correoIngresado]);
            if (!tieneAcceso) {
                return res.send(`${cssIframe}<div class="api-result-box" style="border-color:#E50914;"><h2 style="color:#E50914; margin-top:0;">⛔ Not assigned to your profile</h2><p style="color:#cbd5e1; font-size:13px;">No tienes este correo asignado.</p></div>`);
            }
        }

        if (tiposApiGhoulflix.includes(accion)) {
            const etiquetasTipo = {
                'signin_6digit': '🔢 Código de Inicio (6 Dígitos)',
                'signin_4digit': '📺 Código de TV (4 Dígitos)',
                'household': '🏠 Hogar / Viaje',
                'reset_link': '🔑 Enlace de Contraseña'
            };
            res.setHeader('Cache-Control', 'no-store');
            return res.send(cssIframe + renderBusquedaCliente(correoIngresado, accion, etiquetasTipo[accion]));
        }

        let resultadoExitoso = await buscarEnBuzonImap('darciogarces@gmail.com', correoIngresado, plataforma, correoIngresado.split('@'), accion);

        if (!resultadoExitoso) { 
            return res.send(`${cssIframe}<div style="text-align:center; padding:40px;"><h2 style="color:#FFD700;">Mensaje no encontrado</h2><p>No hay mensajes recientes para: <b>${email_search}</b></p></div>`); 
        }

        const { mail } = resultadoExitoso;
        res.send(`${cssIframe}<div style="padding:20px; font-family:'Inter', sans-serif;">${mail.html || mail.text}</div>`);

    } catch (err) {
        res.send(`${cssIframe}<h2 style="color:#E50914; text-align:center;">Error en la búsqueda</h2>`);
    }
});

app.listen(10000, () => {
    console.log("🚀 SISTEMA COMPLETO Y RESTAURADO EN EL PUERTO 10000");
});
