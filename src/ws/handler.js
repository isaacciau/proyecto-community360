/**
 * ws/handler.js — WebSocket (Fase 5)
 * Gestiona los eventos en tiempo real con Socket.io.
 *
 * Eventos emitidos al cliente:
 *   interaccion:nueva      → cuando se crea una interacción vía POST /api/interacciones
 *   interaccion:actualizada → cuando se actualiza vía PUT /api/interacciones/:id
 *   interaccion:eliminada  → cuando se elimina vía DELETE /api/interacciones/:id
 *   stats:actualizadas     → versión recalculada de los KPIs (enviada tras cada cambio)
 *
 * Solo los clientes autenticados pueden conectarse.
 */
const jwt  = require('jsonwebtoken');
const pool = require('../db/pool');
const { SECRET } = require('../auth/middleware');

// Función que calcula los KPIs actuales desde la BD
async function calcularStats() {
    const [[activos]]   = await pool.query(`SELECT COUNT(*) AS n FROM usuarios WHERE estatus='activo'`);
    const [[enRiesgo]]  = await pool.query(`SELECT COUNT(*) AS n FROM usuarios WHERE estatus='en_riesgo'`);
    const [[inactivos]] = await pool.query(`SELECT COUNT(*) AS n FROM usuarios WHERE estatus='inactivo'`);
    const [[totalInt]]  = await pool.query(`SELECT COUNT(*) AS n FROM interacciones`);
    const [[sentProm]]  = await pool.query(`SELECT ROUND(AVG(sentimiento),3) AS v FROM interacciones`);
    const [[reacProm]]  = await pool.query(`SELECT ROUND(AVG(reacciones_recibidas),2) AS v FROM interacciones`);
    const [porCanal]    = await pool.query(
        `SELECT canal, COUNT(*) AS total, ROUND(AVG(sentimiento),3) AS sentimiento_promedio
         FROM interacciones GROUP BY canal ORDER BY total DESC`);
    const [porTema]     = await pool.query(
        `SELECT tema, COUNT(*) AS total FROM interacciones WHERE tema IS NOT NULL
         GROUP BY tema ORDER BY total DESC LIMIT 10`);
    const [etiquetas]   = await pool.query(
        `SELECT e.nombre AS etiqueta, COUNT(ie.id_interaccion) AS frecuencia
         FROM etiquetas e JOIN interaccion_etiqueta ie USING(id_etiqueta)
         GROUP BY e.nombre ORDER BY frecuencia DESC`);

    return {
        total_usuarios  : activos.n + enRiesgo.n + inactivos.n,
        activos         : activos.n,
        en_riesgo       : enRiesgo.n,
        inactivos       : inactivos.n,
        total_interacciones  : totalInt.n,
        sentimiento_promedio : sentProm.v,
        reacciones_promedio  : reacProm.v,
        por_canal  : porCanal,
        por_tema   : porTema,
        etiquetas,
        timestamp  : new Date().toISOString(),
    };
}

function setupWebSocket(io) {
    // Middleware de autenticación Socket.io
    io.use((socket, next) => {
        // Token puede venir en handshake auth o como query param
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) return next(new Error('No autenticado'));
        try {
            socket.user = jwt.verify(token, SECRET);
            next();
        } catch {
            next(new Error('Token inválido'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`[WS] Cliente conectado: ${socket.user.correo} (${socket.id})`);

        socket.emit('conectado', {
            message: `Bienvenido, ${socket.user.correo}`,
            timestamp: new Date().toISOString(),
        });

        socket.on('disconnect', () => {
            console.log(`[WS] Cliente desconectado: ${socket.user.correo} (${socket.id})`);
        });
    });
}

// Función exportada para emitir eventos desde el router de la API
function emitir(io, evento, datos) {
    io.emit(evento, { ...datos, timestamp: new Date().toISOString() });
}

async function emitirConStats(io, evento, datos) {
    emitir(io, evento, datos);
    try {
        const stats = await calcularStats();
        io.emit('stats:actualizadas', stats);
    } catch (e) {
        console.error('[WS] Error calculando stats:', e.message);
    }
}

module.exports = { setupWebSocket, emitir, emitirConStats };
