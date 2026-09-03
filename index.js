const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const path = require('path');
const app = express();

// 📂 BASE DE DATOS PERSISTENTE CON RUTA ABSOLUTA SEGURA
const dbPath = path.resolve(__dirname, 'betflix_mexico_v1.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Error al abrir la base de datos", err.message);
    } else {
        console.log("💾 Base de datos conectada correctamente en:", dbPath);
    }
});

// Wrappers de Promesas para Async/Await en SQLite
const dbGet = (query, params = []) => new Promise((resolve, reject) => db.get(query, params, (err, row) => err ? reject(err) : resolve(row)));
const dbAll = (query, params = []) => new Promise((resolve, reject) => db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows)));
const dbRun = (query, params = []) => new Promise((resolve, reject) => db.run(query, params, function(err) { err ? reject(err) : resolve(this) }));

// 🔥 CONFIGURACIÓN DE LAS CUENTAS DE GMAIL
const CUENTAS_GMAIL_MAP = {
    'tokioappoficial@gmail.com': 'avzepljuczbawvoy',
    'riandasnet@gmail.com': 'updchdcdsjnxvnyy',
    'clubecampestrejp@gmail.com': 'ipmvedbivouzeudi',
    'capoeirajpmg@gmail.com': 'nsadcogfhbxbmnac',
    'darciogarces@gmail.com': 'wkcidkcgtuapcnkh',
    'julianamjp1@gmail.com': 'lkambczcmvkddvcz',
    'casu34jk@gmail.com': 'npbqnwucjkicsnow',
    'santiagorevend@gmail.com': 'dqawfgnliyolqvjy',
    'aniketseller2@gmail.com': 'eogzbxpttachdnf'
};

// 🚀 SISTEMA ESCALABLE DE PLATAFORMAS
const PLATAFORMAS = {
    'netflix': { nombre: 'Netflix', color: '#E50914', alpha: 'rgba(229, 9, 20, 0.08)', logo: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg', keyword_from: 'netflix' },
    'disney': { nombre: 'Disney+', color: '#113CCF', alpha: 'rgba(17, 60, 207, 0.08)', logo: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg', keyword_from: 'disneyplus' },
    'crunchyroll': { nombre: 'Crunchyroll', color: '#F47521', alpha: 'rgba(244, 117, 33, 0.08)', logo: 'https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/svg/crunchyroll.svg', keyword_from: 'crunchyroll' },
    'spotify': { nombre: 'Spotify', color: '#1DB954', alpha: 'rgba(29, 185, 84, 0.08)', logo: 'https://upload.wikimedia.org/wikipedia/commons/2/26/Spotify_logo_with_text.svg', keyword_from: 'spotify' }
};

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'betflix_mexico_ultra_secure_2026_MX',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// 🔥 INICIALIZACIÓN SEGURA DE LA BASE DE DATOS (NO BORRA DATOS EXISTENTES)
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT UNIQUE, pass TEXT, rol TEXT, creado_por INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS correos (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, user_id INTEGER, fecha_asignacion DATETIME DEFAULT (date('now', 'localtime')))");
    db.run("CREATE TABLE IF NOT EXISTS registro_codigos (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, email_buscado TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    
    db.run("ALTER TABLE usuarios ADD COLUMN creado_por INTEGER", (err) => {});
    db.run("ALTER TABLE correos ADD COLUMN fecha_asignacion DATETIME DEFAULT (date('now', 'localtime'))", (err) => {});
    
    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por) VALUES ('ruben', 'teamo2020', 'Administrador', NULL)");
});

// 🔥 ESTILOS CSS MODERNOS
const CSS_MODERNO = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    :root {
        --bg-main: #f4f6f9; 
        --card-bg: #ffffff;
        --text-dark: #0f172a;
        --text-muted: #64748b;
        --border-soft: #e2e8f0;
        --btn-dark: #1e293b;
        --btn-light: #f1f5f9;
        --green-ok: #22c55e;
        --shadow-soft: 0 8px 30px rgba(0,0,0,0.04);
        --radius-pill: 50px;
        --radius-card: 24px;
    }

    body { 
        background-color: var(--bg-main); 
        color: var(--text-dark); 
        font-family: 'Inter', sans-serif; 
        margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; 
    }

    .goog-te-banner-frame.skiptranslate, #goog-gt-tt, .goog-te-gadget-tooltip { display: none !important; }
    body { top: 0px !important; }

    .top-header { 
        background: var(--bg-main); 
        padding: 20px 40px; 
        display: flex; justify-content: space-between; align-items: center; 
    }
    
    .user-pill {
        display: flex; align-items: center; gap: 12px;
        background: var(--card-bg); padding: 8px 16px; 
        border-radius: var(--radius-pill); box-shadow: var(--shadow-soft);
        font-size: 13px; cursor: pointer;
    }
    .user-pill img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
    .user-pill .info { display: flex; flex-direction: column; }
    .user-pill .info strong { color: var(--text-dark); font-weight: 700; }
    .user-pill .info span { color: var(--text-muted); font-size: 11px; }

    .brand-logo { font-size: 22px; font-weight: 800; display:flex; align-items:center; gap: 8px; letter-spacing: -0.5px; text-transform: uppercase;}
    .brand-logo .icon { color: #10b981; }

    .search-top { display: flex; align-items: center; gap: 15px; }
    .search-top input {
        background: var(--card-bg); border: none; padding: 12px 20px; width: 300px;
        border-radius: var(--radius-pill); box-shadow: var(--shadow-soft);
        font-family: 'Inter', sans-serif; font-size: 14px; outline: none;
    }
    .search-top .menu-btn {
        background: var(--card-bg); border: none; width: 42px; height: 42px;
        border-radius: 50%; box-shadow: var(--shadow-soft); font-weight: bold;
        cursor: pointer; display: flex; justify-content: center; align-items: center;
    }

    .dashboard-grid { 
        display: grid; 
        grid-template-columns: 420px 1fr 320px; 
        gap: 30px; 
        padding: 10px 40px 40px 40px; 
        align-items: start;
    }

    .platforms-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .plat-card {
        background: var(--card-bg); border-radius: var(--radius-card); padding: 25px 20px;
        box-shadow: var(--shadow-soft); display: flex; flex-direction: column; gap: 15px;
        position: relative; overflow: hidden; border: 1px solid rgba(255,255,255,0.5);
    }
    .plat-header { display: flex; justify-content: space-between; align-items: flex-start; z-index: 2; position: relative; }
    
    .plat-logo { height: 28px; max-width: 100px; object-fit: contain; transition: 0.3s; }
    .main-card-logo { height: 40px; max-width: 150px; object-fit: contain; transition: 0.3s; }

    .status-ok { background: var(--green-ok); color: white; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 50px; box-shadow: 0 4px 10px rgba(34, 197, 94, 0.3); }
    
    .plat-stats { z-index: 2; position: relative; margin-top: 10px; }
    .plat-stats span { display: block; font-size: 13px; font-weight: 600; color: var(--text-dark); margin-bottom: 5px; }
    .plat-stats .line { height: 2px; width: 100%; border-radius: 2px; margin-bottom: 8px; }
    .plat-stats small { font-size: 12px; color: var(--text-muted); font-weight: 500; }

    .plat-actions { display: flex; flex-direction: column; gap: 8px; z-index: 2; position: relative; margin-top: auto; }
    .btn-dark-blue { background: var(--btn-dark); color: white; border: none; padding: 12px; border-radius: 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn-dark-blue:hover { opacity: 0.9; transform: translateY(-2px); }
    .btn-light-pill { background: var(--btn-light); color: var(--text-dark); border: none; padding: 12px; border-radius: 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn-light-pill:hover { background: #e2e8f0; }

    .center-panel { display: flex; flex-direction: column; gap: 25px; }
    .main-card {
        background: var(--card-bg); border-radius: var(--radius-card); padding: 40px;
        box-shadow: var(--shadow-soft); display: none; animation: fadeIn 0.3s ease;
    }
    .main-card.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

    .main-card-header { display: flex; align-items: center; gap: 20px; margin-bottom: 30px; }
    .main-card-title h3 { margin: 0; font-size: 22px; color: var(--text-dark); font-weight: 800; }
    .main-card-title p { margin: 5px 0 0 0; color: var(--text-muted); font-size: 13px; }

    .action-row { display: flex; gap: 15px; margin-bottom: 25px; }
    .action-btn-pill {
        flex: 1; background: var(--btn-light); border: 1px solid var(--border-soft);
        padding: 15px; border-radius: var(--radius-pill); font-size: 12px; font-weight: 700;
        color: var(--text-dark); cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 8px;
        transition: 0.2s;
    }
    .action-btn-pill:hover { background: #e2e8f0; }

    .search-input-large {
        width: 100%; background: var(--btn-light); border: 1px solid var(--border-soft);
        padding: 18px 25px; border-radius: var(--radius-pill); font-size: 14px;
        color: var(--text-dark); outline: none; box-sizing: border-box; font-family: 'Inter', sans-serif;
    }

    .iframe-container {
        background: var(--card-bg); border-radius: var(--radius-card); 
        box-shadow: var(--shadow-soft); overflow: hidden; 
        height: 500px; display: flex; flex-direction: column;
    }
    .iframe-header {
        padding: 15px 25px; background: var(--btn-light); 
        border-bottom: 1px solid var(--border-soft); font-weight: 700; 
        font-size: 13px; color: var(--text-dark); display: flex; align-items: center; gap: 8px;
    }

    .right-sidebar { display: flex; flex-direction: column; gap: 25px; }
    .side-card {
        background: var(--card-bg); border-radius: var(--radius-card); padding: 25px;
        box-shadow: var(--shadow-soft);
    }
    .side-card h4 { margin: 0 0 20px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dark); font-weight: 800; }
    
    .activity-list { display: flex; flex-direction: column; gap: 15px; }
    .activity-item { border-bottom: 1px solid var(--btn-light); padding-bottom: 12px; }
    .activity-item:last-child { border-bottom: none; padding-bottom: 0; }
    .activity-item strong { display: block; font-size: 13px; color: var(--text-dark); }
    .activity-item span { font-size: 11px; color: var(--text-muted); }

    .menu-list { display: flex; flex-direction: column; gap: 10px; }
    .menu-btn-item {
        background: var(--btn-light); border: none; padding: 14px 20px;
        border-radius: var(--radius-pill); font-size: 13px; font-weight: 600;
        color: var(--text-dark); cursor: pointer; text-align: left; display: flex; align-items: center; gap: 12px;
        transition: 0.2s; font-family: 'Inter', sans-serif;
    }
    .menu-btn-item:hover { background: #e2e8f0; transform: translateX(5px); }

    .input-classic { width: 100%; padding: 15px; margin-bottom: 15px; border-radius: 12px; border: 1px solid var(--border-soft); background: var(--btn-light); font-family: 'Inter', sans-serif; box-sizing: border-box;}
    .btn-submit { background: var(--btn-dark); color: white; border: none; padding: 15px; border-radius: 12px; font-weight: 700; cursor: pointer; width: 100%; }
</style>

<script>
    function openTab(tabId) {
        document.querySelectorAll('.main-card').forEach(p => p.classList.remove('active'));
        let selectedTab = document.getElementById(tabId);
        if(selectedTab) selectedTab.classList.add('active');
        localStorage.setItem('activeBetflixTab', tabId);
    }
    
    document.addEventListener('DOMContentLoaded', () => {
        let active = localStorage.getItem('activeBetflixTab');
        const urlParams = new URLSearchParams(window.location.search);
        if(urlParams.has('buscar_dueno')) {
            active = 'panel-base-datos';
        }
        if(!active || !document.getElementById(active)) active = 'panel-netflix'; 
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
    <style>
        body { background: #f4f6f9; font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login-box { background: white; padding: 40px; border-radius: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); text-align: center; width: 100%; max-width: 350px; }
        input { width: 100%; padding: 15px; margin-bottom: 15px; border-radius: 50px; border: 1px solid #e2e8f0; background: #f1f5f9; box-sizing: border-box; text-align: center; font-family: 'Inter', sans-serif; outline: none; }
        button { width: 100%; padding: 15px; border-radius: 50px; border: none; background: #1e293b; color: white; font-weight: bold; cursor: pointer; font-family: 'Inter', sans-serif; }
    </style>
    <div class="login-box">
        <h2 style="margin-top:0;">⚡ PLATAFORMAS STREAMING</h2>
        <p style="color:#64748b; font-size:14px; margin-bottom:30px;">Acceso al Panel Central</p>
        <form action="/login" method="POST">
            <input name="user" placeholder="Usuario" required>
            <input type="password" name="pass" placeholder="Contraseña" required>
            <button>Iniciar Sesión</button>
        </form>
    </div>
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

app.get('/admin/logout-todos', (req, res) => {
    if (req.session.user === 'ruben' || req.session.rol === 'Administrador') { req.sessionStore.clear(() => { res.redirect('/'); }); } else { res.redirect('/dash'); }
});

app.get('/dash', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'ruben' || req.session.rol === 'Administrador');
    const esSubAdmin = (req.session.rol === 'Subadministrador');

    if (esAdminPrincipal || esSubAdmin || req.session.rol === 'Cliente') {
        try {
            let query = esAdminPrincipal ? "SELECT * FROM usuarios" : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
            let params = esAdminPrincipal ? [] : [req.session.uid, req.session.uid];
            const usuarios = await dbAll(query, params);
            const correos = await dbAll("SELECT * FROM correos", []);
            const registros = await dbAll("SELECT * FROM registro_codigos ORDER BY id DESC LIMIT 5", []);

            let plataformasCardsHtml = "";
            Object.keys(PLATAFORMAS).forEach(key => {
                let plat = PLATAFORMAS[key];
                plataformasCardsHtml += `
                <div class="plat-card">
                    <div style="position:absolute; top:-50px; right:-50px; width:150px; height:150px; background:radial-gradient(circle, ${plat.alpha} 0%, transparent 70%); border-radius:50%; pointer-events:none;"></div>
                    <div class="plat-header">
                        <img src="${plat.logo}" alt="${plat.nombre}" class="plat-logo" style="filter: drop-shadow(0px 0px 10px ${plat.color});">
                        <span class="status-ok">DE ACUERDO</span>
                    </div>
                    <div class="plat-stats">
                        <span>Estado</span>
                        <div class="line" style="background: ${plat.color};"></div>
                        <small>Códigos activos: 145/200</small>
                    </div>
                    <div class="plat-actions">
                        <button class="btn-dark-blue" onclick="openTab('panel-${key}')">Consulta tu plataforma</button>
                        <button class="btn-light-pill" onclick="openTab('panel-${key}')">Consultar códigos</button>
                    </div>
                </div>`;
            });

            let plataformasPanelsHtml = "";
            Object.keys(PLATAFORMAS).forEach(key => {
                let plat = PLATAFORMAS[key];
                plataformasPanelsHtml += `
                <div id="panel-${key}" class="main-card">
                    <div class="main-card-header">
                        <img src="${plat.logo}" alt="${plat.nombre}" class="main-card-logo" style="filter: drop-shadow(0px 0px 15px ${plat.color});">
                        <div class="main-card-title">
                            <h3>Gestor Central ${plat.nombre}</h3>
                            <p>Búsqueda avanzada de códigos y accesos cifrados de ${plat.nombre}.</p>
                        </div>
                    </div>
                    <form action="/buscar" method="POST" target="marco_resultados">
                        <input type="hidden" name="plataforma" value="${key}">
                        <div class="action-row">
                            <button type="submit" name="accion" value="mensaje" class="action-btn-pill">📩 LEER MENSAJE</button>
                            <button type="submit" name="accion" value="pais" class="action-btn-pill">🌍 ANALIZAR PAÍS</button>
                            <button type="submit" name="accion" value="ip" class="action-btn-pill">📡 BUSCAR IP</button>
                        </div>
                        <input type="text" name="email_search" class="search-input-large" placeholder="✉️ Buscar correo registrado en ${plat.nombre}..." required>
                    </form>
                </div>`;
            });

            let actividadesHtml = "";
            if (registros.length > 0) {
                registros.forEach(r => {
                    actividadesHtml += `<div class="activity-item"><strong>Consultar correo ${r.email_buscado}</strong><span>${r.fecha} - ${r.user}</span></div>`;
                });
            } else {
                actividadesHtml = `<div class="activity-item"><span>No hay actividades recientes.</span></div>`;
            }
            
            let clientesOpcionesHtml = usuarios.filter(u => u.rol === 'Cliente').map(u => `<option value="${u.id}">${u.user}</option>`).join('');

            let terminoBusqueda = (req.query.buscar_dueno || "").trim().toLowerCase();
            let tablaUsuariosHtml = "";
            
            if (esAdminPrincipal || esSubAdmin) {
                let usuariosVisibles = esAdminPrincipal 
                    ? usuarios.filter(u => u.user !== 'ruben') 
                    : usuarios.filter(u => u.creado_por === req.session.uid);

                if (usuariosVisibles.length === 0) {
                    tablaUsuariosHtml = "<tr><td colspan='4' style='padding: 15px; text-align: center;'>No tienes clientes asignados.</td></tr>";
                } else {
                    usuariosVisibles.forEach(u => {
                        let correosDelUsuario = correos.filter(c => c.user_id === u.id);
                        
                        let listaCorreosHtml = "";
                        if (correosDelUsuario.length > 0) {
                            listaCorreosHtml = correosDelUsuario.map(c => {
                                let esBuscado = terminoBusqueda && c.email.toLowerCase().includes(terminoBusqueda);
                                let estiloFondo = esBuscado ? "background: #fee2e2; border: 1px solid #ef4444;" : "background: #f1f5f9;";
                                
                                return `<div style="display:flex; align-items:center; justify-content:space-between; ${estiloFondo} padding:6px 10px; border-radius:8px; font-size:11px; margin-bottom:5px;">
                                    <span>${c.email} <small style="color:var(--text-muted);">(Asig: ${c.fecha_asignacion || 'N/A'})</small></span>
                                    <form action="/admin/eliminar-correo" method="POST" style="margin:0;">
                                        <input type="hidden" name="correo_id" value="${c.id}">
                                        <button type="submit" style="background:none; border:none; color:#ef4444; font-weight:bold; cursor:pointer; font-size:12px;" title="Eliminar correo">✕</button>
                                    </form>
                                </div>`;
                            }).join('');
                        } else {
                            listaCorreosHtml = "<span style='color:var(--text-muted); font-size:11px;'>Sin correos asignados</span>";
                        }

                        tablaUsuariosHtml += `
                        <tr style="border-bottom: 1px solid var(--border-soft);">
                            <td style="padding: 15px; font-weight: 600; vertical-align: top;">${u.user} <br><small style="color:var(--text-muted); font-weight:400;">${u.rol}</small></td>
                            <td style="padding: 15px; vertical-align: top;">
                                <div style="max-height: 150px; overflow-y: auto; padding-right: 5px;">
                                    ${listaCorreosHtml}
                                </div>
                            </td>
                            <td style="padding: 15px; font-size: 12px; vertical-align: top;">${esAdminPrincipal && u.creado_por ? `ID Creador: ${u.creado_por}` : 'Tú'}</td>
                            <td style="padding: 15px; vertical-align: top; text-align: center;">
                                <form action="/admin/eliminar-usuario" method="POST" onsubmit="return confirm('¿Seguro que deseas eliminar a este usuario y todos sus correos?');" style="margin:0;">
                                    <input type="hidden" name="user_id" value="${u.id}">
                                    <button type="submit" style="background:#fee2e2; color:#ef4444; border:none; padding:6px 12px; border-radius:8px; font-size:11px; font-weight:bold; cursor:pointer;">Eliminar</button>
                                </form>
                            </td>
                        </tr>`;
                    });
                }
            }

            res.send(`
            ${CSS_MODERNO}
            
            <div class="top-header">
                <div class="user-pill" onclick="window.location='/logout'" title="Cerrar sesión">
                    <img src="https://ui-avatars.com/api/?name=${req.session.user}&background=random" alt="Avatar">
                    <div class="info">
                        <strong>${req.session.user}</strong>
                        <span>${req.session.rol} ▾</span>
                    </div>
                </div>
                
                <div class="brand-logo"><span class="icon">⚡</span> PLATAFORMAS STREAMING</div>
                
                <div class="search-top">
                    <input type="text" placeholder="Buscar correo general...">
                    <button class="menu-btn">...</button>
                </div>
            </div>

            <div class="dashboard-grid">
                <div class="platforms-grid">
                    ${plataformasCardsHtml}
                </div>

                <div class="center-panel">
                    ${plataformasPanelsHtml}
                    
                    <div id="panel-crear-user" class="main-card">
                        <h3>Crear Nuevo Usuario</h3>
                        <form action="/admin/crear" method="POST">
                            <input name="n" class="input-classic" placeholder="Nombre de Usuario" required>
                            <input name="c" class="input-classic" placeholder="Contraseña" required>
                            <select name="r" class="input-classic">
                                <option value="Cliente">Cliente Normal</option>
                                ${esAdminPrincipal ? '<option value="Subadministrador">Subadministrador</option>' : ''}
                            </select>
                            <button class="btn-submit">Guardar Usuario</button>
                        </form>
                    </div>

                    <div id="panel-usuarios" class="main-card">
                        <h3>Gestión de Accesos a Correos</h3>
                        <p style="color:#64748b; font-size:13px; margin-bottom: 20px;">Pega los correos separados por espacio para asignarlos de forma masiva (Hasta 500 correos).</p>
                        
                        <form action="/admin/asignar-correo" method="POST" style="margin-bottom: 25px;">
                            <select name="user_id" class="input-classic" required>
                                <option value="" disabled selected>Selecciona un cliente...</option>
                                ${clientesOpcionesHtml}
                            </select>
                            <textarea name="email" class="input-classic" placeholder="ejemplo1@gmail.com ejemplo2@gmail.com ..." rows="4" required style="resize: vertical;"></textarea>
                            <button type="submit" class="btn-submit">Asignar Correos al Cliente</button>
                        </form>
                        
                        <a href="/admin/logout-todos" style="color:red; font-size:12px; text-decoration: none; font-weight: bold;">🛑 Desconectar a todos los usuarios</a>
                    </div>

                    <div id="panel-base-datos" class="main-card">
                        <h3>Base de Usuarios y Correos Asignados</h3>
                        <p style="color:#64748b; font-size:13px; margin-bottom: 15px;">Resumen de clientes y fechas de asignación de cuentas.</p>
                        
                        <form action="/dash" method="GET" style="margin-bottom: 20px; display: flex; gap: 10px;">
                            <input type="text" name="buscar_dueno" value="${terminoBusqueda}" class="input-classic" placeholder="🔍 Escribe un correo para buscar a su dueño..." style="margin:0; font-size:13px; padding: 10px 15px;">
                            <button type="submit" style="background:var(--btn-dark); color:white; border:none; padding: 0 20px; border-radius:12px; font-weight:bold; cursor:pointer; font-size:13px;">Buscar</button>
                        </form>

                        <div style="overflow-x: auto; background: var(--card-bg); border: 1px solid var(--border-soft); border-radius: 12px;">
                            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                                <thead style="background: var(--btn-light);">
                                    <tr>
                                        <th style="padding: 15px; color: var(--text-dark);">Usuario</th>
                                        <th style="padding: 15px; color: var(--text-dark); width: 50%;">Correos y Vencimiento (Con Scroll)</th>
                                        <th style="padding: 15px; color: var(--text-dark);">Creado Por</th>
                                        <th style="padding: 15px; color: var(--text-dark); text-align: center;">Acción</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tablaUsuariosHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="iframe-container">
                        <div class="iframe-header">
                            <span>📑</span> Visor de Resultados
                        </div>
                        <iframe name="marco_resultados" style="width: 100%; height: 100%; border: none;"></iframe>
                    </div>
                </div>

                <div class="right-sidebar">
                    <div class="side-card">
                        <h4>Últimas Actividades</h4>
                        <div class="activity-list">
                            ${actividadesHtml}
                        </div>
                    </div>

                    <div class="side-card">
                        <h4>Gestión del Sistema</h4>
                        <div class="menu-list">
                            ${(esAdminPrincipal || esSubAdmin) ? `
                            <button class="menu-btn-item" onclick="openTab('panel-crear-user')">🔍 Crear Nuevo Usuario</button>
                            <button class="menu-btn-item" onclick="openTab('panel-usuarios')">🗄️ Asignar Correos</button>
                            <button class="menu-btn-item" onclick="openTab('panel-base-datos')">👥 Ver Base de Usuarios</button>
                            ` : ''}
                            <button class="menu-btn-item" onclick="alert('Historial completo en desarrollo')">🔒 Historial de Códigos</button>
                        </div>
                    </div>

                    <div class="side-card">
                        <h4>Herramientas Globales</h4>
                        <div class="menu-list">
                            <button class="menu-btn-item" onclick="openTab('panel-base-datos')">🔧 Buscar Dueño de Cuenta</button>
                        </div>
                    </div>
                </div>
            </div>
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
        const correosBrutos = req.body.email.trim();
        const listaCorreos = correosBrutos.split(/[\s,]+/).filter(e => e.includes('@'));

        for (let email of listaCorreos) {
            await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [email.toLowerCase(), req.body.user_id]);
        }
        res.redirect('/dash'); 
    } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/eliminar-correo', async (req, res) => {
    if (req.session.rol === 'Cliente') return res.redirect('/dash');
    try {
        await dbRun("DELETE FROM correos WHERE id = ?", [req.body.correo_id]);
        res.redirect('/dash');
    } catch(err) { res.redirect('/dash'); }
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

app.post('/buscar', async (req, res) => {
    const { email_search, accion, plataforma } = req.body;
    let messages = [];
    let connection = null;
    let mail = null;

    const cssIframe = `<style>body { font-family: 'Inter', sans-serif; background: #ffffff; color: #0f172a; padding: 20px; margin: 0; }</style>`;

    try {
        let correoIngresado = email_search.trim().toLowerCase();
        
        if (req.session.rol === 'Cliente') {
            const permiso = await dbGet("SELECT id FROM correos WHERE email = ? AND user_id = ?", [correoIngresado, req.session.uid]);
            if (!permiso) {
                return res.send(`${cssIframe}<div style="text-align:center; padding:40px;"><h2 style="color:#ef4444;">⛔ Acceso Denegado</h2><p>No tienes autorización para buscar códigos o leer mensajes de este correo.</p></div>`);
            }
        }

        let partes = correoIngresado.split('@');
        let correoNormalizado = correoIngresado;

        if (partes.length === 2 && partes[1] === 'gmail.com') {
            let usernamePuro = partes[0].replace(/\./g, '').split('+')[0];
            correoNormalizado = `${usernamePuro}@${partes[1]}`;
        }

        let correoSeleccionado = "darciogarces@gmail.com";
        
        // Asignación directa a la cuenta receptora de Hotmail
        if (correoIngresado.includes('@hotmail.')) {
            correoSeleccionado = 'aniketseller2@gmail.com';
        } else if (CUENTAS_GMAIL_MAP[correoNormalizado]) {
            correoSeleccionado = correoNormalizado;
        } else if (CUENTAS_GMAIL_MAP[correoIngresado]) {
            correoSeleccionado = correoIngresado;
        }

        const passwordSeleccionado = CUENTAS_GMAIL_MAP[correoSeleccionado];
        const config = { imap: { user: correoSeleccionado, password: passwordSeleccionado, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 } };

        try {
            connection = await imaps.connect(config);
            await connection.openBox('INBOX');
            
            // ⚠️ MODIFICACIÓN CLAVE: Buscamos el correo en cualquier parte del cuerpo/título, no solo en "to:"
            let queryStr = `"${correoIngresado}"`;
            
            if (plataforma && PLATAFORMAS[plataforma]) {
                queryStr += ` from:${PLATAFORMAS[plataforma].keyword_from}`;
            }

            let searchResults = await connection.search([['X-GM-RAW', queryStr]], { bodies: ['HEADER'] });

            if (searchResults.length > 0) {
                searchResults.sort((a, b) => b.attributes.uid - a.attributes.uid);
                let latestUid = searchResults[0].attributes.uid;
                messages = await connection.search([['UID', latestUid]], { bodies: [''], struct: true });
            } else {
                connection.end();
            }
        } catch (err) {
            console.log(`⚠️ Error IMAP con ${correoSeleccionado}:`, err.message);
            if (connection) connection.end();
        }

        if (messages.length === 0) { 
            let nombrePlat = (plataforma && PLATAFORMAS[plataforma]) ? PLATAFORMAS[plataforma].nombre : '';
            return res.send(`${cssIframe}<div style="text-align:center; padding:40px;">
                <h2 style="color:#ef4444;">❌ No se encontró correo reciente${nombrePlat ? ` de ${nombrePlat}` : ''}</h2>
                <p>Para la cuenta: <strong>${email_search}</strong></p>
                <p style="color:#64748b; font-size: 13px; margin-top:20px; font-weight:600;">🔍 <strong>Buzón consultado directamente:</strong> ${correoSeleccionado}</p>
            </div>`); 
        }

        mail = await simpleParser(messages[0].parts.find(p => p.which === '').body);
        connection.end();
        const textoBruto = mail.text || String(mail.html).replace(/<[^>]*>?/gm, ' ') || "";
        const textoCorreo = textoBruto.toLowerCase();

        if (accion === 'pais') {
            let paisDetectado = null;
            const reglasPais = [
                { id: "🇺🇸 Estados Unidos", keys: ['ee. uu.', 'usa', 'united states', 'los gatos', 'california', '1-866-', '1-844-', '1-800-', '1-888-', '1-877-'] },
                { id: "🇨🇴 Colombia", keys: ['colombia', 'bogota', 'bogotá', '018000', '01 8000'] }
            ];
            for (let regla of reglasPais) { if (regla.keys.some(k => textoCorreo.includes(k))) { paisDetectado = regla.id; break; } }
            let htmlRes = paisDetectado ? `<div style="font-size: 40px; margin: 20px auto; padding: 20px; background:#f8fafc; border-radius:16px; display:inline-block; border: 1px solid #e2e8f0;">${paisDetectado}</div>` : `<div style="margin: 20px auto; padding: 20px; background:#fef2f2; border-radius:16px; display:inline-block;"><h3 style="color:#ef4444; margin:0;">⚠️ País no detectado</h3></div>`;
            return res.send(`${cssIframe}<div style="text-align:center; padding: 20px;"><h2>🌍 Análisis de País</h2><p>${email_search}</p>${htmlRes}</div>`);
        }

        if (accion === 'ip') {
            const ipsEncontradas = textoCorreo.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g);
            let ipUnicas = ipsEncontradas ? [...new Set(ipsEncontradas)].filter(ip => !ip.startsWith('127.') && !ip.startsWith('10.') && !ip.startsWith('192.168.')) : [];
            let ipContenido = ipUnicas.length > 0 ? ipUnicas.map(ip => `<div style="font-size: 30px; font-weight:800; color:#ef4444; margin:10px 0;">${ip}</div>`).join('') : `<div style="font-size: 18px; color:#ef4444; margin: 20px 0;">❌ No se detectó ninguna IP pública.</div>`;
            return res.send(`${cssIframe}<div style="text-align:center; padding: 20px;"><h2>📡 Escáner de IP</h2><p>${email_search}</p><div style="margin: 20px auto; padding: 20px; background:#f8fafc; border-radius:16px; display:inline-block; border: 1px solid #e2e8f0;">${ipContenido}</div></div>`);
        }

        if (/\b\d{4}\b/.test(textoBruto) && (!accion || accion === 'mensaje')) {
            try { await dbRun("INSERT INTO registro_codigos (user, email_buscado) VALUES (?, ?)", [req.session.user, email_search.trim()]); } catch(err) {}
        }

        let contenidoFinal = mail.html || mail.text || "";
        res.send(contenidoFinal);
    } catch (e) { 
        res.send(`${cssIframe}<div style="text-align:center; padding:40px;"><h2 style="color:#ef4444;">⚠️ Error en el servidor</h2><p>${e.message}</p></div>`); 
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Panel V6 Optimizado funcionando en el puerto ${PORT}`); });
