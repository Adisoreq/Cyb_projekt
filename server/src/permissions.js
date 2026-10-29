const ROLES = {
  ADMIN: 'Administrator',
  MANAGER: 'Kierownik',
  EMPLOYEE: 'Pracownik',
  GUEST: 'Gość',
};

// Administrator to wyłącznie stałe konto ADMIN – pozostałym można nadać tylko te role.
const ASSIGNABLE_ROLES = [ROLES.MANAGER, ROLES.EMPLOYEE, ROLES.GUEST];

const PERMISSIONS = {
  [ROLES.ADMIN]: ['resources:read', 'resources:create', 'resources:update', 'resources:delete', 'users:manage', 'settings:manage'],
  [ROLES.MANAGER]: ['resources:read', 'resources:create', 'resources:update', 'resources:delete'],
  [ROLES.EMPLOYEE]: ['resources:read', 'resources:create', 'resources:update'],
  [ROLES.GUEST]: ['resources:read'],
};

const permissionsFor = (role) => PERMISSIONS[role] || [];
const can = (role, permission) => permissionsFor(role).includes(permission);

module.exports = { ROLES, ASSIGNABLE_ROLES, PERMISSIONS, permissionsFor, can };
