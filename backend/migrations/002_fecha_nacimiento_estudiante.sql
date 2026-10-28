-- Agrega la fecha de cumpleaños editable al perfil del estudiante.
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
