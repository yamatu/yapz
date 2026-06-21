import type { AdminChannel, AdminServer, AdminUser, Channel, Invite, Member, Message, Server, User } from "@/types/domain";

const configuredURL = process.env.NEXT_PUBLIC_API_URL;
const API_URL = configuredURL ?? "";

type AuthResponse = {
  token: string;
  user: User;
};

async function request<T>(path: string, token?: string | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data as T;
}

async function requestList<T>(path: string, token: string): Promise<T[]> {
  const data = await request<T[] | null>(path, token);
  return Array.isArray(data) ? data : [];
}

export const api = {
  url: API_URL,
  wsUrl: (token: string) => {
    if (configuredURL) {
      return `${configuredURL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  },
  register: (body: { username: string; email: string; password: string }) =>
    request<AuthResponse>("/api/auth/register", null, { method: "POST", body: JSON.stringify(body) }),
  login: (body: { login: string; password: string }) =>
    request<AuthResponse>("/api/auth/login", null, { method: "POST", body: JSON.stringify(body) }),
  me: (token: string) => request<User>("/api/me", token),
  changePassword: (token: string, body: { currentPassword: string; nextPassword: string }) =>
    request<{ status: string }>("/api/me/password", token, { method: "POST", body: JSON.stringify(body) }),
  servers: (token: string) => requestList<Server>("/api/servers", token),
  createServer: (token: string, body: { name: string; description: string; iconText: string }) =>
    request<{ server: Server; channels: Channel[] }>("/api/servers", token, { method: "POST", body: JSON.stringify(body) }),
  invite: (token: string, serverId: string) => request<Invite>(`/api/servers/${serverId}/invite`, token),
  joinInvite: (token: string, code: string) =>
    request<Server>("/api/invites/join", token, { method: "POST", body: JSON.stringify({ code }) }),
  channels: (token: string, serverId: string) => requestList<Channel>(`/api/servers/${serverId}/channels`, token),
  createChannel: (token: string, serverId: string, body: { name: string; kind: "text" | "voice" }) =>
    request<Channel>(`/api/servers/${serverId}/channels`, token, { method: "POST", body: JSON.stringify(body) }),
  renameChannel: (token: string, serverId: string, channelId: string, name: string) =>
    request<Channel>(`/api/servers/${serverId}/channels/${channelId}`, token, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteChannel: (token: string, serverId: string, channelId: string) =>
    request<{ status: string }>(`/api/servers/${serverId}/channels/${channelId}`, token, { method: "DELETE" }),
  members: (token: string, serverId: string) => requestList<Member>(`/api/servers/${serverId}/members`, token),
  removeMember: (token: string, serverId: string, memberId: string) =>
    request<{ status: string }>(`/api/servers/${serverId}/members/${memberId}`, token, { method: "DELETE" }),
  messages: (token: string, channelId: string) => requestList<Message>(`/api/channels/${channelId}/messages?limit=80`, token),
  sendMessage: (token: string, channelId: string, content: string) =>
    request<Message>(`/api/channels/${channelId}/messages`, token, { method: "POST", body: JSON.stringify({ content }) }),
  adminUsers: (token: string) => requestList<AdminUser>("/api/admin/users", token),
  adminServers: (token: string) => requestList<AdminServer>("/api/admin/servers", token),
  adminChannels: (token: string) => requestList<AdminChannel>("/api/admin/channels", token),
  deleteAdminChannel: (token: string, channelId: string) =>
    request<{ status: string }>(`/api/admin/channels/${channelId}`, token, { method: "DELETE" })
};

export function rtcIceServers(): RTCIceServer[] {
  const urls = process.env.NEXT_PUBLIC_RTC_ICE_URLS?.split(",").map((item) => item.trim()).filter(Boolean);
  if (!urls?.length) return [{ urls: "stun:stun.l.google.com:19302" }];
  return [
    {
      urls,
      username: process.env.NEXT_PUBLIC_RTC_ICE_USERNAME,
      credential: process.env.NEXT_PUBLIC_RTC_ICE_CREDENTIAL
    }
  ];
}
