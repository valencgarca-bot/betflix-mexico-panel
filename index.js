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
    secret: 'betflix_mexico_ultra_secure_2026_MX',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT UNIQUE, pass TEXT, rol TEXT, creado_por INTEGER, fecha_creacion DATETIME DEFAULT (datetime('now', 'localtime')), telefono TEXT)");
    db.run("ALTER TABLE usuarios ADD COLUMN telefono TEXT", (err) => {});
    
    db.run("CREATE TABLE IF NOT EXISTS correos (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, user_id INTEGER, fecha_asignacion DATETIME DEFAULT (date('now', 'localtime')))");
    db.run("CREATE TABLE IF NOT EXISTS registro_codigos (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, email_buscado TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    
    db.run("CREATE TABLE IF NOT EXISTS reservas (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, cantidad INTEGER, telefono TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Pendiente')");
    db.run("CREATE TABLE IF NOT EXISTS garantias (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plataforma TEXT, motivo TEXT, detalles TEXT, reemplazo TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Pendiente')");
    db.run("CREATE TABLE IF NOT EXISTS soporte (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, mensaje TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')), estado TEXT DEFAULT 'Abierto')");
    
    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por) VALUES ('admin', '14032021', 'Administrador', NULL)", (err) => {});
    db.run("UPDATE usuarios SET user = 'admin', pass = '14032021' WHERE user = 'dueño'", (err) => {});
});

// 🧹 FUNCIÓN AUTOMÁTICA PARA BORRAR CLIENTES SIN CORREO DESPUÉS DE 24 HORAS
setInterval(async () => {
    try {
        await dbRun(`
            DELETE FROM usuarios 
            WHERE rol = 'Cliente' 
            AND id NOT IN (SELECT DISTINCT user_id FROM correos) 
            AND datetime(fecha_creacion, '+24 hours') <= datetime('now', 'localtime')
        `);
    } catch(err) {
        console.error("Error en limpieza automática de usuarios:", err.message);
    }
}, 60 * 60 * 1000);

// 🎬 ESTILO PURO NEGRO, SERIES RESALTANDO Y MENÚ AJUSTADO
const CSS_MODERNO = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    :root {
        --text-main: #f8fafc;
        --text-muted: #94a3b8;
        --card-bg: rgba(0, 0, 0, 0.92);
        --card-border: rgba(255, 255, 255, 0.15);
        --accent: #00D2FF;
        --accent-hover: #0099CC;
        --btn-bg: rgba(0, 210, 255, 0.12);
        --shadow-elegant: 0 20px 50px rgba(0, 0, 0, 0.98);
        --blur-effect: blur(8px);
        --radius: 16px;
    }

    @keyframes pureSeriesSlideshow {
        0% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
        33% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=2000&auto=format&fit=crop'); }
        66% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2000&auto=format&fit=crop'); }
        100% { background-image: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.4)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
    }

    body { 
        background-size: cover;
        background-position: center;
        background-attachment: fixed;
        animation: pureSeriesSlideshow 16s ease infinite;
        background-color: #000000;
        color: var(--text-main); font-family: 'Inter', sans-serif; 
        margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; min-height: 100vh;
    }

    .top-header { background: transparent; padding: 25px 40px; display: flex; justify-content: space-between; align-items: center; }
    
    .user-pill {
        display: flex; align-items: center; gap: 12px; background: var(--card-bg); padding: 8px 16px; 
        border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect);
        border-radius: 50px; box-shadow: var(--shadow-elegant); cursor: pointer; transition: 0.3s;
    }
    .user-pill:hover { border-color: rgba(255, 255, 255, 0.4); transform: translateY(-2px); }
    .user-pill img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; }
    .user-pill .info { display: flex; flex-direction: column; }
    .user-pill .info strong { color: var(--text-main); font-size: 13px; font-weight: 600; }
    .user-pill .info span { color: var(--text-muted); font-size: 11px; }

    .brand-logo { font-size: 20px; font-weight: 300; display:flex; align-items:center; gap: 10px; letter-spacing: 2px; text-transform: uppercase; color: #fff;}
    .brand-logo strong { font-weight: 700; color: var(--accent); }

    .search-top input {
        background: var(--card-bg); border: 1px solid var(--card-border); padding: 12px 25px; width: 280px;
        border-radius: 50px; color: #fff; backdrop-filter: var(--blur-effect); font-size: 13px; outline: none; transition: 0.3s;
    }
    .search-top input:focus { border-color: var(--accent); width: 320px; background: #000; }

    .dashboard-grid { 
        display: grid; grid-template-columns: 320px 1fr 280px; gap: 25px; 
        padding: 10px 40px 40px 40px; align-items: start; 
    }

    .left-sidebar { display: flex; flex-direction: column; gap: 20px; height: 100%; min-height: 600px; }
    .right-sidebar { display: flex; flex-direction: column; gap: 20px; }
    .center-panel { display: flex; flex-direction: column; gap: 20px; }

    .action-panel {
        background: var(--card-bg);
        border-radius: var(--radius); padding: 25px;
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); 
        backdrop-filter: var(--blur-effect); display: none; flex-direction: column; gap: 12px;
        min-height: 380px; 
    }
    .action-panel.active { display: flex; }

    .main-card {
        background: var(--card-bg);
        border-radius: var(--radius); padding: 18px 25px; 
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); 
        backdrop-filter: var(--blur-effect); display: none;
    }
    .main-card.active { display: block; }

    .action-btn-pill {
        width: 100%; background: var(--btn-bg); border: 1px solid var(--card-border);
        padding: 14px; border-radius: 12px; font-size: 11px; font-weight: 600;
        color: var(--text-main); cursor: pointer; transition: 0.3s; text-transform: uppercase; letter-spacing: 0.5px; text-align: center;
    }
    .action-btn-pill:hover { background: rgba(255, 255, 255, 0.15); border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,0,0,0.5);}

    .search-input-large {
        width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); 
        padding: 16px 25px; border-radius: 12px; font-size: 14px; margin-top: 5px;
        color: var(--text-main); outline: none; box-sizing: border-box; font-family: 'Inter', sans-serif; transition: 0.3s;
    }
    .search-input-large:focus { border-color: var(--accent); background: #000; box-shadow: 0 0 20px rgba(0,210,255,0.3); }

    .iframe-container {
        display: none; 
        background: transparent;
        border: none; 
        height: 600px; 
        width: 100%;
        overflow: hidden;
    }

    .side-card {
        background: var(--card-bg);
        border-radius: var(--radius); padding: 25px;
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect);
    }
    .side-card h4 { margin: 0 0 15px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--card-border); padding-bottom: 10px;}
    
    .plat-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px; }
    .plat-mini-btn {
        background: #000000; border: 1px solid var(--card-border); padding: 12px;
        border-radius: 12px; cursor: pointer; display: flex; justify-content: center; align-items: center;
        height: 60px; transition: 0.3s; box-shadow: 0 4px 15px rgba(0,0,0,0.8);
    }
    .plat-mini-btn:hover { background: rgba(0, 210, 255, 0.2); border-color: var(--accent); transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0,210,255,0.4);}
    .plat-mini-btn img { max-height: 28px; max-width: 90%; object-fit: contain; }

    .provider-contact { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 15px; }
    .contact-btn {
        background: #000; border: 1px solid var(--card-border); padding: 10px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; color: #fff; font-size: 11px; font-weight: 600; transition: 0.3s;
    }
    .contact-btn.telegram:hover { background: rgba(0, 136, 204, 0.25); border-color: #0088cc; transform: translateY(-2px); }
    .contact-btn.whatsapp:hover { background: rgba(37, 211, 102, 0.25); border-color: #25d366; transform: translateY(-2px); }
    .contact-btn.forobeta:hover { background: rgba(255, 115, 0, 0.25); border-color: #ff7300; transform: translateY(-2px); }
    .contact-btn img { width: 18px; height: 18px; object-fit: contain; }

    .menu-list { display: flex; flex-direction: column; gap: 8px; }
    .menu-btn-item {
        background: transparent; border: 1px solid transparent; padding: 10px 12px;
        border-radius: 8px; font-size: 13px; color: var(--text-main); cursor: pointer; 
        text-align: left; transition: 0.3s; font-family: 'Inter', sans-serif;
    }
    .menu-btn-item:hover { background: rgba(0, 210, 255, 0.15); border-color: rgba(0, 210, 255, 0.4); padding-left: 18px; }

    .activity-list { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow-y: auto; padding-right: 4px; }
    .activity-item {
        background: #000000; border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 12px 14px; border-radius: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; transition: 0.2s;
    }
    .activity-item:hover { border-color: var(--accent); background: rgba(0, 210, 255, 0.08); }
    .activity-item strong { color: var(--text-main); font-weight: 500; word-break: break-all; font-size: 12px; }
    .activity-meta { display: flex; justify-content: space-between; align-items: center; color: var(--text-muted); font-size: 10px; margin-top: 2px; }
    .activity-user { color: var(--accent); font-weight: 600; }

    .input-classic { width: 100%; padding: 14px; margin-bottom: 10px; border-radius: 8px; border: 1px solid var(--card-border); background: #000000; color: white; box-sizing: border-box; outline: none; font-size: 13px;}
    .input-classic:focus { border-color: var(--accent); box-shadow: 0 0 15px rgba(0,210,255,0.25); }
    .btn-submit { background: var(--accent); color: #000; border: none; padding: 14px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px;}
    .btn-submit:hover { background: var(--accent-hover); box-shadow: 0 0 20px rgba(0, 210, 255, 0.5); color: #fff; }

    .sub-form { display: none; background: rgba(0,0,0,0.6); padding: 15px; border-radius: 12px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.1); }
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
                <span class="contact-label">⬇ Grupo de Ref.</span>
                <a href="https://chat.whatsapp.com/HZ5XGqXqajW5V2UICj8A7g?s=cl&p=i&mlu=4&ilr=4" target="_blank" class="contact-icon-btn whatsapp" title="Grupo de Referencia" style="width: 100%;">
                    <svg viewBox="0 0 24 24" fill="#25d366"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm-2.025 15.34l-3.32-3.32 1.414-1.414 1.906 1.906 5.234-5.234 1.414 1.414-6.648 6.648z"/></svg> Grupo
                </a>
            </div>
        </div>
    `;

    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Acceso - SyncBox</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
            body { margin: 0; font-family: 'Inter', sans-serif; background: url('https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2000&auto=format&fit=crop') center/cover fixed; background-color: #000; height: 100vh; display: flex; justify-content: center; align-items: center; }
            .login-box { position: relative; z-index: 2; background: rgba(0, 0, 0, 0.92); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px; padding: 40px 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.98); text-align: center; }
            .input-group { margin-bottom: 20px; }
            .input-group input { width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; height: 55px; padding: 0 20px; box-sizing: border-box; font-size: 14px; border-radius: 8px; outline: none; transition: 0.3s; }
            .input-group input:focus { border-color: #00D2FF; box-shadow: 0 0 15px rgba(0,210,255,0.2);}
            .btn-submit { width: 100%; background: #00D2FF; color: #000; font-size: 13px; font-weight: 700; padding: 18px; border: none; border-radius: 8px; cursor: pointer; margin-top: 10px; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px; }
            .btn-submit:hover { background: #0099CC; color: #fff; box-shadow: 0 0 20px rgba(0, 210, 255, 0.5); }
            .help-text { color: #888; font-size: 12px; margin-top: 20px; margin-bottom: 20px; line-height: 1.6; font-weight: 300; }
            
            .contact-icon-btn {
                background: #000; border: 1px solid rgba(255,255,255,0.15); padding: 10px; border-radius: 10px;
                display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; color: #fff; font-size: 11px; font-weight: 600; transition: 0.3s;
            }
            .contact-icon-btn.telegram:hover { background: rgba(0, 136, 204, 0.25); border-color: #0088cc; transform: translateY(-2px); }
            .contact-icon-btn.whatsapp:hover { background: rgba(37, 211, 102, 0.25); border-color: #25d366; transform: translateY(-2px); }
            .contact-icon-btn svg { width: 16px; height: 16px; }
        </style>
    </head>
    <body>
        <div class="login-box">
            ${logosReconocidos}
            ${contenidoForm}
            <div class="help-text">Panel cifrado. Conexión segura.</div>
            ${redesSociales}
        </div>
    </body>
    </html>
    `);
});

app.post('/registrar-cliente', async (req, res) => {
    const { user, pass, telefono } = req.body;
    try {
        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono) VALUES (?, ?, 'Cliente', NULL, ?)", [user.trim(), pass, telefono.trim()]);
        
        const mensajeWhatsApp = `¡Hola! Me acabo de registrar en SyncBox.\n\n👤 *Usuario:* ${user.trim()}\n🔑 *Contraseña:* ${pass}\n📱 *Número:* ${telefono.trim()}\n\n¡Me gustaría unirme al grupo y conocer los enlaces oficiales!`;
        const linkRedireccion = `https://api.whatsapp.com/send?phone=573012964169&text=${encodeURIComponent(mensajeWhatsApp)}`;

        res.send(`<script>
            alert('✅ ¡Cuenta creada con éxito! Serás redirigido a nuestro WhatsApp para enviarte los links de acceso.'); 
            window.location.href='${linkRedireccion}';
        </script>`);
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

// ✅ RUTA PARA CAMBIAR EL ROL DE UN USUARIO (CLIENTE <-> SUBADMIN)
app.post('/admin/cambiar-rol', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    try {
        await dbRun("UPDATE usuarios SET rol = ? WHERE id = ?", [req.body.nuevo_rol, req.body.user_id]);
        res.redirect('/dash');
    } catch(err) { res.redirect('/dash'); }
});

app.get('/dash', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'admin' || req.session.user === 'ruben');
    const esSubAdmin = (req.session.rol === 'Subadministrador');
    const esCliente = (req.session.rol === 'Cliente');

    if (esAdminPrincipal || esSubAdmin || esCliente) {
        try {
            let misCorreos = [];
            if (esCliente) {
                misCorreos = await dbAll("SELECT * FROM correos WHERE user_id = ?", [req.session.uid]);
            }

            let query = esAdminPrincipal ? "SELECT * FROM usuarios" : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
            let params = esAdminPrincipal ? [] : [req.session.uid, req.session.uid];
            const usuarios = await dbAll(query, params);
            const correos = await dbAll("SELECT * FROM correos", []);
            const registros = await dbAll("SELECT * FROM registro_codigos ORDER BY id DESC LIMIT 5", []);
            
            const garantias = await dbAll(`SELECT g.*, u.user as cliente_nombre FROM garantias g JOIN usuarios u ON g.user_id = u.id ORDER BY g.estado ASC, g.id DESC`);
            const reservas = await dbAll(`SELECT r.*, u.user as cliente_nombre FROM reservas r JOIN usuarios u ON r.user_id = u.id ORDER BY r.estado ASC, r.id DESC`);

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

                controlesIzquierda += `
                    <button onclick="alert('📊 Stock en vivo: ${Math.floor(Math.random() * 40) + 15} Cuentas Disponibles')" class="action-btn-pill" style="background: #000;">📊 Ver Stock Disponible</button>
                    
                    <button onclick="toggleSubForm('reserva-${key}')" class="action-btn-pill" style="background: #000;">🛒 Reservar Cuentas</button>
                    <div id="reserva-${key}" class="sub-form">
                        <form action="/bot/reservar" method="POST">
                            <h5 style="margin: 0 0 10px 0; color: var(--accent);">🛒 Reservar Stock</h5>
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
                if (esCliente && misCorreos.length === 0) {
                    avisoSinCorreo = `<div style="background: rgba(229,9,20,0.2); border: 1px solid #E50914; padding: 12px; border-radius: 8px; margin-bottom: 15px; font-size: 12px; color: #f8fafc;">⚠️ Aún no tienes cuentas asignadas por el administrador. Comunícate mediante los botones de contacto para activar tu acceso (Tu cuenta se eliminará en 24h si no se asigna).</div>`;
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
                        <input type="text" name="email_search" class="search-input-large" placeholder="Escribe el correo registrado..." required ${esCliente && misCorreos.length === 0 ? 'disabled' : ''}>
                    </form>
                </div>`;
            });

            if (esAdminPrincipal || esSubAdmin) {
                let listadoReservas = "";
                if(reservas.length === 0) listadoReservas = "<p style='color:var(--text-muted); font-size:12px;'>No hay reservas pendientes.</p>";
                reservas.forEach(r => {
                    if(r.estado === 'Pendiente') {
                        listadoReservas += `
                        <div style="background: rgba(0, 210, 255, 0.1); border: 1px solid rgba(0, 210, 255, 0.3); padding: 15px; border-radius: 12px; margin-bottom: 15px;">
                            <strong style="color: var(--accent);">🛒 PEDIDO: ${r.cantidad} Cuentas</strong>
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
                    <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500; color: var(--accent);">🛒 Pedidos de Cuentas (Reservas)</h3>
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
            <div id="action-reservas-admin" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Reservas</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Revisa las peticiones de nuevas cuentas de tus clientes.</p></div>
            `;
            
            // ✅ NUEVA LÓGICA DE BASE DE DATOS ORGANIZADA Y JERÁRQUICA
            let tablaUsuariosHtml = "";
            let terminoBusqueda = (req.query.buscar_dueno || "").trim().toLowerCase();
            let clientesOpcionesHtml = usuarios.filter(u => u.rol === 'Cliente' || u.rol === 'Subadministrador').map(u => `<option value="${u.id}">${u.user} (${u.rol})</option>`).join('');
            
            if (esAdminPrincipal || esSubAdmin) {
                let usuariosBase = esAdminPrincipal ? usuarios.filter(u => u.user !== 'admin' && u.user !== 'ruben' && u.user !== 'dueño') : usuarios.filter(u => u.creado_por === req.session.uid);
                
                if (usuariosBase.length === 0) {
                    tablaUsuariosHtml = "<tr><td colspan='5' style='padding: 20px; text-align: center; color: var(--text-muted);'>No hay usuarios registrados aún.</td></tr>";
                } else {
                    let renderRow = (u, prefix = "") => {
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
                        } else { listaCorreosHtml = "<span style='color:var(--text-muted); font-size:11px; font-style: italic;'>Sin correos asignados (Auto-eliminación 24h)</span>"; }

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

                        let idCreadorTexto = esAdminPrincipal && u.creado_por ? 'ID Creador: ' + u.creado_por : (u.creado_por ? 'Tú' : 'Registro Público');

                        return `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05); ${prefix ? 'background: rgba(0,210,255,0.03);' : ''}">
                            <td style="font-weight: 500; vertical-align: top; padding-left: ${prefix ? '30px' : '16px'};">
                                <span style="${prefix ? 'color: var(--text-muted);' : 'color: #fff;'}">${prefix} ${u.user}</span>
                                <br><small style="color:var(--text-muted); font-weight:300; font-size:10px; margin-top:4px; display:block;">Tel: ${u.telefono || 'N/A'}</small>
                            </td>
                            <td style="vertical-align: top; width: 100px;">${selectorRol}</td>
                            <td style="vertical-align: top; width: 40%;"><div style="max-height: 120px; overflow-y: auto; padding-right: 8px;">${listaCorreosHtml}</div></td>
                            <td style="font-size: 11px; color: var(--text-muted); vertical-align: top;">${idCreadorTexto}</td>
                            <td style="vertical-align: top; text-align: center;">
                                <form action="/admin/eliminar-usuario" method="POST" onsubmit="return confirm('¿Seguro que deseas eliminar a este usuario? ${u.rol === 'Subadministrador' ? '¡ESTO BORRARÁ TAMBIÉN A TODOS SUS CLIENTES Y DATOS!' : ''}');" style="margin:0;">
                                    <input type="hidden" name="user_id" value="${u.id}">
                                    <button type="submit" style="background:#000000; border:1px solid rgba(255, 255, 255, 0.2); color:#E50914; padding:6px 12px; border-radius:6px; font-size:10px; font-weight:600; cursor:pointer;">Eliminar</button>
                                </form>
                            </td>
                        </tr>`;
                    };

                    if (esAdminPrincipal) {
                        let subadmins = usuariosBase.filter(u => u.rol === 'Subadministrador');
                        let directos = usuariosBase.filter(u => u.rol !== 'Subadministrador' && !u.creado_por);
                        let huerfanos = usuariosBase.filter(u => u.rol !== 'Subadministrador' && u.creado_por && !subadmins.find(sa => sa.id === u.creado_por));

                        // 1. Mostrar Subadmins y sus hijos anidados
                        subadmins.forEach(sa => {
                            tablaUsuariosHtml += renderRow(sa);
                            let children = usuariosBase.filter(u => u.creado_por === sa.id);
                            children.forEach(child => {
                                tablaUsuariosHtml += renderRow(child, "↳ ");
                            });
                        });

                        // 2. Mostrar clientes directos al final
                        if (directos.length > 0 || huerfanos.length > 0) {
                            tablaUsuariosHtml += `<tr><td colspan="5" style="background: rgba(255,255,255,0.05); text-align: center; font-size: 11px; color: var(--accent); font-weight: 600; letter-spacing: 1px; padding: 10px;">CLIENTES DIRECTOS / REGISTRO PÚBLICO</td></tr>`;
                            directos.forEach(d => tablaUsuariosHtml += renderRow(d));
                            huerfanos.forEach(h => tablaUsuariosHtml += renderRow(h));
                        }
                    } else {
                        // Subadmin solo ve sus hijos de manera normal
                        usuariosBase.forEach(u => tablaUsuariosHtml += renderRow(u));
                    }
                }
            }

            let botonesContactoProveedor = `
            <div class="provider-contact">
                <a href="https://t.me/SyncBox701" target="_blank" class="contact-btn telegram">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#0088cc"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.14-.261.26-.536.26l.213-3.05 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.654-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z"/></svg> Telegram
                </a>
                <a href="https://wa.me/573012964169" target="_blank" class="contact-btn whatsapp">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#25d366"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg> WhatsApp
                </a>
                <a href="https://forobeta.com/members/soncbox.367003/" target="_blank" class="contact-btn forobeta">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#ff7300"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 6h-2v1.5h2v2h-2V19h-3v-6.5H8v-2h1V7c0-1.66 1.34-3 3-3h3v3z"/></svg> ForoBeta
                </a>
                <a href="https://chat.whatsapp.com/HZ5XGqXqajW5V2UICj8A7g?s=cl&p=i&mlu=4&ilr=4" target="_blank" class="contact-btn whatsapp">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#25d366"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm-2.025 15.34l-3.32-3.32 1.414-1.414 1.906 1.906 5.234-5.234 1.414 1.414-6.648 6.648z"/></svg> Grupo Ventas
                </a>
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
                                <div class="info"><strong>${req.session.user}</strong><span>${req.session.rol} ▾</span></div>
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
                                <table>
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
                                ${(esAdminPrincipal || esSubAdmin) ? `
                                <button class="menu-btn-item" onclick="openTab('crear-user')">Crear Usuario</button>
                                <button class="menu-btn-item" onclick="openTab('usuarios')">Asignar Correos</button>
                                <button class="menu-btn-item" onclick="openTab('base-datos')">Ver Base de Datos</button>
                                <button class="menu-btn-item" onclick="openTab('reservas-admin')" style="color: var(--accent); font-weight: 600;">🛒 Ver Reservas</button>
                                <button class="menu-btn-item" onclick="openTab('garantias-admin')" style="color: #00D2FF; font-weight: 600;">🚨 Alertas y Garantías</button>
                                ` : `<p style="font-size:12px; color:var(--text-muted); margin:0;">Panel exclusivo para Clientes. Contacta al proveedor para activar accesos.</p>`}
                            </div>
                            
                            <h4 style="margin: 25px 0 10px 0;">Plataformas</h4>
                            <div class="plat-mini-grid">
                                ${botonesPlataformaHtml}
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

// ✅ RUTA DE DESTRUCCIÓN EN CASCADA (Borra a un usuario y todo lo que haya creado)
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
            // EL ADMIN PRINCIPAL ELIMINA AL SUBADMIN Y A TODOS LOS HIJOS QUE ÉSTE CREÓ
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
                } else {
                    return res.send(`<script>alert('Esta cuenta ya está asignada. Cliente actual: ${existente.user} | Correo: ${email}'); window.location='/dash';</script>`);
                }
            } else {
                await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [email, targetUserId]); 
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

    const config = { imap: { user: correoBuzon, password: passwordSeleccionado, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 5000 } };
    let connection = null;

    try {
        connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        
        let keywordPlat = (plataforma && PLATAFORMAS[plataforma]) ? PLATAFORMAS[plataforma].keyword_from : '';
        let queryStr = `"${correoIngresado}"`;
        if (keywordPlat) queryStr += ` ${keywordPlat}`;

        let searchResults = await connection.search([['X-GM-RAW', queryStr]], { bodies: ['HEADER.FIELDS (DATE)'] });
        
        if (searchResults.length === 0) {
            searchResults = await connection.search([['TEXT', correoIngresado]], { bodies: ['HEADER.FIELDS (DATE)'] });
        }

        let messages = [];
        let mail = null;

        if (searchResults.length > 0) {
            searchResults.sort((a, b) => {
                let dateA = new Date(a.attributes.date || 0);
                let dateB = new Date(b.attributes.date || 0);
                if (dateB.getTime() !== dateA.getTime()) { return dateB - dateA; }
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

        * { background-color: transparent !important; background: transparent !important; }
        
        .magic-email-wrapper * {
            font-family: 'Inter', sans-serif !important;
            color: #f8fafc !important;
            line-height: 1.6 !important;
            border: none !important;
            box-shadow: none !important;
        }

        .magic-email-wrapper h1, 
        .magic-email-wrapper h2, 
        .magic-email-wrapper h3, 
        .magic-email-wrapper a, 
        .magic-email-wrapper strong {
            color: #00D2FF !important; 
            text-shadow: 0 0 8px rgba(0, 210, 255, 0.8), 0 0 15px rgba(0, 210, 255, 0.5) !important;
            text-decoration: none !important;
        }

        .magic-email-wrapper p, 
        .magic-email-wrapper td, 
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
        const esCliente = (req.session.rol === 'Cliente');

        if (esCliente) {
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
