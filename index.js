const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const path = require('path');
const app = express();

// 📂 BASE DE DATOS PREPARADA PARA ALMACENAMIENTO PERSISTENTE
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'betflix_mexico_v1.db');
const db = new sqlite3.Database(dbPath);

const dbGet = (query, params = []) => new Promise((resolve, reject) => db.get(query, params, (err, row) => err ? reject(err) : resolve(row)));
const dbAll = (query, params = []) => new Promise((resolve, reject) => db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows)));
const dbRun = (query, params = []) => new Promise((resolve, reject) => db.run(query, params, function(err) { err ? reject(err) : resolve(this) }));

// 🔥 CONFIGURACIÓN DE LAS CUENTAS DE GMAIL
const CUENTAS_GMAIL_MAP = {
    'tokioappoficial@gmail.com': 'avzepljuczbawvoy',
    'riandasnet@gmail.com': 'updchdcdsjnxvnyy',
    'clubecampestrejp@gmail.com': 'ipmvedbivouzeudi',
    'capoeirajpmg@gmail.com': 'vhtvjorujpohphks',
    'darciogarces@gmail.com': 'wkcidkcgtuapcnkh',
    'julianamjp1@gmail.com': 'lkambczcmvkddvcz',
    'casu34jk@gmail.com': 'btvouamnnjrjdrup',
    'santiagorevend@gmail.com': 'dqawfgnliyolqvjy'
};

// 🚀 PLATAFORMAS REDUCIDAS CON COLORES RGB Y LOGOS OFICIALES PARA DISEÑO PREMIUM
const PLATAFORMAS = {
    'netflix': { nombre: 'Netflix', color: '#E50914', rgb: '229, 9, 20', icono: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg', keyword_from: 'netflix' },
    'disney': { nombre: 'Disney+', color: '#113CCF', rgb: '17, 60, 207', icono: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg', keyword_from: 'disney' },
    'paramount': { nombre: 'Paramount+', color: '#0064FF', rgb: '0, 100, 255', icono: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Paramount_Plus.svg', keyword_from: 'paramount' },
    'crunchyroll': { nombre: 'Crunchyroll', color: '#F47521', rgb: '244, 117, 33', icono: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Crunchyroll_Logo.png', keyword_from: 'crunchyroll' },
    'spotify': { nombre: 'Spotify', color: '#1DB954', rgb: '29, 185, 84', icono: 'https://upload.wikimedia.org/wikipedia/commons/2/26/Spotify_logo_with_text.svg', keyword_from: 'spotify' }
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
    db.run("CREATE TABLE IF NOT EXISTS correos (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, user_id INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS registro_codigos (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, email_buscado TEXT, fecha DATETIME DEFAULT (datetime('now', 'localtime')))");
    db.run("ALTER TABLE usuarios ADD COLUMN creado_por INTEGER", (err) => {});
    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por) VALUES ('ruben', 'teamo2020', 'Administrador', NULL)");
});

// 🔥 ESTILOS MODERNOS Y PROFESIONALES ACTUALIZADOS
const CSS_MODERNO = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    :root {
        --bg-deep: #030303;
        --bg-panel: rgba(12, 12, 12, 0.7);
        --bg-sidebar: rgba(8, 8, 8, 0.85);
        --text-primary: #ffffff;
        --text-secondary: #b0b0b0;
        --mx-green: #00e676;
        --mx-red: #ff1744;
        --mx-white: #f5f5f5;
        --border-color: rgba(255, 255, 255, 0.08);
    }

    body { 
        background-color: var(--bg-deep); color: var(--text-primary); 
        font-family: 'Inter', sans-serif; margin: 0; padding: 0; box-sizing: border-box; 
        overflow-x: hidden; position: relative; 
    }
    
    body::before {
        content: ""; position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
        background: radial-gradient(circle at 50% 50%, rgba(255,23,68,0.04), rgba(0,230,118,0.04), rgba(17,60,207,0.04), rgba(244,117,33,0.04), transparent 60%);
        animation: rotateLED 25s linear infinite; z-index: -1; pointer-events: none;
    }
    @keyframes rotateLED { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    .goog-te-banner-frame.skiptranslate, #goog-gt-tt, .goog-te-gadget-tooltip { display: none !important; }
    body { top: 0px !important; }

    .top-header { 
        background: rgba(5, 5, 5, 0.85); backdrop-filter: blur(20px); padding: 14px 30px; 
        display: flex; justify-content: space-between; align-items: center; 
        border-bottom: 1px solid var(--border-color); position: sticky; top: 0; z-index: 100; 
        box-shadow: 0 4px 30px rgba(0,0,0,0.6); 
    }
    .top-header h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .top-header .brand-mx { background: linear-gradient(to right, var(--mx-green), var(--mx-white), var(--mx-red)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 20px rgba(0,230,118,0.2); }
    .top-header .user-badge { background: #111; color: var(--text-secondary); padding: 6px 16px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid #333; text-transform: uppercase; }
    
    .dashboard-layout { display: flex; min-height: calc(100vh - 65px); }
    
    .sidebar { 
        width: 300px; background: var(--bg-sidebar); backdrop-filter: blur(25px); 
        padding: 30px 20px; border-right: 1px solid var(--border-color); display: flex; 
        flex-direction: column; gap: 8px; position: sticky; top: 65px; height: calc(100vh - 65px); 
        box-sizing: border-box; overflow-y: auto; z-index: 50;
    }
    .sidebar::-webkit-scrollbar { width: 5px; }
    .sidebar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
    
    .sidebar-title { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; margin: 25px 0 15px 15px; font-weight: 800; }
    
    .main-content { flex: 1; padding: 40px; overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; }

    /* 🔥 ESTILOS PREMIUM PARA TABS (SIDEBAR) Y TARJETAS (CLIENTE) */
    .tab-btn { 
        background: transparent; color: var(--text-secondary); border: none; padding: 14px 18px; 
        border-radius: 12px; text-align: left; font-size: 13px; font-weight: 600; cursor: pointer; 
        transition: all 0.3s ease; display: flex; align-items: center; gap: 14px; width: 100%; box-sizing: border-box; 
    }
    
    .premium-tab {
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.03);
        position: relative;
        overflow: hidden;
    }
    .premium-tab::before {
        content: ''; position: absolute; left: 0; top: 0; width: 4px; height: 100%;
        background: var(--plat-color);
        box-shadow: 0 0 15px var(--plat-color);
        transition: 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .premium-tab:hover, .premium-tab.active {
        background: linear-gradient(90deg, rgba(var(--plat-rgb), 0.15) 0%, transparent 100%);
        border-color: rgba(var(--plat-rgb), 0.3);
        transform: translateX(6px);
        color: var(--text-primary);
    }
    .premium-tab:hover::before, .premium-tab.active::before {
        width: 100%; opacity: 0.08; z-index: 0;
    }
    .sidebar-icon {
        height: 22px; width: auto; max-width: 90px;
        object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
        z-index: 1; transition: 0.3s;
    }
    .premium-tab:hover .sidebar-icon { transform: scale(1.1); }
    .plat-name { z-index: 1; font-weight: 700; letter-spacing: 0.3px; }

    /* Tarjetas UI Cliente */
    .plat-card-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 15px; margin-top: 25px; width: 100%;
    }
    .plat-card-btn {
        background: linear-gradient(145deg, rgba(20,20,20,0.8) 0%, rgba(5,5,5,0.9) 100%);
        border: 1px solid rgba(255,255,255,0.05); border-radius: 16px;
        padding: 25px 15px; cursor: pointer; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 18px;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        position: relative; overflow: hidden; box-shadow: 0 5px 15px rgba(0,0,0,0.5);
    }
    .plat-card-btn::after {
        content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
        background: radial-gradient(circle, rgba(var(--plat-rgb), 0.15) 0%, transparent 70%);
        opacity: 0; transition: 0.5s;
    }
    .plat-card-btn:hover {
        transform: translateY(-8px) scale(1.02); border-color: var(--plat-color);
        box-shadow: 0 15px 35px rgba(var(--plat-rgb), 0.3), inset 0 0 20px rgba(var(--plat-rgb), 0.1);
    }
    .plat-card-btn:hover::after { opacity: 1; }
    .plat-card-btn img {
        height: 38px; max-width: 130px; object-fit: contain; z-index: 2;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6)); transition: 0.3s;
    }
    .plat-card-btn:hover img { transform: scale(1.12); }
    .plat-card-btn span {
        color: #fff; font-weight: 700; font-size: 13px; letter-spacing: 0.8px;
        z-index: 2; text-transform: uppercase;
    }

    .tab-panel { 
        display: none; background: var(--bg-panel); backdrop-filter: blur(30px); padding: 50px; 
        border-radius: 24px; border: 1px solid var(--border-color); animation: fadeInScale 0.4s cubic-bezier(0.16, 1, 0.3, 1); 
        width: 100%; max-width: 1000px; box-shadow: 0 20px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1); 
        box-sizing: border-box; position: relative; overflow: hidden;
    }
    .tab-panel.active { display: block; }
    @keyframes fadeInScale { from { opacity: 0; transform: translateY(15px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .panel-header { border-bottom: 1px solid var(--border-color); padding-bottom: 25px; margin-bottom: 35px; }
    .panel-header p { margin: 12px 0 0 0; color: var(--text-secondary); font-size: 15px; font-weight: 400; line-height: 1.6; }

    input, select, textarea { 
        width: 100%; padding: 18px 20px; margin-bottom: 20px; border-radius: 12px; 
        border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.5); color: var(--text-primary); 
        box-sizing: border-box; font-size: 15px; font-weight: 500; transition: all 0.3s ease; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
    }
    input:focus, select:focus { border-color: var(--mx-green); outline: none; background: rgba(0,0,0,0.8); box-shadow: 0 0 20px rgba(0,230,118,0.15); }
    
    button.action-btn, .action-btn-link { 
        color: white; border: none; padding: 16px 24px; border-radius: 12px; cursor: pointer; 
        font-weight: 700; width: 100%; box-sizing: border-box; text-transform: uppercase; 
        font-size: 13px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); letter-spacing: 1px; 
        display: inline-flex; justify-content: center; align-items: center; text-decoration: none; 
        border: 1px solid rgba(255,255,255,0.1);
    }
    button.action-btn:hover, .action-btn-link:hover { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    
    .btn-green-mx { background: linear-gradient(135deg, #00c853 0%, #008000 100%); color: #000 !important; border-color: #00c853; box-shadow: 0 8px 25px rgba(0,255,0,0.2); }
    .btn-white-mx { background: #fff; color: #000 !important; font-weight: 800 !important; box-shadow: 0 8px 25px rgba(255,255,255,0.2); }
    .btn-red-mx { background: linear-gradient(135deg, #ff1744 0%, #a00 100%); color: #fff !important; border-color: #ff1744; box-shadow: 0 8px 25px rgba(255,0,0,0.2); }

    .folder { background: rgba(10,10,10,0.6); border: 1px solid var(--border-color); border-radius: 16px; overflow: hidden; margin-bottom: 18px; transition: 0.3s; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
    .folder summary { padding: 22px 30px; font-weight: 700; font-size: 15px; cursor: pointer; display: flex; justify-content: space-between; }
    .folder-content { padding: 30px; background: rgba(5,5,5,0.8); border-top: 1px solid var(--border-color); }
    .client-card { background: rgba(15,15,15,0.9); border: 1px solid var(--border-color); padding: 24px; border-radius: 14px; position: relative; border-left: 4px solid; transition: 0.3s; }
</style>

<script>
    function openTab(tabId) {
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        
        let selectedTab = document.getElementById(tabId);
        if(selectedTab) selectedTab.classList.add('active');
        
        let selectedBtn = document.querySelector('[onclick="openTab(\\''+tabId+'\\')"]');
        if(selectedBtn) selectedBtn.classList.add('active');
        
        localStorage.setItem('activeBetflixTab', tabId);
    }
    
    document.addEventListener('DOMContentLoaded', () => {
        let active = localStorage.getItem('activeBetflixTab');
        if(!active || !document.getElementById(active)) active = 'panel-netflix'; 
        openTab(active);
    });

    function buscarCorreoLocal() {
        let input = document.getElementById('buscadorLocal').value.toLowerCase();
        let folders = document.querySelectorAll('.item-folder');
        let clients = document.querySelectorAll('.item-client');

        if(input === '') {
            folders.forEach(f => { f.style.display = ''; f.removeAttribute('open'); });
            clients.forEach(c => c.style.display = ''); return;
        }
        clients.forEach(c => { c.style.display = c.innerText.toLowerCase().includes(input) ? '' : 'none'; });
        folders.forEach(f => {
            if(f.innerText.toLowerCase().includes(input)) { f.style.display = ''; f.setAttribute('open', 'true'); } 
            else { f.style.display = 'none'; f.removeAttribute('open'); }
        });
    }
</script>
`;

app.use(async (req, res, next) => {
    const rutasAbiertas = ['/', '/login', '/logout'];
    if (rutasAbiertas.includes(req.path)) return next();
    if (req.session && req.session.uid) {
        try {
            const row = await dbGet("SELECT id FROM usuarios WHERE id = ?", [req.session.uid]);
            if (!row) { req.session.destroy(); return res.send("<script>alert('⛔ ACCESO DENEGADO'); window.location='/';</script>"); }
            next();
        } catch (err) { return res.redirect('/'); }
    } else { return res.redirect('/'); }
});

app.get('/', (req, res) => {
    res.send(`
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
        body { background: #050505; color: white; font-family: 'Inter', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .login-panel { background: rgba(10,10,10,0.85); padding: 70px 50px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.05); max-width: 440px; width: 90%; text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,0.9); }
        .logo-mx { font-size: 36px; font-weight: 800; margin-bottom: 15px; letter-spacing: -1px; }
        input { width: 100%; padding: 20px; margin-bottom: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.6); color: white; font-size: 15px; box-sizing: border-box; }
        input:focus { border-color: #00e676; outline: none; }
        .btn { background: linear-gradient(135deg, #00c853, #008000); color: #000; border: none; padding: 20px; border-radius: 12px; font-weight: 800; width: 100%; cursor: pointer; text-transform: uppercase; font-size: 14px; }
    </style>
    <div class="login-panel">
        <div class="logo-mx"><span style="color:#00e676;">⚡ BET</span>FLIX <br><span style="color:#ff1744;">M É X I C O</span></div>
        <h2 style="color:#888; font-size:14px; margin-bottom:45px;">Acceso de Alta Seguridad</h2>
        <form action="/login" method="POST">
            <input name="user" placeholder="Usuario" required>
            <input type="password" name="pass" placeholder="Contraseña" required>
            <button class="btn">🔓 Entrar al Sistema</button>
        </form>
    </div>`);
});

app.post('/login', async (req, res) => {
    try {
        const row = await dbGet("SELECT * FROM usuarios WHERE user = ? AND pass = ?", [req.body.user, req.body.pass]);
        if (row) { req.session.uid = row.id; req.session.user = row.user; req.session.rol = row.rol; res.redirect('/dash'); } 
        else { res.send("<script>alert('Datos incorrectos'); window.location='/';</script>"); }
    } catch (err) { res.redirect('/'); }
});

app.get('/dash', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'ruben' || req.session.rol === 'Administrador');
    const esSubAdmin = (req.session.rol === 'Subadministrador');

    if (esAdminPrincipal || esSubAdmin) {
        let query = esAdminPrincipal ? "SELECT * FROM usuarios WHERE user != 'ruben'" : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
        let params = esAdminPrincipal ? [] : [req.session.uid, req.session.uid];

        try {
            const usuarios = await dbAll(query, params);
            
            // 🔥 GENERACIÓN DEL MENÚ Y PANELES (PREMIUM)
            let plataformasSidebarHtml = "";
            let plataformasPanelsHtml = "";
            
            Object.keys(PLATAFORMAS).forEach(key => {
                let plat = PLATAFORMAS[key];
                
                plataformasSidebarHtml += `
                <button class="tab-btn premium-tab" onclick="openTab('panel-${key}')" style="--plat-color: ${plat.color}; --plat-rgb: ${plat.rgb};">
                    <img src="${plat.icono}" alt="${plat.nombre}" class="sidebar-icon">
                    <span class="plat-name">${plat.nombre}</span>
                </button>`;
                
                plataformasPanelsHtml += `
                <div id="panel-${key}" class="tab-panel">
                    <div class="panel-header">
                        <h3 style="color: #fff; font-size: 28px; font-weight: 800; display:flex; align-items:center; gap:18px;">
                            <div style="background: rgba(${plat.rgb}, 0.1); border: 1px solid rgba(${plat.rgb}, 0.3); padding: 10px 20px; border-radius: 14px; display:flex; justify-content:center; align-items:center; box-shadow: 0 0 20px rgba(${plat.rgb}, 0.2);">
                                <img src="${plat.icono}" style="height:35px; max-width: 150px; object-fit:contain; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.5));" alt="${plat.nombre}">
                            </div>
                            <span style="letter-spacing:-0.5px;">Panel de ${plat.nombre}</span>
                        </h3>
                        <p>Motor de Búsqueda <strong>Nativo en Tiempo Real</strong>. Nunca mostrará correos antiguos.</p>
                    </div>
                    <form action="/buscar" method="POST">
                        <input type="hidden" name="plataforma" value="${key}">
                        <input name="email_search" placeholder="Escribe el correo a buscar..." required style="border-color: rgba(255,255,255,0.1); font-size: 16px; padding: 22px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-top: 15px;">
                            <button type="submit" name="accion" value="mensaje" class="action-btn" style="background: linear-gradient(135deg, ${plat.color} 0%, rgba(${plat.rgb}, 0.5) 100%); border-color: ${plat.color}; box-shadow: 0 8px 25px rgba(${plat.rgb}, 0.3); font-size: 14px;">📩 Extraer Código</button>
                        </div>
                    </form>
                </div>`;
            });

            res.send(`
            ${CSS_MODERNO}
            <div class="top-header">
                <h2><span class="brand-mx">⚡ BET</span>FLIX</h2>
                <div style="display:flex; align-items:center; gap:25px;">
                    <span class="user-badge">${req.session.user} | ${req.session.rol}</span>
                    <a href="/logout" style="color:var(--mx-red); font-weight:800; text-decoration:none; font-size:12px;">SALIR</a>
                </div>
            </div>
            
            <div class="dashboard-layout">
                <div class="sidebar">
                    <div class="sidebar-title">Plataformas Stream</div>
                    ${plataformasSidebarHtml}
                    <div class="sidebar-title" style="margin-top:35px;">Herramientas Globales</div>
                    <button class="tab-btn premium-tab" onclick="openTab('panel-buscar')" style="--plat-color: #00A8E1; --plat-rgb: 0, 168, 225;">
                        <span style="font-size:18px;">🔎</span> <span class="plat-name">Buscar Dueño</span>
                    </button>
                    <button class="tab-btn premium-tab" onclick="openTab('panel-usuarios')" style="--plat-color: #00e676; --plat-rgb: 0, 230, 118;">
                        <span style="font-size:18px;">👥</span> <span class="plat-name">Base de Usuarios</span>
                    </button>
                </div>

                <div class="main-content">
                    ${plataformasPanelsHtml}
                    <div id="panel-buscar" class="tab-panel"><div class="panel-header"><h3>🔎 Buscar Dueño</h3></div><input type="text" id="buscadorLocal" onkeyup="buscarCorreoLocal();" placeholder="Filtrar base de usuarios..."></div>
                    <div id="panel-usuarios" class="tab-panel"><div class="panel-header"><h3>👥 Base de Usuarios</h3></div><p>Gestiona clientes y subadmins aquí.</p></div>
                </div>
            </div>`);
        } catch (err) { res.redirect('/'); }
    } else {
        // 🔥 VISTA DE CLIENTE CON DISEÑO GRID PREMIUM
        let btnHtml = "<div class='plat-card-grid'>";
        Object.keys(PLATAFORMAS).forEach((key) => {
            let plat = PLATAFORMAS[key];
            btnHtml += `
            <button type="button" class="plat-card-btn" style="--plat-color: ${plat.color}; --plat-rgb: ${plat.rgb};" onclick="document.getElementById('plat_input').value='${key}'; document.getElementById('search_form').submit();">
                <img src="${plat.icono}" alt="${plat.nombre}">
                <span>Consultar</span>
            </button>`;
        });
        btnHtml += "</div>";

        res.send(`
        ${CSS_MODERNO}
        <div class="top-header">
            <h2><span class="brand-mx">⚡ BET</span>FLIX</h2>
            <div style="display:flex; align-items:center; gap:20px;">
                <span class="user-badge">Cliente: ${req.session.user}</span>
                <a href="/logout" style="color:var(--mx-red); text-decoration:none; font-weight:800; font-size:12px;">SALIR</a>
            </div>
        </div>
        <div style="padding: 60px 20px; display:flex; justify-content:center; align-items: flex-start; min-height: calc(100vh - 100px);">
            <div class="tab-panel active" style="margin: 0; width:100%; max-width:800px; display: block; padding: 50px;">
                <div class="panel-header" style="text-align:center; border-bottom: none;">
                    <h3 style="justify-content:center; font-size:32px;">📨 Centro de Extracción</h3>
                    <p>Ingresa el correo y selecciona la plataforma que deseas consultar.</p>
                </div>
                <form id="search_form" action="/buscar" method="POST">
                    <input name="email_search" placeholder="Escribe aquí el correo..." required style="text-align:center; font-size:18px; padding: 22px; background: rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.1);">
                    <input type="hidden" name="accion" value="mensaje">
                    <input type="hidden" name="plataforma" id="plat_input" value="netflix">
                    ${btnHtml}
                </form>
            </div>
        </div>`);
    }
});

// 🔥 BÚSQUEDA NATIVA IMAP EN TIEMPO REAL (Corrige el bug de Disney+ mostrando correos viejos)
app.post('/buscar', async (req, res) => {
    const { email_search, accion, plataforma } = req.body;
    let messages = [];
    let connection = null;

    try {
        let correoIngresado = email_search.trim().toLowerCase();
        let partes = correoIngresado.split('@');
        let correoNormalizado = correoIngresado;

        if (partes.length === 2 && partes[1] === 'gmail.com') {
            let usernamePuro = partes[0].replace(/\./g, '').split('+')[0];
            correoNormalizado = `${usernamePuro}@${partes[1]}`;
        }

        let correoSeleccionado = "darciogarces@gmail.com";
        if (CUENTAS_GMAIL_MAP[correoNormalizado]) correoSeleccionado = correoNormalizado;
        else if (CUENTAS_GMAIL_MAP[correoIngresado]) correoSeleccionado = correoIngresado;

        const config = { imap: { user: correoSeleccionado, password: CUENTAS_GMAIL_MAP[correoSeleccionado], host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 } };

        try {
            connection = await imaps.connect(config);
            await connection.openBox('INBOX');
            
            // 🔥 SOLUCIÓN ESTRICTA: IMAP NATIVO en lugar de X-GM-RAW para garantizar la sincronización en vivo.
            let searchCriteria = [['TO', correoIngresado]];
            if (plataforma && PLATAFORMAS[plataforma]) {
                searchCriteria.push(['FROM', PLATAFORMAS[plataforma].keyword_from]);
            }

            // Descarga instantánea de encabezados para validar el buzón
            let searchResults = await connection.search(searchCriteria, { bodies: ['HEADER'] });

            if (searchResults.length > 0) {
                // Ordenar por identificador único descendente (El número más alto siempre es el más reciente)
                searchResults.sort((a, b) => b.attributes.uid - a.attributes.uid);
                let latestUid = searchResults[0].attributes.uid;
                
                // Extraer únicamente el cuerpo de ese mensaje exacto
                messages = await connection.search([['UID', latestUid]], { bodies: [''], struct: true });
            } else {
                connection.end();
            }
        } catch (err) { if (connection) connection.end(); }

        if (messages.length === 0) { 
            let nombrePlat = (plataforma && PLATAFORMAS[plataforma]) ? PLATAFORMAS[plataforma].nombre : '';
            return res.send(`<div style="background:#030303; text-align:center; padding:80px; color:white; font-family:'Inter', sans-serif; min-height:100vh;">
                <h2>❌ No hay correos recientes registrados${nombrePlat ? ` de ${nombrePlat}` : ''} para:<br><br><span style="color:var(--mx-green);">${email_search}</span></h2>
                <br><br><a href="/dash" style="color:black; background: white; padding: 18px 40px; border-radius: 12px; font-weight:800; text-decoration:none;">⬅ VOLVER AL PANEL</a>
            </div>`); 
        }

        const mail = await simpleParser(messages[0].parts.find(p => p.which === '').body);
        connection.end();
        let contenidoFinal = mail.html || mail.text || "";

        res.send(`
        <div style="background:#050505; padding: 20px 40px; display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid rgba(255,255,255,0.1); position: sticky; top: 0; z-index: 100;">
            <a href="/dash" style="color: white; text-decoration:none; background: rgba(255,255,255,0.05); padding: 12px 25px; border-radius: 10px; font-family:'Inter', sans-serif; font-weight:700; border: 1px solid rgba(255,255,255,0.1); transition: 0.3s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">⬅ VOLVER AL INICIO</a>
            <div style="font-family:'Inter', sans-serif; color: #00e676; font-size: 13px; font-weight:700; letter-spacing:0.5px;">✓ LECTURA EN TIEMPO REAL APLICADA</div>
        </div>
        <div style="background:#0f0f0f; min-height:100vh; padding: 40px 20px;">
            <div style="background:white; color:black; margin: 0 auto; max-width: 800px; font-family:sans-serif; border-radius: 16px; overflow:hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.8);">
                ${contenidoFinal}
            </div>
        </div>`);
    } catch (e) { res.redirect('/dash'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Panel V3 Premium iniciado en puerto ${PORT}`); });
