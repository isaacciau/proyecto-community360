USE community360;

DROP TABLE IF EXISTS historial_cambios, interaccion_etiqueta, cuarentena_interacciones, interacciones,
  etiquetas, bitacora_etl, usuarios, admin_usuarios;

CREATE TABLE usuarios (
  id_usuario VARCHAR(10) NOT NULL,
  alias VARCHAR(50) NOT NULL,
  fecha_ingreso DATE NOT NULL,
  pais VARCHAR(50) NULL,
  estado VARCHAR(60) NULL,
  ciudad VARCHAR(80) NULL,
  latitud DECIMAL(9,6) NULL,
  longitud DECIMAL(9,6) NULL,
  zona_horaria VARCHAR(50) NULL,
  rango_edad VARCHAR(10) NOT NULL,
  especie_fursona VARCHAR(30) NOT NULL,
  interes_principal VARCHAR(40) NOT NULL,
  plataforma_principal VARCHAR(20) NOT NULL,
  es_artista BOOLEAN NOT NULL,
  mensajes_30d INT NOT NULL,
  reacciones_30d INT NOT NULL,
  eventos_asistidos INT NOT NULL,
  comisiones_compradas INT NOT NULL,
  sentimiento_promedio DECIMAL(4,3) NOT NULL,
  ultima_actividad DATE NOT NULL,
  estatus VARCHAR(10) NOT NULL,
  consentimiento_datos CHAR(2) NOT NULL,
  PRIMARY KEY (id_usuario),
  CONSTRAINT ck_usu_estatus CHECK (estatus IN ('activo','en_riesgo','inactivo')),
  CONSTRAINT ck_usu_consent CHECK (consentimiento_datos IN ('si','no')),
  CONSTRAINT ck_usu_sent CHECK (sentimiento_promedio BETWEEN -1 AND 1),
  CONSTRAINT ck_usu_privacidad CHECK (consentimiento_datos = 'si' OR
    (pais IS NULL AND estado IS NULL AND ciudad IS NULL AND
     latitud IS NULL AND longitud IS NULL AND zona_horaria IS NULL))
);

CREATE TABLE interacciones (
  id_interaccion VARCHAR(10) NOT NULL,
  id_usuario VARCHAR(10) NOT NULL,
  fecha_hora DATETIME NOT NULL,
  canal VARCHAR(20) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  texto TEXT NULL,
  tema VARCHAR(30) NOT NULL,
  sentimiento DECIMAL(3,2) NOT NULL,
  idioma CHAR(2) NOT NULL,
  dispositivo ENUM('Android','Escritorio','Web','iOS') NOT NULL,
  longitud_texto INT NOT NULL,
  reacciones_recibidas INT NOT NULL,
  PRIMARY KEY (id_interaccion),
  INDEX idx_inter_usuario (id_usuario),
  INDEX idx_inter_fecha (fecha_hora),
  CONSTRAINT fk_inter_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
  CONSTRAINT ck_inter_tipo CHECK (tipo IN ('mensaje','comentario','reaccion','respuesta_encuesta','rsvp_evento')),
  CONSTRAINT ck_inter_sent CHECK (sentimiento BETWEEN -1 AND 1)
);

CREATE TABLE etiquetas (
  id_etiqueta INT NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(20) NOT NULL,
  PRIMARY KEY (id_etiqueta),
  UNIQUE KEY uq_etiqueta_nombre (nombre)
);

CREATE TABLE interaccion_etiqueta (
  id_interaccion VARCHAR(10) NOT NULL,
  id_etiqueta INT NOT NULL,
  PRIMARY KEY (id_interaccion, id_etiqueta),
  INDEX idx_ie_etiqueta (id_etiqueta),
  CONSTRAINT fk_ie_inter FOREIGN KEY (id_interaccion) REFERENCES interacciones(id_interaccion) ON DELETE CASCADE,
  CONSTRAINT fk_ie_etiqueta FOREIGN KEY (id_etiqueta) REFERENCES etiquetas(id_etiqueta)
);

CREATE TABLE bitacora_etl (
  id_ejecucion INT NOT NULL AUTO_INCREMENT,
  fecha_ejecucion DATETIME NOT NULL,
  tabla_destino VARCHAR(30) NOT NULL,
  registros_recibidos INT NOT NULL,
  registros_aceptados INT NOT NULL,
  registros_transformados INT NOT NULL,
  registros_rechazados INT NOT NULL,
  observaciones TEXT NULL,
  PRIMARY KEY (id_ejecucion)
);

CREATE TABLE cuarentena_interacciones (
  id_cuarentena INT NOT NULL AUTO_INCREMENT,
  id_ejecucion INT NOT NULL,
  id_interaccion VARCHAR(10) NOT NULL,
  id_usuario_referido VARCHAR(10) NOT NULL,
  registro_original JSON NOT NULL,
  motivo_rechazo VARCHAR(100) NOT NULL,
  fecha_rechazo DATETIME NOT NULL,
  PRIMARY KEY (id_cuarentena),
  INDEX idx_cuar_ejec (id_ejecucion),
  CONSTRAINT fk_cuar_ejec FOREIGN KEY (id_ejecucion) REFERENCES bitacora_etl(id_ejecucion)
);

CREATE TABLE admin_usuarios (
  id_admin INT NOT NULL AUTO_INCREMENT,
  correo VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL,
  activo BOOLEAN NOT NULL,
  fecha_creacion DATETIME NOT NULL,
  PRIMARY KEY (id_admin),
  UNIQUE KEY uq_admin_correo (correo)
);

-- Historial de cambios hechos desde la API (POST, PUT, DELETE).
-- No tiene llave foránea a interacciones para conservar el registro de las eliminadas.
CREATE TABLE historial_cambios (
  id_cambio INT NOT NULL AUTO_INCREMENT,
  accion ENUM('crear','actualizar','eliminar') NOT NULL,
  id_interaccion VARCHAR(10) NOT NULL,
  id_usuario VARCHAR(10) NULL,
  detalle JSON NULL,
  realizado_por VARCHAR(100) NOT NULL,
  fecha_cambio DATETIME NOT NULL,
  PRIMARY KEY (id_cambio),
  INDEX idx_hist_fecha (fecha_cambio),
  INDEX idx_hist_inter (id_interaccion)
);

SHOW TABLES;
