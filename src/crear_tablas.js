/**
 * COMMUNITY 360 — Fase 3
 * Crea (o valida) el esquema en TiDB Cloud.
 * Uso: node src/crear_tablas.js
 */
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

async function main() {
    console.log('\n=== COMMUNITY 360 — Creación de esquema en la nube ===\n');

    const db = await mysql.createConnection({
        host    : process.env.DB_HOST,
        port    : Number(process.env.DB_PORT) || 4000,
        user    : process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        ssl     : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        multipleStatements: true,
        enableKeepAlive: true,
    });

    console.log(`Conectado a: ${process.env.DB_HOST}/${process.env.DB_NAME}\n`);

    // Leer el DDL
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    // Separar en sentencias individuales (ignorar comentarios y vacíos)
    const sentencias = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    const tablas = ['bitacora_etl', 'usuarios', 'interacciones', 'etiquetas',
                    'interaccion_etiqueta', 'cuarentena_interacciones'];

    // Ejecutar cada sentencia
    for (const stmt of sentencias) {
        const nombre = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)?.[1]
                    || stmt.match(/USE (\w+)/i)?.[1]
                    || 'índice/otro';
        process.stdout.write(`  → Ejecutando: ${nombre.padEnd(30, '.')} `);
        try {
            await db.query(stmt);
            console.log('OK');
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
            await db.end();
            process.exit(1);
        }
    }

    // Verificar que todas las tablas existen
    console.log('\n--- Verificación de tablas ---');
    for (const t of tablas) {
        const [rows] = await db.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [process.env.DB_NAME, t]
        );
        const existe = rows.length > 0 ? '✓ existe' : '✗ NO ENCONTRADA';
        console.log(`  ${t.padEnd(30)} ${existe}`);
    }

    // Mostrar resumen de columnas de cada tabla
    console.log('\n--- Columnas por tabla ---');
    for (const t of tablas) {
        const [cols] = await db.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION`,
            [process.env.DB_NAME, t]
        );
        console.log(`\n  ${t} (${cols.length} columnas):`);
        for (const c of cols) {
            const pk  = c.COLUMN_KEY === 'PRI' ? ' [PK]' : '';
            const mul = c.COLUMN_KEY === 'MUL' ? ' [IDX]' : '';
            const uni = c.COLUMN_KEY === 'UNI' ? ' [UNI]' : '';
            console.log(`    ${c.COLUMN_NAME.padEnd(28)} ${c.COLUMN_TYPE.padEnd(35)} NULL:${c.IS_NULLABLE}${pk}${mul}${uni}`);
        }
    }

    // Mostrar foreign keys
    console.log('\n--- Claves foráneas ---');
    const [fks] = await db.query(
        `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME,
                REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ?
           AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY TABLE_NAME`,
        [process.env.DB_NAME]
    );
    for (const fk of fks) {
        console.log(`  ${fk.TABLE_NAME}.${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}  (${fk.CONSTRAINT_NAME})`);
    }

    await db.end();
    console.log('\n✓ Esquema listo. Ahora ejecuta:\n  node src/etl.js --load\n');
}

main().catch(e => {
    console.error('\nError:', e.code || '', e.message);
    process.exit(1);
});
