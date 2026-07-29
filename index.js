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

// Wrappers de Promesas para Async/Await en SQLite
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

// 🚀 SISTEMA ESCALABLE DE PLATAFORMAS (Limpiado y con Logos Oficiales)
const PLATAFORMAS = {
    'netflix': { 
        nombre: 'Netflix', 
        color: '#E50914', 
        logo: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg', 
        keyword_from: 'netflix' 
    },
    'disney': { 
        nombre: 'Disney+', 
        color: '#113CCF', 
        logo: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Disney%2B_logo.svg', 
        keyword_from: 'disney' 
    },
    'crunchyroll': { 
        nombre: 'Crunchyroll', 
        color: '#F47521', 
        logo: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Crunchyroll_Logo.png', 
        keyword_from: 'crunchyroll' 
    },
    'spotify': { 
        nombre: 'Spotify', 
        color: '#1DB954', 
        logo: 'https://upload.wikimedia.org/wikipedia/commons/2/26/Spotify_logo_with_text.svg', 
        keyword_from: 'spotify' 
    }
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

// 🔥 ESTILOS MODERNOS Y PROFESIONALES (LEDS, ANIMACIONES Y RESPONSIVO)
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
        background-color: var(--bg-deep); 
        color: var(--text-primary); 
        font-family: 'Inter', sans-serif; 
        margin: 0; padding: 0; box-sizing: border-box; overflow-x: hidden; position: relative; 
    }
    
    /* EFECTO LED DINÁMICO DE FONDO */
    body::before {
        content: ""; position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
        background: radial-gradient(circle at 50% 50%, rgba(255,23,68,0.04), rgba(0,230,118,0.04), rgba(17,60,207,0.04), rgba(244,117,33,0.04), transparent 60%);
        animation: rotateLED 25s linear infinite; z-index: -1; pointer-events: none;
    }
    @keyframes rotateLED { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    .goog-te-banner-frame.skiptranslate, #goog-gt-tt, .goog-te-gadget-tooltip { display: none !important; }
    body { top: 0px !important; }

    .custom-lang-select { 
        background: rgba(0,0,0,0.8); color: white; border: 1px solid var(--border-color); 
        padding: 6px 12px; border-radius: 8px; font-family: 'Inter', sans-serif; font-size: 13px; 
        font-weight: 600; cursor: pointer; outline: none; transition: 0.3s;
    }
    .custom-lang-select:focus, .custom-lang-select:hover { border-color: var(--mx-green); box-shadow: 0 0 10px rgba(0,230,118,0.3); }

    .top-header { 
        background: rgba(5, 5, 5, 0.85); backdrop-filter: blur(20px); padding: 14px 30px; 
        display: flex; justify-content: space-between; align-items: center; 
        border-bottom: 1px solid var(--border-color); position: sticky; top: 0; z-index: 100; 
        box-shadow: 0 4px 30px rgba(0,0,0,0.6); 
    }
    .top-header h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .top-header .brand-mx { background: linear-gradient(to right, var(--mx-green), var(--mx-white), var(--mx-red)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 20px rgba(0,230,118,0.2); }
    .top-header .user-badge { background: #111; color: var(--text-secondary); padding: 6px 16px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid #333; text-transform: uppercase; letter-spacing: 0.8px; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); }
    
    .dashboard-layout { display: flex; min-height: calc(100vh - 65px); }
    
    .sidebar { 
        width: 300px; background: var(--bg-sidebar); backdrop-filter: blur(25px); 
        padding: 30px 20px; border-right: 1px solid var(--border-color); display: flex; 
        flex-direction: column; gap: 10px; position: sticky; top: 65px; height: calc(100vh - 65px); 
        box-sizing: border-box; overflow-y: auto; z-index: 50;
    }
    .sidebar::-webkit-scrollbar { width: 5px; }
    .sidebar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
    
    .sidebar-title { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; margin: 25px 0 10px 15px; font-weight: 800; }
    
    .main-content { flex: 1; padding: 40px; overflow-y: auto; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; }
    
    .tab-btn { 
        background: rgba(255, 255, 255, 0.02); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.05); 
        padding: 14px 18px; border-radius: 12px; text-align: left; font-size: 14px; font-weight: 600; cursor: pointer; 
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; align-items: center; gap: 14px; width: 100%; box-sizing: border-box; 
    }
    .tab-btn img { height: 20px; object-fit: contain; filter: grayscale(100%) opacity(0.7); transition: 0.3s; }
    
    .tab-btn:hover { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); transform: translateX(4px); }
    .tab-btn:hover img { filter: grayscale(0%) opacity(1); }

    .tab-btn.active { 
        background: rgba(20, 20, 20, 0.8); color: var(--text-primary); font-weight: 700; 
        border-color: rgba(255,255,255,0.2); box-shadow: 0 10px 20px rgba(0,0,0,0.5); 
    }
    .tab-btn.active img { filter: grayscale(0%) opacity(1); }
    
    .sidebar-footer { margin-top: auto; padding-top: 25px; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 10px; }

    .tab-panel { 
        display: none; background: var(--bg-panel); backdrop-filter: blur(30px); padding: 50px; 
        border-radius: 24px; border: 1px solid var(--border-color); animation: fadeInScale 0.4s cubic-bezier(0.16, 1, 0.3, 1); 
        width: 100%; max-width: 1000px; box-shadow: 0 20px 60px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1); 
        box-sizing: border-box; position: relative; overflow: hidden;
    }
    .tab-panel::before {
        content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    }
    .tab-panel.active { display: block; }
    @keyframes fadeInScale { from { opacity: 0; transform: translateY(15px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .panel-header { border-bottom: 1px solid var(--border-color); padding-bottom: 25px; margin-bottom: 35px; display: flex; align-items: center; gap: 20px; }
    .panel-header h3 { margin: 0; color: var(--text-primary); font-size: 28px; font-weight: 800; letter-spacing: -0.8px; display: flex; align-items: center; gap: 15px; }
    .panel-header h3 img { height: 35px; object-fit: contain; }
    .panel-header p { margin: 12px 0 0 0; color: var(--text-secondary); font-size: 15px; font-weight: 400; line-height: 1.6; }

    input, select, textarea { 
        width: 100%; padding: 18px 20px; margin-bottom: 20px; border-radius: 12px; 
        border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.5); color: var(--text-primary); 
        box-sizing: border-box; font-size: 15px; font-weight: 500; font-family: 'Inter', sans-serif; 
        transition: all 0.3s ease; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
    }
    input:focus, select:focus { 
        border-color: var(--mx-green); outline: none; background: rgba(0,0,0,0.8); 
        box-shadow: 0 0 20px rgba(0,230,118,0.15), inset 0 2px 10px rgba(0,0,0,0.5); 
    }
    
    .led-action-btn { 
        background: rgba(10, 10, 10, 0.8); color: white; border: 1px solid rgba(255,255,255,0.1); 
        padding: 16px 24px; border-radius: 12px; cursor: pointer; font-weight: 700; 
        width: 100%; box-sizing: border-box; text-transform: uppercase; font-size: 13px; 
        font-family: 'Inter', sans-serif; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
        letter-spacing: 1px; display: inline-flex; justify-content: center; align-items: center; 
        text-decoration: none; position: relative; overflow: hidden; gap: 10px;
    }
    .led-action-btn::after { content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent); transition: 0.5s; }
    .led-action-btn:hover::after { left: 100%; }
    .led-action-btn:hover { transform: translateY(-3px); }
    .led-action-btn img { height: 20px; }

    /* Estilos dinámicos inyectados por plataforma */
    
    .danger-btn-sidebar { 
        background: transparent; border: 1px solid rgba(255, 23, 68, 0.3); color: #999; 
        padding: 12px 18px; text-align: center; border-radius: 10px; font-size: 11px; 
        text-decoration: none; display: flex; align-items: center; justify-content: center; font-weight: 700; 
        transition: 0.3s; text-transform: uppercase; letter-spacing: 1px; width: 100%; box-sizing: border-box; 
    }
    .danger-btn-sidebar:hover { background: rgba(255, 23, 68, 0.1); border-color: var(--mx-red); color: var(--mx-red); box-shadow: 0 0 15px rgba(255,23,68,0.2); }

    .folder { background: rgba(10,10,10,0.6); border: 1px solid var(--border-color); border-radius: 16px; overflow: hidden; margin-bottom: 18px; transition: 0.3s; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
    .folder:hover { border-color: rgba(255,255,255,0.15); box-shadow: 0 8px 25px rgba(0,0,0,0.5); }
    .folder summary { padding: 22px 30px; font-weight: 700; font-size: 15px; color: var(--text-primary); cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: 0.2s; }
    .folder summary:hover { background: rgba(255,255,255,0.02); }
    .folder summary::-webkit-details-marker { display: none; }
    .folder summary .user-count { font-size: 11px; background: rgba(0,0,0,0.8); color: var(--text-secondary); padding: 8px 16px; border-radius: 20px; border: 1px solid #333; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .folder-content { padding: 30px; background: rgba(5,5,5,0.8); border-top: 1px solid var(--border-color); }

    .client-card { background: rgba(15,15,15,0.9); border: 1px solid var(--border-color); padding: 24px; margin-bottom: 20px; border-radius: 14px; position: relative; border-left: 4px solid; transition: 0.3s; box-shadow: 0 5px 20px rgba(0,0,0,0.4); }
    .client-card:hover { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
    .client-card strong { font-size: 16px; font-weight: 700; letter-spacing: -0.2px; }
    .del-btn { position: absolute; top: 20px; right: 20px; color: #555; text-decoration: none; font-weight: bold; font-size: 20px; transition: 0.3s; background: rgba(255,255,255,0.05); width: 32px; height: 32px; display:flex; justify-content:center; align-items:center; border-radius: 50%; }
    .del-btn:hover { color: white; background: var(--mx-red); box-shadow: 0 0 15px rgba(255,0,0,0.5); transform: rotate(90deg); }
    
    .email-list { max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.6); padding: 15px; border-radius: 10px; margin-top: 20px; font-size: 13px; border: 1px solid rgba(255,255,255,0.05); box-shadow: inset 0 2px 10px rgba(0,0,0,0.5); }
    .email-item { display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 12px 10px; color: #aaa; transition: 0.2s; }
    .email-item:hover { background: rgba(255,255,255,0.03); color: white; }
    .email-item:last-child { border-bottom: none; }

    @media (max-width: 900px) {
        .dashboard-layout { flex-direction: column; }
        .sidebar { width: 100%; height: auto; position: relative; top: 0; padding: 20px; }
        .main-content { padding: 20px; }
        .tab-panel { padding: 30px 20px; }
    }
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
            clients.forEach(c => c.style.display = '');
            return;
        }
        clients.forEach(c => {
            let text = c.innerText.toLowerCase();
            c.style.display = text.includes(input) ? '' : 'none';
        });
        folders.forEach(f => {
            let text = f.innerText.toLowerCase();
            if(text.includes(input)) { f.style.display = ''; f.setAttribute('open', 'true'); } 
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
            if (!row) {
                req.session.destroy();
                return res.send("<script>alert('⛔ 🇲🇽 ACCESO DENEGADO \\n\\nTu cuenta ha sido eliminada por el administrador.'); window.location='/';</script>");
            }
            next();
        } catch (err) { return res.redirect('/'); }
    } else { return res.redirect('/'); }
});

app.get('/', (req, res) => {
    const ESTILO_LOGIN = `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap');
        :root { --bg-deep: #050505; --bg-panel: rgba(10, 10, 10, 0.85); --mx-green: #00e676; --mx-red: #ff1744; --mx-white: #f5f5f5; }
        body { color: white; font-family: 'Inter', sans-serif; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; overflow: hidden; background-color: var(--bg-deep); }
        .login-panel { background: var(--bg-panel); backdrop-filter: blur(40px); padding: 70px 50px; border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.05); max-width: 440px; width: 90%; text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,0.9); z-index: 10; }
        .logo-mx { font-size: 36px; font-weight: 800; margin-bottom: 15px; text-transform: uppercase; letter-spacing: -1.5px; line-height: 1.1; }
        .logo-mx .green { color: var(--mx-green); text-shadow: 0 0 20px rgba(0,230,118,0.4); } 
        .logo-mx .white { color: var(--mx-white); } 
        .logo-mx .red { color: var(--mx-red); text-shadow: 0 0 20px rgba(255,23,68,0.4); }
        h2 { color: #888; margin-bottom: 45px; font-weight: 500; font-size: 14px; margin-top: 0; line-height: 1.6; letter-spacing: 0.5px; }
        input { width: 100%; padding: 20px; margin-bottom: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.6); color: white; box-sizing: border-box; font-size: 15px; font-weight: 500; transition: 0.3s; }
        input:focus { border-color: var(--mx-green); outline: none; background: rgba(0,0,0,0.9); box-shadow: 0 0 20px rgba(0,230,118,0.2); }
        .btn-neon-green { background: linear-gradient(135deg, #00c853 0%, #008000 100%); color: #000; border: none; padding: 20px; border-radius: 12px; cursor: pointer; font-weight: 800; width: 100%; text-transform: uppercase; font-size: 14px; letter-spacing: 1px; box-shadow: 0 10px 30px rgba(0,255,0,0.25); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); font-family: 'Inter', sans-serif; }
        .btn-neon-green:hover { transform: translateY(-3px); box-shadow: 0 15px 40px rgba(0,255,0,0.4); }
        .goog-te-banner-frame.skiptranslate, #goog-gt-tt { display: none !important; }
    </style>
    `;
    res.send(`${ESTILO_LOGIN}
    <div style="position: absolute; width: 0; height: 0; overflow: hidden; z-index: -1;"><div id="google_translate_element"></div></div>
    <div class="login-panel">
        <div class="logo-mx"><span class="green">⚡ BET</span><span class="white">FLIX</span> <br><span class="red">M É X I C O</span></div>
        <h2>Panel de Control Profesional <br>Acceso de Alta Seguridad</h2>
        <form action="/login" method="POST">
            <input name="user" placeholder="Nombre de Usuario Master" required>
            <input type="password" name="pass" placeholder="Contraseña de Seguridad" required>
            <button class="btn-neon-green">🔓 Iniciar Sesión</button>
        </form>
    </div>
    <script type="text/javascript">
        function googleTranslateElementInit() { new google.translate.TranslateElement({pageLanguage: 'es', includedLanguages: 'es,en,pt', autoDisplay: false}, 'google_translate_element'); }
    </script>
    <script type="text/javascript" src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
    </body>`);
});

app.post('/login', async (req, res) => {
    const { user, pass } = req.body;
    try {
        const row = await dbGet("SELECT * FROM usuarios WHERE user = ? AND pass = ?", [user, pass]);
        if (row) {
            req.session.uid = row.id; req.session.user = row.user; req.session.rol = row.rol;
            res.redirect('/dash');
        } else { res.send("<script>alert('⛔ Datos de acceso incorrectos.'); window.location='/';</script>"); }
    } catch (err) { res.redirect('/'); }
});

app.get('/admin/logout-todos', (req, res) => {
    const esAdminPrincipal = (req.session.user === 'ruben' || req.session.rol === 'Administrador');
    if (esAdminPrincipal) { req.sessionStore.clear((err) => { res.send("<script>alert('✅ Se ha cerrado la sesión de TODOS los usuarios conectados.'); window.location='/';</script>"); }); } else { res.redirect('/dash'); }
});

app.get('/admin/nuke-database', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'ruben' || req.session.rol === 'Administrador');
    if (esAdminPrincipal) {
        try { await dbRun("DELETE FROM correos", []); await dbRun("DELETE FROM usuarios WHERE user != 'ruben'", []); res.send("<script>alert('💥 BASE DE DATOS FORMATEADA COMPLETAMENTE.'); window.location='/dash';</script>"); } catch(err) { res.redirect('/dash'); }
    } else { res.redirect('/dash'); }
});

app.get('/dash', async (req, res) => {
    const esAdminPrincipal = (req.session.user === 'ruben' || req.session.rol === 'Administrador');
    const esSubAdmin = (req.session.rol === 'Subadministrador');

    if (esAdminPrincipal || esSubAdmin) {
        let query = esAdminPrincipal ? "SELECT * FROM usuarios WHERE user != 'ruben'" : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
        let params = esAdminPrincipal ? [] : [req.session.uid, req.session.uid];

        try {
            const usuarios = await dbAll(query, params);
            const correos = await dbAll("SELECT * FROM correos", []);
            const registros = await dbAll("SELECT * FROM registro_codigos ORDER BY id DESC LIMIT 100", []);
                    
            let subadmins = usuarios.filter(u => u.rol === 'Subadministrador');
            let clientes = usuarios.filter(u => u.rol === 'Cliente');
            if (esSubAdmin) subadmins = usuarios.filter(u => u.id === req.session.uid);

            let subadminsHtml = "";
            subadmins.forEach(sub => {
                let clientesDelSub = clientes.filter(c => c.creado_por === sub.id);
                subadminsHtml += `
                <details class="folder item-folder">
                    <summary><span>📁 ${sub.user.toUpperCase()}</span><span class="user-count">${clientesDelSub.length} usuarios</span></summary>
                    <div class="folder-content">
                        <a href="/admin/del-user/${sub.id}" class="led-action-btn" style="border-color: #ff1744; margin-bottom:25px;" onclick="return confirm('⚠️ ¿Borrar a este subadmin y sus clientes?')">❌ ELIMINAR SUBADMINISTRADOR</a>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;">`;
                        clientesDelSub.forEach(cli => {
                            let correosDelCli = correos.filter(c => c.user_id === cli.id);
                            subadminsHtml += `
                            <div class="client-card item-client" style="border-left-color: var(--mx-green);">
                                <strong style="color: var(--mx-green);">👤 ${cli.user}</strong>
                                <a href="/admin/del-user/${cli.id}" class="del-btn" onclick="return confirm('¿Borrar cliente?')">×</a>
                                <form action="/admin/add-mail-masivo" method="POST" style="margin-top:20px; display:flex; gap:10px;">
                                    <input type="hidden" name="uid" value="${cli.id}">
                                    <input name="emails" placeholder="Pega los correos..." style="padding:12px; margin:0; font-size:13px; flex:1;">
                                    <button class="led-action-btn" style="width:auto; padding:0 20px; font-size:16px; border-color:var(--mx-green); color:var(--mx-green);">+</button>
                                </form>
                                <div class="email-list">`;
                                    correosDelCli.forEach(m => { subadminsHtml += `<div class="email-item"><span>${m.email}</span> <a href="/admin/del-mail/${m.id}" style="color:#f00; text-decoration:none; font-weight:bold; font-size:16px;">×</a></div>`; });
                            subadminsHtml += `</div></div>`;
                        });
                subadminsHtml += `</div></div></details>`;
            });

            let clientesDirectosHtml = "";
            if (esAdminPrincipal) {
                let clientesDirectos = clientes.filter(c => !c.creado_por);
                if(clientesDirectos.length > 0) {
                    clientesDirectosHtml += `<h4 style="color:var(--text-primary); margin-top:50px; border-bottom:1px solid var(--border-color); padding-bottom:15px; font-size:18px;">👤 Clientes Directos</h4><div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px;">`;
                    clientesDirectos.forEach(cli => {
                        let correosDelCli = correos.filter(c => c.user_id === cli.id);
                        clientesDirectosHtml += `
                        <div class="client-card item-client" style="border-left-color: var(--mx-red);">
                            <strong style="color: var(--mx-red);">👤 ${cli.user}</strong>
                            <a href="/admin/del-user/${cli.id}" class="del-btn" onclick="return confirm('¿Borrar cliente?')">×</a>
                            <form action="/admin/add-mail-masivo" method="POST" style="margin-top:20px; display:flex; gap:10px;">
                                <input type="hidden" name="uid" value="${cli.id}">
                                <input name="emails" placeholder="Pega los correos..." style="padding:12px; margin:0; font-size:13px; flex:1;">
                                <button class="led-action-btn" style="width:auto; padding:0 20px; font-size:16px; border-color:var(--mx-red); color:var(--mx-red);">+</button>
                            </form>
                            <div class="email-list">`;
                                correosDelCli.forEach(m => { clientesDirectosHtml += `<div class="email-item"><span>${m.email}</span> <a href="/admin/del-mail/${m.id}" style="color:#f00; text-decoration:none; font-weight:bold; font-size:16px;">×</a></div>`; });
                        clientesDirectosHtml += `</div></div>`;
                    });
                    clientesDirectosHtml += `</div>`;
                }
            }

            let registrosHtml = `<div style="overflow-x:auto; background: rgba(0,0,0,0.4); border-radius:12px; padding: 10px; border: 1px solid rgba(255,255,255,0.05);"><table style="width:100%; border-collapse: collapse; font-size: 14px;">
                <tr style="border-bottom: 1px solid var(--border-color); color:var(--text-secondary); text-align:left;">
                    <th style="padding:16px;">Usuario</th><th style="padding:16px;">Correo Buscado</th><th style="padding:16px;">Fecha y Hora</th>
                </tr>`;
            if (registros && registros.length > 0) {
                registros.forEach(r => { registrosHtml += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.02);"><td style="padding:16px; font-weight:700; color:var(--mx-green);">${r.user}</td><td style="padding:16px; color:white;">${r.email_buscado}</td><td style="padding:16px; color:#888;">${r.fecha}</td></tr>`; });
            } else { registrosHtml += `<tr><td colspan="3" style="padding:30px; text-align:center; color:#555;">No hay registros de códigos solicitados aún.</td></tr>`; }
            registrosHtml += `</table></div>`;

            let plataformasSidebarHtml = "";
            let plataformasPanelsHtml = "";
            
            Object.keys(PLATAFORMAS).forEach(key => {
                let plat = PLATAFORMAS[key];
                plataformasSidebarHtml += `
                <button class="tab-btn" onclick="openTab('panel-${key}')">
                    <img src="${plat.logo}" alt="${plat.nombre}">
                    Consultar ${plat.nombre}
                </button>`;
                
                plataformasPanelsHtml += `
                <div id="panel-${key}" class="tab-panel">
                    <div class="panel-header">
                        <h3><img src="${plat.logo}" alt="${plat.nombre}"> Consultar ${plat.nombre}</h3>
                    </div>
                    <form action="/buscar" method="POST">
                        <input type="hidden" name="plataforma" value="${key}">
                        <input name="email_search" placeholder="Escribe el correo registrado en ${plat.nombre}..." required style="border-color: rgba(255,255,255,0.1); font-size: 16px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 15px;">
                            <button type="submit" name="accion" value="mensaje" class="led-action-btn" style="border-color: ${plat.color}; color: ${plat.color}; box-shadow: 0 0 15px ${plat.color}30;" onmouseover="this.style.boxShadow='0 0 25px ${plat.color}80'" onmouseout="this.style.boxShadow='0 0 15px ${plat.color}30'">📩 Leer Mensaje</button>
                            <button type="submit" name="accion" value="pais" class="led-action-btn">🌍 Analizar País</button>
                            <button type="submit" name="accion" value="ip" class="led-action-btn">📡 Buscar IP</button>
                        </div>
                    </form>
                </div>
                `;
            });

            res.send(`
            ${CSS_MODERNO}
            <div style="position: absolute; width: 0; height: 0; overflow: hidden; z-index: -1;"><div id="google_translate_element"></div></div>
            <div class="top-header">
                <h2><span class="brand-mx">⚡ BET</span>FLIX</h2>
                <div style="display:flex; align-items:center; gap:25px;">
                    <span class="user-badge">${req.session.user} | ${req.session.rol}</span>
                    <a href="/logout" style="color:var(--text-secondary); text-decoration:none; font-size:12px; font-weight:800; transition:0.2s;" onmouseover="this.style.color='var(--mx-red)'" onmouseout="this.style.color='var(--text-secondary)'">SALIR</a>
                </div>
            </div>
            
            <div class="dashboard-layout">
                <div class="sidebar">
                    <div class="sidebar-title">Plataformas Streaming</div>
                    ${plataformasSidebarHtml}
                    
                    <div class="sidebar-title" style="margin-top:35px;">Herramientas Globales</div>
                    <button class="tab-btn" onclick="openTab('panel-buscar')">🔎 Buscar Dueño de Cuenta</button>
                    
                    <div class="sidebar-title" style="margin-top:35px;">Gestión de Sistema</div>
                    <button class="tab-btn" onclick="openTab('panel-registrar')">➕ Crear Nuevo Usuario</button>
                    <button class="tab-btn" onclick="openTab('panel-usuarios')">👥 Base de Usuarios</button>
                    <button class="tab-btn" onclick="openTab('panel-auditoria')">🕵️ Historial de Códigos</button>
                    
                    <div class="sidebar-footer">
                    ${esAdminPrincipal ? `
                        <a href="/admin/logout-todos" class="danger-btn-sidebar logout" onclick="return confirm('¿Cerrar sesión de TODOS los dispositivos?')">🛑 Desconectar Todos</a>
                        <a href="/admin/nuke-database" class="danger-btn-sidebar" onclick="return confirm('⚠️ ¿ESTÁS SEGURO DE BORRAR TODA LA BASE DE DATOS?')">💥 Formatear Sistema</a>
                    ` : ''}
                    </div>
                </div>

                <div class="main-content">
                    ${plataformasPanelsHtml}

                    <div id="panel-buscar" class="tab-panel">
                        <div class="panel-header"><h3>🔎 Buscar Dueño de Cuenta</h3></div>
                        <input type="text" id="buscadorLocal" onkeyup="buscarCorreoLocal(); openTab('panel-usuarios');" placeholder="Escribe aquí para filtrar la base de usuarios..." style="border-color:#00A8E1;">
                    </div>

                    <div id="panel-registrar" class="tab-panel">
                        <div class="panel-header"><h3>➕ Crear Nuevo Usuario</h3></div>
                        <form action="/admin/crear" method="POST">
                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                                <input name="n" placeholder="Nombre de Usuario" required>
                                <input name="c" placeholder="Contraseña de acceso" required>
                            </div>
                            <select name="r" style="margin-bottom:30px;">
                                <option value="Cliente">Perfil: Cliente Normal</option>
                                ${esAdminPrincipal ? '<option value="Subadministrador">Perfil: Subadministrador</option>' : ''}
                            </select>
                            <button class="led-action-btn">🚀 Crear Cuenta</button>
                        </form>
                    </div>

                    <div id="panel-usuarios" class="tab-panel">
                        <div class="panel-header"><h3>👥 Base de Usuarios</h3></div>
                        ${subadminsHtml}
                        ${clientesDirectosHtml}
                        ${(!subadminsHtml && !clientesDirectosHtml) ? '<p style="color:#555; text-align:center;">No hay usuarios registrados aún en el sistema.</p>' : ''}
                    </div>
                    
                    <div id="panel-auditoria" class="tab-panel">
                        <div class="panel-header"><h3>🕵️ Auditoría de Seguridad</h3></div>
                        ${registrosHtml}
                    </div>
                </div>
            </div>
            </body>`);
        } catch (err) { res.redirect('/'); }
    } else {
        // PERFIL CLIENTE
        let btnHtml = "";
        Object.keys(PLATAFORMAS).forEach((key) => {
            let plat = PLATAFORMAS[key];
            btnHtml += `<button type="button" class="led-action-btn" style="border-color: ${plat.color}; margin-bottom: 15px; color: ${plat.color}; justify-content: flex-start; box-shadow: 0 0 15px ${plat.color}20;" onclick="document.getElementById('plat_input').value='${key}'; document.getElementById('search_form').submit();" onmouseover="this.style.boxShadow='0 0 25px ${plat.color}60'" onmouseout="this.style.boxShadow='0 0 15px ${plat.color}20'">
                <img src="${plat.logo}" alt="${plat.nombre}">
                Consultar ${plat.nombre}
            </button>`;
        });

        res.send(`
        ${CSS_MODERNO}
        <div style="position: absolute; width: 0; height: 0; overflow: hidden; z-index: -1;"><div id="google_translate_element"></div></div>
        <div class="top-header">
            <h2><span class="brand-mx">⚡ BET</span>FLIX</h2>
            <div style="display:flex; align-items:center; gap:20px;">
                <span class="user-badge">${req.session.user}</span>
                <a href="/logout" style="color:var(--mx-red); text-decoration:none; font-weight:800; font-size:12px;">SALIR</a>
            </div>
        </div>
        <div style="padding: 60px 20px; display:flex; justify-content:center; align-items: flex-start;">
            <div class="tab-panel active" style="margin: 0; width:100%; max-width:500px; display: block; padding: 40px;">
                <div class="panel-header" style="text-align:center; display:block;">
                    <h3 style="justify-content:center;">📨 Lector Universal</h3>
                </div>
                <form id="search_form" action="/buscar" method="POST">
                    <input name="email_search" placeholder="Correo a buscar..." required style="text-align:center; font-size:16px;">
                    <input type="hidden" name="accion" value="mensaje">
                    <input type="hidden" name="plataforma" id="plat_input" value="netflix">
                    <div style="display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 15px;">
                        ${btnHtml}
                    </div>
                </form>
            </div>
        </div></body>`);
    }
});

app.post('/admin/crear', async (req, res) => {
    let creado_por = (req.session.rol === 'Subadministrador') ? req.session.uid : null;
    try { await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por) VALUES (?, ?, ?, ?)", [req.body.n, req.body.c, req.body.r, creado_por]); res.redirect('/dash'); } catch(err) { res.redirect('/dash'); }
});

app.post('/admin/add-mail-masivo', async (req, res) => {
    const list = req.body.emails.split(/[\s,]+/).filter(e => e.includes('@'));
    try {
        const rows = await dbAll("SELECT c.email, COALESCE(u.user, 'Fantasma/Eliminado') as owner FROM correos c LEFT JOIN usuarios u ON c.user_id = u.id", []);
        const correosExistentes = {}; rows.forEach(r => { correosExistentes[r.email.toLowerCase()] = r.owner; });
        
        const stmt = db.prepare("INSERT INTO correos (email, user_id) VALUES (?, ?)");
        let insertados = 0, repetidos = [];
        list.forEach(m => {
            let correoLimpio = m.trim().toLowerCase();
            if (correosExistentes[correoLimpio]) repetidos.push(`${correoLimpio}`);
            else { stmt.run(correoLimpio, req.body.uid); insertados++; }
        });
        stmt.finalize(); 
        if (repetidos.length > 0) res.send(`<script>alert('✅ Se guardaron ${insertados} correos.\\n\\n⚠️ Se bloquearon ${repetidos.length} repetidos.'); window.location='/dash';</script>`); 
        else res.redirect('/dash'); 
    } catch(err) { res.redirect('/dash'); }
});

app.get('/admin/del-user/:id', async (req, res) => { try { await dbRun("DELETE FROM usuarios WHERE id = ?", [req.params.id]); await dbRun("DELETE FROM correos WHERE user_id = ?", [req.params.id]); res.redirect('/dash'); } catch(err) { res.redirect('/dash'); } });
app.get('/admin/del-mail/:id', async (req, res) => { try { await dbRun("DELETE FROM correos WHERE id = ?", [req.params.id]); res.redirect('/dash'); } catch(err) { res.redirect('/dash'); } });

// 🔥 SISTEMA DE BÚSQUEDA EXTREMA O(1) + NORMALIZACIÓN DE GMAIL + CONTROL DE CACHÉ
app.post('/buscar', async (req, res) => {
    // 🛡️ Previene estrictamente que el navegador almacene en caché las respuestas y repita resultados.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { email_search, accion, plataforma } = req.body;
    let messages = [];
    let connection = null;
    let mail = null;
    let cuentaExitosa = null;

    try {
        let correoIngresado = email_search.trim().toLowerCase();
        let partes = correoIngresado.split('@');
        let correoNormalizado = correoIngresado;

        if (partes.length === 2 && partes[1] === 'gmail.com') {
            let usernamePuro = partes[0].replace(/\./g, '').split('+')[0];
            correoNormalizado = `${usernamePuro}@${partes[1]}`;
        }

        let correoSeleccionado = "darciogarces@gmail.com";
        if (CUENTAS_GMAIL_MAP[correoNormalizado]) {
            correoSeleccionado = correoNormalizado;
        } else if (CUENTAS_GMAIL_MAP[correoIngresado]) {
            correoSeleccionado = correoIngresado;
        }

        const passwordSeleccionado = CUENTAS_GMAIL_MAP[correoSeleccionado];
        const config = { imap: { user: correoSeleccionado, password: passwordSeleccionado, host: 'imap.gmail.com', port: 993, tls: true, tlsOptions: { rejectUnauthorized: false }, authTimeout: 3000 } };

        try {
            connection = await imaps.connect(config);
            await connection.openBox('INBOX');
            
            let queryStr = `to:${correoIngresado}`;
            if (plataforma && PLATAFORMAS[plataforma]) {
                queryStr += ` from:${PLATAFORMAS[plataforma].keyword_from}`;
            }

            let searchResults = await connection.search([['X-GM-RAW', queryStr]], { bodies: ['HEADER'] });

            if (searchResults.length > 0) {
                cuentaExitosa = correoSeleccionado;
                
                // 🔥 Siempre se extrae el UID más alto (el correo más reciente)
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
            return res.send(`<div style="background:#030303; text-align:center; padding:60px; color:white; font-family: 'Inter', sans-serif; min-height: 100vh;">
                <h2 style="font-size:30px;">❌ No se encontró correo reciente${nombrePlat ? ` de ${nombrePlat}` : ''} para:<br><span style="color:var(--mx-green);">${email_search}</span></h2>
                <br><br><a href="/dash" style="color:white; text-decoration:none; background: #111; border: 1px solid #333; padding: 15px 30px; border-radius: 12px; font-weight:700;">⬅ VOLVER AL PANEL</a>
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
                { id: "🇫🇷 Francia", keys: ['france', 'francia', 'paris', 's.a.s.', 'des questions'] },
                { id: "🇮🇳 India", keys: ['india', 'mumbai', 'maharashtra', 'llp', '000-800-'] },
                { id: "🇧🇷 Brasil", keys: ['brasil', 'brazil', 'alphaville', 'barueri', 'são paulo', '0800-', 'dúvidas?'] },
                { id: "🇨🇴 Colombia", keys: ['colombia', 'bogota', 'bogotá', '018000', '01 8000'] },
                { id: "🇪🇸 España", keys: ['españa', 'spain', 'madrid', '900 ', '900-'] },
                { id: "🇲🇽 México", keys: ['mexico', 'méxico', 'ciudad de méxico', '800-'] }
            ];
            for (let regla of reglasPais) { if (regla.keys.some(k => textoCorreo.includes(k))) { paisDetectado = regla.id; break; } }
            let htmlRes = paisDetectado ? `<div style="font-size: 50px; margin: 40px auto; padding: 40px; background:#fff; color:#000; border-radius:20px; display:inline-block; border-bottom: 6px solid #f00; border-top: 6px solid #0f0; box-shadow: 0 10px 40px rgba(255,255,255,0.2);">${paisDetectado}</div>` : `<div style="margin: 40px auto; padding: 30px; background:#111; border-radius:15px; display:inline-block; border: 1px solid #ffaa00;"><h3 style="color:#ffaa00; margin-top:0;">⚠️ País no detectado</h3></div>`;
            return res.send(`<div style="background:#050505; text-align:center; padding:15px; border-bottom:1px solid #222;"><a href="/dash" style="color:var(--mx-green); text-decoration:none; font-family:'Inter', sans-serif; font-weight:700;">⬅ VOLVER AL PANEL</a></div><div style="background:#0a0a0a; color:white; padding: 60px 20px; text-align:center; font-family:'Inter', sans-serif; min-height:100vh;"><h2>🌍 Análisis de País Geoespacial</h2><p>Correo analizado: <strong style="color:var(--mx-green); font-size:18px;">${email_search}</strong></p>${htmlRes}</div>`);
        }

        if (accion === 'ip') {
            const ipsEncontradas = textoCorreo.match(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g);
            let ipUnicas = ipsEncontradas ? [...new Set(ipsEncontradas)].filter(ip => !ip.startsWith('127.') && !ip.startsWith('10.') && !ip.startsWith('192.168.')) : [];
            let ipContenido = ipUnicas.length > 0 ? ipUnicas.map(ip => `<div style="font-size: 40px; font-weight:800; color:var(--mx-red); margin:15px 0;">${ip}</div>`).join('') : `<div style="font-size: 20px; color:#f00; margin: 30px 0;">❌ No se detectó ninguna IP pública en el código fuente.</div>`;
            return res.send(`<div style="background:#050505; text-align:center; padding:15px; border-bottom:1px solid #222;"><a href="/dash" style="color:var(--mx-green); text-decoration:none; font-family:'Inter', sans-serif; font-weight:700;">⬅ VOLVER AL PANEL</a></div><div style="background:#0a0a0a; color:white; padding: 60px 20px; text-align:center; font-family:'Inter', sans-serif; min-height:100vh;"><h2>📡 Escáner de IP</h2><p>Correo analizado: <strong style="color:var(--mx-green); font-size:18px;">${email_search}</strong></p><div style="margin: 40px auto; padding: 40px; background:#111; border-radius:20px; display:inline-block; border: 1px solid var(--mx-red); box-shadow: 0 10px 40px rgba(255,23,68,0.2);">${ipContenido}</div></div>`);
        }

        if (/\b\d{4}\b/.test(textoBruto) && (!accion || accion === 'mensaje')) {
            try { await dbRun("INSERT INTO registro_codigos (user, email_buscado) VALUES (?, ?)", [req.session.user, email_search.trim()]); } catch(err) {}
        }

        let contenidoFinal = mail.html || mail.text || "";

        res.send(`
        <div style="background:#050505; padding: 15px 30px; display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #222; position: sticky; top: 0; z-index: 100;">
            <a href="/dash" style="color: white; text-decoration:none; background: #1a1a1a; padding: 10px 20px; border-radius: 8px; font-family:'Inter', sans-serif; font-weight:700; border: 1px solid #333; transition: 0.3s;">⬅ VOLVER AL PANEL</a>
            <div style="font-family:'Inter', sans-serif; color: #888; font-size: 13px;">Extracción segura vía servidor central</div>
        </div>
        <div style="background:#0f0f0f; min-height:100vh; padding-top:40px;">
            <div style="background:white; color:black; padding: 0; margin: 0 auto; max-width: 800px; font-family:'Inter', sans-serif; border-radius: 12px; overflow:hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.8);">
                ${contenidoFinal}
            </div>
        </div>`);
    } catch (e) { 
        res.send(`<div style="background:#030303; text-align:center; padding:60px; color:white; font-family: 'Inter', sans-serif; min-height:100vh;"><h2 style="color:var(--mx-red);">⚠️ Error de conexión IMAP</h2><p style="color:#888;">${e.message}</p><br><br><a href="/dash" style="color:white; text-decoration:none; background: #111; border: 1px solid #333; padding: 15px 30px; border-radius: 12px; font-weight:700;">⬅ VOLVER AL PANEL</a></div>`); 
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`🚀 Panel V2 funcionando a máxima velocidad en el puerto ${PORT}`); });
