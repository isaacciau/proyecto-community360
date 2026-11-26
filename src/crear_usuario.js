/**
 * crear_usuario.js — Crea o actualiza una cuenta con acceso al dashboard.
 *
 * Uso (en PowerShell usa comillas SIMPLES para que el $ de la contraseña no se altere):
 *   node src/crear_usuario.js 'correo@dominio.com' 'contraseña' 'rol'
 *
 * Si el correo ya existe, actualiza su contraseña y lo deja activo.
 * La contraseña se guarda cifrada con bcrypt (costo 12), nunca en texto plano.
 */
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const pool   = require('./db/pool');

async function main() {
    const [correo, password, rol = 'docente'] = process.argv.slice(2);
    if (!correo || !password || !correo.includes('@')) {
        console.log("Uso: node src/crear_usuario.js 'correo@dominio.com' 'contraseña' 'rol'");
        process.exit(1);
    }

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
        `INSERT INTO admin_usuarios (correo, password_hash, rol, activo, fecha_creacion)
         VALUES (?, ?, ?, 1, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), rol = VALUES(rol), activo = 1`,
        [correo.trim().toLowerCase(), hash, rol]
    );

    // Comprobación: la contraseña guardada coincide con la escrita
    const [[u]] = await pool.query('SELECT password_hash FROM admin_usuarios WHERE correo = ?', [correo.trim().toLowerCase()]);
    const ok = await bcrypt.compare(password, u.password_hash);
    console.log(`\n✓ Cuenta lista: ${correo.trim().toLowerCase()} (rol: ${rol})`);
    console.log(`  Usuario para entrar sin correo: ${correo.split('@')[0].toLowerCase()}`);
    console.log(`  Verificación de contraseña: ${ok ? 'correcta' : 'NO COINCIDE'}`);
    console.log(`  Largo de la contraseña recibida: ${password.length} caracteres\n`);

    const [todos] = await pool.query('SELECT id_admin, correo, rol, activo FROM admin_usuarios ORDER BY id_admin');
    console.table(todos);
    await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
