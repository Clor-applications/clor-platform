export const PermissionAction = {
  VIEW: 'VIEW',
  CREATE: 'CREATE',
  EDIT: 'EDIT',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
  EXPORT: 'EXPORT',
} as const;

export type PermissionAction = (typeof PermissionAction)[keyof typeof PermissionAction];

export const RoleType = {
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  SALES: 'SALES',
  CUSTOM: 'CUSTOM',
} as const;

export type RoleType = (typeof RoleType)[keyof typeof RoleType];

export const TransferStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  RECEIVED: 'RECEIVED',
  REJECTED: 'REJECTED',
} as const;

export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];

export const GstRegistrationType = {
  REGULAR: 'REGULAR',
  COMPOSITION: 'COMPOSITION',
  UNREGISTERED: 'UNREGISTERED',
} as const;

export type GstRegistrationType = (typeof GstRegistrationType)[keyof typeof GstRegistrationType];
