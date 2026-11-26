/**
 * server.js — Servidor principal de Community 360
 *
 * Integra:
 *  - Express (HTTP)
 *  - Autenticación JWT   (Fase 3)
 *  - API REST            (Fase 4)
 *  - WebSockets          (Fase 5)
 *  - Archivos estáticos  (Fase 6)
 *
 * Uso: node src/server.js
 */
require('dotenv').config({ quiet: true });
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');

const authRouter   = require('./auth/router');
const apiRouter    = require('./api/router');
const { setupWebSocket }  = require('./ws/handler');
const { verifyTokenPage } = require('./auth/middleware');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
    cors: { origin: '*', methods: ['GET','POST'] }
});

const PORT = process.env.PORT || 3000;

// ── Middleware global ──────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Rutas de autenticación (públicas) ─────────────────────────
app.use('/api/auth', authRouter);

// ── Inyectar `io` en cada request (para los routers de la API) ─
app.use((req, _res, next) => { req.io = io; next(); });

// ── API REST (protegida por JWT) ───────────────────────────────
app.use('/api', apiRouter);

// ── Archivos estáticos del dashboard ──────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Páginas HTML ───────────────────────────────────────────────
app.get('/login', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/dashboard', verifyTokenPage, (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// Redirigir raíz a login
app.get('/', (_req, res) => res.redirect('/login'));

// Ruta ligera para comprobar que el servidor está encendido (sin tocar la base de datos).
// La usa el monitor externo que evita que Render apague el servicio por inactividad.
app.get('/salud', (_req, res) => res.json({ ok: true, servicio: 'community360', hora: new Date().toISOString() }));

// 404 genérico
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Ruta no encontrada' }));

// ── WebSockets ─────────────────────────────────────────────────
// Autenticación JWT de los sockets. Los eventos se emiten desde api/router.js
// mediante req.io después de cada POST, PUT o DELETE.
setupWebSocket(io);

// ── Iniciar servidor ───────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`\n🌐 Community 360 escuchando en http://localhost:${PORT}`);
    console.log(`   Login   → http://localhost:${PORT}/login`);
    console.log(`   Dashboard → http://localhost:${PORT}/dashboard`);
    console.log(`   API     → http://localhost:${PORT}/api/`);
    console.log(`   WebSocket → ws://localhost:${PORT}\n`);
});

// Exportar io para usarlo en tests o scripts externos
module.exports = { app, server, io };
