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
    db.run("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT UNIQUE, pass TEXT, rol TEXT, creado_por INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS correos (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, user_id INTEGER, fecha_asignacion DATETIME DEFAULT (date('now', 'localtime')))");
    db.run("CREATE TABLE IF NOT EXISTS registro_codigos (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, email_buscado TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por) VALUES ('dueño', 'teamo2020', 'Administrador', NULL)");
});

// 🎬 ESTILO TOTALMENTE ANIMADO CON SERIES EN TODO EL FONDO Y TEMA OSCURO INTENSO
const CSS_MODERNO = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    :root {
        --text-main: #f8fafc;
        --text-muted: #a3a3a3;
        --card-bg: rgba(8, 11, 16, 0.88);
        --card-border: rgba(0, 210, 255, 0.35);
        --accent: #00D2FF;
        --accent-hover: #0099CC;
        --btn-bg: rgba(0, 210, 255, 0.12);
        --shadow-elegant: 0 15px 50px rgba(0, 0, 0, 0.95);
        --blur-effect: blur(18px);
        --radius: 18px;
    }

    /* 🌀 ANIMACIÓN DE ROTACIÓN DE FONDOS DE SERIES EN TODA LA WEB */
    @keyframes globalSeriesSlideshow {
        0% { background-image: linear-gradient(rgba(0, 2, 5, 0.92), rgba(0, 2, 5, 0.92)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
        33% { background-image: linear-gradient(rgba(5, 0, 2, 0.92), rgba(5, 0, 2, 0.92)), url('https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=2000&auto=format&fit=crop'); }
        66% { background-image: linear-gradient(rgba(0, 5, 8, 0.92), rgba(0, 5, 8, 0.92)), url('https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2000&auto=format&fit=crop'); }
        100% { background-image: linear-gradient(rgba(0, 2, 5, 0.92), rgba(0, 2, 5, 0.92)), url('https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2000&auto=format&fit=crop'); }
    }

    body { 
        background-size: cover;
        background-position: center;
        background-attachment: fixed;
        animation: globalSeriesSlideshow 20s ease infinite;
        background-color: #000205;
        color: var(--text-main); font-family: 'Inter', sans-serif; 
        margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; min-height: 100vh;
    }

    body::before {
        content: ''; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: radial-gradient(circle at top center, rgba(0, 210, 255, 0.1) 0%, rgba(0, 2, 5, 0.95) 90%);
        backdrop-filter: blur(4px);
        z-index: -1; pointer-events: none;
    }

    .top-header { background: transparent; padding: 25px 40px; display: flex; justify-content: space-between; align-items: center; }
    
    .user-pill {
        display: flex; align-items: center; gap: 12px; background: var(--card-bg); padding: 8px 16px; 
        border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect);
        border-radius: 50px; box-shadow: var(--shadow-elegant); cursor: pointer; transition: 0.3s;
    }
    .user-pill:hover { border-color: rgba(0, 210, 255, 0.7); transform: translateY(-2px); }
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
    .search-top input:focus { border-color: var(--accent); width: 320px; background: rgba(0,0,0,0.95); }

    .dashboard-grid { 
        display: grid; grid-template-columns: 280px 1fr 280px; gap: 30px; 
        padding: 10px 40px 40px 40px; align-items: start; 
    }

    .left-sidebar, .right-sidebar { display: flex; flex-direction: column; gap: 20px; }
    .center-panel { display: flex; flex-direction: column; gap: 20px; }

    .action-panel {
        background: var(--card-bg);
        border-radius: var(--radius); padding: 25px;
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); 
        backdrop-filter: var(--blur-effect); display: none; flex-direction: column; gap: 12px;
    }
    .action-panel.active { display: flex; }

    .main-card {
        background: var(--card-bg);
        border-radius: var(--radius); padding: 35px;
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); 
        backdrop-filter: var(--blur-effect); display: none;
    }
    .main-card.active { display: block; }

    .action-btn-pill {
        width: 100%; background: var(--btn-bg); border: 1px solid var(--card-border);
        padding: 15px; border-radius: 50px; font-size: 11px; font-weight: 600;
        color: var(--text-main); cursor: pointer; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px;
    }
    .action-btn-pill:hover { background: rgba(0, 210, 255, 0.25); border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,210,255,0.4);}

    .search-input-large {
        width: 100%; background: rgba(0,0,0,0.85); border: 1px solid rgba(0, 210, 255, 0.4); 
        padding: 20px 30px; border-radius: 50px; font-size: 14px; margin-top: 15px;
        color: var(--text-main); outline: none; box-sizing: border-box; font-family: 'Inter', sans-serif; transition: 0.3s;
    }
    .search-input-large:focus { border-color: var(--accent); background: rgba(0,0,0,0.98); box-shadow: 0 0 25px rgba(0,210,255,0.35); }

    /* VISOR DE RESULTADOS COMPLETAMENTE OSCURO Y CLARO */
    .iframe-container {
        background: rgba(5, 7, 10, 0.95);
        border-radius: var(--radius); box-shadow: var(--shadow-elegant); 
        border: 1px solid var(--card-border); height: 500px; display: flex; flex-direction: column; backdrop-filter: var(--blur-effect); overflow: hidden;
    }
    .iframe-header {
        padding: 16px 25px; background: rgba(0,0,0,0.85); border-bottom: 1px solid var(--card-border); 
        font-weight: 500; font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: 1px;
    }

    .side-card {
        background: var(--card-bg);
        border-radius: var(--radius); padding: 25px;
        box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect);
    }
    .side-card h4 { margin: 0 0 15px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--card-border); padding-bottom: 10px;}
    
    .plat-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
    .plat-mini-btn {
        background: rgba(0,0,0,0.75); border: 1px solid var(--card-border); padding: 12px;
        border-radius: 12px; cursor: pointer; display: flex; justify-content: center; align-items: center;
        height: 60px; transition: 0.3s; box-shadow: 0 4px 15px rgba(0,0,0,0.6);
    }
    .plat-mini-btn:hover { background: rgba(0, 210, 255, 0.2); border-color: var(--accent); transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0,210,255,0.4);}
    .plat-mini-btn img { max-height: 28px; max-width: 90%; object-fit: contain; }

    .menu-list { display: flex; flex-direction: column; gap: 8px; }
    .menu-btn-item {
        background: transparent; border: 1px solid transparent; padding: 10px 12px;
        border-radius: 8px; font-size: 13px; color: var(--text-main); cursor: pointer; 
        text-align: left; transition: 0.3s; font-family: 'Inter', sans-serif;
    }
    .menu-btn-item:hover { background: rgba(0, 210, 255, 0.15); border-color: rgba(0, 210, 255, 0.4); padding-left: 18px; }

    .activity-list { display: flex; flex-direction: column; gap: 10px; max-height: 320px; overflow-y: auto; padding-right: 4px; }
    .activity-item {
        background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(0, 210, 255, 0.25);
        padding: 12px 14px; border-radius: 10px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; transition: 0.2s;
    }
    .activity-item:hover { border-color: var(--accent); background: rgba(0, 210, 255, 0.1); }
    .activity-item strong { color: var(--text-main); font-weight: 500; word-break: break-all; font-size: 12px; }
    .activity-meta { display: flex; justify-content: space-between; align-items: center; color: var(--text-muted); font-size: 10px; margin-top: 2px; }
    .activity-user { color: var(--accent); font-weight: 600; }

    .input-classic { width: 100%; padding: 16px; margin-bottom: 15px; border-radius: 8px; border: 1px solid var(--card-border); background: rgba(0,0,0,0.85); color: white; box-sizing: border-box; outline: none;}
    .input-classic:focus { border-color: var(--accent); box-shadow: 0 0 15px rgba(0,210,255,0.25); }
    .btn-submit { background: var(--accent); color: #000; border: none; padding: 16px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px;}
    .btn-submit:hover { background: var(--accent-hover); box-shadow: 0 0 20px rgba(0, 210, 255, 0.6); color: #fff; }

    table { width: 100%; border-collapse: separate; border-spacing: 0; }
    table th { background: rgba(0,0,0,0.85); border-bottom: 1px solid var(--card-border); padding: 16px; font-size: 11px; text-transform: uppercase; color: var(--text-muted); text-align: left;}
    table td { border-bottom: 1px solid rgba(255,255,255,0.06); padding: 16px; font-size: 13px; }
</style>

<script>
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
            form.submit();
        }
    }

    function openTab(tabId) {
        document.querySelectorAll('.main-card').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.action-panel').forEach(p => p.classList.remove('active'));
        
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
    const rutasAbiertas = ['/', '/login', '/logout'];
    if (rutasAbiertas.includes(req.path)) return next();
    if (req.session && req.session.uid) {
        try {
            const row = await dbGet("SELECT id FROM usuarios WHERE id = ?", [req.session.uid]);
            if (!row) {
                req.session.destroy();
                return res.send("<script>alert('⛔ ACCESO DENEGADO'); window.location='/';</script>");
            }
            next();
        } catch (err) { return res.redirect('/'); }
    } else { return res.redirect('/'); }
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Acceso - SyncBox</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
            body { 
                margin: 0; font-family: 'Inter', sans-serif; 
                background: url('https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2000&auto=format&fit=crop') center/cover fixed; 
                background-color: #000000; height: 100vh; display: flex; justify-content: center; align-items: center; 
            }
            body::before { 
                content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; 
                background: radial-gradient(circle at top center, rgba(0, 210, 255, 0.2) 0%, rgba(0, 5, 15, 0.95) 80%); 
                backdrop-filter: blur(5px); z-index: 1; pointer-events: none; 
            }
            .login-box { position: relative; z-index: 2; background: rgba(10, 14, 20, 0.85); backdrop-filter: blur(20px); border: 1px solid rgba(0, 210, 255, 0.3); border-radius: 16px; padding: 50px 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.9); text-align: center; }
            .login-box h2 { color: #ffffff; font-size: 24px; font-weight: 500; letter-spacing: 2px; margin-top: 0; margin-bottom: 35px; display: flex; align-items: center; justify-content: center; gap: 10px; }
            .input-group { margin-bottom: 20px; }
            .input-group input { width: 100%; background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255, 255, 255, 0.15); color: #ffffff; height: 55px; padding: 0 20px; box-sizing: border-box; font-size: 14px; border-radius: 8px; outline: none; transition: 0.3s; }
            .input-group input:focus { border-color: #00D2FF; background: rgba(0,0,0,0.9); box-shadow: 0 0 15px rgba(0,210,255,0.2);}
            .btn-submit { width: 100%; background: #00D2FF; color: #000; font-size: 13px; font-weight: 700; padding: 18px; border: none; border-radius: 8px; cursor: pointer; margin-top: 15px; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px; }
            .btn-submit:hover { background: #0099CC; color: #fff; box-shadow: 0 0 20px rgba(0, 210, 255, 0.5); }
            .help-text { color: #888; font-size: 12px; margin-top: 30px; line-height: 1.6; font-weight: 300; }
        </style>
    </head>
    <body>
        <div class="login-box">
            <h2>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#00D2FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 8px rgba(0,210,255,0.6));"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg> 
                SYNCBOX
            </h2>
            <form action="/login" method="POST">
                <div class="input-group"><input type="text" name="user" placeholder="Usuario" required></div>
                <div class="input-group"><input type="password" name="pass" placeholder="Contraseña" required></div>
                <button type="submit" class="btn-submit">Ingresar</button>
            </form>
            <div class="help-text">Panel de administración encriptado. Conexión segura.</div>
        </div>
    </body>
    </html>
    `);
});

app.post('/login', async (req, res) => {
    const { user, pass } = req.body;
    try {
        const row = await dbGet("SELECT * FROM usuarios WHERE user = ? AND pass = ?", [user, pass]);
        if (row) {
            req.session.uid = row.id; req.session.user = row.user; req.session.rol = row.rol;
            res.redirect('/dash');
        } else { res.send("<script>alert('⛔ Datos incorrectos.'); window.location='/';</script>"); }
    } catch (err) { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/dash', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'dueño' || req.session.user === 'ruben');
    const esSubAdmin = (req.session.rol === 'Subadministrador');

    if (esAdminPrincipal || esSubAdmin || req.session.rol === 'Cliente') {
        try {
            let query = esAdminPrincipal ? "SELECT * FROM usuarios" : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
            let params = esAdminPrincipal ? [] : [req.session.uid, req.session.uid];
            const usuarios = await dbAll(query, params);
            const correos = await dbAll("SELECT * FROM correos", []);
            const registros = await dbAll("SELECT * FROM registro_codigos ORDER BY id DESC LIMIT 5", []);

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
                
                let controlesIzquierda = "";
                if (key === 'netflix') {
                    controlesIzquierda = `
                        <div style="background: rgba(0, 0, 0, 0.75); border: 1px solid rgba(0, 210, 255, 0.4); border-radius: 12px; padding: 12px; text-align: center; margin-bottom: 5px;">
                            <p style="margin: 0; color: #f8fafc; font-size: 11px; line-height: 1.5; font-weight: 400;">
                                ¡Bienvenido! Presiona en <strong style="color: var(--accent);">Consultar lo último que pidió</strong> y el sistema te dará exactamente lo que has pedido al instante. ✨
                            </p>
                        </div>
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill" style="background: var(--accent); color: #000; border: none;">🔎 Consultar lo último que pidió</button>
                    `;
                } else {
                    controlesIzquierda = `
                        <button onclick="triggerAction('${key}', 'mensaje')" class="action-btn-pill">Leer Mensaje</button>
                        <button onclick="triggerAction('${key}', 'pais')" class="action-btn-pill">Analizar País</button>
                        <button onclick="triggerAction('${key}', 'ip')" class="action-btn-pill">Buscar IP</button>
                    `;
                }

                panelesIzquierdosHtml += `
                <div id="action-${key}" class="action-panel">
                    <h4 style="margin:0 0 10px 0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Acciones ${plat.nombre}</h4>
                    ${controlesIzquierda}
                </div>`;

                panelesCentroHtml += `
                <div id="main-${key}" class="main-card">
                    <div style="display:flex; align-items:center; gap:15px; margin-bottom:20px;">
                        <div style="background:rgba(0,0,0,0.7); padding:10px 15px; border-radius:8px; border:1px solid var(--card-border);">
                            <img src="${plat.logo}" alt="${plat.nombre}" style="display:block; height:30px; width:auto; max-width:120px; object-fit:contain;">
                        </div>
                        <div>
                            <h3 style="margin:0; font-size:18px; font-weight:500;">Búsqueda en ${plat.nombre}</h3>
                            <p style="margin:5px 0 0 0; font-size:12px; color:var(--text-muted);">Ingresa el correo para consultar resultados.</p>
                        </div>
                    </div>
                    <form id="form-${key}" action="/buscar" method="POST" target="marco_resultados" style="margin:0;">
                        <input type="hidden" name="plataforma" value="${key}">
                        <input type="text" name="email_search" class="search-input-large" placeholder="Escribe el correo registrado..." required>
                    </form>
                </div>`;
            });

            panelesIzquierdosHtml += `
            <div id="action-crear-user" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Información</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Crea nuevas cuentas de clientes para darles acceso al panel SyncBox.</p></div>
            <div id="action-usuarios" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Información</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Vincula los correos de las plataformas de streaming al perfil de un cliente autorizado.</p></div>
            <div id="action-base-datos" class="action-panel"><h4 style="margin:0; font-size:11px; color:var(--text-muted); text-transform:uppercase;">Información</h4><p style="font-size:12px; color:#fff; line-height:1.5; margin-top:10px;">Consulta la base de datos persistente y borra registros que ya no necesites en el sistema.</p></div>
            `;

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
            
            let clientesOpcionesHtml = usuarios.filter(u => u.rol === 'Cliente' || u.rol === 'Subadministrador').map(u => `<option value="${u.id}">${u.user} (${u.rol})</option>`).join('');
            let terminoBusqueda = (req.query.buscar_dueno || "").trim().toLowerCase();
            let tablaUsuariosHtml = "";
            
            if (esAdminPrincipal || esSubAdmin) {
                let usuariosVisibles = esAdminPrincipal ? usuarios.filter(u => u.user !== 'dueño' && u.user !== 'ruben') : usuarios.filter(u => u.creado_por === req.session.uid);
                if (usuariosVisibles.length === 0) {
                    tablaUsuariosHtml = "<tr><td colspan='4' style='padding: 20px; text-align: center; color: var(--text-muted);'>No tienes clientes asignados.</td></tr>";
                } else {
                    usuariosVisibles.forEach(u => {
                        let correosDelUsuario = correos.filter(c => c.user_id === u.id);
                        let listaCorreosHtml = "";
                        if (correosDelUsuario.length > 0) {
                            listaCorreosHtml = correosDelUsuario.map(c => {
                                let esBuscado = terminoBusqueda && c.email.toLowerCase().includes(terminoBusqueda);
                                let estiloFondo = esBuscado ? "background: rgba(0, 210, 255, 0.15); border: 1px solid rgba(0, 210, 255, 0.3);" : "background: rgba(0,0,0,0.6); border: 1px solid transparent;";
                                return `<div style="display:flex; align-items:center; justify-content:space-between; ${estiloFondo} padding:8px 12px; border-radius:6px; font-size:12px; margin-bottom:5px;">
                                    <span>${c.email}</span>
                                    <form action="/admin/eliminar-correo" method="POST" style="margin:0;"><input type="hidden" name="correo_id" value="${c.id}"><button type="submit" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">✕</button></form>
                                </div>`;
                            }).join('');
                        } else { listaCorreosHtml = "<span style='color:var(--text-muted); font-size:11px; font-style: italic;'>Sin correos asignados</span>"; }

                        let idCreadorTexto = esAdminPrincipal && u.creado_por ? 'ID Creador: ' + u.creado_por : 'Tú';

                        tablaUsuariosHtml += `<tr>
                            <td style="font-weight: 500; vertical-align: top;">${u.user} <br><small style="color:var(--text-muted); font-weight:300; font-size:11px; margin-top:4px; display:block;">${u.rol}</small></td>
                            <td style="vertical-align: top;"><div style="max-height: 160px; overflow-y: auto; padding-right: 8px;">${listaCorreosHtml}</div></td>
                            <td style="font-size: 12px; color: var(--text-muted); vertical-align: top;">${idCreadorTexto}</td>
                            <td style="vertical-align: top; text-align: center;"><form action="/admin/eliminar-usuario" method="POST" onsubmit="return confirm('¿Seguro que deseas eliminar a este usuario?');" style="margin:0;"><input type="hidden" name="user_id" value="${u.id}"><button type="submit" style="background:rgba(0, 210, 255, 0.1); border:1px solid rgba(0, 210, 255, 0.3); color:#fff; padding:8px 16px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">Eliminar</button></form></td>
                        </tr>`;
                    });
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
                    <div class="user-pill" onclick="window.location='/logout'" title="Cerrar sesión">
                        <img src="https://i.pravatar.cc/150?u=${req.session.user}" alt="Avatar">
                        <div class="info"><strong>${req.session.user}</strong><span>${req.session.rol} ▾</span></div>
                    </div>
                    <div class="brand-logo">
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
                    </div>

                    <div class="center-panel">
                        ${panelesCentroHtml}
                        
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
                        <div id="main-base-datos" class="main-card">
                            <h3 style="margin:0 0 20px 0; font-size:20px; font-weight:500;">Base de Datos SyncBox</h3>
                            <form action="/dash" method="GET" style="display:flex; gap:12px; margin-bottom:20px;">
                                <input type="text" name="buscar_dueno" value="${terminoBusqueda}" class="input-classic" placeholder="Buscar correo..." style="margin:0;">
                                <button type="submit" class="btn-action-sm" style="padding: 0 20px;">Buscar</button>
                            </form>
                            <div style="background: rgba(0,0,0,0.7); border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden;">
                                <table><thead><tr><th>Usuario</th><th style="width: 50%;">Correos Vinculados</th><th>Creador</th><th style="text-align:center;">Acción</th></tr></thead><tbody>${tablaUsuariosHtml}</tbody></table>
                            </div>
                        </div>

                        <div class="iframe-container">
                            <div class="iframe-header">Data Vortex - VISOR DE RESULTADOS EN VIVO</div>
                            <iframe name="marco_resultados" style="width: 100%; height: 100%; border: none;"></iframe>
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
                                ` : ''}
                            </div>
                            
                            <h4 style="margin: 25px 0 10px 0;">Plataformas</h4>
                            <div class="plat-mini-grid">
                                ${botonesPlataformaHtml}
                            </div>
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
        } catch (err) { res.redirect('/'); }
    }
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

app.post('/admin/eliminar-usuario', async (req, res) => {
    if (req.session.rol === 'Cliente') return res.redirect('/dash');
    try {
        const userId = req.body.user_id;
        if (req.session.rol === 'Subadministrador') {
            const u = await dbGet("SELECT creado_por FROM usuarios WHERE id = ?", [userId]);
            if (!u || u.creado_por !== req.session.uid) return res.redirect('/dash');
        }
        await dbRun("DELETE FROM correos WHERE user_id = ?", [userId]);
        await dbRun("DELETE FROM usuarios WHERE id = ?", [userId]);
        res.redirect('/dash');
    } catch(err) { res.redirect('/dash'); }
});

async function buscarEnBuzonImap(correoBuzon, correoIngresado, plataforma, partes, accion) {
    const passwordSeleccionado = CUENTAS_GMAIL_MAP[correoBuzon];
    if (!passwordSeleccionado) return null;

    const config = { imap: { user: correoBuzon, password: passwordSeleccionado, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 2500 } };
    let connection = null;

    try {
        connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        
        let keywordPlat = (plataforma && PLATAFORMAS[plataforma]) ? PLATAFORMAS[plataforma].keyword_from : '';

        let messages = [];
        let mail = null;

        let queryStr = `"${correoIngresado}"`;
        if (keywordPlat) queryStr += ` ${keywordPlat}`;

        let searchResults = await connection.search([['X-GM-RAW', queryStr]], { bodies: ['HEADER.FIELDS (DATE)'] });
        if (searchResults.length > 0) {
            searchResults.sort((a, b) => new Date(b.attributes.date || 0) - new Date(a.attributes.date || 0));
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
        console.log(`⚠️️ Advertencia IMAP (${correoBuzon}):`, err.message);
        if (connection) connection.end();
        return null;
    }
}

app.post('/buscar', async (req, res) => {
    const { email_search, accion, plataforma } = req.body;
    
    const cssIframe = `<style>body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #cbd5e1; padding: 25px; margin: 0; line-height: 1.6; } h2, h3 { color: #f8fafc; font-weight: 400; }</style>`;

    try {
        let correoIngresado = (email_search || "").trim().toLowerCase();
        
        const esAdminPrincipal = (req.session.user === 'dueño' || req.session.user === 'ruben');
        if (!esAdminPrincipal) {
            const dueñocuenta = await dbGet("SELECT c.user_id, u.user, u.creado_por FROM correos c JOIN usuarios u ON c.user_id = u.id WHERE c.email = ?", [correoIngresado]);
            
            if (dueñocuenta) {
                const esPropia = (dueñocuenta.user_id === req.session.uid);
                const esDeMiCliente = (dueñocuenta.creado_por === req.session.uid);
                
                if (!esPropia && !esDeMiCliente) {
                    return res.send(`${cssIframe}<div style="text-align:center; padding:40px; border: 1px solid rgba(0, 210, 255, 0.3); border-radius:12px; background: rgba(0,0,0,0.8);"><h2 style="color:var(--accent);">⛔ Acceso Denegado</h2><p>El correo <strong>${correoIngresado}</strong> le pertenece al cliente <strong>${dueñocuenta.user}</strong></p></div>`);
                }
            } else {
                return res.send(`${cssIframe}<div style="text-align:center; padding:40px; border: 1px solid rgba(0, 210, 255, 0.3); border-radius:12px; background: rgba(0,0,0,0.8);"><h2 style="color:var(--accent);">⛔ Acceso Denegado</h2><p>No tienes autorización en la base de datos para consultar este correo.</p></div>`);
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
            return res.send(`${cssIframe}<div style="text-align:center; padding:40px; border: 1px solid rgba(255,255,255,0.1); border-radius:12px; background: rgba(0,0,0,0.5);">
                <h2 style="color:#f8fafc; font-weight:300;">Mensaje no encontrado</h2>
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
            let htmlRes = paisDetectado ? `<div style="font-size: 32px; font-weight: 300; margin: 20px auto; padding: 25px; background:rgba(0, 210, 255, 0.1); border-radius:12px; display:inline-block; border: 1px solid rgba(0, 210, 255, 0.3); color:#fff;">${paisDetectado}</div>` : `<div style="margin: 20px auto; padding: 25px; background:rgba(0,0,0,0.6); border-radius:12px; display:inline-block; border: 1px solid rgba(0, 210, 255, 0.5);"><h3 style="color:#00D2FF; margin:0; font-weight:300;">País no detectado en el mensaje</h3></div>`;
            return res.send(`${cssIframe}<div style="text-align:center; padding: 20px;"><h2>Análisis de Origen</h2><p style="color: #94a3b8;">${email_search}</p>${htmlRes}</div>`);
        }

        if (accion === 'ip') {
            const ipsEncontradas = textoCorreo.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g);
            let ipUnicas = ipsEncontradas ? [...new Set(ipsEncontradas)].filter(ip => !ip.startsWith('127.') && !ip.startsWith('10.') && !ip.startsWith('192.168.')) : [];
            let ipContenido = ipUnicas.length > 0 ? ipUnicas.map(ip => `<div style="font-size: 24px; font-weight:300; color:#fff; margin:10px 0; letter-spacing: 1px;">${ip}</div>`).join('') : `<div style="font-size: 15px; color:#94a3b8; margin: 20px 0;">No se detectó ninguna IP pública en el texto.</div>`;
            return res.send(`${cssIframe}<div style="text-align:center; padding: 20px;"><h2>Escáner de Direcciones IP</h2><p style="color: #94a3b8;">${email_search}</p><div style="margin: 20px auto; padding: 25px; background:rgba(0, 210, 255, 0.1); border-radius:12px; display:inline-block; border: 1px solid rgba(0, 210, 255, 0.3);">${ipContenido}</div></div>`);
        }

        if (/\b\d{4,6}\b/.test(textoBruto) && plataforma === 'netflix') {
            try { await dbRun("INSERT INTO registro_codigos (user, email_buscado) VALUES (?, ?)", [req.session.user, email_search.trim()]); } catch(err) {}
        }
        
        res.send(`${cssIframe}
            <div style="padding: 15px 20px; border: 1px solid rgba(0, 210, 255, 0.2); border-radius: 12px; background: rgba(0,0,0,0.6); margin-bottom: 25px;">
                <div style="font-weight: 500; font-size: 14px; margin-bottom: 5px; color: #f8fafc;">Remitente: <span style="color:#a3a3a3; font-weight:300;">${mail.from.text}</span></div>
                <div style="font-weight: 500; font-size: 14px; margin-bottom: 5px; color: #f8fafc;">Asunto: <span style="color:#a3a3a3; font-weight:300;">${mail.subject}</span></div>
                <div style="font-weight: 400; font-size: 11px; margin-top:10px; color:rgba(0, 210, 255, 0.8); text-transform:uppercase; letter-spacing:1px;">Buzón consultado: [SISTEMA ENCRIPTADO SYNCBOX]</div>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                ${mail.html ? mail.html : `<pre style="font-family:'Inter', sans-serif; white-space:pre-wrap; word-wrap:break-word; color:#e2e8f0;">${mail.text}</pre>`}
            </div>
        `);

    } catch (err) { res.send(`${cssIframe}<h2 style="color:#00D2FF; text-align:center; padding:20px; font-weight:300;">Error en la Búsqueda</h2>`); }
});

app.listen(10000, () => {
    console.log("🚀 SISTEMA CENTRAL INICIADO EN EL PUERTO 10000");
});
