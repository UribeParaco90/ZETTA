# ZETTA

La página informativa y los módulos usan Bootstrap local y estilos propios.
Para usar login, registro, administración o módulos académicos, inicia la API
de Neon desde la raíz con `npm --prefix backend start` y abre
`http://localhost:3000`.

El formulario público solo crea cuentas de Acudiente asociadas a una
institución existente. El login valida el rol y las credenciales en Neon.
Las cuentas falsas de demostración y el almacenamiento local de usuarios se
retiraron.

El panel de administración permite CRUD de las entidades existentes, limitado
por perfil y por institución. El módulo de asistencia permite registrar y
consultar estados desde Neon; el módulo de calificaciones genera una vista
previa desde registros de Neon. Los certificados no son documentos oficiales.

Los menús marcan como “Próximamente” las funciones que no tienen una pantalla
y flujo de datos completos. La descripción actualizada de configuración,
esquema y límites está en [`backend/README.md`](../backend/README.md).

## Organización

- `backend/`: API, reglas de negocio, seguridad, migraciones y pruebas.
- `css/` y `js/`: estilos y lógica del sitio, el panel y la planilla.
- `vendor/`: dependencias de frontend servidas localmente.
- `../modules/<modulo>/`: páginas y recursos propios de cada módulo académico.

El servidor publica `landing_page/` como raíz web y `modules/` bajo `/modules`.
Por eso, los recursos compartidos de una página de módulo deben usar rutas web
como `/css/styles.css` o `/vendor/bootstrap/bootstrap.min.css`, no rutas a la
carpeta física `landing_page/`.
