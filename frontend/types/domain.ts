export type User = {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string | null;
  status: string;
  role: "user" | "admin";
};

export type Server = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  iconText: string;
  role: string;
};

export type Channel = {
  id: string;
  serverId: string;
  name: string;
  kind: "text" | "voice";
  position: number;
};

export type Message = {
  id: string;
  channelId: string;
  authorId: string;
  username: string;
  content: string;
  createdAt: string;
};

export type Member = {
  id: string;
  username: string;
  avatarUrl?: string | null;
  status: string;
  role: string;
};

export type Invite = {
  code: string;
  serverId: string;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  username: string;
  email: string;
  role: string;
  serverCount: number;
  createdAt: string;
};

export type AdminServer = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  channelCount: number;
  createdAt: string;
};

export type AdminChannel = {
  id: string;
  serverId: string;
  serverName: string;
  name: string;
  kind: "text" | "voice";
  createdAt: string;
};
