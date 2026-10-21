/** Admins can change the data model, workflows, API keys and members. Members work with records. */
export enum WorkspaceRole {
  ADMIN = 'admin',
  MEMBER = 'member',
}

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt ignores everything past 72 bytes, so longer passwords are rejected. */
export const PASSWORD_MAX_BYTES = 72;

export interface WorkspaceSummary {
  id: string;
  name: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: WorkspaceRole;
}

/** GET /api/auth/me, and the response of signup / login / accept-invite. */
export interface SessionResponse {
  user: CurrentUser;
  workspace: WorkspaceSummary;
}

export interface MemberDto {
  id: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface InviteInfoResponse {
  workspaceName: string;
}

export interface InviteLinkResponse {
  token: string;
  url: string;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  /** First characters of the key, e.g. `crm_Ab12Cd34`, to tell keys apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: { id: string; name: string } | null;
}

/** Returned once, when the key is created. The full key can't be shown again. */
export interface CreatedApiKeyDto extends ApiKeyDto {
  key: string;
}

export const API_KEY_PREFIX = 'crm_';

/** GET /api/auth/demo: the public demo login, shown on the login page when DEMO_MODE is on. */
export type DemoLoginDto = { enabled: false } | { enabled: true; email: string; password: string };
