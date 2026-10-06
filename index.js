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

    db.run("CREATE TABLE IF NOT EXISTS historial_asignaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, receptor_id INTEGER, admin_id INTEGER, fecha DATETIME DEFAULT (datetime('now', 'localtime')), tipo_operacion TEXT DEFAULT 'Asignación manual', estado TEXT DEFAULT 'Asignada')");

    db.run("INSERT OR IGNORE INTO usuarios (user, pass, rol, creado_por) VALUES ('admin', '14032021', 'Administrador', NULL)", (err) => {});
    db.run("UPDATE usuarios SET user = 'admin', pass = '14032021' WHERE user = 'dueño'", (err) => {});
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

// Métodos de pago (Solo visibles para Admins y Subadmins)
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
            <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.5;">Accede a tu panel seguro.</p>
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

    // Se eliminan los datos de contacto personal del Administrador de la vista pública (Clausula 15)
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
            .login-box { position: relative; z-index: 2; background: rgba(0, 0, 0, 0.92); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 16px; padding: 40px 40px; width: 100%; max-width: 400px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.98); text-align: center; margin: 15px; }
            .input-group { margin-bottom: 20px; }
            .input-group input { width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; height: 55px; padding: 0 20px; box-sizing: border-box; font-size: 14px; border-radius: 8px; outline: none; transition: 0.3s; }
            .input-group input:focus { border-color: #00D2FF; box-shadow: 0 0 15px rgba(0,210,255,0.2);}
            .btn-submit { width: 100%; background: #00D2FF; color: #000; font-size: 13px; font-weight: 700; padding: 18px; border: none; border-radius: 8px; cursor: pointer; margin-top: 10px; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px; }
            .btn-submit:hover { background: #0099CC; color: #fff; box-shadow: 0 0 20px rgba(0, 210, 255, 0.5); }
            .help-text { color: #888; font-size: 12px; margin-top: 20px; margin-bottom: 20px; line-height: 1.6; font-weight: 300; }
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
        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono) VALUES (?, ?, 'Cliente', NULL, ?)", [user.trim(), pass, telefono.trim()]);
        res.send("<script>alert('✅ Registro exitoso. Ingresa con tus credenciales.'); window.location='/';</script>");
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
    const { n, c, r, t } = req.body;
    try {
        await dbRun("INSERT INTO usuarios (user, pass, rol, creado_por, telefono) VALUES (?, ?, ?, ?, ?)", [n.trim(), c.trim(), r, req.session.uid, t || '']);
        res.redirect('/dash');
    } catch(err) {
        res.send("<script>alert('Error al crear usuario o ya existe.'); window.location='/dash';</script>");
    }
});

app.post('/admin/asignar-correo', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    const { user_id, email } = req.body;
    const lista = email.split(/[\s,]+/).filter(e => e.includes('@'));
    try {
        for (let mail of lista) {
            let e = mail.trim().toLowerCase();
            let exist = await dbGet("SELECT id FROM correos WHERE email = ?", [e]);
            if (!exist) {
                await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [e, user_id]);
            }
        }
        res.redirect('/dash');
    } catch(err) {
        res.redirect('/dash');
    }
});

app.post('/admin/eliminar-correo', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    try {
        await dbRun("DELETE FROM correos WHERE id = ?", [req.body.correo_id]);
        res.redirect('/dash');
    } catch(err) {
        res.redirect('/dash');
    }
});

app.post('/admin/eliminar-usuario', async (req, res) => {
    if (req.session.rol !== 'Administrador' && req.session.rol !== 'Subadministrador') return res.redirect('/dash');
    try {
        await dbRun("DELETE FROM correos WHERE user_id = ?", [req.body.user_id]);
        await dbRun("DELETE FROM usuarios WHERE id = ?", [req.body.user_id]);
        res.redirect('/dash');
    } catch(err) {
        res.redirect('/dash');
    }
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
            res.send(`<script>alert('✅ Se agregaron ${agregadas} cuentas.\\n\\n⚠️ Se ignoraron ${duplicadas} cuentas porque YA ESTÁN REGISTRADAS.'); window.location='/dash';</script>`);
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
        res.send(`<script>alert('Saldo actualizado correctamente.'); window.location='/dash';</script>`);
    } catch(e) { res.redirect('/dash'); }
});

// 🎯 ASIGNACIÓN MANUAL CON LUPA Y CONFIRMACIÓN
app.post('/admin/asignar-manual', async (req, res) => {
    if (req.session.rol !== 'Administrador') return res.redirect('/dash');
    const { cuenta_id, receptor_id } = req.body;

    if (!cuenta_id || !receptor_id) {
        return res.send("<script>alert('⛔ Faltan datos para la asignación.'); window.location='/dash';</script>");
    }

    try {
        const cuenta = await dbGet("SELECT id, email, plataforma FROM stock_cuentas WHERE id = ? AND estado = 'Disponible'", [cuenta_id]);
        if (!cuenta) {
            return res.send("<script>alert('⛔ La cuenta ya no está disponible en el stock.'); window.location='/dash';</script>");
        }

        const yaVinculada = await dbGet("SELECT id FROM correos WHERE email = ?", [cuenta.email]);
        if (yaVinculada) {
            await dbRun("UPDATE stock_cuentas SET estado = 'Asignada', comprador_id = ? WHERE id = ?", [receptor_id, cuenta.id]);
            return res.send("<script>alert('⛔ Esta cuenta ya estaba vinculada.'); window.location='/dash';</script>");
        }

        await dbRun("UPDATE stock_cuentas SET estado = 'Asignada', comprador_id = ?, fecha_compra = datetime('now', 'localtime') WHERE id = ?", [receptor_id, cuenta.id]);
        await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [cuenta.email, receptor_id]);
        await dbRun("INSERT INTO historial_asignaciones (email, receptor_id, admin_id, tipo_operacion, estado) VALUES (?, ?, ?, 'Asignación manual', 'Asignada')", [cuenta.email, receptor_id, req.session.uid]);

        res.send(`<script>alert('✅ Asignación manual completada.\\nCuenta: ${cuenta.email} transferida al usuario.'); window.location='/dash';</script>`);
    } catch(e) {
        res.send(`<script>alert('Error en la asignación: ${e.message}'); window.location='/dash';</script>`);
    }
});

app.post('/subadmin/comprar', async (req, res) => {
    if (req.session.rol !== 'Subadministrador' && req.session.rol !== 'Cliente') return res.redirect('/dash');
    const paquete = parseInt(req.body.paquete);
    let costo = paquete === 5 ? 832 : (paquete === 10 ? 1560 : 0);
    if (!costo) return res.send("<script>alert('Paquete inválido'); window.location='/dash';</script>");

    try {
        const user = await dbGet("SELECT user, telefono, creditos, deuda FROM usuarios WHERE id = ?", [req.session.uid]);
        if (user.creditos < costo) return res.send("<script>alert('Créditos insuficientes.'); window.location='/dash';</script>");

        const disponibles = await dbAll("SELECT id, email FROM stock_cuentas WHERE estado = 'Disponible' AND plataforma = 'netflix' LIMIT ?", [paquete]);
        if (disponibles.length < paquete) return res.send("<script>alert('No hay stock suficiente. Intenta más tarde.'); window.location='/dash';</script>");

        const nuevoSaldo = user.creditos - costo;
        const nuevaDeuda = (user.deuda || 0) + costo;

        await dbRun("UPDATE usuarios SET creditos = ?, deuda = ? WHERE id = ?", [nuevoSaldo, nuevaDeuda, req.session.uid]);
        const compraInfo = await dbRun("INSERT INTO compras_stock (subadmin_id, cantidad, creditos_usados, saldo_anterior, saldo_nuevo) VALUES (?, ?, ?, ?, ?)", [req.session.uid, paquete, costo, user.creditos, nuevoSaldo]);
        const compraId = compraInfo.lastID;

        for (let cuenta of disponibles) {
            await dbRun("UPDATE stock_cuentas SET estado = 'Vendida', comprador_id = ?, compra_id = ?, fecha_compra = datetime('now', 'localtime') WHERE id = ?", [req.session.uid, compraId, cuenta.id]);
            await dbRun("INSERT INTO detalles_compras (compra_id, cuenta_id, email_cuenta) VALUES (?, ?, ?)", [compraId, cuenta.id, cuenta.email]);
            await dbRun("INSERT INTO correos (email, user_id) VALUES (?, ?)", [cuenta.email, req.session.uid]);
        }

        res.send(`<script>alert('✅ Compra exitosa. Las cuentas se agregaron a tu panel.'); window.location='/dash';</script>`);
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

            let superiorPhone = "";
            let superiorName = "";
            if (esCliente && usuarioActual.creado_por) {
                const creador = await dbGet("SELECT user, telefono FROM usuarios WHERE id = ?", [usuarioActual.creado_por]);
                if (creador) {
                    superiorPhone = creador.telefono;
                    superiorName = creador.user;
                }
            }

            let providerContactHtml = "";
            if (esAdminPrincipal) {
                providerContactHtml = `<div style="margin-top:15px; padding:10px; background: rgba(0,210,255,0.1); border-radius:8px; border:1px solid rgba(0,210,255,0.3); font-size:12px;">📞 Eres el Administrador Principal.</div>`;
            } else if (esSubAdmin) {
                providerContactHtml = `
                <div class="provider-contact" style="margin-top: 15px;">
                    <span style="font-size: 11px; color: var(--accent); display: block; margin-bottom: 5px;">Comunicación Interna:</span>
                    <a href="https://wa.me/573012964169" target="_blank" class="contact-btn whatsapp" style="width: 100%;">WhatsApp Jefe Admin</a>
                </div>`;
            } else if (esCliente) {
                if (superiorPhone) {
                    let cleanPhone = superiorPhone.replace('+', '').replace(/ /g, '');
                    providerContactHtml = `
                    <div class="provider-contact" style="margin-top: 15px;">
                        <span style="font-size: 11px; color: var(--accent); display: block; margin-bottom: 5px;">Tu Proveedor Oficial (@${superiorName}):</span>
                        <a href="https://wa.me/${cleanPhone}" target="_blank" class="contact-btn whatsapp" style="width: 100%;">Contactar Proveedor</a>
                    </div>`;
                } else {
                    providerContactHtml = `<div style="margin-top:15px; font-size:11px; color:var(--text-muted);">Comunícate con quien te creó la cuenta.</div>`;
                }
            }

            let query = esAdminPrincipal ? "SELECT * FROM usuarios" : "SELECT * FROM usuarios WHERE creado_por = ? OR id = ?";
            let params = esAdminPrincipal ? [] : [req.session.uid, req.session.uid];
            const usuarios = await dbAll(query, params);
            const correos = await dbAll("SELECT * FROM correos", []);
            
            const stockDisp = await dbGet("SELECT COUNT(*) as count FROM stock_cuentas WHERE estado = 'Disponible'");
            const stockCuentasDisponibles = await dbAll("SELECT id, email, plataforma FROM stock_cuentas WHERE estado = 'Disponible' ORDER BY id DESC");
            const clientesOpcionesHtml = usuarios.filter(u => u.rol === 'Cliente' || u.rol === 'Subadministrador').map(u => `<option value="${u.id}">${u.user} (${u.rol})</option>`).join('');

            // ... Renderización CSS, JS y layout (Abreviado para enfoque exacto al requerimiento)
            let layoutHead = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Panel - SyncBox</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                    :root { --text-main: #f8fafc; --text-muted: #94a3b8; --card-bg: rgba(0, 0, 0, 0.92); --card-border: rgba(255, 255, 255, 0.15); --accent: #00D2FF; --accent-hover: #0099CC; --btn-bg: rgba(0, 210, 255, 0.12); --shadow-elegant: 0 20px 50px rgba(0, 0, 0, 0.98); --blur-effect: blur(8px); --radius: 16px; }
                    body { background: #000; color: var(--text-main); font-family: 'Inter', sans-serif; margin: 0; padding: 0; min-height: 100vh; }
                    .dashboard-grid { display: grid; grid-template-columns: 320px 1fr 280px; gap: 25px; padding: 20px 40px; align-items: start; }
                    .main-card { background: var(--card-bg); border-radius: var(--radius); padding: 18px 25px; box-shadow: var(--shadow-elegant); border: 1px solid var(--card-border); backdrop-filter: var(--blur-effect); display: none; }
                    .main-card.active { display: block; }
                    .action-panel { background: var(--card-bg); border-radius: var(--radius); padding: 25px; border: 1px solid var(--card-border); display: none; flex-direction: column; gap: 12px; }
                    .action-panel.active { display: flex; }
                    .search-input-large { width: 100%; background: #000000; border: 1px solid rgba(255, 255, 255, 0.2); padding: 16px 25px; border-radius: 12px; font-size: 14px; color: var(--text-main); outline: none; box-sizing: border-box; }
                    .search-input-large:focus { border-color: var(--accent); }
                    .btn-submit { background: var(--accent); color: #000; border: none; padding: 14px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; transition: 0.3s; text-transform: uppercase; }
                    .input-classic { width: 100%; padding: 14px; margin-bottom: 10px; border-radius: 8px; border: 1px solid var(--card-border); background: #000000; color: white; box-sizing: border-box; outline: none; }
                    .menu-btn-item { background: transparent; border: 1px solid transparent; padding: 10px 12px; border-radius: 8px; font-size: 13px; color: var(--text-main); cursor: pointer; text-align: left; transition: 0.3s; }
                    .menu-btn-item:hover { background: rgba(0, 210, 255, 0.15); border-color: rgba(0, 210, 255, 0.4); padding-left: 18px; }
                    .contact-btn { background: #000; border: 1px solid var(--card-border); padding: 10px; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; color: #fff; font-size: 11px; font-weight: 600; transition: 0.3s; }
                    .contact-btn.whatsapp:hover { background: rgba(37, 211, 102, 0.25); border-color: #25d366; }
                </style>
                <script>
                    const stockDisponible = ${JSON.stringify(stockCuentasDisponibles)};
                    
                    function openTab(tabId) {
                        document.querySelectorAll('.main-card').forEach(p => p.classList.remove('active'));
                        document.querySelectorAll('.action-panel').forEach(p => p.classList.remove('active'));
                        if(document.getElementById('main-' + tabId)) document.getElementById('main-' + tabId).classList.add('active');
                        if(document.getElementById('action-' + tabId)) document.getElementById('action-' + tabId).classList.add('active');
                    }

                    // BUSCADOR EN STOCK
                    function buscarStockManual() {
                        const query = document.getElementById('buscador-stock').value.toLowerCase().trim();
                        const container = document.getElementById('resultado-busqueda-stock');
                        if (query.length === 0) { container.innerHTML = ''; return; }
                        
                        const resultados = stockDisponible.filter(c => c.email.toLowerCase().includes(query));
                        if (resultados.length === 0) {
                            container.innerHTML = '<p style="color: #E50914; font-size: 13px;">❌ No se encontró ninguna cuenta con ese correo.</p>';
                            return;
                        }

                        let html = '';
                        resultados.slice(0, 5).forEach(cuenta => {
                            html += \`
                            <div style="background: rgba(37, 211, 102, 0.1); border: 1px solid #25d366; padding: 12px; border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong style="color: #25d366; font-size: 14px; display:block;">Cuenta encontrada</strong>
                                    <span style="color: #fff; font-size: 13px; font-family: monospace;">Correo: \${cuenta.email}</span><br>
                                    <span style="color: var(--text-muted); font-size: 11px;">Estado: Disponible | Stock: Sí</span>
                                </div>
                                <button type="button" class="btn-submit" style="width: auto; padding: 8px 15px; font-size: 11px; background: #25d366; color: #000;" onclick="prepararAsignacion(\${cuenta.id}, '\${cuenta.email}')">Asignar cuenta</button>
                            </div>\`;
                        });
                        container.innerHTML = html;
                    }

                    function prepararAsignacion(id, email) {
                        document.getElementById('hidden-cuenta-id').value = id;
                        document.getElementById('confirm-email-txt').innerText = email;
                        document.getElementById('form-asignacion-manual').style.display = 'block';
                        document.getElementById('resultado-busqueda-stock').innerHTML = ''; 
                        document.getElementById('buscador-stock').value = '';
                        actualizarUsuarioConfirmacion();
                    }

                    function actualizarUsuarioConfirmacion() {
                        const select = document.getElementById('select-receptor-manual');
                        const confirmTxt = document.getElementById('confirm-usuario-txt');
                        const userNameSpan = document.getElementById('confirm-user-name');
                        if(select.selectedIndex > 0) {
                            userNameSpan.innerText = select.options[select.selectedIndex].text;
                            confirmTxt.style.display = 'block';
                        } else {
                            confirmTxt.style.display = 'none';
                        }
                    }

                    function cancelarAsignacion() {
                        document.getElementById('form-asignacion-manual').style.display = 'none';
                        document.getElementById('hidden-cuenta-id').value = '';
                    }
                </script>
            </head>
            <body>`;

            let leftSide = `
                <div class="left-sidebar">
                    <div class="side-card">
                        <h4>MENÚ PRINCIPAL</h4>
                        <button onclick="openTab('netflix')" class="menu-btn-item">📺 Sistema Netflix</button>
                        ${esAdminPrincipal || esSubAdmin ? `<button onclick="openTab('usuarios')" class="menu-btn-item">👥 Gestión de Clientes</button>` : ''}
                        ${esAdminPrincipal ? `<button onclick="openTab('asignacion-manual')" class="menu-btn-item">🎯 Asignación Manual</button>` : ''}
                    </div>
                    ${esAdminPrincipal || esSubAdmin ? metodosDePagoHtml : ''}
                </div>`;

            let centerPanel = `
                <div class="center-panel">
                    <div id="main-netflix" class="main-card active">
                        <h3>📺 Panel Netflix</h3>
                        <p>Plataforma habilitada. Puedes verificar correos usando el extractor superior.</p>
                    </div>`;

            if (esAdminPrincipal || esSubAdmin) {
                centerPanel += `
                    <div id="main-usuarios" class="main-card">
                        <h3>👥 Creación y Gestión de Clientes</h3>
                        <form action="/admin/crear" method="POST" style="margin-bottom: 20px; background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                            <input type="text" name="n" placeholder="Usuario Cliente" class="input-classic" required>
                            <input type="password" name="c" placeholder="Clave" class="input-classic" required>
                            <input type="tel" name="t" placeholder="Teléfono del Cliente" class="input-classic">
                            <input type="hidden" name="r" value="Cliente">
                            <button type="submit" class="btn-submit">Registrar Cliente y Asociarlo a tu Red</button>
                        </form>
                    </div>`;
            }

            if (esAdminPrincipal) {
                centerPanel += `
                    <div id="main-asignacion-manual" class="main-card">
                        <h3 style="margin:0 0 10px 0; font-size:20px; font-weight:500; color: #00D2FF;">🎯 Asignación Manual con Búsqueda Rápida</h3>
                        
                        <div style="background: rgba(0,0,0,0.6); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15); margin-bottom: 20px;">
                            <label style="color: #00D2FF; font-size: 12px; font-weight: 600; margin-bottom: 10px; display: block;">1. Buscar cuenta en Stock: 🔍</label>
                            <input type="text" id="buscador-stock" class="search-input-large" placeholder="Escribe el correo exacto o parcial (Ej: cuenta123@email.com)..." onkeyup="buscarStockManual()">
                            <div id="resultado-busqueda-stock" style="margin-top: 15px;"></div>
                        </div>

                        <form id="form-asignacion-manual" action="/admin/asignar-manual" method="POST" style="display: none; background: rgba(0,210,255,0.05); padding: 20px; border-radius: 12px; border: 1px dashed #00D2FF;">
                            <h4 style="margin: 0 0 15px 0; color: #00D2FF;">¿Confirmar asignación?</h4>
                            <p style="margin: 5px 0; font-size: 14px;"><strong>Cuenta:</strong> <span id="confirm-email-txt" style="color: #fff;"></span></p>
                            <input type="hidden" name="cuenta_id" id="hidden-cuenta-id">
                            
                            <div style="margin: 15px 0;">
                                <label style="color: var(--text-muted); font-size: 12px; font-weight: 600; margin-bottom: 6px; display: block;">2. Selecciona el Usuario al que se la asignarás:</label>
                                <select id="select-receptor-manual" name="receptor_id" class="input-classic" required onchange="actualizarUsuarioConfirmacion()">
                                    <option value="" disabled selected>-- Selecciona al usuario --</option>
                                    ${clientesOpcionesHtml}
                                </select>
                            </div>
                            <p id="confirm-usuario-txt" style="margin: 5px 0 15px 0; font-size: 14px; display: none;"><strong>Usuario:</strong> <span id="confirm-user-name" style="color: #fff;"></span></p>

                            <div style="display: flex; gap: 10px;">
                                <button type="button" class="btn-submit" style="background: #E50914; color: #fff; flex: 1;" onclick="cancelarAsignacion()">Cancelar</button>
                                <button type="submit" class="btn-submit" style="flex: 2;">Confirmar asignación</button>
                            </div>
                        </form>
                    </div>
                `;
            }

            centerPanel += `</div>`;

            let rightSide = `
                <div class="right-sidebar">
                    <div class="side-card">
                        <h4>INFORMACIÓN</h4>
                        <p style="font-size: 12px;">Usuario: <strong>${usuarioActual.user}</strong><br>Rol: ${usuarioActual.rol}</p>
                        ${providerContactHtml}
                        <a href="/logout" class="btn-submit" style="display:inline-block; text-align:center; background:#E50914; color:#fff; text-decoration:none; margin-top:20px;">Cerrar Sesión</a>
                    </div>
                </div>`;

            res.send(`${layoutHead}<div class="dashboard-grid">${leftSide}${centerPanel}${rightSide}</div></body></html>`);
        } catch(err) {
            console.error(err);
            res.send("Error al cargar el panel.");
        }
    } else {
        res.redirect('/');
    }
});

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`));
