(() => {
  const STORAGE_KEY = "zetta-demo-accounts";
  const PASSWORD_ITERATIONS = 210000;

  const roles = [
    {
      id: "SuperAdmin",
      label: "Superadministrador",
      description: "Alcance previsto: administración global de la plataforma y de las instituciones.",
      permissions: [
        "Consultar las instituciones y métricas de la plataforma",
        "Gestionar instituciones, usuarios globales y configuración SaaS",
        "Consultar los registros de auditoría globales",
        "Administrar planes y facturación de demostración"
      ]
    },
    {
      id: "Admin",
      label: "Administrador",
      description: "Alcance previsto: gestión administrativa autorizada dentro de su institución.",
      permissions: [
        "Gestionar usuarios, matrículas, cursos y asignaturas de su institución",
        "Administrar periodos académicos, cierres y boletines",
        "Gestionar excusas y consultar reportes institucionales",
        "Modificar los ajustes institucionales permitidos"
      ]
    },
    {
      id: "Profesor",
      label: "Profesor",
      description: "Alcance previsto: cursos, estudiantes y actividades académicas que tenga asignados.",
      permissions: [
        "Consultar sus cursos, estudiantes y horario asignados",
        "Registrar y consultar calificaciones de sus cursos",
        "Registrar y consultar asistencia de sus cursos",
        "Gestionar observaciones de aula permitidas"
      ]
    },
    {
      id: "Estudiante",
      label: "Estudiante",
      description: "Alcance previsto: consulta de su propia información académica.",
      permissions: [
        "Consultar sus cursos y calificaciones",
        "Revisar su asistencia y observador",
        "Consultar su progreso y boletines"
      ]
    },
    {
      id: "Acudiente",
      label: "Acudiente",
      description: "Alcance previsto: consulta de información de estudiantes asociados a su cuenta.",
      permissions: [
        "Consultar la información de sus acudidos",
        "Revisar calificaciones y progreso académico",
        "Consultar asistencia, excusas y observador",
        "Consultar documentos disponibles"
      ]
    }
  ];

  const demoAccounts = [
    { email: "superadmin@demo.zetta.local", password: "SuperDemo2026!", role: "SuperAdmin" },
    { email: "admin@demo.zetta.local", password: "AdminDemo2026!", role: "Admin" },
    { email: "profesor@demo.zetta.local", password: "ProfesorDemo2026!", role: "Profesor" },
    { email: "estudiante@demo.zetta.local", password: "EstudianteDemo2026!", role: "Estudiante" },
    { email: "acudiente@demo.zetta.local", password: "AcudienteDemo2026!", role: "Acudiente" }
  ];

  const encodeBytes = (bytes) => {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  };

  const decodeBytes = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

  const readRegisteredAccounts = () => {
    const rawAccounts = localStorage.getItem(STORAGE_KEY);
    if (rawAccounts === null) {
      return [];
    }

    const accounts = JSON.parse(rawAccounts);
    if (!Array.isArray(accounts) || accounts.some((account) => (
      typeof account?.name !== "string"
      || typeof account?.email !== "string"
      || typeof account?.role !== "string"
      || typeof account?.salt !== "string"
      || typeof account?.passwordHash !== "string"
    ))) {
      throw new Error("Las cuentas guardadas tienen un formato no válido. Borra los datos locales de demostración y vuelve a registrarte.");
    }
    return accounts;
  };

  const derivePasswordHash = async (password, salt) => {
    if (!window.crypto?.subtle) {
      throw new Error("El navegador no permite proteger contraseñas en este origen. Abre el proyecto con Live Server en localhost o HTTPS.");
    }

    const key = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const hash = await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: PASSWORD_ITERATIONS,
        hash: "SHA-256"
      },
      key,
      256
    );
    return encodeBytes(new Uint8Array(hash));
  };

  const register = async ({ name, email, role, password }) => {
    if (!roles.some((item) => item.id === role)) {
      throw new Error("Selecciona uno de los perfiles disponibles.");
    }

    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      throw new Error("El nombre debe tener entre 2 y 120 caracteres.");
    }
    if (password.length < 8) {
      throw new Error("La contraseña debe tener al menos 8 caracteres.");
    }
    if (!window.crypto?.subtle || !window.crypto.getRandomValues) {
      throw new Error("El navegador no permite proteger contraseñas en este origen. Abre el proyecto con Live Server en localhost o HTTPS.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const registeredAccounts = readRegisteredAccounts();
    const emailExists = demoAccounts.some((account) => account.email === normalizedEmail)
      || registeredAccounts.some((account) => account.email === normalizedEmail);
    if (emailExists) {
      throw new Error("Ya existe una cuenta de demostración con ese correo.");
    }

    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const account = {
      name: normalizedName,
      email: normalizedEmail,
      role,
      salt: encodeBytes(salt),
      passwordHash: await derivePasswordHash(password, salt)
    };
    registeredAccounts.push(account);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registeredAccounts));
    return account;
  };

  const authenticate = async ({ email, password, role }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const demoAccount = demoAccounts.find((account) => (
      account.email === normalizedEmail
      && account.password === password
      && account.role === role
    ));
    if (demoAccount) {
      const roleDefinition = roles.find((item) => item.id === demoAccount.role);
      return {
        name: roleDefinition.label,
        email: demoAccount.email,
        role: demoAccount.role
      };
    }

    const account = readRegisteredAccounts().find((item) => (
      item.email === normalizedEmail && item.role === role
    ));
    if (!account) {
      return null;
    }

    const actualHash = await derivePasswordHash(password, decodeBytes(account.salt));
    if (actualHash !== account.passwordHash) {
      return null;
    }
    return { name: account.name, email: account.email, role: account.role };
  };

  window.ZettaDemoAccounts = Object.freeze({
    authenticate,
    register,
    roles
  });
})();
