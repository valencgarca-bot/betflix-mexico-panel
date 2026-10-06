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
    
    db.run("CREATE TABLE IF NOT EXISTS correos (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, user_id INTEGER, fecha_asignacion DATETIME DEFAULT (date('now', 'localtime')))");
    db.run("CREATE TABLE IF NOT EXISTS registro_codigos (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, email_buscado TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    
    db.run("CREATE TABLE IF NOT EXISTS reservas (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, cantidad INTEGER, telefono TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Pendiente')");
    db.run("CREATE TABLE IF NOT EXISTS garantias (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plataforma TEXT, motivo TEXT, detalles TEXT, reemplazo TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Pendiente')");
    db.run("CREATE TABLE IF NOT EXISTS soporte (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, mensaje TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Abierto')");
    
    db.run("CREATE TABLE IF NOT EXISTS stock_cuentas (id INTEGER PRIMARY KEY AUTOINCREMENT, plataforma TEXT, email TEXT UNIQUE, estado TEXT DEFAULT 'Disponible', fecha_carga DATETIME DEFAULT (datetime('now', 'localtime')))");
    db.run("ALTER TABLE stock_cuentas ADD COLUMN comprador_id INTEGER", (err) => {});
    db.run("ALTER TABLE stock_cuentas ADD COLUMN compra_id INTEGER", (err) => {});
    db.run("ALTER TABLE stock_cuentas ADD COLUMN fecha_compra DATETIME", (err) => {});

    db.run("CREATE TABLE IF NOT EXISTS compras_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, subadmin_id INTEGER, cantidad INTEGER, creditos_usados REAL, saldo_anterior REAL, saldo_nuevo REAL, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    db.run("CREATE TABLE IF NOT EXISTS detalles_compras (id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER, cuenta_id INTEGER, email_cuenta TEXT)");

    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por) VALUES ('admin', '14032021', 'Administrador', NULL)", (err) => {});
    db.run("UPDATE usuarios SET user = 'admin', pass = '14032021' WHERE user = 'dueño'", (err) => {});
});

// 🧹 FUNCIÓN DE PURGA INMEDIATA
async function purgarUsuariosInactivos() {
    try {
        const res = await dbRun(`
            DELETE FROM usuarios 
            WHERE rol = 'Cliente' 
            AND id NOT IN (SELECT DISTINCT user_id FROM correos) 
            AND datetime(fecha_creacion, '+24 hours') <= datetime('now', 'localtime')
        `);
    } catch(err) {}
}
purgarUsuariosInactivos();
setInterval(purgarUsuariosInactivos, 15 * 60 * 1000);

const metodosDePagoHtml = `
    <div class="payment-box" style="background: rgba(0,0,0,0.85); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 15px; text-align: left;">
        <div class="pay-method" style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <div class="pay-header" style="font-size: 14px; font-weight: 600; color: #00D2FF; margin-bottom: 8px; text-transform: uppercase;"><span>🇨🇴 Colombia</span></div>
            <div class="pay-details" style="color: #ffffff;">
                <div style="margin-bottom: 6px;">
                    <span class="badge" style="background: #2e004b; color: #ffffff; border: 1px solid #ff00ea; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase; margin-right: 5px;">Nequi</span>
                    <span class="badge" style="background: #ED1C24; color: #ffffff; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase;">DaviPlata</span>
                </div>
                <small style="color: #94a3b8; font-size: 11px;">Número de Cuenta:</small>
                <strong style="display: block; font-size: 18px; margin-top: 2px; color: #ffffff; font-family: monospace; letter-spacing: 1px; user-select: all;">3157705811</strong>
            </div>
        </div>
        <div class="pay-method" style="margin-bottom: 0;">
            <div class="pay-header" style="font-size: 14px; font-weight: 600; color: #00D2FF; margin-bottom: 8px; text-transform: uppercase;"><span>🇲🇽 México</span></div>
            <div class="pay-details" style="color: #ffffff;">
                <div style="margin-bottom: 6px;">
                    <span class="badge" style="background: #820AD1; color: #ffffff; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase;">Nu México</span>
                </div>
                <small style="color: #94a3b8; font-size: 11px;">Titular: <b style="color:#f8fafc;">Javier Rodriguez</b></small><br>
                <small style="color: #94a3b8; font-size: 11px;">Concepto: <b style="color:#00D2FF;">Pago o Comida</b></small>
                <strong style="display: block; font-size: 16px; margin-top: 4px; color: #ffffff; font-family: monospace; letter-spacing: 1px; user-select: all;">638180010102198561</strong>
            </div>
        </div>
    </div>
`;

const CSS_MODERNO = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    :root {
        --text-main: #f8fafc; --text-muted: #94a3b8; --card-bg: rgba(0, 0, 0, 0.92);
        --card-border: rgba(255, 255, 255, 0.15); --accent: #00D2FF; --accent-hover: #0099CC;
        --btn-bg: rgba(0, 210, 255, 0.12); --shadow-elegant: 0 20px 50px rgba(0, 0, 0, 0.98);
        --blur-effect: blur(8px); --radius: 16px;
    }
    @keyframes pureSeriesSlideshow {
        0% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
        33% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=2000&auto=format&fit=crop'); }
        66% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2000&auto=format&fit=crop'); }
        100% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
    }
    body { background-size: cover; background-position: center; background-attachment: fixed; animation: pureSeriesSlideshow 16s ease infinite; background-color: #000000; color: var(--text-main); font-family: 'Inter', sans-serif; margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; min-height: 100vh; }
    .top-header { background: transparent; padding: 25px 40px; display: flex; justify-content: space-between; align-items: center; }
    .user-pill { display: flex; align-items: center; gap: 12px; background: var(--card-bg); padding: 8px 16px; border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); border-radius: 50px; box-shadow: var(--shadow-elegant); cursor: pointer; transition: 0.3s; }
    .user-pill:hover { border-color: rgba(255, 255, 255, 0.4); transform: translateY(-2px); }
    .user-pill img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
    .user-pill .info { display: flex; flex-direction: column; }
    .user-pill .info strong { color: var(--text-main); font-size: 13px; font-weight: 600; }
    .user-pill .info span { color: var(--text-muted); font-size: 11px; }
    .brand-logo { font-size: 20px; font-weight: 300; display:flex; align-items:center; gap: 10px; letter-spacing: 2px; text-transform: uppercase; color: #fff;}
    .brand-logo strong { font-weight: 700; color: var(--accent); }
    .search-top input { background: var(--card-bg); border: 1px solid var(--card-border); padding: 12px 25px; width: 280px; border-radius: 50px; color: #fff; backdrop-filter: var(--blur-effect); font-size: 13px; outline: none; transition: 0.3s; }
    .search-top input:focus { border-color: var(--accent); width: 320px; background: #000; }
    .dashboard-grid { display: grid; grid-template-columns: 320px 1fr 280px; gap: 25px; padding: 10px 40px 40px 40px; align-items: start; }
    .left-sidebar { display: flex; flex-direction: column; gap: 20px; height: 100%; min-height: 600px; }
    .right-sidebar { display: flex; flex-direction: column; gap: 20px; }
    .center-panel { display: flex; flex-direction: column; gap: 20px; }
    .action-panel { background: var(--card-bg); border-radius: var(--radius); padding: 25px; box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); display: none; flex-direction: column; gap: 12px; min-height: 380px; }
    .action-panel.active { display: flex; }
    .main-card { background: var(--card-bg); border-radius: var(--radius); padding: 18px 25px; box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); display: none; }
    .main-card.active { display: block; }
    .action-btn-pill { width: 100%; background: var(--btn-bg); border: 1px solid var(--card-border); padding: 14px; border-radius: 12px; font-size: 11px; font-weight: 600; color: var(--text-main); cursor: pointer; transition: 0.3s; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
    .action-btn-pill:hover { background: rgba(255, 255, 255, 0.15); border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.5);}
    .search-input-large { width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); padding: 16px 25px; border-radius: 12px; font-size: 14px; margin-top: 5px; color: var(--text-main); outline: none; box-sizing: border-box; font-family: 'Inter', sans-serif; transition: 0.3s; }
    .search-input-large:focus { border-color: var(--accent); background: #000; box-shadow: 0 0 20px rgba(0,210,255,0.3); }
    .iframe-container { display: none; background: transparent; border: none; height: 600px; width: 100%; overflow: hidden; }
    .side-card { background: var(--card-bg); border-radius: var(--radius); padding: 25px; box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); }
    .side-card h4 { margin: 0 0 15px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--card-border); padding-bottom: 10px;}
    .plat-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px; }
    .plat-mini-btn { background: #000000; border: 1px solid var(--card-border); padding: 12px; border-radius: 12px; cursor: pointer; display: flex; justify-content: center; align-items: center; height: 60px; transition: 0.3s; box-shadow: 0 4px 15px rgba(0,0,0,0.8); }
    .plat-mini-btn:hover { background: rgba(0, 210, 255, 0.2); border-color: var(--accent); transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0,210,255,0.4);}
    .plat-mini-btn img { max-height: 28px; max-width: 90%; object-fit: contain; }
    .menu-list { display: flex; flex-direction: column; gap: 8px; }
    .menu-btn-item { background: transparent; border: 1px solid transparent; padding: 10px 12px; border-radius: 8px; font-size: 13px; color: var(--text-main); cursor: pointer; text-align: left; transition: 0.3s; font-family: 'Inter', sans-serif; }
    .menu-btn-item:hover { background: rgba(0, 210, 255, 0.15); border-color: rgba(0, 210, 255, 0.4); padding-left: 18px; }
    .activity-list { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow-y: auto; padding-right: 4px; }
    .activity-item { background: #000000; border: 1px solid rgba(255, 255, 255, 0.12); padding: 12px 14px; border-radius: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; transition: 0.2s; }
    .activity-item:hover { border-color: var(--accent); background: rgba(0, 210, 255, 0.08); }
    .activity-item strong { color: var(--text-main); font-weight: 500; word-break: break-all; font-size: 12px; }
    .activity-meta { display: flex; justify-content: space-between; align-items: center; color: var(--text-muted); font-size: 10px; margin-top: 2px; }
    .activity-user { color: var(--accent); font-weight: 600; }
    .input-classic { width: 100%; padding: 14px; margin-bottom: 10px; border-radius: 8px; border: 1px solid var(--card-border); background: #000000; color: white; box-sizing: border-box; outline: none; font-size: 13px;}
    .input-classic:focus { border-color: var(--accent); box-shadow: 0 0 15px rgba(0,210,255,0.25); }
    .btn-submit { background: var(--accent); color: #000; border: none; padding: 14px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px;}
    .btn-submit:hover { background: var(--accent-hover); box-shadow: 0 0 20px rgba(0, 210, 255, 0.5); color: #fff; }
    .sub-form { display: none; background: rgba(0,0,0,0.6); padding: 15px; border-radius: 12px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.1); }
    .table-modern { width: 100%; border-collapse: collapse; text-align: left; }
    .table-modern th { padding: 12px; font-size: 11px; color: var(--accent); border-bottom: 1px solid rgba(255,255,255,0.15); text-transform: uppercase; letter-spacing: 1px; }
    .table-modern td { padding: 12px; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #f8fafc; vertical-align: top; }
    .badge-status { padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .badge-status.disp { background: rgba(37,211,102,0.15); color: #25d366; border: 1px solid #25d366; }
    .badge-status.vendida { background: rgba(229,9,20,0.15); color: #E50914; border: 1px solid #E50914; }

    @media (max-width: 1024px) {
        .dashboard-grid { grid-template-columns: 1fr !important; padding: 15px 15px 40px 15px !important; gap: 20px !important; }
        .left-sidebar { min-height: auto !important; }
        .top-header { flex-direction: column; gap: 15px; padding: 15px; text-align: center; }
        .brand-logo { margin: 0 auto !important; justify-content: center; width: 100%; text-align: center; }
        .search-top { width: 100%; }
        .search-top input { width: 100% !important; max-width: 100%; }
        .iframe-container { height: 400px; }
        .action-panel, .main-card, .side-card { padding: 18px !important; }
        .user-pill { justify-content: center; }
        .table-modern { display: block; overflow-x: auto; white-space: nowrap; }
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
        
        let selectedMain = document.getElementById('main-' + tabId);
        let selectedAction = document.getElementById('action-' + tabId);
        
        if(selectedMain) selectedMain.classList.add('active');
        if(selectedAction) selectedAction.classList.add('active');
        
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
            return res.send(`<script>alert('Error Interno de Sesión: ${err.message}'); window.location='/';</script>`);
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
                <div class="input-group"><input type="tel" name="telefono" placeholder="Número de WhatsApp (Ej: +57...)" required></div>
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

    let redesSociales = `
        <style>
            .contact-wrapper { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1; text-align: center; }
            .contact-label { font-size: 10px; color: #00D2FF; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-shadow: 0 0 8px rgba(0,210,255,0.6); }
        </style>
        <div class="login-contact" style="display: flex; justify-content: center; gap: 10px; margin-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
            <div class="contact-wrapper">
                <span class="contact-label">⬇ Mi Telegram</span>
                <a href="https://t.me/SyncBox701" target="_blank" class="contact-icon-btn telegram" title="Telegram" style="width: 100%;">
                    <svg viewBox="0 0 24 24" fill="#0088cc"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.14-.261.26-.536.26l.213-3.05 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.654-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z"/></svg> Telegram
                </a>
            </div>
            <div class="contact-wrapper">
                <span class="contact-label">⬇ Mi WhatsApp</span>
                <a href="https://wa.me/573012964169" target="_blank" class="contact-icon-btn whatsapp" title="WhatsApp Directo" style="width: 100%;">
                    <svg viewBox="0 0 24 24" fill="#25d366"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg> WhatsApp
                </a>
            </div>
            <div class="contact-wrapper">
                <span class="contact-label">⬇ Ref. Grupo</span>
                <a href="https://chat.whatsapp.com/HZ5XGqXqajW5V2UICj8A7g?s=cl&p=i&mlu=4&ilr=4" target="_blank" class="contact-icon-btn whatsapp" title="Grupo de Referencia" style="width: 100%;">
                    <svg viewBox="0 0 24 24" fill="#25d366"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm-2.025 15.34l-3.32-3.32 1.414-1.414 1.906 1.906 5.234-5.234 1.414 1.414-6.648 6.648z"/></svg> Grupo
                </a>
            </div>
        </div>
    </body>
    </html>
    `);
});

app.post('/registrar-cliente', async (req, res) => {
    const { user, pass, telefono } = req.body;
    try {
        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono) VALUES (?, ?, 'Cliente', NULL, ?)", [user.trim(), pass, telefono.trim()]);
        
        const fechaObj = new Date();
        const fechaHoraLocal = fechaObj.toLocaleString('es-CO', { timeZone: 'America/Bogota' });

        const mensajeWhatsApp = `¡Hola! Me acabo de registrar en SyncBox.\n\n👤 *Usuario:* ${user.trim()}\n🔑 *Contraseña:* ${pass}\n📱 *Número:* ${telefono.trim()}\n📅 *Fecha y Hora:* ${fechaHoraLocal}\n\n¡Me gustaría unirme al grupo y conocer los enlaces oficiales!`;
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
        console.error(err);
        res.send(`<script>alert('Error de base de datos en Login: ${err.message}'); window.location='/';</script>`); 
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.post('/bot/reservar', async (req, res) => {
    if(!req.session.uid) return res.redirect('/');
    try {
        await dbRun("INSERT INTO reservas (user_id, cantidad, telefono) VALUES (?, ?, ?)", [req.session.uid, req.body.cantidad, req.body.telefono]);
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

app.post('/admin/cargar-stock', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    const { correos_stock, plataforma } = req.body;
    const lista = correos_stock.split(/[\s,]+/).filter(e => e.includes('@'));
    
    let duplicadas = 0;
    let agregadas = 0;

    try {
        for (let email of lista) {
            let e = email.trim().toLowerCase();
            let existsStock = await dbGet("SELECT id FROM stock_cuentas WHERE email = ?", [e]);
            let existsCorreos = await dbGet("SELECT id FROM correos WHERE email = ?", [e]);
            
            if(existsStock || existsCorreos) {
                duplicadas++;
            } else {
                await dbRun("INSERT INTO stock_cuentas (plataforma, email) VALUES (?, ?)", [plataforma, e]);
                agregadas++;
            }
        }
        if(duplicadas > 0) {
            res.send(`<script>alert('✅ Se agregaron ${agregadas} cuentas.\\n\\n⚠️ Se ignoraron ${duplicadas} cuentas porque YA ESTÁN REGISTRADAS (en el stock o asignadas a un cliente).'); window.location='/dash';</script>`);
        } else {
            res.redirect('/dash');
        }
    } catch(e) { res.redirect('/dash'); }
});

app.post('/admin/asignar-creditos', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    const { subadmin_id, cantidad } = req.body;
    
    try {
        const user = await dbGet("SELECT user, telefono, creditos FROM usuarios WHERE id = ?", [subadmin_id]);
        if(!user) return res.redirect('/dash');

        const monto = parseFloat(cantidad);
        const nuevoSaldo = user.creditos + monto;

        await dbRun("UPDATE usuarios SET creditos = ? WHERE id = ?", [nuevoSaldo, subadmin_id]);

        let telefonoLimpio = user.telefono ? user.telefono.replace('+', '').replace(/\s/g, '') : '';
        const msg = `Hola, ${user.user}.\n\nSe te ha asignado un crédito de *$${monto} MXN* para realizar compras de cuentas de Netflix.\n\n*Crédito disponible:* $${nuevoSaldo} MXN\n\nPuedes utilizar tu crédito en tu panel para comprar:\n- 5 cuentas por $832 MXN.\n- 10 cuentas por $1.560 MXN.\n\nTu crédito disponible se irá descontando automáticamente en cada compra.`;
        const link = `https://api.whatsapp.com/send?phone=${telefonoLimpio}&text=${encodeURIComponent(msg)}`;

        res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Aviso de Crédito</title>
            <style>
                body { background: #000; color: #fff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
                h2 { color: #00D2FF; font-size: 24px; }
                .btn { background: #00D2FF; color: #000; padding: 18px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 5px 20px rgba(0,210,255,0.4); margin-top: 20px;}
            </style>
        </head>
        <body>
            <h2>✅ Crédito Asignado (${nuevoSaldo} Cr)</h2>
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

app.post('/subadmin/comprar', async (req, res) => {
    if (req.session.rol !== 'Subadministrador' && req.session.rol !== 'Cliente') return res.redirect('/dash');
    const paquete = parseInt(req.body.paquete);
    let costo = 0;
    
    if (paquete === 5) costo = 832;
    else if (paquete === 10) costo = 1560;
    else return res.send("<script>alert('Paquete inválido'); window.location='/dash';</script>");

    try {
        const user = await dbGet("SELECT user, telefono, creditos, deuda FROM usuarios WHERE id = ?", [req.session.uid]);
        if (user.creditos < costo) return res.send("<script>alert('Créditos insuficientes. Contacta al administrador.'); window.location='/dash';</script>");

        const disponibles = await dbAll("SELECT id, email FROM stock_cuentas WHERE estado = 'Disponible' AND plataforma = 'netflix' LIMIT ?", [paquete]);
        if (disponibles.length < paquete) return res.send("<script>alert('El administrador no tiene suficiente stock disponible en este momento. Intenta más tarde.'); window.location='/dash';</script>");

        const nuevoSaldo = user.creditos - costo;
        const nuevaDeuda = (user.deuda || 0) + costo;

        await dbRun("UPDATE usuarios SET creditos = ?, deuda = ? WHERE id = ?", [nuevoSaldo, nuevaDeuda, req.session.uid]);

        const compraInfo = await dbRun("INSERT INTO compras_stock (subadmin_id, cantidad, creditos_usados, saldo_anterior, saldo_nuevo) VALUES (?, ?, ?, ?, ?)", [req.session.uid, paquete, costo, user.creditos, nuevoSaldo]);
        const compraId = compraInfo.lastID;

        let correosEntregados = [];
        for (let cuenta of disponibles) {
            await dbRun("UPDATE stock_cuentas SET estado = 'Vendida', comprador_id = ?, compra_id = ?, fecha_compra = datetime('now', 'localtime') WHERE id = ?", [req.session.uid, compraId, cuenta.id]);
            await dbRun("INSERT INTO detalles_compras (compra_id, cuenta_id, email_cuenta) VALUES (?, ?, ?)", [compraId, cuenta.id, cuenta.email]);
            await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [cuenta.email, req.session.uid]);
            correosEntregados.push(cuenta.email);
        }

        const fechaObj = new Date();
        const fechaStr = fechaObj.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
        const horaStr = fechaObj.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota' });

        const adminPhone = "573012964169";
        const msgAdmin = `*NUEVA COMPRA REALIZADA*\n\n👤 *Usuario:* ${user.user}\n📱 *Teléfono:* ${user.telefono}\n📅 *Fecha:* ${fechaStr}\n⏰ *Hora:* ${horaStr}\n\n🛒 *Compró:* ${paquete} cuentas\n💵 *Valor:* $${costo} MXN\n\n*Cuentas entregadas:*\n${correosEntregados.join('\n')}\n\n➖ *Crédito utilizado:* $${costo} MXN\n🪙 *Crédito restante:* $${nuevoSaldo} MXN\n🔴 *Deuda Total:* $${nuevaDeuda} MXN`;
        const linkAdmin = `https://api.whatsapp.com/send?phone=${adminPhone}&text=${encodeURIComponent(msgAdmin)}`;

        res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Compra Exitosa</title>
            <style>
                body { background: #000; color: #fff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
                h2 { color: #25d366; font-size: 24px; }
                .btn { background: #25d366; color: #000; padding: 18px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px; box-shadow: 0 5px 20px rgba(37,211,102,0.4); margin-top: 20px;}
            </style>
        </head>
        <body>
            <h2>✅ Compra de ${paquete} Cuentas Exitosa</h2>
            <p>Las cuentas ya están en tu panel listas para usar.<br>Notifica al administrador para confirmar el comprobante de la transacción.</p>
            <a href="${linkAdmin}" class="btn">Enviar Comprobante</a>
            <br><br>
            <a href="/dash" style="color:var(--text-muted); font-size: 12px;">Volver al Panel</a>
            <script>window.location.replace('${linkAdmin}');</script>
        </body>
        </html>
        `);
    } catch(e) {
        res.send(`<script>alert('Error en el sistema: ${e.message}'); window.location='/dash';</script>`);
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

            const stockDisp = await dbGet("SELECT COUNT(*) as count FROM stock_cuentas WHERE estado = 'Disponible'");
            const stockVend = await dbGet("SELECT COUNT(*) as count FROM stock_cuentas WHERE estado = 'Vendida'");
            const historialCompras = await dbAll(`SELECT c.*, u.user as comprador FROM compras_stock c JOIN usuarios u ON c.subadmin_id = u.id ORDER BY c.id DESC`);
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
                <div class="plat-mini-btn" onclick="openTab('${key}')" title="Abrir ${plat.nombre}">
                    <img src="${plat.logo}" alt="${plat.nombre}">
                </div>`;
            });

            let panelesCentroHtml = "";
            let panelesIzquierdosHtml = "";

            Object.keys(PLATAFORMAS).forEach(key => {
                let plat = PLATAFORMAS[key];
                
                let controlesIzquierda = `
                    <div style="background: #000000; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px; padding: 12px; text-align: center; margin-bottom: 15px;">
                        <p style="margin: 0; color: #f8fafc; font-size: 11px; line-height: 1.5; font-weight: 400;">
                            Panel Operativo. Utiliza las opciones del bot para interactuar con la administración.
                        </p>
                    </div>`;

                if (key === 'netflix') {
                    controlesIzquierda += `
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill" style="background: #000000; color: #fff; border: 1px solid #E50914; margin-bottom: 5px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px;">
                            <img src="${plat.logo}" alt="Netflix" style="height: 16px;"> DAR CLICK AQUÍ
                        </button>
                    `;
                } else {
                    controlesIzquierda += `
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill" style="background: var(--accent); color: #000; border: none; margin-bottom: 5px;">🔎 Extraer Código Original</button>
                    `;
                }

                let stockEnVivo = stockDisp ? stockDisp.count : 0;
                let msjStock = esSubAdmin ? `📊 Stock en vivo: ${stockEnVivo} Cuentas Netflix Disponibles` : `📊 Stock en vivo: ${Math.floor(Math.random() * 40) + 15} Cuentas Disponibles`;
                
                controlesIzquierda += `
                    <button onclick="alert('${msjStock}')" class="action-btn-pill" style="background: #000;">📊 Ver Stock Disponible</button>
                    
                    <button onclick="toggleSubForm('reserva-${key}')" class="action-btn-pill" style="background: #000;">🛒 Reservar Cuentas (Manual)</button>
                    <div id="reserva-${key}" class="sub-form">
                        <form action="/bot/reservar" method="POST">
                            <h5 style="margin: 0 0 10px 0; color: var(--accent);">🛒 Pedido Manual</h5>
                            <input type="number" name="cantidad" min="1" max="10" placeholder="Cantidad (1 a 10)" class="input-classic" required>
                            <input type="text" name="telefono" placeholder="Número de WhatsApp" class="input-classic" required>
                            <button type="submit" class="btn-submit">Enviar Pedido</button>
                        </form>
                    </div>
                `;

                if (esAdminPrincipal || esSubAdmin) {
                    controlesIzquierda += `
                    <button onclick="toggleSubForm('garantia-${key}')" class="action-btn-pill" style="background: rgba(229, 9, 20, 0.15); border-color: #E50914; color: #fff; margin-top: 5px;">🛡️ Pedir Garantía</button>
                    <div id="garantia-${key}" class="sub-form" style="border-color: #E50914;">
                        <form action="/bot/garantia" method="POST">
                            <h5 style="margin: 0 0 10px 0; color: #E50914;">🛡️️ Reportar Caída</h5>
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
                    <button onclick="toggleSubForm('soporte-${key}')" class="action-btn-pill" style="background: rgba(255, 115, 0, 0.15); border-color: #ff7300; margin-top: 5px;">🛠️ Pedir Soporte (SubAdmin)</button>
                    <div id="soporte-${key}" class="sub-form" style="border-color: #ff7300;">
                        <p style="font-size: 11px; margin-bottom: 10px;">Comunícate directo con el jefe por pagos o ayudas técnicas.</p>
                        <textarea class="input-classic" rows="2" placeholder="Describe el problema..."></textarea>
                        <button type="button" class="btn-submit" style="background: #ff7300; color: #fff;" onclick="alert('Ticket de soporte enviado.')">Enviar Ticket</button>
                    </div>`;
                }

                panelesIzquierdosHtml += `
                <div id="action-${key}" class="action-panel">
                    <h4 style="margin:0 0 10px 0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Acciones ${plat.nombre}</h4>
                    ${controlesIzquierda}
                </div>`;

                let avisoSinCorreo = "";
                if ((esCliente || esSubAdmin) && misCorreos.length === 0) {
                    avisoSinCorreo = `<div style="background: rgba(229,9,20,0.2); border: 1px solid #E50914; padding: 12px; border-radius: 8px; margin-bottom: 15px; font-size: 12px; color: #f8fafc;">⚠️ Aún no tienes cuentas asignadas. Comunícate mediante los botones de contacto (Tu cuenta se eliminará en 24h si no se asigna).</div>`;
                }

                panelesCentroHtml += `
                <div id="main-${key}" class="main-card">
                    ${avisoSinCorreo}
                    <div style="display:flex; align-items:center; gap:15px; margin-bottom:10px;">
                        <div style="background:#000000; padding:10px 15px; border-radius:8px; border:1px solid var(--card-border);">
                            <img src="${plat.logo}" alt="${plat.nombre}" style="display:block; height:24px; width:auto; max-width:100px; object-fit:contain;">
                        </div>
                        <div>
                            <h3 style="margin:0; font-size:16px; font-weight:500;">Búsqueda en ${plat.nombre}</h3>
                            <p style="margin:2px 0 0 0; font-size:11px; color:var(--text-muted);">Ingresa el correo para consultar resultados.</p>
                        </div>
                    </div>
                    <form id="form-${key}" action="/buscar" method="POST" target="marco_resultados" style="margin:0;" onsubmit="document.getElementById('visor-resultados').style.display='flex';">
                        <input type="hidden" name="plataforma" value="${key}">
                        <input type="text" name="email_search" class="search-input-large" placeholder="Escribe el correo registrado..." required ${((esCliente || esSubAdmin) && misCorreos.length === 0) ? 'disabled' : ''}>
                    </form>
                </div>`;
            });

            if (esAdminPrincipal) {
                panelesIzquierdosHtml += `
                <div id="action-stock-admin" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Control de Inventario</h4>
                    <p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Carga masiva de cuentas al sistema para la venta automática a subadministradores.</p>
                    <div style="margin-top:20px; background: rgba(0, 210, 255, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(0, 210, 255, 0.3);">
                        <div style="font-size: 24px; font-weight: 700; color: #00D2FF;">${stockDisp.count}</div>
                        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Cuentas Disponibles</div>
                        <div style="font-size: 18px; font-weight: 700; color: #fff; margin-top: 10px;">${stockVend.count}</div>
                        <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Cuentas Vendidas</div>
                    </div>
                </div>
                <div id="action-creditos-admin" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Economía Global</h4>
                    <p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Asigna saldo a tus subadministradores y controla su deuda acumulada.</p>
                </div>
                <div id="action-historial-compras" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Auditoría General</h4>
                    <p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Registro inmutable de todas las cuentas reclamadas por subadministradores.</p>
                </div>`;

                let subadminsOpcionesHtml = usuarios.filter(u => u.rol === 'Subadministrador' || u.rol === 'Cliente').map(u => `<option value="${u.id}">${u.user} (Crédito: ${u.creditos} | Deuda: ${u.deuda})</option>`).join('');

                let historialGlobalHtml = "";
                if(historialCompras.length === 0) {
                    historialGlobalHtml = "<tr><td colspan='4' style='text-align:center;'>No hay compras registradas.</td></tr>";
                } else {
                    historialCompras.forEach(c => {
                        let cuentasEntregadas = detallesComprasDB.filter(d => d.compra_id === c.id).map(d => `<div style="font-family:monospace; color:#E50914; padding:2px 0;">${d.email_cuenta}</div>`).join('');
                        historialGlobalHtml += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="padding-left:20px;"><span style="color:#00D2FF; font-weight:600;">@${c.comprador}</span><br><small style="color:var(--text-muted);">${c.fecha}</small></td>
                            <td style="text-align:center; font-weight:bold; color:#fff;">${c.cantidad}</td>
                            <td><span style="color:#E50914;">-${c.creditos_usados} Cr</span><br><small style="color:var(--text-muted);">Quedan: ${c.saldo_nuevo}</small></td>
                            <td><div style="max-height:80px; overflow-y:auto; font-size:10px;">${cuentasEntregadas}</div></td>
                        </tr>`;
                    });
                }

                const stockDB = await dbAll(`SELECT s.*, u.user as comprador FROM stock_cuentas s LEFT JOIN usuarios u ON s.comprador_id = u.id ORDER BY s.id DESC`);
                let stockAdnHtml = "";
                if(stockDB.length === 0) {
                    stockAdnHtml = "<tr><td colspan='4' style='text-align:center;'>No hay stock en la base de datos.</td></tr>";
                } else {
                    stockDB.forEach(s => {
                        let estadoBadge = s.estado === 'Disponible' ? '<span class="badge-status disp">Libre</span>' : '<span class="badge-status vendida">Vendida</span>';
                        let compradorTxt = s.comprador ? `<span style="color:#00D2FF;">@${s.comprador}</span><br><small style="color:var(--text-muted);">${s.fecha_compra}</small>` : '<span style="color:var(--text-muted);">Nadie</span>';
                        stockAdnHtml += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="font-family:monospace; padding-left:20px;">${s.email}</td>
                            <td>${estadoBadge}</td>
                            <td>${compradorTxt}</td>
                            <td><small style="color:var(--text-muted);">${s.fecha_carga}</small></td>
                        </tr>`;
                    });
                }

                panelesCentroHtml += `
                <div id="main-stock-admin" class="main-card">
                    <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500; color: #00D2FF;">📦 Cargar Stock y Ver Historial</h3>
                    <form action="/admin/cargar-stock" method="POST">
                        <select name="plataforma" class="input-classic" required>
                            <option value="netflix">Netflix</option>
                        </select>
                        <textarea name="correos_stock" class="input-classic" placeholder="Pega los correos del lote de cuentas separados por espacio o saltos de línea..." rows="5" required></textarea>
                        <button type="submit" class="btn-submit">Ingresar al Inventario Seguro</button>
                    </form>
                    <div style="background: #000000; border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden; margin-top: 25px;">
                        <table class="table-modern">
                            <thead><tr><th style="padding-left:20px;">Correo (ADN)</th><th>Estado</th><th>Comprador</th><th>Fecha Carga</th></tr></thead>
                            <tbody>${stockAdnHtml}</tbody>
                        </table>
                    </div>
                </div>
                <div id="main-creditos-admin" class="main-card">
                    <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500; color: #00D2FF;">💰 Asignación de Créditos</h3>
                    <form action="/admin/asignar-creditos" method="POST">
                        <select name="subadmin_id" class="input-classic" required>
                            <option value="" disabled selected>Selecciona al Usuario/Subadmin...</option>
                            ${subadminsOpcionesHtml}
                        </select>
                        <input type="number" step="0.01" name="cantidad" class="input-classic" placeholder="Cantidad de Créditos a Asignar (Ej: 832)" required>
                        <p style="font-size:11px; color:var(--text-muted); margin-top:-5px; margin-bottom:15px;">* Usa números negativos para restar saldo.</p>
                        <button type="submit" class="btn-submit">Actualizar Saldo y Notificar por WhatsApp</button>
                    </form>
                </div>
                <div id="main-historial-compras" class="main-card" style="padding: 10px;">
                    <div style="padding: 20px 20px 0 20px;">
                        <h3 style="margin:0; font-size:20px; font-weight:500; color: #00D2FF;">🧾 Historial de Compras Global</h3>
                    </div>
                    <div style="background: #000000; border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden; margin-top: 20px;">
                        <table class="table-modern">
                            <thead><tr><th style="padding-left:20px;">Subadmin</th><th style="text-align:center;">Cant.</th><th>Créditos</th><th>Cuentas Entregadas</th></tr></thead>
                            <tbody>${historialGlobalHtml}</tbody>
                        </table>
                    </div>
                </div>
                `;
            }

            if (esSubAdmin) {
                panelesIzquierdosHtml += `
                <div id="action-comprar-stock" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Tienda de Cuentas</h4>
                    <p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Compra cuentas de Netflix de forma instantánea usando tu saldo de créditos.</p>
                </div>
                <div id="action-mis-compras" class="action-panel">
                    <h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Mi Inventario</h4>
                    <p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Revisa las cuentas que has comprado anteriormente.</p>
                </div>`;

                let misComprasHtml = "";
                let misComprasLog = historialCompras.filter(c => c.subadmin_id === req.session.uid);
                if(misComprasLog.length === 0) {
                    misComprasHtml = "<tr><td colspan='4' style='text-align:center;'>Aún no has realizado compras.</td></tr>";
                } else {
                    misComprasLog.forEach(c => {
                        let cuentasEntregadas = detallesComprasDB.filter(d => d.compra_id === c.id).map(d => `<div style="font-family:monospace; color:#E50914; padding:2px 0;">${d.email_cuenta}</div>`).join('');
                        misComprasHtml += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="padding-left:20px;"><span style="color:#00D2FF; font-weight:600;">#${c.id}</span><br><small style="color:var(--text-muted);">${c.fecha}</small></td>
                            <td style="text-align:center; font-weight:bold; color:#fff;">${c.cantidad} Netflix</td>
                            <td><span style="color:#E50914;">-${c.creditos_usados} Cr</span></td>
                            <td><div style="max-height:80px; overflow-y:auto; font-size:11px;">${cuentasEntregadas}</div></td>
                        </tr>`;
                    });
                }

                panelesCentroHtml += `
                <div id="main-comprar-stock" class="main-card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
                        <h3 style="margin:0; font-size:20px; font-weight:500; color: #00D2FF;">🛒 Tienda Mayorista</h3>
                        <div style="background: rgba(0,210,255,0.1); border: 1px solid rgba(0,210,255,0.3); padding: 8px 15px; border-radius: 50px; font-size: 13px; font-weight: 600; color: #fff;">
                            Saldo: <span style="color:#00D2FF;">${usuarioActual.creditos || 0} Cr</span>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div style="background: #000; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 25px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                            <img src="${PLATAFORMAS['netflix'].logo}" height="30" style="margin-bottom: 15px; filter: drop-shadow(0 0 8px rgba(229,9,20,0.6));">
                            <h2 style="margin: 0 0 5px 0; color: #fff; font-size: 24px;">5 Cuentas</h2>
                            <p style="color: #00D2FF; font-weight: 600; font-size: 18px; margin: 0 0 20px 0;">832 Cr</p>
                            <form action="/subadmin/comprar" method="POST">
                                <input type="hidden" name="paquete" value="5">
                                <button type="submit" class="btn-submit" style="font-size: 12px;" onclick="return confirm('¿Seguro que deseas comprar 5 cuentas por 832 créditos? Las cuentas se asignarán a tu panel automáticamente.');">Comprar Ahora</button>
                            </form>
                        </div>
                        
                        <div style="background: #000; border: 1px solid rgba(0,210,255,0.3); border-radius: 12px; padding: 25px; text-align: center; box-shadow: 0 10px 30px rgba(0,210,255,0.1);">
                            <img src="${PLATAFORMAS['netflix'].logo}" height="30" style="margin-bottom: 15px; filter: drop-shadow(0 0 8px rgba(229,9,20,0.6));">
                            <h2 style="margin: 0 0 5px 0; color: #fff; font-size: 24px;">10 Cuentas</h2>
                            <p style="color: #00D2FF; font-weight: 600; font-size: 18px; margin: 0 0 20px 0;">1,560 Cr</p>
                            <form action="/subadmin/comprar" method="POST">
                                <input type="hidden" name="paquete" value="10">
                                <button type="submit" class="btn-submit" style="font-size: 12px;" onclick="return confirm('¿Seguro que deseas comprar 10 cuentas por 1,560 créditos? Las cuentas se asignarán a tu panel automáticamente.');">Comprar Ahora</button>
                            </form>
                        </div>
                    </div>
                </div>

                <div id="main-mis-compras" class="main-card" style="padding: 10px;">
                    <div style="padding: 20px 20px 0 20px;">
                        <h3 style="margin:0; font-size:20px; font-weight:500; color: #00D2FF;">🧾 Mis Compras</h3>
                    </div>
                    <div style="background: #000000; border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden; margin-top: 20px;">
                        <table class="table-modern">
                            <thead><tr><th style="padding-left:20px;">ID / Fecha</th><th style="text-align:center;">Paquete</th><th>Descuento</th><th>Cuentas Entregadas</th></tr></thead>
                            <tbody>${misComprasHtml}</tbody>
                        </table>
                    </div>
                </div>
                `;
            }

            if (esAdminPrincipal || esSubAdmin) {
                let listadoReservas = "";
                if(reservas.length === 0) listadoReservas = "<p style='color:var(--text-muted); font-size:12px;'>No hay reservas pendientes.</p>";
                reservas.forEach(r => {
                    if(r.estado === 'Pendiente') {
                        listadoReservas += `
                        <div style="background: rgba(0, 210, 255, 0.1); border: 1px solid rgba(0, 210, 255, 0.3); padding: 15px; border-radius: 12px; margin-bottom: 15px;">
                            <strong style="color: var(--accent);">🛒 PEDIDO MANUAL: ${r.cantidad} Cuentas</strong>
                            <p style="margin: 5px 0; font-size: 12px;"><strong>Cliente:</strong> ${r.cliente_nombre} | <strong>WhatsApp:</strong> ${r.telefono}</p>
                            <p style="margin: 5px 0 15px 0; font-size: 11px; color: var(--text-muted);"><strong>Fecha:</strong> ${r.fecha}</p>
                            <form action="/admin/completar-reserva" method="POST" style="margin:0;">
                                <input type="hidden" name="reserva_id" value="${r.id}">
                                <button type="submit" class="btn-submit" style="background: #25d366; width: auto; padding: 8px 15px; font-size:11px;">Marcar como Atendido</button>
                            </form>
                        </div>`;
                    }
                });

                panelesCentroHtml += `
                <div id="main-reservas-admin" class="main-card">
                    <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500; color: var(--accent);">🛒 Reservas (Proceso Manual)</h3>
                    <div style="max-height: 400px; overflow-y: auto; padding-right: 10px;">
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
                        <div style="background: rgba(229, 9, 20, 0.15); border: 1px solid #E50914; padding: 15px; border-radius: 12px; margin-bottom: 15px;">
                            <strong style="color: #E50914;">🔴 ALERTA: Caída de ${g.plataforma.toUpperCase()}</strong>
                            <p style="margin: 5px 0; font-size: 12px;"><strong>Cliente:</strong> ${g.cliente_nombre} | <strong>Motivo:</strong> ${g.motivo}</p>
                            <p style="margin: 5px 0 15px 0; font-size: 12px; color: #a3a3a3;"><strong>Detalles:</strong> ${g.detalles}</p>
                            <form action="/admin/resolver-garantia" method="POST" style="display:flex; gap:10px;">
                                <input type="hidden" name="garantia_id" value="${g.id}">
                                <input type="text" name="reemplazo" class="input-classic" style="margin:0; padding:10px;" placeholder="Pega aquí la nueva cuenta..." required>
                                <button type="submit" class="btn-submit" style="background: #25d366; width: auto; padding: 0 15px;">Solucionar</button>
                            </form>
                        </div>`;
                    } else {
                        listadoGarantias += `
                        <div style="background: rgba(37, 211, 102, 0.1); border: 1px solid #25d366; padding: 12px; border-radius: 12px; margin-bottom: 10px; opacity: 0.8;">
                            <strong style="color: #25d366;">🟢 RESUELTO (${g.plataforma.toUpperCase()})</strong>
                            <p style="margin: 5px 0 0 0; font-size: 11px; color: #ccc;"><strong>Cliente:</strong> ${g.cliente_nombre} | <strong>Entregada:</strong> ${g.reemplazo}</p>
                        </div>`;
                    }
                });

                panelesCentroHtml += `
                <div id="main-garantias-admin" class="main-card">
                    <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500; color: #E50914;">🚨 Central de Garantías</h3>
                    <div style="max-height: 400px; overflow-y: auto; padding-right: 10px;">
                        ${listadoGarantias}
                    </div>
                </div>`;
            }

            panelesIzquierdosHtml += `
            <div id="action-crear-user" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Información</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Crea nuevas cuentas de clientes para darles acceso al panel SyncBox.</p></div>
            <div id="action-usuarios" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Información</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Vincula los correos de las plataformas al perfil de un cliente.</p></div>
            <div id="action-base-datos" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Información</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Consulta la base de datos persistente y clientes registrados.</p></div>
            <div id="action-garantias-admin" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Sistema Inteligente</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Gestiona alertas y reemplazos en tiempo real.</p></div>
            <div id="action-reservas-admin" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Reservas</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Revisa las peticiones manuales de tus clientes.</p></div>
            `;
            
            let tablaUsuariosHtml = "";
            let terminoBusqueda = (req.query.buscar_dueno || "").trim().toLowerCase();
            let clientesOpcionesHtml = usuarios.filter(u => u.rol === 'Cliente' || u.rol === 'Subadministrador').map(u => `<option value="${u.id}">${u.user} (${u.rol})</option>`).join('');
            
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
                                let estiloFondo = esBuscado ? "background: rgba(0, 210, 255, 0.2); border: 1px solid rgba(0, 210, 255, 0.4);" : "background: #000000; border: 1px solid transparent;";
                                return `<div style="display:flex; align-items:center; justify-content:space-between; ${estiloFondo} padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:5px;">
                                    <span>${c.email}</span>
                                    <form action="/admin/eliminar-correo" method="POST" style="margin:0;"><input type="hidden" name="correo_id" value="${c.id}"><button type="submit" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">✕</button></form>
                                </div>`;
                            }).join('');
                        } else { listaCorreosHtml = "<span style='color:var(--text-muted); font-size:11px; font-style: italic;'>Sin correos (Auto-eliminación 24h)</span>"; }

                        let selectorRol = "";
                        if (esAdminPrincipal) {
                            selectorRol = `
                            <form action="/admin/cambiar-rol" method="POST" style="margin-top: 5px; display: flex; flex-direction: column; gap: 5px;">
                                <input type="hidden" name="user_id" value="${u.id}">
                                <select name="nuevo_rol" style="background: #000; color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 4px; border-radius: 4px; font-size: 10px; outline: none; width: 100%;">
                                    <option value="Cliente" ${u.rol === 'Cliente' ? 'selected' : ''}>Cliente</option>
                                    <option value="Subadministrador" ${u.rol === 'Subadministrador' ? 'selected' : ''}>Subadmin</option>
                                </select>
                                <button type="submit" style="background: var(--accent); color: #000; border: none; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; width: 100%;">Cambiar</button>
                            </form>`;
                        } else {
                            selectorRol = `<small style="color:var(--text-muted); font-weight:300; font-size:11px; margin-top:4px; display:block;">${u.rol}</small>`;
                        }

                        let idCreadorTexto = esAdminPrincipal && u.creado_por ? 'Subadmin ID: ' + u.creado_por : (u.creado_por ? 'Tú' : 'Registro Público');
                        let icon = u.rol === 'Subadministrador' ? '👑' : '👤';
                        let rowStyle = isChild ? 'background: rgba(0, 210, 255, 0.05);' : 'background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255,255,255,0.1);';
                        let paddingL = isChild ? '40px' : '20px';
                        let dateFormated = u.fecha_creacion ? u.fecha_creacion.split('.')[0] : 'Desconocida';

                        return `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05); ${rowStyle}">
                            <td style="font-weight: 500; vertical-align: top; padding-left: ${paddingL}; position: relative;">
                                ${isChild ? '<div style="position:absolute; left: 20px; top: 0; bottom: 0; width: 2px; background: rgba(0, 210, 255, 0.3);"></div>' : ''}
                                <span style="${isChild ? 'color: var(--text-muted);' : 'color: #fff;'} font-size: 13px;">${icon} ${u.user}</span>
                                <div style="margin-top: 5px;">
                                    <small style="color:var(--accent); font-weight:600; font-size:10px; display:block;">🔑 Pass: ${u.pass}</small>
                                    <small style="color:var(--text-muted); font-weight:300; font-size:10px; margin-top:2px; display:block;">📱 Tel: ${u.telefono || 'N/A'}</small>
                                    <small style="color:var(--text-muted); font-weight:300; font-size:10px; margin-top:2px; display:block;">📅 Reg: ${dateFormated}</small>
                                    ${esAdminPrincipal ? `<small style="color:#25d366; font-weight:600; font-size:10px; margin-top:2px; display:block;">🪙 Cr: ${u.creditos || 0}</small>
                                    <small style="color:#E50914; font-weight:600; font-size:10px; margin-top:2px; display:block;">🔴 Deuda: ${u.deuda || 0}</small>` : ''}
                                </div>
                            </td>
                            <td style="vertical-align: top; width: 100px;">${selectorRol}</td>
                            <td style="vertical-align: top; width: 40%;"><div style="max-height: 120px; overflow-y: auto; padding-right: 8px;">${listaCorreosHtml}</div></td>
                            <td style="font-size: 11px; color: var(--text-muted); vertical-align: top;">${idCreadorTexto}</td>
                            <td style="vertical-align: top; text-align: center;">
                                <form action="/admin/eliminar-usuario" method="POST" onsubmit="return confirm('¿Seguro que deseas eliminar a este usuario? ${u.rol === 'Subadministrador' ? '¡ESTO BORRARÁ TAMBIÉN A TODOS SUS CLIENTES Y DATOS!' : ''}');" style="margin:0;">
                                    <input type="hidden" name="user_id" value="${u.id}">
                                    <button type="submit" style="background: rgba(229,9,20,0.1); border:1px solid #E50914; color:#E50914; padding:6px 10px; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer; transition:0.3s;" onmouseover="this.style.background='#E50914'; this.style.color='#fff';" onmouseout="this.style.background='rgba(229,9,20,0.1)'; this.style.color='#E50914';">Eliminar</button>
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
                            tablaUsuariosHtml += `<tr><td colspan="5" style="background: rgba(255,255,255,0.08); text-align: center; font-size: 12px; color: #00D2FF; font-weight: 600; padding: 10px; letter-spacing: 1px;">CLIENTES DIRECTOS / PÚBLICOS</td></tr>`;
                            huerfanos.forEach(h => tablaUsuariosHtml += renderRow(h, false));
                        }
                    } else {
                        usuariosVisibles.forEach(u => tablaUsuariosHtml += renderRow(u, false));
                    }
                }
            }

            // ✅ DECLARACIÓN DE BOTONES DE CONTACTO (RESTAURADO)
            let botonesContactoProveedor = `
            <style>
                .contact-wrapper { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; margin-bottom: 5px; }
                .contact-label { font-size: 10px; color: #00D2FF; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-shadow: 0 0 8px rgba(0,210,255,0.6); }
            </style>
            <div class="provider-contact">
                <div class="contact-wrapper">
                    <span class="contact-label">⬇ Mi Telegram</span>
                    <a href="https://t.me/SyncBox701" target="_blank" class="contact-btn telegram" style="width: 100%;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#0088cc"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.14-.261.26-.536.26l.213-3.05 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.654-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z"/></svg> Telegram
                    </a>
                </div>
                <div class="contact-wrapper">
                    <span class="contact-label">⬇ Mi WhatsApp</span>
                    <a href="https://wa.me/573012964169" target="_blank" class="contact-btn whatsapp" style="width: 100%;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#25d366"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg> WhatsApp
                    </a>
                </div>
                <div class="contact-wrapper">
                    <span class="contact-label">⬇ Ref. Grupo</span>
                    <a href="https://chat.whatsapp.com/HZ5XGqXqajW5V2UICj8A7g?s=cl&p=i&mlu=4&ilr=4" target="_blank" class="contact-btn whatsapp" style="width: 100%;">
                        <svg viewBox="0 0 24 24" fill="#25d366" width="16" height="16"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm-2.025 15.34l-3.32-3.32 1.414-1.414 1.906 1.906 5.234-5.234 1.414 1.414-6.648 6.648z"/></svg> Grupo Ventas
                    </a>
                </div>
            </div>`;

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
                    <div style="width: 150px;"></div>
                    <div class="brand-logo" style="margin-right: auto;">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00D2FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 8px rgba(0,210,255,0.6));">
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
                        ${panelesIzquierdosHtml}
                        
                        <div style="margin-top: auto; padding-top: 20px;">
                            <div class="user-pill" onclick="window.location='/logout'" title="Cerrar sesión">
                                <img src="https://i.pravatar.cc/150?u=${req.session.user}" alt="Avatar">
                                <div class="info">
                                    <strong>${req.session.user}</strong>
                                    <span>${req.session.rol} ${esSubAdmin ? `| 🪙 ${usuarioActual.creditos || 0} Cr.` : ''}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="center-panel">
                        ${panelesCentroHtml}
                        
                        ${(esAdminPrincipal || esSubAdmin) ? `
                        <div id="main-crear-user" class="main-card">
                            <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500;">Crear Nuevo Usuario</h3>
                            <form action="/admin/crear" method="POST">
                                <input name="n" class="input-classic" placeholder="Nombre de Usuario" required>
                                <input name="c" class="input-classic" placeholder="Contraseña" required>
                                <select name="r" class="input-classic"><option value="Cliente">Cliente Normal</option>${esAdminPrincipal ? '<option value="Subadministrador">Subadministrador</option>' : ''}</select>
                                <button class="btn-submit">Guardar Usuario en DB</button>
                            </form>
                        </div>
                        <div id="main-usuarios" class="main-card">
                            <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500;">Asignación de Correos</h3>
                            <form action="/admin/asignar-correo" method="POST">
                                <select name="user_id" class="input-classic" required><option value="" disabled selected>Selecciona un usuario...</option>${clientesOpcionesHtml}</select>
                                <textarea name="email" class="input-classic" placeholder="Pega los correos separados por espacio" rows="5" required></textarea>
                                <button type="submit" class="btn-submit">Asignar Correos</button>
                            </form>
                        </div>
                        <div id="main-base-datos" class="main-card" style="padding: 10px;">
                            <div style="padding: 20px 20px 0 20px; display:flex; justify-content:space-between; align-items:center;">
                                <h3 style="margin:0; font-size:20px; font-weight:500;">Base de Datos SyncBox</h3>
                                <form action="/dash" method="GET" style="display:flex; gap:12px;">
                                    <input type="text" name="buscar_dueno" value="${terminoBusqueda}" class="input-classic" placeholder="Buscar correo..." style="margin:0; padding: 10px;">
                                    <button type="submit" class="btn-submit" style="padding: 10px 20px; width:auto;">Buscar</button>
                                </form>
                            </div>
                            <div style="background: #000000; border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden; margin-top: 20px;">
                                <table class="table-modern">
                                    <thead><tr>
                                        <th style="padding-left: 20px;">Usuario</th>
                                        <th>Rol</th>
                                        <th style="width: 40%;">Correos Vinculados</th>
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
                            <h4>Administración</h4>
                            <div class="menu-list">
                                ${(esAdminPrincipal) ? `
                                <button class="menu-btn-item" onclick="openTab('stock-admin')">📦 Gestión de Stock</button>
                                <button class="menu-btn-item" onclick="openTab('creditos-admin')">💰 Asignar Créditos</button>
                                <button class="menu-btn-item" onclick="openTab('historial-compras')">🧾 Historial Global</button>
                                ` : ''}
                                ${(esSubAdmin) ? `
                                <button class="menu-btn-item" onclick="openTab('comprar-stock')" style="color: #00D2FF; font-weight: 600;">🛒 Tienda de Cuentas</button>
                                <button class="menu-btn-item" onclick="openTab('mis-compras')">🧾 Mis Compras</button>
                                ` : ''}
                                ${(esAdminPrincipal || esSubAdmin) ? `
                                <button class="menu-btn-item" onclick="openTab('crear-user')">Crear Usuario</button>
                                <button class="menu-btn-item" onclick="openTab('usuarios')">Asignar Correos</button>
                                <button class="menu-btn-item" onclick="openTab('base-datos')">Ver Base de Datos</button>
                                <button class="menu-btn-item" onclick="openTab('reservas-admin')" style="color: var(--accent); font-weight: 600;">🛒 Reservas (Manuales)</button>
                                <button class="menu-btn-item" onclick="openTab('garantias-admin')" style="color: #E50914; font-weight: 600;">🚨 Alertas y Garantías</button>
                                ` : `<p style="font-size:12px; color:var(--text-muted); margin:0;">Panel exclusivo para Clientes. Contacta al proveedor para activar accesos.</p>`}
                            </div>
                            
                            <h4 style="margin: 25px 0 10px 0;">Plataformas</h4>
                            <div class="plat-mini-grid">
                                ${botonesPlataformaHtml}
                            </div>
                            
                            <div class="side-card" style="margin-top: 20px; background: rgba(0,0,0,0.6);">
                                <h4 style="margin-bottom: 5px;">💳 MÉTODOS DE PAGO</h4>
                                ${metodosDePagoHtml}
                            </div>

                            ${botonesContactoProveedor}
                        </div>

                        ${esAdminPrincipal ? `
                        <div class="side-card">
                            <h4>Actividad Reciente</h4>
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

app.post('/admin/eliminar-usuario', async (req, res) => {
    if (req.session.rol === 'Cliente') return res.redirect('/dash');
    try {
        const userId = req.body.user_id;
        if (req.session.rol === 'Subadministrador') {
            const u = await dbGet("SELECT creado_por FROM usuarios WHERE id = ?", [userId]);
            if (!u || u.creado_por !== req.session.uid) return res.redirect('/dash');
            
            await dbRun("DELETE FROM correos WHERE user_id = ?", [userId]);
            await dbRun("DELETE FROM reservas WHERE user_id = ?", [userId]);
            await dbRun("DELETE FROM garantias WHERE user_id = ?", [userId]);
            await dbRun("DELETE FROM usuarios WHERE id = ?", [userId]);
        } else {
            const children = await dbAll("SELECT id FROM usuarios WHERE creado_por = ?", [userId]);
            const idsToDelete = [userId, ...children.map(c => c.id)];
            
            for(let id of idsToDelete) {
                await dbRun("DELETE FROM correos WHERE user_id = ?", [id]);
                await dbRun("DELETE FROM reservas WHERE user_id = ?", [id]);
                await dbRun("DELETE FROM garantias WHERE user_id = ?", [id]);
                await dbRun("DELETE FROM usuarios WHERE id = ?", [id]);
            }
        }
        res.redirect('/dash');
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/crear', async (req, res) => {
    let creado_por = (req.session.rol === 'Subadministrador') ? req.session.uid : null;
    try { await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por) VALUES (?, ?, ?, ?)", [req.body.n, req.body.c, req.body.r, creado_por]); res.redirect('/dash'); } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/asignar-correo', async (req, res) => {
    if (req.session.rol === 'Cliente') return res.redirect('/dash');
    try {
        const targetUserId = req.body.user_id;

        if (req.session.rol === 'Subadministrador') {
            const verificaPropietario = await dbGet("SELECT id FROM usuarios WHERE id = ? AND (creado_por = ? OR id = ?)", [targetUserId, req.session.uid, req.session.uid]);
            if (!verificaPropietario) return res.send("<script>alert('⛔ No tienes permiso.'); window.location='/dash';</script>");
        }

        const correosBrutos = req.body.email.trim();
        const listaCorreos = correosBrutos.split(/[\s,]+/).filter(e => e.includes('@'));
        
        for (let email of listaCorreos) { 
            email = email.toLowerCase();
            const existente = await dbGet("SELECT c.id, c.user_id, u.user, u.creado_por FROM correos c JOIN usuarios u ON c.user_id = u.id WHERE c.email = ?", [email]);
            
            if (existente) {
                if (req.session.rol === 'Subadministrador' && existente.user_id === req.session.uid) {
                    await dbRun("UPDATE correos SET user_id = ? WHERE id = ?", [targetUserId, existente.id]);
                    await dbRun("DELETE FROM stock_cuentas WHERE email = ?", [email]);
                } else {
                    return res.send(`<script>alert('Esta cuenta ya está asignada. Cliente actual: ${existente.user} | Correo: ${email}'); window.location='/dash';</script>`);
                }
            } else {
                await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [email, targetUserId]); 
                await dbRun("DELETE FROM stock_cuentas WHERE email = ?", [email]);
            }
        }
        res.redirect('/dash'); 
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/eliminar-correo', async (req, res) => {
    if (req.session.rol === 'Cliente') return res.redirect('/dash');
    try { await dbRun("DELETE FROM correos WHERE id = ?", [req.body.correo_id]); res.redirect('/dash'); } catch(err) { res.redirect('/dash'); }
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

        if (accion === 'pais') {
            let paisDetectado = null;
            const reglasPais = [
                { id: "🇺🇸 Estados Unidos", keys: ['ee. uu.', 'usa', 'united states', 'los gatos', 'california', '1-866-', '1-844-', '1-800-', '1-888-', '1-877-'] },
                { id: "🇨🇴 Colombia", keys: ['colombia', 'bogota', 'bogotá', '018000', '01 8000'] }
            ];
            for (let regla of reglasPais) { if (regla.keys.some(k => textoCorreo.includes(k))) { paisDetectado = regla.id; break; } }
            let htmlRes = paisDetectado ? `<div style="font-size: 32px; font-weight: 300; margin: 20px auto; padding: 25px; background:transparent; display:inline-block; color:#00D2FF; text-shadow: 0 0 15px rgba(0, 210, 255, 0.8);">${paisDetectado}</div>` : `<div style="margin: 20px auto; padding: 25px; background:transparent; display:inline-block;"><h3 style="color:#00D2FF; margin:0; font-weight:300;">País no detectado en el mensaje</h3></div>`;
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
