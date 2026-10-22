# Backend ZETTA · Neon PostgreSQL

## Configuración local

1. Copia `.env.example` como `.env` y completa `DATABASE_URL` con la URL de Neon.
   No publiques `.env` ni compartas su contenido. Si la URL ya se incluyó en un
   commit, rótala en Neon: eliminar el archivo del commit actual no borra su
   contenido de la historia anterior.
2. Desde la raíz del proyecto ejecuta `npm --prefix backend start`.
3. Abre `http://localhost:3000`.

El servidor consulta tablas PostgreSQL en minúsculas con los nombres definidos en
`schema.postgres.sql`. Ese archivo sirve para una base nueva; no lo ejecutes sobre
una base existente sin revisar antes sus tablas y respaldar los datos.

## Cuentas y sesión

- El login valida correo, contraseña y rol contra `usuarios` en Neon.
- El servidor usa cookies de sesión opacas `HttpOnly`, `SameSite=Strict` y con
  una duración de ocho horas. Las contraseñas nuevas se almacenan con scrypt.
- Las sesiones opacas se guardan como hashes en `zetta_sessions`; cerrar sesión
  invalida la sesión en el servidor y eliminar un usuario invalida sus sesiones.
- El formulario público solo registra Acudientes, asociados a una institución
  existente. La creación de los demás perfiles debe hacerse desde la consola
  institucional o por un proceso administrativo autorizado.
- Las rutas CRUD comprueban el rol, la institución y las asignaciones en cada
  consulta. Las vistas del navegador no sustituyen esas comprobaciones.

## Alcance

CRUD disponibles: instituciones para SuperAdmin; usuarios, cursos, materias,
matrículas, calificaciones y asistencia para Administrador; calificaciones y
asistencia para Profesor, limitadas a sus materias. Estudiantes y Acudientes
solo consultan información vinculada a su cuenta.

La consola incluye CRUD genérico para las tablas actuales. El panel muestra
“Próximamente” en módulos que todavía no existen (por ejemplo, facturación,
audit logs, horario y observador). No hay envíos automáticos de notificaciones
ni emisión oficial de certificados.
