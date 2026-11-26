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
 *   GET  /api/stats/detalle/:kpi    → detalle de cada tarjeta KPI
 *
 * HISTORIAL
 *   GET  /api/historial             → últimos cambios hechos con POST, PUT y DELETE
 */
const router      = require('express').Router();
const pool        = require('../db/pool');
const { verifyToken } = require('../auth/middleware');
const { emitirConStats } = require('../ws/handler');

// Todas las rutas de la API requieren autenticación
router.use(verifyToken);

// ═══════════════════════════════════════════════════════════
// HISTORIAL DE CAMBIOS
// Cada POST, PUT y DELETE de interacciones deja un registro con
// la acción, los datos afectados, quién lo hizo y cuándo (UTC).
// ═══════════════════════════════════════════════════════════
pool.query(`CREATE TABLE IF NOT EXISTS historial_cambios (
    id_cambio      INT NOT NULL AUTO_INCREMENT,
    accion         ENUM('crear','actualizar','eliminar') NOT NULL,
    id_interaccion VARCHAR(10) NOT NULL,
    id_usuario     VARCHAR(10) NULL,
    detalle        JSON NULL,
    realizado_por  VARCHAR(100) NOT NULL,
    fecha_cambio   DATETIME NOT NULL,
    PRIMARY KEY (id_cambio),
    INDEX idx_hist_fecha (fecha_cambio),
    INDEX idx_hist_inter (id_interaccion)
)`).catch(e => console.error('[historial] No se pudo crear la tabla:', e.message));

async function registrarHistorial(req, accion, id_interaccion, id_usuario, detalle) {
    try {
        await pool.query(
            `INSERT INTO historial_cambios
             (accion, id_interaccion, id_usuario, detalle, realizado_por, fecha_cambio)
             VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
            [accion, id_interaccion, id_usuario || null, JSON.stringify(detalle || {}),
             (req.user && req.user.correo) || 'desconocido']
        );
    } catch (e) {
        // El historial nunca debe impedir que la operación principal responda
        console.error('[historial]', e.message);
    }
}

// Compara el registro antes y después de un PUT y devuelve solo lo que cambió
function camposCambiados(antes, despues, campos) {
    const cambios = {};
    for (const c of campos) {
        const a = antes[c] === undefined ? null : antes[c];
        const d = despues[c] === undefined ? null : despues[c];
        const iguales = (a !== null && d !== null && !isNaN(a) && !isNaN(d) && String(a).trim() !== '' && String(d).trim() !== '')
            ? Number(a) === Number(d)
            : String(a) === String(d);
        if (!iguales) cambios[c] = { antes: a, despues: d };
    }
    return cambios;
}

/** GET /api/historial?limit=30&accion=crear|actualizar|eliminar */
router.get('/historial', async (req, res) => {
    try {
        const limit = Math.min(toInt(req.query.limit, 30), 100);
        const params = [];
        let where = '';
        if (['crear','actualizar','eliminar'].includes(req.query.accion)) {
            where = 'WHERE accion = ?';
            params.push(req.query.accion);
        }
        const [rows] = await pool.query(
            `SELECT id_cambio, accion, id_interaccion, id_usuario, detalle, realizado_por, fecha_cambio
             FROM historial_cambios ${where} ORDER BY id_cambio DESC LIMIT ?`, [...params, limit]);
        rows.forEach(r => {
            if (typeof r.detalle === 'string') { try { r.detalle = JSON.parse(r.detalle); } catch { r.detalle = {}; } }
        });
        return res.json({ ok: true, data: rows });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

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
        const n = rows[0];
        await registrarHistorial(req, 'crear', n.id_interaccion, n.id_usuario, {
            canal: n.canal, tipo: n.tipo, tema: n.tema, sentimiento: n.sentimiento, dispositivo: n.dispositivo,
        });
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
        const [exist] = await pool.query('SELECT * FROM interacciones WHERE id_interaccion = ?', [id]);
        if (!exist.length) return res.status(404).json({ ok: false, error: 'Interacción no encontrada' });
        const antes = exist[0];

        const setCols = Object.keys(updates).map(c => `${c} = ?`).join(', ');
        await pool.query(`UPDATE interacciones SET ${setCols} WHERE id_interaccion = ?`,
            [...Object.values(updates), id]);

        const [rows] = await pool.query('SELECT * FROM interacciones WHERE id_interaccion = ?', [id]);
        await registrarHistorial(req, 'actualizar', id, rows[0].id_usuario,
            camposCambiados(antes, rows[0], Object.keys(updates)));
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
        const [exist] = await pool.query('SELECT * FROM interacciones WHERE id_interaccion = ?', [id]);
        if (!exist.length) return res.status(404).json({ ok: false, error: 'Interacción no encontrada' });
        const borrada = exist[0];

        await pool.query('DELETE FROM interacciones WHERE id_interaccion = ?', [id]);
        await registrarHistorial(req, 'eliminar', id, borrada.id_usuario, {
            canal: borrada.canal, tipo: borrada.tipo, tema: borrada.tema, sentimiento: borrada.sentimiento,
        });
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

/**
 * GET /api/stats/detalle/:kpi — detalle de cada tarjeta KPI del dashboard
 * kpi: activo | en_riesgo | inactivo | interacciones | sentimiento | reacciones
 * Devuelve { resumen: [{etiqueta, valor}], grafica: {titulo, tipo, etiquetas, valores}, lista: [...] }
 */
router.get('/stats/detalle/:kpi', async (req, res) => {
    const kpi = req.params.kpi;
    try {
        // ── Usuarios por estatus ──
        if (['activo', 'en_riesgo', 'inactivo'].includes(kpi)) {
            const [[r]] = await pool.query(
                `SELECT COUNT(*) AS total,
                        ROUND(COUNT(*) * 100 / (SELECT COUNT(*) FROM usuarios), 1) AS porcentaje,
                        ROUND(AVG(mensajes_30d), 1)        AS mensajes,
                        ROUND(AVG(sentimiento_promedio), 3) AS sentimiento,
                        SUM(es_artista)                     AS artistas
                 FROM usuarios WHERE estatus = ?`, [kpi]);
            const [graf] = await pool.query(
                `SELECT plataforma_principal AS etiqueta, COUNT(*) AS valor
                 FROM usuarios WHERE estatus = ?
                 GROUP BY plataforma_principal ORDER BY valor DESC`, [kpi]);
            const [lista] = await pool.query(
                `SELECT id_usuario, alias, rango_edad, plataforma_principal, interes_principal,
                        mensajes_30d, sentimiento_promedio, ultima_actividad, pais
                 FROM usuarios WHERE estatus = ?
                 ORDER BY mensajes_30d DESC, alias`, [kpi]);
            return res.json({ ok: true, data: {
                resumen: [
                    { etiqueta: 'Usuarios',              valor: r.total },
                    { etiqueta: '% del padrón',          valor: `${r.porcentaje}%` },
                    { etiqueta: 'Mensajes prom. (30 d)', valor: r.mensajes },
                    { etiqueta: 'Artistas',              valor: r.artistas },
                ],
                grafica: { titulo: 'Plataforma principal', tipo: 'bar',
                           etiquetas: graf.map(g => g.etiqueta), valores: graf.map(g => g.valor) },
                lista,
            }});
        }

        // ── Interacciones ──
        if (kpi === 'interacciones') {
            const [[r]] = await pool.query(
                `SELECT COUNT(*) AS total, COUNT(DISTINCT id_usuario) AS usuarios,
                        COUNT(DISTINCT canal) AS canales, ROUND(AVG(longitud_texto), 0) AS longitud
                 FROM interacciones`);
            const [graf] = await pool.query(
                `SELECT tipo AS etiqueta, COUNT(*) AS valor FROM interacciones
                 GROUP BY tipo ORDER BY valor DESC`);
            const [lista] = await pool.query(
                `SELECT i.id_interaccion, i.fecha_hora, u.alias, i.canal, i.tipo, i.tema, i.sentimiento
                 FROM interacciones i JOIN usuarios u USING (id_usuario)
                 ORDER BY i.fecha_hora DESC LIMIT 50`);
            return res.json({ ok: true, data: {
                resumen: [
                    { etiqueta: 'Interacciones',       valor: r.total },
                    { etiqueta: 'Usuarios que participan', valor: r.usuarios },
                    { etiqueta: 'Canales usados',      valor: r.canales },
                    { etiqueta: 'Largo prom. del texto', valor: `${r.longitud || 0} car.` },
                ],
                grafica: { titulo: 'Interacciones por tipo', tipo: 'doughnut',
                           etiquetas: graf.map(g => g.etiqueta), valores: graf.map(g => g.valor) },
                lista,
            }});
        }

        // ── Sentimiento ──
        if (kpi === 'sentimiento') {
            const [[r]] = await pool.query(
                `SELECT ROUND(AVG(sentimiento), 3) AS promedio,
                        SUM(sentimiento >  0.2) AS positivas,
                        SUM(sentimiento BETWEEN -0.2 AND 0.2) AS neutras,
                        SUM(sentimiento < -0.2) AS negativas
                 FROM interacciones`);
            const [graf] = await pool.query(
                `SELECT CASE
                          WHEN sentimiento < -0.6 THEN 1 WHEN sentimiento < -0.2 THEN 2
                          WHEN sentimiento <= 0.2 THEN 3 WHEN sentimiento <= 0.6 THEN 4 ELSE 5 END AS rango,
                        COUNT(*) AS valor
                 FROM interacciones GROUP BY rango ORDER BY rango`);
            const nombres = ['Muy negativo', 'Negativo', 'Neutral', 'Positivo', 'Muy positivo'];
            const valores = nombres.map((_, i) => Number((graf.find(g => Number(g.rango) === i + 1) || {}).valor || 0));
            const consulta = (orden) => pool.query(
                `SELECT i.id_interaccion, u.alias, i.canal, i.tema, i.sentimiento, i.texto
                 FROM interacciones i JOIN usuarios u USING (id_usuario)
                 ORDER BY i.sentimiento ${orden}, i.id_interaccion LIMIT 5`);
            const [[mejores], [peores]] = await Promise.all([consulta('DESC'), consulta('ASC')]);
            return res.json({ ok: true, data: {
                resumen: [
                    { etiqueta: 'Promedio',             valor: r.promedio },
                    { etiqueta: 'Positivas (> 0.2)',    valor: r.positivas },
                    { etiqueta: 'Neutras',              valor: r.neutras },
                    { etiqueta: 'Negativas (< −0.2)',   valor: r.negativas },
                ],
                grafica: { titulo: 'Distribución del sentimiento', tipo: 'bar', etiquetas: nombres, valores },
                lista: [...mejores, ...peores],
            }});
        }

        // ── Reacciones ──
        if (kpi === 'reacciones') {
            const [[r]] = await pool.query(
                `SELECT ROUND(AVG(reacciones_recibidas), 2) AS promedio, MAX(reacciones_recibidas) AS maximo,
                        SUM(reacciones_recibidas) AS total,
                        ROUND(SUM(reacciones_recibidas = 0) * 100 / COUNT(*), 1) AS sin_reaccion
                 FROM interacciones`);
            const [graf] = await pool.query(
                `SELECT canal AS etiqueta, ROUND(AVG(reacciones_recibidas), 2) AS valor
                 FROM interacciones GROUP BY canal ORDER BY valor DESC`);
            const [lista] = await pool.query(
                `SELECT i.id_interaccion, u.alias, i.canal, i.tipo, i.tema, i.reacciones_recibidas
                 FROM interacciones i JOIN usuarios u USING (id_usuario)
                 ORDER BY i.reacciones_recibidas DESC, i.id_interaccion LIMIT 10`);
            return res.json({ ok: true, data: {
                resumen: [
                    { etiqueta: 'Promedio',         valor: r.promedio },
                    { etiqueta: 'Máximo',           valor: r.maximo },
                    { etiqueta: 'Total recibidas',  valor: r.total },
                    { etiqueta: 'Sin reacciones',   valor: `${r.sin_reaccion}%` },
                ],
                grafica: { titulo: 'Reacciones promedio por canal', tipo: 'bar',
                           etiquetas: graf.map(g => g.etiqueta), valores: graf.map(g => Number(g.valor)) },
                lista,
            }});
        }

        return res.status(404).json({ ok: false, error: 'Indicador no encontrado' });
    } catch (e) {
        console.error('[GET /stats/detalle]', e.message);
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
