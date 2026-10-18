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
