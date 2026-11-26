/**
 * setup_auth.js — Crea la tabla admin_usuarios y el usuario administrador inicial.
 * Uso: node src/setup_auth.js
 */
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const pool   = require('./db/pool');
const fs     = require('fs');
const path   = require('path');

async function main() {
    console.log('\n=== Setup de autenticación — Community 360 ===\n');

    // 1. Verificar / crear tabla admin_usuarios
    const ddl = fs.readFileSync(path.join(__dirname, 'schema_auth.sql'), 'utf8');
    const sentencias = ddl
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--') && !/^USE\s+/i.test(s));

    for (const stmt of sentencias) {
        await pool.query(stmt);
        console.log('✓ Tabla admin_usuarios creada / verificada');
    }

    // 2. Verificar si ya existe el admin
    // Las credenciales del administrador se leen SOLO del archivo .env
    const adminEmail = process.env.ADMIN_EMAIL;
    const rawPass    = process.env.ADMIN_PASS;
    if (!adminEmail || !rawPass) {
        throw new Error('Faltan ADMIN_EMAIL o ADMIN_PASS en el archivo .env');
    }

    const [rows] = await pool.query('SELECT id_admin FROM admin_usuarios WHERE correo = ?', [adminEmail]);
    if (rows.length > 0) {
        console.log(`ℹ  El usuario "${adminEmail}" ya existe. No se sobreescribe.`);
    } else {
        // Hashear contraseña con bcrypt (cost factor 12)
        const hash = await bcrypt.hash(rawPass, 12);
        await pool.query(
            'INSERT INTO admin_usuarios (correo, password_hash, rol, activo, fecha_creacion) VALUES (?, ?, ?, 1, NOW())',
            [adminEmail, hash, 'admin']
        );
        console.log(`✓ Usuario "${adminEmail}" creado con rol "admin"`);
    }

    // 3. Mostrar administradores registrados (sin exponer hash)
    const [admins] = await pool.query('SELECT id_admin, correo, rol, activo, fecha_creacion FROM admin_usuarios');
    console.log('\n--- Administradores registrados ---');
    console.table(admins);

    await pool.end();
    console.log('\n✓ Setup completo.\n');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
