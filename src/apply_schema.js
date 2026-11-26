/**
 * apply_schema.js
 * Fase 3 – Community 360
 * Conecta a TiDB Cloud y aplica el esquema DDL (schema.sql).
 * Uso: node src/apply_schema.js
 */
require('dotenv').config({ quiet: true });
const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    // Dividir en sentencias individuales (ignorar comentarios y líneas vacías)
    const sentencias = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`\n=== Conectando a TiDB Cloud ===`);
    console.log(`  Host : ${process.env.DB_HOST}`);
    console.log(`  BD   : ${process.env.DB_NAME}`);

    const db = await mysql.createConnection({
        host    : process.env.DB_HOST,
        port    : Number(process.env.DB_PORT) || 4000,
        user    : process.env.DB_USER,
        password: process.env.DB_PASS,
        // Sin especificar database para poder crear la BD si no existe
        ssl     : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        multipleStatements: false,
    });

    console.log('\n=== Aplicando DDL ===');
    for (const stmt of sentencias) {
        const resumen = stmt.replace(/\s+/g, ' ').slice(0, 80);
        try {
            await db.query(stmt);
            console.log(`  ✔  ${resumen}`);
        } catch (e) {
            // ER_TABLE_EXISTS_ERROR (1050) → la tabla ya existe, se ignora
            if (e.errno === 1050 || e.message.includes('already exists')) {
                console.log(`  ⚠  Ya existe (se omite): ${resumen}`);
            } else {
                console.error(`  ✘  Error en: ${resumen}`);
                await db.end();
                throw e;
            }
        }
    }

    console.log('\n=== Verificando tablas creadas ===');
    const [tablas] = await db.query(
        `SELECT TABLE_NAME, TABLE_ROWS
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME`,
        [process.env.DB_NAME]
    );
    console.table(tablas);

    await db.end();
    console.log('\n✅ Esquema aplicado correctamente.\n');
    console.log('   Siguiente paso: node src/etl.js --load');
}

main().catch(e => {
    console.error('\n❌ Error al aplicar esquema:', e.code || '', e.message);
    process.exit(1);
});
