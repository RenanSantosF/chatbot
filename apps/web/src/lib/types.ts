export type UserRole = "OWNER" | "ADMIN" | "AGENT";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface SessionTenant {
  id: string;
  name: string;
  slug: string;
}

export interface MeResponse {
  user: SessionUser;
  tenant: SessionTenant;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  avatar: string | null;
  createdAt: string;
}
