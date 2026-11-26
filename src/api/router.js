/**
 * api/router.js — API REST (Fase 4)
 *
 * Endpoints protegidos con JWT:
 *
 * USUARIOS
 *   GET  /api/usuarios              → lista paginada
 *   GET  /api/usuarios/:id          → un usuario
 *
 * INTERACCIONES
 *   GET  /api/interacciones         → lista paginada con filtros
 *   GET  /api/interacciones/:id     → una interacción
 *   POST /api/interacciones         → crear interacción
 *   PUT  /api/interacciones/:id     → actualizar interacción
 *   DELETE /api/interacciones/:id   → eliminar interacción
 *
 * ESTADÍSTICAS (dashboard)
 *   GET  /api/stats/resumen         → KPIs generales
 *   GET  /api/stats/por-canal       → interacciones por canal
 *   GET  /api/stats/por-tema        → temas más populares
 *   GET  /api/stats/por-estatus     → distribución de estatus
 *   GET  /api/stats/temporal        → actividad semanal
 *   GET  /api/stats/por-edad        → interacciones por rango de edad
 *   GET  /api/stats/etiquetas       → etiquetas más usadas
 *   GET  /api/stats/top-usuarios    → top 10 usuarios activos
 */
const router      = require('express').Router();
const pool        = require('../db/pool');
const { verifyToken } = require('../auth/middleware');
const { emitirConStats } = require('../ws/handler');

// Todas las rutas de la API requieren autenticación
router.use(verifyToken);

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const toInt  = (v, def) => { const n = parseInt(v); return isNaN(n) ? def : n; };
const toFloat= (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

// Campos permitidos para actualizar interacciones (whitelist)
const CAMPOS_INTER = ['canal','tipo','texto','tema','sentimiento','idioma','dispositivo',
                      'longitud_texto','reacciones_recibidas','fecha_hora'];
const CANALES = ['Discord','Facebook','Instagram','Telegram','TikTok','Twitter/X'];
const TIPOS   = ['mensaje','comentario','reaccion','respuesta_encuesta','rsvp_evento'];
const DISPOSITIVOS = ['Android','Escritorio','Web','iOS'];
const RE_FECHA_HORA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
const esEnteroNoNegativo = (v) => Number.isInteger(Number(v)) && Number(v) >= 0 && String(v).trim() !== '';

// ═══════════════════════════════════════════════════════════
// USUARIOS
// ═══════════════════════════════════════════════════════════

/** GET /api/usuarios?page=1&limit=20&estatus=activo */
router.get('/usuarios', async (req, res) => {
    try {
        const page  = Math.max(1, toInt(req.query.page, 1));
        const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
        const offset = (page - 1) * limit;

        let where = '1=1';
        const params = [];
        if (req.query.estatus) { where += ' AND estatus = ?'; params.push(req.query.estatus); }
        if (req.query.pais)    { where += ' AND pais = ?';    params.push(req.query.pais); }

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM usuarios WHERE ${where}`, params);
        const [rows] = await pool.query(
            `SELECT * FROM usuarios WHERE ${where} ORDER BY id_usuario LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        return res.json({ ok: true, total, page, limit, data: rows });
    } catch (e) {
        console.error('[GET /usuarios]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** GET /api/usuarios/:id */
router.get('/usuarios/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE id_usuario = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
        return res.json({ ok: true, data: rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// INTERACCIONES
// ═══════════════════════════════════════════════════════════

/** GET /api/interacciones?page=1&limit=20&canal=X&tema=X */
router.get('/interacciones', async (req, res) => {
    try {
        const page  = Math.max(1, toInt(req.query.page, 1));
        const limit = Math.min(200, Math.max(1, toInt(req.query.limit, 20)));
        const offset = (page - 1) * limit;

        let where = '1=1';
        const params = [];
        if (req.query.canal) { where += ' AND canal = ?'; params.push(req.query.canal); }
        if (req.query.tipo)  { where += ' AND tipo = ?';  params.push(req.query.tipo); }
        if (req.query.tema)  { where += ' AND tema = ?';  params.push(req.query.tema); }
        if (req.query.id_usuario) { where += ' AND id_usuario = ?'; params.push(req.query.id_usuario); }

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM interacciones WHERE ${where}`, params);
        const [rows] = await pool.query(
            `SELECT i.*, GROUP_CONCAT(e.nombre ORDER BY e.nombre SEPARATOR ',') AS etiquetas
             FROM interacciones i
             LEFT JOIN interaccion_etiqueta ie USING(id_interaccion)
             LEFT JOIN etiquetas e USING(id_etiqueta)
             WHERE ${where}
             GROUP BY i.id_interaccion
             ORDER BY i.fecha_hora DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        return res.json({ ok: true, total, page, limit, data: rows });
    } catch (e) {
        console.error('[GET /interacciones]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** GET /api/interacciones/:id */
router.get('/interacciones/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT i.*, GROUP_CONCAT(e.nombre ORDER BY e.nombre SEPARATOR ',') AS etiquetas
             FROM interacciones i
             LEFT JOIN interaccion_etiqueta ie USING(id_interaccion)
             LEFT JOIN etiquetas e USING(id_etiqueta)
             WHERE i.id_interaccion = ?
             GROUP BY i.id_interaccion`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Interacción no encontrada' });
        return res.json({ ok: true, data: rows[0] });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** POST /api/interacciones — crear nueva interacción */
router.post('/interacciones', async (req, res) => {
    const b = req.body || {};

    // Validaciones
    const errores = [];
    if (!b.id_interaccion || String(b.id_interaccion).trim().length > 10)
        errores.push('id_interaccion requerido (máximo 10 caracteres)');
    if (!b.id_usuario)     errores.push('id_usuario requerido');
    if (!b.canal || !CANALES.includes(b.canal)) errores.push(`canal inválido. Valores: ${CANALES.join(', ')}`);
    if (!b.tipo  || !TIPOS.includes(b.tipo))    errores.push(`tipo inválido. Valores: ${TIPOS.join(', ')}`);
    if (!b.fecha_hora || !RE_FECHA_HORA.test(String(b.fecha_hora)))
        errores.push('fecha_hora requerida (formato YYYY-MM-DD HH:MM:SS)');
    if (!b.tema || String(b.tema).trim().length === 0 || String(b.tema).trim().length > 30)
        errores.push('tema requerido (máximo 30 caracteres)');
    if (b.reacciones_recibidas !== undefined && !esEnteroNoNegativo(b.reacciones_recibidas))
        errores.push('reacciones_recibidas debe ser un entero mayor o igual a 0');
    const sent = toFloat(b.sentimiento);
    if (sent === null || sent < -1 || sent > 1)
        errores.push('sentimiento requerido (número entre -1 y 1)');
    if (!b.idioma || String(b.idioma).trim().length !== 2)
        errores.push('idioma requerido (código de 2 letras, ej. es, en)');
    if (!b.dispositivo || !DISPOSITIVOS.includes(b.dispositivo))
        errores.push(`dispositivo inválido. Valores: ${DISPOSITIVOS.join(', ')}`);
    if (errores.length) return res.status(400).json({ ok: false, errores });

    try {
        // Verificar que el usuario existe
        const [[usr]] = await pool.query('SELECT id_usuario FROM usuarios WHERE id_usuario = ?', [b.id_usuario]);
        if (!usr) return res.status(400).json({ ok: false, error: 'El id_usuario no existe en el padrón' });

        // Verificar que no exista el id_interaccion
        const [[dup]] = await pool.query('SELECT id_interaccion FROM interacciones WHERE id_interaccion = ?', [b.id_interaccion]);
        if (dup) return res.status(409).json({ ok: false, error: 'El id_interaccion ya existe' });

        const texto = b.texto ? String(b.texto) : null;
        await pool.query(
            `INSERT INTO interacciones
             (id_interaccion, id_usuario, fecha_hora, canal, tipo, texto, tema,
              sentimiento, idioma, dispositivo, longitud_texto, reacciones_recibidas)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                String(b.id_interaccion).trim(),
                String(b.id_usuario).trim(),
                String(b.fecha_hora).replace('T', ' '),
                b.canal,
                b.tipo,
                texto,
                String(b.tema).trim(),
                sent,
                String(b.idioma).trim().toLowerCase(),
                b.dispositivo,
                texto ? texto.length : 0,
                Math.max(0, toInt(b.reacciones_recibidas, 0)),
            ]
        );

        const [rows] = await pool.query('SELECT * FROM interacciones WHERE id_interaccion = ?', [String(b.id_interaccion).trim()]);
        // Emitir evento WebSocket
        await emitirConStats(req.io, 'interaccion:nueva', { interaccion: rows[0] });
        return res.status(201).json({ ok: true, data: rows[0] });

    } catch (e) {
        console.error('[POST /interacciones]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** PUT /api/interacciones/:id — actualizar interacción */
router.put('/interacciones/:id', async (req, res) => {
    const b = req.body || {};
    const id = req.params.id;

    // Filtrar solo campos permitidos
    const updates = {};
    for (const f of CAMPOS_INTER) {
        if (b[f] !== undefined) updates[f] = b[f];
    }
    if (!Object.keys(updates).length) {
        return res.status(400).json({ ok: false, error: 'No se recibió ningún campo válido para actualizar' });
    }
    if (updates.canal && !CANALES.includes(updates.canal))
        return res.status(400).json({ ok: false, error: `canal inválido. Valores: ${CANALES.join(', ')}` });
    if (updates.tipo && !TIPOS.includes(updates.tipo))
        return res.status(400).json({ ok: false, error: `tipo inválido. Valores: ${TIPOS.join(', ')}` });
    if (updates.dispositivo && !DISPOSITIVOS.includes(updates.dispositivo))
        return res.status(400).json({ ok: false, error: `dispositivo inválido. Valores: ${DISPOSITIVOS.join(', ')}` });
    if (updates.sentimiento !== undefined) {
        const s = toFloat(updates.sentimiento);
        if (s === null || s < -1 || s > 1)
            return res.status(400).json({ ok: false, error: 'sentimiento debe ser un número entre -1 y 1' });
        updates.sentimiento = s;
    }
    if (updates.fecha_hora !== undefined) {
        if (!RE_FECHA_HORA.test(String(updates.fecha_hora)))
            return res.status(400).json({ ok: false, error: 'fecha_hora debe tener formato YYYY-MM-DD HH:MM:SS' });
        updates.fecha_hora = String(updates.fecha_hora).replace('T', ' ');
    }
    if (updates.idioma !== undefined) {
        if (String(updates.idioma).trim().length !== 2)
            return res.status(400).json({ ok: false, error: 'idioma debe ser un código de 2 letras (ej. es, en)' });
        updates.idioma = String(updates.idioma).trim().toLowerCase();
    }
    if (updates.tema !== undefined) {
        const t = String(updates.tema).trim();
        if (t.length === 0 || t.length > 30)
            return res.status(400).json({ ok: false, error: 'tema no puede ir vacío (máximo 30 caracteres)' });
        updates.tema = t;
    }
    if (updates.reacciones_recibidas !== undefined && !esEnteroNoNegativo(updates.reacciones_recibidas))
        return res.status(400).json({ ok: false, error: 'reacciones_recibidas debe ser un entero mayor o igual a 0' });
    // longitud_texto siempre se calcula a partir del texto; no se acepta desde el cliente
    delete updates.longitud_texto;
    if (updates.texto !== undefined) {
        updates.texto = updates.texto ? String(updates.texto) : null;
        updates.longitud_texto = updates.texto ? updates.texto.length : 0;
    }
    if (!Object.keys(updates).length) {
        return res.status(400).json({ ok: false, error: 'longitud_texto se calcula sola; envía texto para cambiarla' });
    }

    try {
        const [exist] = await pool.query('SELECT id_interaccion FROM interacciones WHERE id_interaccion = ?', [id]);
        if (!exist.length) return res.status(404).json({ ok: false, error: 'Interacción no encontrada' });

        const setCols = Object.keys(updates).map(c => `${c} = ?`).join(', ');
        await pool.query(`UPDATE interacciones SET ${setCols} WHERE id_interaccion = ?`,
            [...Object.values(updates), id]);

        const [rows] = await pool.query('SELECT * FROM interacciones WHERE id_interaccion = ?', [id]);
        // Emitir evento WebSocket
        await emitirConStats(req.io, 'interaccion:actualizada', { interaccion: rows[0] });
        return res.json({ ok: true, data: rows[0] });

    } catch (e) {
        console.error('[PUT /interacciones]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** DELETE /api/interacciones/:id */
router.delete('/interacciones/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const [exist] = await pool.query('SELECT id_interaccion FROM interacciones WHERE id_interaccion = ?', [id]);
        if (!exist.length) return res.status(404).json({ ok: false, error: 'Interacción no encontrada' });

        await pool.query('DELETE FROM interacciones WHERE id_interaccion = ?', [id]);
        // Emitir evento WebSocket
        await emitirConStats(req.io, 'interaccion:eliminada', { id_interaccion: id });
        return res.json({ ok: true, message: `Interacción ${id} eliminada` });
    } catch (e) {
        console.error('[DELETE /interacciones]', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════

/** GET /api/stats/resumen — KPIs generales */
router.get('/stats/resumen', async (req, res) => {
    try {
        const [[activos]]   = await pool.query(`SELECT COUNT(*) AS n FROM usuarios WHERE estatus='activo'`);
        const [[enRiesgo]]  = await pool.query(`SELECT COUNT(*) AS n FROM usuarios WHERE estatus='en_riesgo'`);
        const [[inactivos]] = await pool.query(`SELECT COUNT(*) AS n FROM usuarios WHERE estatus='inactivo'`);
        const [[totalUsr]]  = await pool.query(`SELECT COUNT(*) AS n FROM usuarios`);
        const [[totalInt]]  = await pool.query(`SELECT COUNT(*) AS n FROM interacciones`);
        const [[sentProm]]  = await pool.query(`SELECT ROUND(AVG(sentimiento),3) AS v FROM interacciones`);
        const [[reacProm]]  = await pool.query(`SELECT ROUND(AVG(reacciones_recibidas),2) AS v FROM interacciones`);

        return res.json({ ok: true, data: {
            total_usuarios  : totalUsr.n,
            activos         : activos.n,
            en_riesgo       : enRiesgo.n,
            inactivos       : inactivos.n,
            total_interacciones : totalInt.n,
            sentimiento_promedio: sentProm.v,
            reacciones_promedio : reacProm.v,
        }});
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/** GET /api/stats/por-canal */
router.get('/stats/por-canal', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT canal,
                   COUNT(*) AS total,
                   ROUND(AVG(sentimiento),3) AS sentimiento_promedio,
                   ROUND(AVG(reacciones_recibidas),2) AS reacciones_promedio
            FROM interacciones GROUP BY canal ORDER BY total DESC`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

/** GET /api/stats/por-tema */
router.get('/stats/por-tema', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT tema, COUNT(*) AS total,
                   ROUND(AVG(sentimiento),3) AS sentimiento_promedio,
                   SUM(reacciones_recibidas) AS total_reacciones
            FROM interacciones WHERE tema IS NOT NULL
            GROUP BY tema ORDER BY total DESC LIMIT 15`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

/** GET /api/stats/por-estatus */
router.get('/stats/por-estatus', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT estatus, COUNT(*) AS total,
                   ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),2) AS pct
            FROM usuarios GROUP BY estatus ORDER BY total DESC`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

/** GET /api/stats/temporal */
router.get('/stats/temporal', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT YEARWEEK(fecha_hora,1) AS semana,
                   MIN(DATE(fecha_hora)) AS inicio_semana,
                   COUNT(*) AS total,
                   ROUND(AVG(sentimiento),3) AS sentimiento_promedio
            FROM interacciones GROUP BY semana ORDER BY semana`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

/** GET /api/stats/por-edad */
router.get('/stats/por-edad', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT u.rango_edad,
                   COUNT(DISTINCT u.id_usuario) AS total_usuarios,
                   COUNT(i.id_interaccion) AS total_interacciones,
                   ROUND(AVG(u.sentimiento_promedio),3) AS sent_usuarios
            FROM usuarios u
            LEFT JOIN interacciones i USING(id_usuario)
            GROUP BY u.rango_edad ORDER BY u.rango_edad`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

/** GET /api/stats/etiquetas */
router.get('/stats/etiquetas', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.nombre AS etiqueta, COUNT(ie.id_interaccion) AS frecuencia
            FROM etiquetas e JOIN interaccion_etiqueta ie USING(id_etiqueta)
            GROUP BY e.nombre ORDER BY frecuencia DESC`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

/** GET /api/stats/top-usuarios */
router.get('/stats/top-usuarios', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT u.id_usuario, u.alias, u.estatus,
                   COUNT(i.id_interaccion) AS total_interacciones,
                   ROUND(AVG(i.sentimiento),3) AS sentimiento_promedio
            FROM usuarios u JOIN interacciones i USING(id_usuario)
            GROUP BY u.id_usuario, u.alias, u.estatus
            ORDER BY total_interacciones DESC LIMIT 10`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

/** GET /api/stats/mapa-calor — interacciones por día de semana y hora */
router.get('/stats/mapa-calor', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT DAYOFWEEK(fecha_hora)-1 AS dia_semana,
                   HOUR(fecha_hora)        AS hora,
                   COUNT(*)               AS total
            FROM interacciones
            GROUP BY dia_semana, hora
            ORDER BY dia_semana, hora`);
        return res.json({ ok: true, data: rows });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
