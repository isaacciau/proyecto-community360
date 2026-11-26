require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const CLEAN = path.join(__dirname, '..', 'data', 'clean');
const LOGS = path.join(__dirname, '..', 'logs');
const ARCH_USUARIOS = 'comunidad_virtual_usuarios.csv';
const ARCH_INTER = 'comunidad_virtual_1000_interacciones.csv';

// Catálogos permitidos
const ESTATUS = ['activo', 'en_riesgo', 'inactivo'];
const RANGOS = ['18-24', '25-31', '32-38', '39+'];
const TIPOS = ['mensaje', 'comentario', 'reaccion', 'respuesta_encuesta', 'rsvp_evento'];
const CANALES = ['Discord', 'Facebook', 'Instagram', 'Telegram', 'TikTok', 'Twitter/X'];
const DISPOSITIVOS = ['Android', 'Escritorio', 'Web', 'iOS'];
const COLS_GEO = ['pais', 'estado', 'ciudad', 'latitud', 'longitud', 'zona_horaria'];

// ---------- utilidades ----------
const NULOS = new Set(['', 'null', 'none', 'nan', 'n/a', 'na', '-']);
const aNulo = (v) => {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return NULOS.has(t.toLowerCase()) ? null : t;
};
const sinAcentos = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const canonico = (v, lista) => {
    if (v === null) return null;
    const clave = sinAcentos(v).toLowerCase();
    return lista.find((x) => sinAcentos(x).toLowerCase() === clave) ?? v;
};
const esEntero = (s) => s !== null && /^-?\d+$/.test(s);
const esDecimal = (s) => s !== null && /^-?\d+(\.\d+)?$/.test(s);

function fechaISO(s) {
    if (s === null) return null;
    let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    let y, mes, d;
    if (m) [, d, mes, y] = m;
    else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [, y, mes, d] = m;
    else return null;
    const dt = new Date(Date.UTC(+y, +mes - 1, +d));
    const ok = dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mes - 1 && dt.getUTCDate() === +d;
    return ok ? `${y}-${mes}-${d}` : null;
}
function fechaHoraUTC(s) {
    if (s === null) return null;
    const conZona = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
    const dt = new Date(conZona);
    return isNaN(dt) ? null : dt.toISOString().slice(0, 19).replace('T', ' ');
}
function leerCsv(nombre) {
    return parse(fs.readFileSync(path.join(RAW, nombre)), {
        columns: true, bom: true, skip_empty_lines: true,
    });
}
function escribirCsv(nombre, columnas, filas) {
    const esc = (v) => {
        if (v === null || v === undefined) return '';
        const t = String(v);
        return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lineas = [columnas.join(',')].concat(filas.map((f) => columnas.map((c) => esc(f[c])).join(',')));
    fs.writeFileSync(path.join(CLEAN, nombre), '\uFEFF' + lineas.join('\n') + '\n', 'utf8');
}
const titulo = (t) => console.log(`\n=== ${t} ===`);

// ---------- ETAPAS 1 a 3 (usuarios) ----------
function depurarUsuarios(crudos) {
    const stat = { recibidos: crudos.length, duplicados_id: 0, duplicados_alias: 0, nulos_normalizados: {}, fechas_estandarizadas: 0 };
    const vistos = new Set(), alias = new Set(), filas = [], transformados = new Set();

    for (const crudo of crudos) {
        // Etapa 2: normalizar vacíos y nulos
        const f = {};
        for (const [col, val] of Object.entries(crudo)) {
            f[col] = aNulo(val);
            if (f[col] === null) {
                stat.nulos_normalizados[col] = (stat.nulos_normalizados[col] || 0) + 1;
                transformados.add(crudo.id_usuario);
            }
        }
        // Etapa 1: duplicados por id_usuario y por alias
        f.id_usuario = f.id_usuario ? f.id_usuario.toUpperCase() : null;
        if (f.id_usuario && vistos.has(f.id_usuario)) { stat.duplicados_id++; continue; }
        const claveAlias = f.alias ? f.alias.toLowerCase() : null;
        if (claveAlias && alias.has(claveAlias)) { stat.duplicados_alias++; continue; }
        if (f.id_usuario) vistos.add(f.id_usuario);
        if (claveAlias) alias.add(claveAlias);

        // Etapa 3: estandarizar fechas, categorías y formatos
        const f1 = f.fecha_ingreso, f2 = f.ultima_actividad;
        f.fecha_ingreso = fechaISO(f.fecha_ingreso) ?? f1;
        f.ultima_actividad = fechaISO(f.ultima_actividad) ?? f2;
        if (f.fecha_ingreso !== f1 || f.ultima_actividad !== f2) stat.fechas_estandarizadas++;
        f.estatus = f.estatus ? sinAcentos(f.estatus).toLowerCase().replace(/\s+/g, '_') : null;
        f.consentimiento_datos = f.consentimiento_datos ? sinAcentos(f.consentimiento_datos).toLowerCase() : null;
        f.es_artista = f.es_artista === null ? null : ['1', 'true', 'si'].includes(f.es_artista.toLowerCase()) ? '1'
            : ['0', 'false', 'no'].includes(f.es_artista.toLowerCase()) ? '0' : f.es_artista;
        filas.push(f);
    }
    return { filas, stat, transformados };
}

// ---------- ETAPA 4 (usuarios): validar tipos ----------
function validarUsuario(f) {
    const e = [];
    if (!/^U\d{6}$/.test(f.id_usuario ?? '')) e.push('id_usuario con formato inválido');
    if (!f.alias) e.push('alias vacío');
    if (!f.fecha_ingreso || !fechaISO(f.fecha_ingreso)) e.push('fecha_ingreso inválida');
    if (!f.ultima_actividad || !fechaISO(f.ultima_actividad)) e.push('ultima_actividad inválida');
    for (const c of ['mensajes_30d', 'reacciones_30d', 'eventos_asistidos', 'comisiones_compradas'])
        if (!esEntero(f[c]) || +f[c] < 0) e.push(`${c} no es entero >= 0`);
    if (!['0', '1'].includes(f.es_artista)) e.push('es_artista no es booleano');
    if (!esDecimal(f.sentimiento_promedio) || Math.abs(+f.sentimiento_promedio) > 1) e.push('sentimiento_promedio fuera de [-1,1]');
    if (f.latitud !== null && (!esDecimal(f.latitud) || Math.abs(+f.latitud) > 90)) e.push('latitud inválida');
    if (f.longitud !== null && (!esDecimal(f.longitud) || Math.abs(+f.longitud) > 180)) e.push('longitud inválida');
    if (!ESTATUS.includes(f.estatus)) e.push('estatus fuera de catálogo');
    if (!['si', 'no'].includes(f.consentimiento_datos)) e.push('consentimiento_datos inválido');
    if (!RANGOS.includes(f.rango_edad)) e.push('rango_edad fuera de catálogo');
    return e;
}

// ---------- ETAPA 6: privacidad ----------
function aplicarPrivacidad(usuarios, transformados) {
    const r = { usuarios_sin_consentimiento: 0, valores_geograficos_borrados: 0 };
    for (const u of usuarios) {
        if (u.consentimiento_datos !== 'no') continue;
        r.usuarios_sin_consentimiento++;
        for (const c of COLS_GEO) {
            if (u[c] !== null) { r.valores_geograficos_borrados++; u[c] = null; transformados.add(u.id_usuario); }
        }
    }
    return r;
}

// ---------- ETAPAS 1 a 3 (interacciones) ----------
function depurarInteracciones(crudos) {
    const stat = { recibidos: crudos.length, duplicados_id: 0, nulos_normalizados: {}, timestamps_estandarizados: 0, longitud_recalculada: 0 };
    const vistos = new Set(), filas = [], transformados = new Set();

    for (const crudo of crudos) {
        const f = {};
        for (const [col, val] of Object.entries(crudo)) {
            f[col] = aNulo(val);
            if (f[col] === null) {
                stat.nulos_normalizados[col] = (stat.nulos_normalizados[col] || 0) + 1;
                transformados.add(crudo.id_interaccion);
            }
        }
        f.id_interaccion = f.id_interaccion ? f.id_interaccion.toUpperCase() : null;
        if (f.id_interaccion && vistos.has(f.id_interaccion)) { stat.duplicados_id++; continue; }
        if (f.id_interaccion) vistos.add(f.id_interaccion);
        f.id_usuario = f.id_usuario ? f.id_usuario.toUpperCase() : null;
        f._original = { ...crudo }; // para la cuarentena

        f.fecha_hora = fechaHoraUTC(f.timestamp);
        if (f.fecha_hora !== null) stat.timestamps_estandarizados++;
        f.tipo = f.tipo ? sinAcentos(f.tipo).toLowerCase().replace(/\s+/g, '_') : null;
        f.canal = canonico(f.canal, CANALES);
        f.dispositivo = canonico(f.dispositivo, DISPOSITIVOS);
        f.idioma = f.idioma ? f.idioma.toLowerCase() : null;
        f.tema = f.tema ? sinAcentos(f.tema).toLowerCase() : null;
        // campo multivaluado: etiquetas separadas por "|"
        f.lista_etiquetas = f.etiquetas
            ? [...new Set(f.etiquetas.split('|').map((x) => sinAcentos(x.trim()).toLowerCase()).filter(Boolean))].sort()
            : [];
        // longitud_texto debe coincidir con el texto real
        const real = f.texto ? f.texto.length : 0;
        if (f.longitud_texto !== String(real)) { stat.longitud_recalculada++; transformados.add(f.id_interaccion); }
        f.longitud_texto = String(real);
        filas.push(f);
    }
    return { filas, stat, transformados };
}

// ---------- ETAPA 4 (interacciones): validar tipos ----------
function validarInteraccion(f) {
    const e = [];
    if (!/^I\d+$/.test(f.id_interaccion ?? '')) e.push('id_interaccion con formato inválido');
    if (!/^U\d{6}$/.test(f.id_usuario ?? '')) e.push('id_usuario con formato inválido');
    if (!f.fecha_hora) e.push('timestamp inválido');
    if (!TIPOS.includes(f.tipo)) e.push('tipo fuera de catálogo');
    if (!CANALES.includes(f.canal)) e.push('canal fuera de catálogo');
    if (!DISPOSITIVOS.includes(f.dispositivo)) e.push('dispositivo fuera de catálogo');
    if (f.idioma !== 'es') e.push('idioma inesperado');
    if (!f.tema) e.push('tema vacío');
    if (!esDecimal(f.sentimiento) || Math.abs(+f.sentimiento) > 1) e.push('sentimiento fuera de [-1,1]');
    if (!esEntero(f.reacciones_recibidas) || +f.reacciones_recibidas < 0) e.push('reacciones_recibidas no es entero >= 0');
    return e;
}

// ---------- ETAPA 8: carga a TiDB ----------
async function insertar(db, tabla, columnas, filas, lote = 200) {
    for (let i = 0; i < filas.length; i += lote) {
        const trozo = filas.slice(i, i + lote).map((f) => columnas.map((c) => f[c] ?? null));
        await db.query(`INSERT INTO ${tabla} (${columnas.join(',')}) VALUES ?`, [trozo]);
    }
}
async function cargar(usuarios, interacciones, cuarentena, bit) {
    const mysql = require('mysql2/promise');
    const db = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 4000,
        user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME,
        ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, enableKeepAlive: true,
    });
    await db.beginTransaction();
    try {
        // se limpian los datos de cargas anteriores (la bitácora se conserva como historial)
        for (const t of ['interaccion_etiqueta', 'cuarentena_interacciones', 'interacciones', 'etiquetas', 'usuarios'])
            await db.query(`DELETE FROM ${t}`);

        // la bitácora va primero porque la cuarentena la referencia
        const ahora = new Date();
        const idEjecucion = {};
        for (const t of ['usuarios', 'interacciones']) {
            const b = bit[t];
            const [r] = await db.query(
                `INSERT INTO bitacora_etl (fecha_ejecucion, tabla_destino, registros_recibidos, registros_aceptados,
         registros_transformados, registros_rechazados, observaciones) VALUES (?,?,?,?,?,?,?)`,
                [ahora, t, b.recibidos, b.aceptados, b.transformados, b.rechazados, b.observaciones]);
            idEjecucion[t] = r.insertId;
        }

        await insertar(db, 'usuarios', ['id_usuario', 'alias', 'fecha_ingreso', 'pais', 'estado', 'ciudad', 'latitud',
            'longitud', 'zona_horaria', 'rango_edad', 'especie_fursona', 'interes_principal', 'plataforma_principal',
            'es_artista', 'mensajes_30d', 'reacciones_30d', 'eventos_asistidos', 'comisiones_compradas',
            'sentimiento_promedio', 'ultima_actividad', 'estatus', 'consentimiento_datos'], usuarios);

        const nombres = [...new Set(interacciones.flatMap((i) => i.lista_etiquetas))];
        await insertar(db, 'etiquetas', ['nombre'], nombres.map((n) => ({ nombre: n })));
        const [filasEt] = await db.query('SELECT id_etiqueta, nombre FROM etiquetas');
        const idEtiqueta = Object.fromEntries(filasEt.map((r) => [r.nombre, r.id_etiqueta]));

        await insertar(db, 'interacciones', ['id_interaccion', 'id_usuario', 'fecha_hora', 'canal', 'tipo', 'texto',
            'tema', 'sentimiento', 'idioma', 'dispositivo', 'longitud_texto', 'reacciones_recibidas'], interacciones);
        const puente = interacciones.flatMap((i) =>
            i.lista_etiquetas.map((n) => ({ id_interaccion: i.id_interaccion, id_etiqueta: idEtiqueta[n] })));
        await insertar(db, 'interaccion_etiqueta', ['id_interaccion', 'id_etiqueta'], puente);

        await insertar(db, 'cuarentena_interacciones', ['id_ejecucion', 'id_interaccion', 'id_usuario_referido',
            'registro_original', 'motivo_rechazo', 'fecha_rechazo'],
            cuarentena.map((c) => ({
                id_ejecucion: idEjecucion.interacciones, id_interaccion: c.id_interaccion,
                id_usuario_referido: c.id_usuario_referido, registro_original: JSON.stringify(c.registro_original),
                motivo_rechazo: c.motivo_rechazo, fecha_rechazo: ahora,
            })));
        await db.commit();
    } catch (e) {
        await db.rollback();
        await db.end();
        throw e;
    }

    titulo('Verificación en la nube');
    for (const t of ['usuarios', 'interacciones', 'etiquetas', 'interaccion_etiqueta', 'cuarentena_interacciones', 'bitacora_etl']) {
        const [r] = await db.query(`SELECT COUNT(*) AS n FROM ${t}`);
        console.log(`  ${t}: ${r[0].n} registros`);
    }
    const [p] = await db.query(`SELECT COUNT(*) AS n FROM usuarios WHERE consentimiento_datos = 'no' AND
    (pais IS NOT NULL OR estado IS NOT NULL OR ciudad IS NOT NULL OR latitud IS NOT NULL OR
     longitud IS NOT NULL OR zona_horaria IS NOT NULL)`);
    console.log(`  usuarios sin consentimiento que conservan datos geográficos: ${p[0].n}`);
    const [h] = await db.query(`SELECT COUNT(*) AS n FROM interacciones i
    LEFT JOIN usuarios u ON u.id_usuario = i.id_usuario WHERE u.id_usuario IS NULL`);
    console.log(`  interacciones sin usuario en el padrón: ${h[0].n}`);
    await db.end();
}

// ---------- programa principal ----------
async function main() {
    fs.mkdirSync(CLEAN, { recursive: true });
    fs.mkdirSync(LOGS, { recursive: true });

    titulo('Lectura de archivos originales');
    const usuariosCrudos = leerCsv(ARCH_USUARIOS);
    const interCrudas = leerCsv(ARCH_INTER);
    console.log(`  usuarios: ${usuariosCrudos.length} registros | interacciones: ${interCrudas.length} registros`);

    titulo('Etapas 1-3: duplicados, nulos y estandarización');
    const U = depurarUsuarios(usuariosCrudos);
    const I = depurarInteracciones(interCrudas);
    console.log(`  usuarios -> duplicados por id: ${U.stat.duplicados_id}, por alias: ${U.stat.duplicados_alias}`);
    console.log(`  usuarios -> nulos normalizados: ${JSON.stringify(U.stat.nulos_normalizados)}`);
    console.log(`  interacciones -> duplicados por id: ${I.stat.duplicados_id}`);
    console.log(`  interacciones -> nulos normalizados: ${JSON.stringify(I.stat.nulos_normalizados)}`);
    console.log(`  interacciones -> longitud_texto recalculada: ${I.stat.longitud_recalculada}`);

    titulo('Etapa 4: validación de tipos de datos');
    const usuarios = [], usuariosInvalidos = [];
    for (const u of U.filas) {
        const e = validarUsuario(u);
        if (e.length) usuariosInvalidos.push({ id: u.id_usuario, errores: e });
        else usuarios.push(u);
    }
    const validas = [], cuarentena = [];
    const enviarACuarentena = (f, motivo) => {
        const o = { ...f._original };
        for (const c of ['pais', 'estado', 'ciudad']) if (c in o) o[c] = null; // consentimiento no verificable
        cuarentena.push({ id_interaccion: f.id_interaccion, id_usuario_referido: f.id_usuario, registro_original: o, motivo_rechazo: motivo });
    };
    let interInvalidas = 0;
    for (const f of I.filas) {
        const e = validarInteraccion(f);
        if (e.length) { interInvalidas++; enviarACuarentena(f, `datos inválidos: ${e.join('; ')}`.slice(0, 100)); }
        else validas.push(f);
    }
    console.log(`  usuarios inválidos: ${usuariosInvalidos.length} | interacciones inválidas: ${interInvalidas}`);

    titulo('Etapa 5: verificación de referencias usuario-interacción');
    const ids = new Set(usuarios.map((u) => u.id_usuario));
    const interacciones = [];
    let huerfanas = 0;
    for (const f of validas) {
        if (ids.has(f.id_usuario)) interacciones.push(f);
        else { huerfanas++; enviarACuarentena(f, 'usuario inexistente en el padrón'); }
    }
    console.log(`  interacciones con usuario válido: ${interacciones.length} | huérfanas enviadas a cuarentena: ${huerfanas}`);
    const ingreso = Object.fromEntries(usuarios.map((u) => [u.id_usuario, u.fecha_ingreso]));
    const previas = interacciones.filter((i) => i.fecha_hora.slice(0, 10) < ingreso[i.id_usuario]).length;
    console.log(`  advertencia: ${previas} interacciones ocurren antes de la fecha de ingreso de su usuario (se conservan)`);

    titulo('Etapa 6: privacidad (consentimiento_datos = "no")');
    const P = aplicarPrivacidad(usuarios, U.transformados);
    console.log(`  usuarios sin consentimiento depurados: ${P.usuarios_sin_consentimiento}`);
    console.log(`  valores geográficos eliminados: ${P.valores_geograficos_borrados}`);
    console.log('  la ubicación no se guarda en interacciones (se obtiene solo desde usuarios)');

    titulo('Etapa 7: archivos depurados');
    const etiquetas = [...new Set(interacciones.flatMap((i) => i.lista_etiquetas))].sort();
    escribirCsv('usuarios_depurados.csv', ['id_usuario', 'alias', 'fecha_ingreso', 'pais', 'estado', 'ciudad', 'latitud',
        'longitud', 'zona_horaria', 'rango_edad', 'especie_fursona', 'interes_principal', 'plataforma_principal', 'es_artista',
        'mensajes_30d', 'reacciones_30d', 'eventos_asistidos', 'comisiones_compradas', 'sentimiento_promedio',
        'ultima_actividad', 'estatus', 'consentimiento_datos'], usuarios);
    escribirCsv('interacciones_depuradas.csv', ['id_interaccion', 'id_usuario', 'fecha_hora', 'canal', 'tipo', 'texto',
        'tema', 'sentimiento', 'idioma', 'dispositivo', 'longitud_texto', 'reacciones_recibidas'], interacciones);
    escribirCsv('interaccion_etiqueta.csv', ['id_interaccion', 'etiqueta'],
        interacciones.flatMap((i) => i.lista_etiquetas.map((e) => ({ id_interaccion: i.id_interaccion, etiqueta: e }))));
    escribirCsv('interacciones_cuarentena.csv', ['id_interaccion', 'id_usuario_referido', 'motivo_rechazo'], cuarentena);
    console.log(`  usuarios_depurados.csv: ${usuarios.length} filas`);
    console.log(`  interacciones_depuradas.csv: ${interacciones.length} filas`);
    console.log(`  interaccion_etiqueta.csv: ${interacciones.reduce((a, i) => a + i.lista_etiquetas.length, 0)} filas (${etiquetas.length} etiquetas distintas)`);
    console.log(`  interacciones_cuarentena.csv: ${cuarentena.length} filas`);

    // bitácora
    const bit = {
        usuarios: {
            recibidos: U.stat.recibidos, aceptados: usuarios.length, transformados: U.transformados.size,
            rechazados: U.stat.duplicados_id + U.stat.duplicados_alias + usuariosInvalidos.length,
            observaciones: `duplicados: ${U.stat.duplicados_id + U.stat.duplicados_alias}; inválidos: ${usuariosInvalidos.length}; sin consentimiento depurados: ${P.usuarios_sin_consentimiento}`,
        },
        interacciones: {
            recibidos: I.stat.recibidos, aceptados: interacciones.length, transformados: I.transformados.size,
            rechazados: I.stat.duplicados_id + cuarentena.length,
            observaciones: `duplicados: ${I.stat.duplicados_id}; huérfanas: ${huerfanas}; inválidas: ${interInvalidas}; antes del ingreso: ${previas}`,
        },
    };
    fs.writeFileSync(path.join(LOGS, 'bitacora_etl.json'), JSON.stringify({
        fecha: new Date().toISOString(), usuarios: { ...bit.usuarios, detalle: U.stat, privacidad: P },
        interacciones: { ...bit.interacciones, detalle: I.stat },
    }, null, 2));
    titulo('Bitácora');
    console.table({ usuarios: bit.usuarios, interacciones: bit.interacciones }, ['recibidos', 'aceptados', 'transformados', 'rechazados']);

    if (process.argv.includes('--load')) {
        titulo('Etapa 8: carga a la base de datos en la nube');
        await cargar(usuarios, interacciones, cuarentena, bit);
        console.log('  carga completada');
    } else {
        console.log('\n(Etapa 8 omitida: ejecuta con --load para cargar a la nube)');
    }
}

main().catch((e) => { console.error('\nError en el ETL:', e.code || '', e.message); process.exit(1); });