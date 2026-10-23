-- Migración aditiva para instalaciones existentes. Respaldar la base antes de ejecutarla.
BEGIN;
ALTER TABLE instituciones
    ADD COLUMN IF NOT EXISTS dominio VARCHAR(253),
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS firma_url TEXT,
    ADD COLUMN IF NOT EXISTS fecha_cambio_nombre TIMESTAMPTZ;

ALTER TABLE usuarios
    ALTER COLUMN institucion_id DROP NOT NULL,
    ALTER COLUMN password_hash DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS email_personal VARCHAR(150),
    ADD COLUMN IF NOT EXISTS primer_ingreso BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS codigo_vinculacion CHAR(64);

ALTER TABLE cursos
    ADD COLUMN IF NOT EXISTS aula VARCHAR(80),
    ADD COLUMN IF NOT EXISTS director_grupo_id UUID REFERENCES usuarios(id);

ALTER TABLE asignaturas
    ADD COLUMN IF NOT EXISTS intensidad_horaria SMALLINT
        CHECK (intensidad_horaria > 0);

ALTER TABLE calificaciones DROP CONSTRAINT IF EXISTS calificaciones_periodo_check;
ALTER TABLE calificaciones
    ADD CONSTRAINT calificaciones_periodo_check CHECK (periodo BETWEEN 1 AND 12);

CREATE TABLE IF NOT EXISTS activaciones_cuenta (
    token_hash CHAR(64) PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    vence_en TIMESTAMPTZ NOT NULL,
    usado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS configuracion_institucional (
    institucion_id UUID PRIMARY KEY REFERENCES instituciones(id) ON DELETE CASCADE,
    nota_minima_aprobacion NUMERIC(4, 2) NOT NULL DEFAULT 3.00
        CHECK (nota_minima_aprobacion BETWEEN 0 AND 5),
    escala_min NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (escala_min BETWEEN 0 AND 5),
    escala_max NUMERIC(4, 2) NOT NULL DEFAULT 5 CHECK (escala_max BETWEEN 0 AND 5),
    num_periodos SMALLINT NOT NULL DEFAULT 4 CHECK (num_periodos BETWEEN 1 AND 12),
    CHECK (escala_min < escala_max),
    CHECK (nota_minima_aprobacion >= escala_min AND nota_minima_aprobacion <= escala_max)
);

CREATE TABLE IF NOT EXISTS periodos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id) ON DELETE CASCADE,
    periodo_lectivo INTEGER NOT NULL,
    numero SMALLINT NOT NULL CHECK (numero BETWEEN 1 AND 12),
    peso_porcentaje NUMERIC(5, 2) NOT NULL CHECK (peso_porcentaje > 0 AND peso_porcentaje <= 100),
    cerrado BOOLEAN NOT NULL DEFAULT FALSE,
    cerrado_en TIMESTAMPTZ,
    cerrado_por UUID REFERENCES usuarios(id),
    UNIQUE (institucion_id, periodo_lectivo, numero)
);

CREATE TABLE IF NOT EXISTS actividades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asignatura_id UUID NOT NULL REFERENCES asignaturas(id) ON DELETE CASCADE,
    periodo SMALLINT NOT NULL CHECK (periodo BETWEEN 1 AND 12),
    nombre VARCHAR(120) NOT NULL,
    peso_porcentaje NUMERIC(5, 2) NOT NULL CHECK (peso_porcentaje > 0 AND peso_porcentaje <= 100),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (asignatura_id, periodo, nombre)
);

CREATE TABLE IF NOT EXISTS notas_actividades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actividad_id UUID NOT NULL REFERENCES actividades(id) ON DELETE CASCADE,
    matricula_id UUID NOT NULL REFERENCES matriculas(id) ON DELETE CASCADE,
    nota NUMERIC(5, 2) NOT NULL CHECK (nota BETWEEN 0 AND 100),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (actividad_id, matricula_id)
);

CREATE TABLE IF NOT EXISTS horarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asignatura_id UUID NOT NULL REFERENCES asignaturas(id) ON DELETE CASCADE,
    dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    aula VARCHAR(80),
    CHECK (hora_fin > hora_inicio),
    UNIQUE (asignatura_id, dia_semana, hora_inicio)
);

CREATE TABLE IF NOT EXISTS acudientes_estudiantes (
    acudiente_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estudiante_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    vinculado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (acudiente_id, estudiante_id),
    CHECK (acudiente_id <> estudiante_id)
);

INSERT INTO acudientes_estudiantes (acudiente_id, estudiante_id)
SELECT acudiente_id, estudiante_id FROM matriculas WHERE acudiente_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS observaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institucion_id UUID NOT NULL REFERENCES instituciones(id),
    estudiante_id UUID NOT NULL REFERENCES usuarios(id),
    profesor_id UUID NOT NULL REFERENCES usuarios(id),
    curso_id UUID NOT NULL REFERENCES cursos(id),
    descripcion TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS excusas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asistencia_id UUID NOT NULL UNIQUE REFERENCES asistencia(id) ON DELETE CASCADE,
    acudiente_id UUID REFERENCES usuarios(id),
    motivo TEXT NOT NULL,
    estado VARCHAR(12) NOT NULL DEFAULT 'Pendiente'
        CHECK (estado IN ('Pendiente', 'Aprobada', 'Rechazada')),
    revisado_por UUID REFERENCES usuarios(id),
    revisado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    institucion_id UUID REFERENCES instituciones(id),
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    accion VARCHAR(40) NOT NULL,
    entidad VARCHAR(80) NOT NULL,
    entidad_id TEXT,
    cambios JSONB NOT NULL DEFAULT '{}'::jsonb,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    destinatario VARCHAR(254) NOT NULL,
    asunto VARCHAR(200) NOT NULL,
    cuerpo TEXT NOT NULL,
    disponible_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviado_en TIMESTAMPTZ,
    intentos INTEGER NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zetta_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_institucion_rol ON usuarios (institucion_id, rol);
CREATE INDEX IF NOT EXISTS idx_matriculas_estudiante ON matriculas (estudiante_id);
CREATE INDEX IF NOT EXISTS idx_matriculas_acudiente ON matriculas (acudiente_id);
CREATE INDEX IF NOT EXISTS idx_asignaturas_profesor ON asignaturas (profesor_id);
CREATE INDEX IF NOT EXISTS idx_calificaciones_matricula_periodo ON calificaciones (matricula_id, periodo);
CREATE INDEX IF NOT EXISTS idx_asistencia_fecha ON asistencia (fecha);
CREATE INDEX IF NOT EXISTS idx_zetta_sessions_expires_at ON zetta_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_activaciones_usuario_vence ON activaciones_cuenta (usuario_id, vence_en);
CREATE INDEX IF NOT EXISTS idx_audit_log_institucion_fecha ON audit_log (institucion_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_pendiente ON email_outbox (disponible_en) WHERE enviado_en IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_instituciones_dominio ON instituciones (lower(dominio)) WHERE dominio IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_codigo_vinculacion
    ON usuarios (codigo_vinculacion) WHERE codigo_vinculacion IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_codigo_vinculacion ON usuarios (codigo_vinculacion) WHERE codigo_vinculacion IS NOT NULL;

INSERT INTO configuracion_institucional (institucion_id)
SELECT id FROM instituciones
ON CONFLICT (institucion_id) DO NOTHING;

UPDATE usuarios SET primer_ingreso = FALSE WHERE password_hash IS NOT NULL AND primer_ingreso IS TRUE;

COMMIT;
