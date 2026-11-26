/**
 * COMMUNITY 360 — Fase 4: Análisis SQL
 * Ejecuta 10 consultas analíticas contra TiDB Cloud y guarda los
 * resultados en data/reportes/reporte_analisis.json
 *
 * Uso: node src/analisis.js
 */
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

const REPORTES = path.join(__dirname, '..', 'data', 'reportes');

async function main() {
    console.log('\n=== COMMUNITY 360 — Fase 4: Análisis SQL ===\n');

    const db = await mysql.createConnection({
        host    : process.env.DB_HOST,
        port    : Number(process.env.DB_PORT) || 4000,
        user    : process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        ssl     : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        enableKeepAlive: true,
    });

    fs.mkdirSync(REPORTES, { recursive: true });

    const consultas = [
        // ── 1. Distribución de usuarios por estatus ──────────────────────
        {
            id: 'Q1',
            titulo: 'Distribución de usuarios por estatus',
            sql: `
                SELECT estatus,
                       COUNT(*)                                     AS total,
                       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS pct
                FROM usuarios
                GROUP BY estatus
                ORDER BY total DESC`,
        },
        // ── 2. Actividad por canal ────────────────────────────────────────
        {
            id: 'Q2',
            titulo: 'Interacciones por canal (volumen y sentimiento promedio)',
            sql: `
                SELECT canal,
                       COUNT(*)                       AS total_interacciones,
                       ROUND(AVG(sentimiento), 3)     AS sentimiento_promedio,
                       ROUND(AVG(reacciones_recibidas), 2) AS reacciones_promedio
                FROM interacciones
                GROUP BY canal
                ORDER BY total_interacciones DESC`,
        },
        // ── 3. Usuarios más activos (top 10) ─────────────────────────────
        {
            id: 'Q3',
            titulo: 'Top 10 usuarios más activos (interacciones en BD)',
            sql: `
                SELECT u.id_usuario, u.alias, u.estatus,
                       COUNT(i.id_interaccion)   AS total_interacciones,
                       ROUND(AVG(i.sentimiento),3) AS sentimiento_promedio
                FROM usuarios u
                JOIN interacciones i USING(id_usuario)
                GROUP BY u.id_usuario, u.alias, u.estatus
                ORDER BY total_interacciones DESC
                LIMIT 10`,
        },
        // ── 4. Interacciones por tipo ─────────────────────────────────────
        {
            id: 'Q4',
            titulo: 'Distribución de interacciones por tipo',
            sql: `
                SELECT tipo,
                       COUNT(*)                                           AS total,
                       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS pct,
                       ROUND(AVG(sentimiento), 3)                         AS sentimiento_promedio
                FROM interacciones
                GROUP BY tipo
                ORDER BY total DESC`,
        },
        // ── 5. Temas más populares ────────────────────────────────────────
        {
            id: 'Q5',
            titulo: 'Top 10 temas por número de interacciones',
            sql: `
                SELECT tema,
                       COUNT(*)                       AS total,
                       ROUND(AVG(sentimiento), 3)     AS sentimiento_promedio,
                       SUM(reacciones_recibidas)      AS total_reacciones
                FROM interacciones
                WHERE tema IS NOT NULL
                GROUP BY tema
                ORDER BY total DESC
                LIMIT 10`,
        },
        // ── 6. Sentimiento por rango de edad ──────────────────────────────
        {
            id: 'Q6',
            titulo: 'Sentimiento promedio e interacciones por rango de edad',
            sql: `
                SELECT u.rango_edad,
                       COUNT(DISTINCT u.id_usuario)       AS total_usuarios,
                       COUNT(i.id_interaccion)            AS total_interacciones,
                       ROUND(AVG(u.sentimiento_promedio), 3) AS sent_usuarios,
                       ROUND(AVG(i.sentimiento), 3)       AS sent_interacciones
                FROM usuarios u
                LEFT JOIN interacciones i USING(id_usuario)
                GROUP BY u.rango_edad
                ORDER BY u.rango_edad`,
        },
        // ── 7. Artistas vs no artistas ────────────────────────────────────
        {
            id: 'Q7',
            titulo: 'Comparativa artistas vs no artistas',
            sql: `
                SELECT CASE WHEN es_artista = 1 THEN 'Artista' ELSE 'No artista' END AS perfil,
                       COUNT(*)                               AS total_usuarios,
                       ROUND(AVG(mensajes_30d), 1)           AS mensajes_30d_prom,
                       ROUND(AVG(reacciones_30d), 1)         AS reacciones_30d_prom,
                       ROUND(AVG(comisiones_compradas), 2)   AS comisiones_prom,
                       ROUND(AVG(sentimiento_promedio), 3)   AS sentimiento_prom
                FROM usuarios
                WHERE es_artista IS NOT NULL
                GROUP BY es_artista`,
        },
        // ── 8. Etiquetas más usadas ───────────────────────────────────────
        {
            id: 'Q8',
            titulo: 'Etiquetas más frecuentes en interacciones',
            sql: `
                SELECT e.nombre AS etiqueta,
                       COUNT(ie.id_interaccion) AS frecuencia
                FROM etiquetas e
                JOIN interaccion_etiqueta ie USING(id_etiqueta)
                GROUP BY e.nombre
                ORDER BY frecuencia DESC`,
        },
        // ── 9. Evolución temporal de interacciones (por semana) ───────────
        {
            id: 'Q9',
            titulo: 'Evolución semanal de interacciones y sentimiento',
            sql: `
                SELECT YEARWEEK(fecha_hora, 1)        AS semana,
                       MIN(DATE(fecha_hora))          AS inicio_semana,
                       COUNT(*)                       AS total_interacciones,
                       ROUND(AVG(sentimiento), 3)     AS sentimiento_promedio
                FROM interacciones
                GROUP BY semana
                ORDER BY semana`,
        },
        // ── 10. Usuarios en riesgo: análisis de retención ─────────────────
        {
            id: 'Q10',
            titulo: 'Usuarios en riesgo: perfil y última actividad',
            sql: `
                SELECT estatus,
                       rango_edad,
                       COUNT(*)                               AS total,
                       ROUND(AVG(mensajes_30d), 1)           AS mensajes_30d_prom,
                       ROUND(AVG(DATEDIFF(CURDATE(), ultima_actividad)), 0) AS dias_sin_actividad
                FROM usuarios
                WHERE estatus IN ('en_riesgo', 'inactivo')
                GROUP BY estatus, rango_edad
                ORDER BY estatus, dias_sin_actividad DESC`,
        },
    ];

    const resultados = {};

    for (const q of consultas) {
        process.stdout.write(`  [${q.id}] ${q.titulo} ... `);
        try {
            const [rows] = await db.query(q.sql);
            resultados[q.id] = { titulo: q.titulo, sql: q.sql.trim(), filas: rows };
            console.log(`${rows.length} fila(s)`);

            // Mostrar en consola como tabla si caben
            if (rows.length <= 20) console.table(rows);
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
            resultados[q.id] = { titulo: q.titulo, error: e.message };
        }
    }

    // Guardar JSON completo
    fs.writeFileSync(
        path.join(REPORTES, 'reporte_analisis.json'),
        JSON.stringify({ fecha: new Date().toISOString(), consultas: resultados }, null, 2),
        'utf8'
    );
    console.log('\n✓ Resultados guardados en data/reportes/reporte_analisis.json\n');

    await db.end();
}

main().catch(e => {
    console.error('\nError:', e.code || '', e.message);
    process.exit(1);
});
