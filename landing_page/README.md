# ZETTA · Landing page

Página informativa de ZETTA creada con HTML, CSS propio y Bootstrap 5.3.
Bootstrap se carga desde `vendor/bootstrap/`, así que sus estilos y componentes
funcionan sin depender de una conexión a internet. El JavaScript propio gestiona
el registro local de demostración y la vista informativa de perfiles.

## Abrir el sitio

Abre `index.html` directamente en el navegador o usa la extensión Live Server
de VS Code para servir la carpeta.

## Estructura

- `index.html`: contenido y estructura semántica de la página.
- `login.html`: acceso con las cuentas de demostración o cuentas locales creadas.
- `registro.html`: registro de una cuenta de demostración y catálogo de roles.
- `css/styles.css`: estilos visuales propios y adaptación de Bootstrap.
- `css/login.css`: estilos de acceso y registro.
- `js/demo-accounts.js`: perfiles, credenciales de demostración y almacenamiento local.
- `js/login.js` y `js/register.js`: comportamiento de acceso y registro.
- `vendor/bootstrap/`: hojas de estilo, JavaScript y licencia de Bootstrap.

## Cuentas y roles

En `login.html` están disponibles cinco cuentas ficticias preconfiguradas, una
por rol. En `registro.html` también se pueden crear cuentas adicionales: elige
un rol para ver sus permisos previstos y regístrate con un correo distinto.
Las cuentas nuevas se guardan en el almacenamiento local del navegador y sus
contraseñas se derivan con PBKDF2. Usa localhost (por ejemplo, Live Server) o
HTTPS para disponer de Web Crypto.

Este registro es únicamente una simulación del lado del cliente. El rol se puede
seleccionar libremente, no existe verificación de identidad, sesión segura,
backend ni control de acceso aplicado a rutas u operaciones. No uses datos ni
contraseñas reales. Para un despliegue real se necesita autenticación y
autorización del lado del servidor.
