"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  Expand,
  Gamepad2,
  Hash,
  Headphones,
  ImagePlus,
  KeyRound,
  Loader2,
  LogOut,
  Mic,
  MicOff,
  Plus,
  Send,
  Settings,
  Shield,
  SmilePlus,
  Trash2,
  UserCog,
  UserMinus,
  Volume2
} from "lucide-react";

import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { AdminChannel, AdminServer, AdminUser, Channel, Member, Message, Server, User } from "@/types/domain";

type AuthMode = "login" | "register";
type View = "chat" | "settings" | "admin";

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [textChannelId, setTextChannelId] = useState<string | null>(null);
  const [selectedVoiceChannelId, setSelectedVoiceChannelId] = useState<string | null>(null);
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState("未连接");
  const [view, setView] = useState<View>("chat");
  const [authReady, setAuthReady] = useState(false);
  const [voiceMembers, setVoiceMembers] = useState<Record<string, string>>({});
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>({});
  const [remoteLevels, setRemoteLevels] = useState<Record<string, number>>({});
  const [localLevel, setLocalLevel] = useState(0);
  const [inputGain, setInputGain] = useState(1);
  const [outputGain, setOutputGain] = useState(1);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const processedLocalStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingVoiceJoinRef = useRef<string | null>(null);
  const voiceChannelRef = useRef<string | null>(null);
  const textChannelRef = useRef<string | null>(null);
  const activeServerIdRef = useRef<string | null>(null);
  const textChannelIdRef = useRef<string | null>(null);
  const userRef = useRef<User | null>(null);
  const loadServersRef = useRef<() => void>(() => undefined);
  const loadMembersRef = useRef<() => void>(() => undefined);
  const wsRef = useRef<WebSocket | null>(null);

  const loadServers = useCallback(async () => {
    if (!token) return;
    const data = await api.servers(token);
    setServers(data);
    if (!activeServerId && data[0]) setActiveServerId(data[0].id);
    if (activeServerId && !data.some((server) => server.id === activeServerId)) {
      setActiveServerId(data[0]?.id ?? null);
    }
  }, [activeServerId, token]);

  useEffect(() => {
    const saved = window.localStorage.getItem("yapz_token");
    if (saved) setToken(saved);
    else setAuthReady(true);
    setInputGain(Number(window.localStorage.getItem("yapz_input_gain") ?? "1"));
    setOutputGain(Number(window.localStorage.getItem("yapz_output_gain") ?? "1"));
    setNoiseSuppression(window.localStorage.getItem("yapz_noise_suppression") !== "false");
    setRemoteVolumes(JSON.parse(window.localStorage.getItem("yapz_remote_volumes") ?? "{}"));
  }, []);

  useEffect(() => {
    if (!token) return;
    api
      .me(token)
      .then((nextUser) => {
        userRef.current = nextUser;
        setUser(nextUser);
        setAuthReady(true);
      })
      .catch(() => {
        window.localStorage.removeItem("yapz_token");
        setToken(null);
        setAuthReady(true);
      });
  }, [token]);

  useEffect(() => {
    if (token) void loadServers();
  }, [loadServers, token]);

  useEffect(() => {
    if (!token) return;
    api.iceServers(token).then(setIceServers).catch(() => setIceServers([{ urls: "stun:stun.l.google.com:19302" }]));
  }, [token]);

  useEffect(() => {
    loadServersRef.current = () => {
      void loadServers();
    };
  }, [loadServers]);

  const loadActiveMembers = useCallback(async () => {
    if (!token || !activeServerId) return;
    setMembers(await api.members(token, activeServerId));
  }, [activeServerId, token]);

  useEffect(() => {
    loadMembersRef.current = () => {
      void loadActiveMembers();
    };
  }, [loadActiveMembers]);

  useEffect(() => {
    if (!token || !activeServerId) {
      setChannels([]);
      setMembers([]);
      setMessages([]);
      setTextChannelId(null);
      setSelectedVoiceChannelId(null);
      return;
    }
    Promise.all([api.channels(token, activeServerId), api.members(token, activeServerId)]).then(([channelData, memberData]) => {
      setChannels(channelData);
      setMembers(memberData);
      setTextChannelId((current) => (current && channelData.some((ch) => ch.id === current && ch.kind === "text") ? current : channelData.find((ch) => ch.kind === "text")?.id ?? null));
      setSelectedVoiceChannelId((current) => (current && channelData.some((ch) => ch.id === current && ch.kind === "voice") ? current : channelData.find((ch) => ch.kind === "voice")?.id ?? null));
      if (voiceChannelId && !channelData.some((ch) => ch.id === voiceChannelId)) {
        closeVoice();
        setVoiceChannelId(null);
      }
    });
  }, [activeServerId, token, voiceChannelId]);

  const activeTextChannel = useMemo(() => channels.find((channel) => channel.id === textChannelId) ?? null, [textChannelId, channels]);
  const selectedVoiceChannel = useMemo(() => channels.find((channel) => channel.id === selectedVoiceChannelId) ?? null, [selectedVoiceChannelId, channels]);
  const activeServer = useMemo(() => servers.find((server) => server.id === activeServerId) ?? null, [activeServerId, servers]);

  useEffect(() => {
    if (!token || !textChannelId) return;
    api.messages(token, textChannelId).then(setMessages).catch(() => setMessages([]));
  }, [textChannelId, token]);

  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(api.wsUrl(token));
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus("在线");
      const serverID = activeServerIdRef.current;
      const channelID = textChannelIdRef.current;
      if (serverID) ws.send(JSON.stringify({ type: "join_server", serverId: serverID }));
      if (channelID) ws.send(JSON.stringify({ type: "join_channel", channelId: channelID }));
      loadMembersRef.current();
    };
    ws.onclose = () => setStatus("已断开");
    ws.onerror = () => setStatus("连接异常");
    ws.onmessage = async (event) => {
      const envelope = JSON.parse(event.data);
      if (envelope.type === "message_created" && envelope.payload) {
        const msg = envelope.payload as Message;
        if (msg.channelId === textChannelRef.current) {
          setMessages((prev) => (prev.some((item) => item.id === msg.id) ? prev : [...prev, msg]));
        }
      }
      if (envelope.type === "voice_join" && envelope.username) setStatus(`${envelope.username} 加入语音`);
      if (envelope.type === "voice_leave" && envelope.username) setStatus(`${envelope.username} 离开语音`);
      if (envelope.type === "member_removed") {
        loadServersRef.current();
        window.alert("你已被移出该服务器");
      }
      if (envelope.type === "member_status" && envelope.serverId === activeServerIdRef.current && envelope.payload) {
        const payload = envelope.payload as { userId: string; status: string };
        setMembers((prev) => prev.map((member) => (member.id === payload.userId ? { ...member, status: payload.status } : member)));
      }
      if (envelope.type === "member_snapshot" && envelope.serverId === activeServerIdRef.current && envelope.payload) {
        setMembers((envelope.payload ?? []) as Member[]);
      }
      if (envelope.type === "channel_joined" && pendingVoiceJoinRef.current === envelope.channelId) {
        pendingVoiceJoinRef.current = null;
        wsRef.current?.send(JSON.stringify({ type: "voice_join", channelId: envelope.channelId }));
      }
      const currentVoiceChannel = voiceChannelRef.current;
      const currentUser = userRef.current;
      if (!currentVoiceChannel || envelope.channelId !== currentVoiceChannel || !currentUser) return;
      if (envelope.type === "voice_members" && processedLocalStreamRef.current) {
        const existing = (envelope.payload ?? []) as Array<{ userId: string; username: string }>;
        for (const member of existing) {
          if (member.userId !== currentUser.id) await sendOffer(member.userId, member.username, currentVoiceChannel);
        }
      }
      if (envelope.type === "voice_join" && envelope.userId !== currentUser.id) {
        playJoinTone();
        setVoiceMembers((prev) => ({ ...prev, [envelope.userId]: envelope.username }));
      }
      if (envelope.type === "voice_leave") {
        peersRef.current[envelope.userId]?.close();
        delete peersRef.current[envelope.userId];
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[envelope.userId];
          return next;
        });
        setVoiceMembers((prev) => {
          const next = { ...prev };
          delete next[envelope.userId];
          return next;
        });
      }
      if (envelope.type === "voice_signal" && envelope.userId !== currentUser.id && processedLocalStreamRef.current) {
        const payload = envelope.payload;
        const peer = await ensurePeer(envelope.userId, envelope.username, currentVoiceChannel);
        if (payload.kind === "offer") {
          await peer.setRemoteDescription(payload.description);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendVoiceSignal(currentVoiceChannel, envelope.userId, { kind: "answer", description: answer });
        }
        if (payload.kind === "answer") await peer.setRemoteDescription(payload.description);
        if (payload.kind === "ice") await peer.addIceCandidate(payload.candidate);
      }
    };
    return () => ws.close();
  }, [token]);

  useEffect(() => {
    voiceChannelRef.current = voiceChannelId;
  }, [voiceChannelId]);

  useEffect(() => {
    textChannelRef.current = textChannelId;
    textChannelIdRef.current = textChannelId;
  }, [textChannelId]);

  useEffect(() => {
    activeServerIdRef.current = activeServerId;
  }, [activeServerId]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && activeServerId) {
      wsRef.current.send(JSON.stringify({ type: "join_server", serverId: activeServerId }));
      void loadActiveMembers();
    }
  }, [activeServerId, loadActiveMembers, status]);

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && textChannelId) {
      wsRef.current.send(JSON.stringify({ type: "join_channel", channelId: textChannelId }));
    }
  }, [textChannelId, status]);

  useEffect(() => {
    window.localStorage.setItem("yapz_input_gain", String(inputGain));
  }, [inputGain]);

  useEffect(() => {
    window.localStorage.setItem("yapz_output_gain", String(outputGain));
  }, [outputGain]);

  useEffect(() => {
    window.localStorage.setItem("yapz_noise_suppression", String(noiseSuppression));
  }, [noiseSuppression]);

  useEffect(() => {
    window.localStorage.setItem("yapz_remote_volumes", JSON.stringify(remoteVolumes));
  }, [remoteVolumes]);

  function handleAuth(nextToken: string, nextUser: User) {
    window.localStorage.setItem("yapz_token", nextToken);
    userRef.current = nextUser;
    setToken(nextToken);
    setUser(nextUser);
  }

  function logout() {
    window.localStorage.removeItem("yapz_token");
    wsRef.current?.close();
    voiceChannelRef.current = null;
    userRef.current = null;
    setToken(null);
    setUser(null);
    setServers([]);
    setChannels([]);
    setMessages([]);
    setMembers([]);
    setView("chat");
  }

  async function removeMember(memberID: string) {
    if (!token || !activeServerId) return;
    await api.removeMember(token, activeServerId, memberID);
    setMembers(await api.members(token, activeServerId));
    await loadServers();
  }

  async function leaveServer() {
    if (!activeServerId || !user || !window.confirm("确定退出当前服务器？")) return;
    await removeMember(user.id);
    setActiveServerId(null);
  }

  function sendVoiceSignal(channelID: string, targetID: string, payload: unknown) {
    wsRef.current?.send(JSON.stringify({ type: "voice_signal", channelId: channelID, targetId: targetID, payload }));
  }

  function closeVoice() {
    Object.values(peersRef.current).forEach((peer) => peer.close());
    peersRef.current = {};
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    processedLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    processedLocalStreamRef.current = null;
    micGainRef.current = null;
    setRemoteStreams({});
    setVoiceMembers({});
  }

  async function prepareLocalAudio() {
    const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression, autoGainControl: true }, video: false });
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    await context.resume();
    const source = context.createMediaStreamSource(sourceStream);
    const gain = context.createGain();
    gain.gain.value = inputGain;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const destination = context.createMediaStreamDestination();
    source.connect(gain);
    gain.connect(analyser);
    gain.connect(destination);
    watchAudioLevel(analyser, setLocalLevel);
    localStreamRef.current = sourceStream;
    processedLocalStreamRef.current = destination.stream;
    micGainRef.current = gain;
  }

  async function ensurePeer(targetID: string, targetName: string, channelID: string) {
    if (peersRef.current[targetID]) return peersRef.current[targetID];
    const stream = processedLocalStreamRef.current;
    if (!stream) throw new Error("missing local stream");
    const peer = new RTCPeerConnection({ iceServers, iceTransportPolicy: "all" });
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (event.candidate) sendVoiceSignal(channelID, targetID, { kind: "ice", candidate: event.candidate });
    };
    peer.ontrack = (event) => {
      setRemoteStreams((prev) => ({ ...prev, [targetID]: event.streams[0] }));
      setVoiceMembers((prev) => ({ ...prev, [targetID]: targetName }));
    };
    peersRef.current[targetID] = peer;
    return peer;
  }

  async function sendOffer(targetID: string, targetName: string, channelID: string) {
    const peer = await ensurePeer(targetID, targetName, channelID);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendVoiceSignal(channelID, targetID, { kind: "offer", description: offer });
    setVoiceMembers((prev) => ({ ...prev, [targetID]: targetName }));
  }

  useEffect(() => {
    return () => closeVoice();
  }, []);

  useEffect(() => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    processedLocalStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, [muted]);

  useEffect(() => {
    if (micGainRef.current) micGainRef.current.gain.value = inputGain;
  }, [inputGain]);

  if (!authReady) return <LoadingScreen />;
  if (!token || !user) return <AuthScreen onAuthed={handleAuth} />;

  return (
    <main className="flex min-h-screen bg-ink text-zinc-100 max-lg:flex-col lg:h-screen">
      <aside className="flex border-r border-line bg-[#14171d] p-3 max-lg:w-full max-lg:flex-row max-lg:gap-3 max-lg:overflow-x-auto lg:w-[76px] lg:flex-col lg:items-center lg:gap-3 lg:py-4">
        <Button title="聊天主页" onClick={() => setView("chat")} className="h-12 w-12 p-0">
          <Gamepad2 size={24} />
        </Button>
        <div className="h-px w-10 bg-line" />
        {servers.map((server) => (
          <button
            key={server.id}
            title={server.name}
            onClick={() => {
              setActiveServerId(server.id);
              setView("chat");
            }}
            className={cn(
              "grid h-12 w-12 place-items-center rounded-lg border text-sm font-bold transition",
              activeServerId === server.id && view === "chat" ? "border-mint bg-mint text-ink" : "border-line bg-rail text-zinc-200 hover:border-zinc-400"
            )}
          >
            {server.iconText.slice(0, 2)}
          </button>
        ))}
        <CreateServerButton token={token} onCreated={loadServers} />
      </aside>

      <aside className="flex flex-col border-r border-line bg-panel max-lg:max-h-[42vh] max-lg:w-full lg:w-[306px]">
        <div className="border-b border-line px-4 py-4">
          <p className="text-xs uppercase text-zinc-500">当前服务器</p>
          <h1 className="mt-1 truncate text-lg font-semibold">{activeServer?.name ?? "创建或加入服务器"}</h1>
          <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{activeServer?.description || "通过邀请码加入朋友的频道，或创建自己的游戏空间。"}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <JoinInviteButton token={token} onJoined={loadServers} />
            <InviteButton token={token} server={activeServer} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <ChannelGroup title="文字频道" kind="text" channels={channels} activeChannelId={textChannelId} onSelect={setTextChannelId} token={token} server={activeServer} onCreated={(channel) => setChannels((prev) => [...prev, channel])} onRenamed={(channel) => setChannels((prev) => prev.map((item) => (item.id === channel.id ? channel : item)))} onDeleted={(id) => setChannels((prev) => prev.filter((channel) => channel.id !== id))} />
          <ChannelGroup title="语音频道" kind="voice" channels={channels} activeChannelId={selectedVoiceChannelId} onSelect={setSelectedVoiceChannelId} token={token} server={activeServer} onCreated={(channel) => setChannels((prev) => [...prev, channel])} onRenamed={(channel) => setChannels((prev) => prev.map((item) => (item.id === channel.id ? channel : item)))} onDeleted={(id) => setChannels((prev) => prev.filter((channel) => channel.id !== id))} />
        </div>

        <div className="border-t border-line bg-[#171a21] p-3">
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-coral font-bold text-white">{user.username[0]?.toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.username}</p>
              <p className="text-xs text-mint">{status}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button title="设置" variant={view === "settings" ? "default" : "secondary"} onClick={() => setView("settings")}>
              <Settings size={16} />
            </Button>
            <Button title="管理员" variant={view === "admin" ? "default" : "secondary"} onClick={() => setView("admin")} disabled={user.role !== "admin"}>
              <UserCog size={16} />
            </Button>
            <Button title="退出" variant="secondary" onClick={logout}>
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>

      {view === "settings" ? (
        <SettingsView token={token} user={user} onUpdated={(updatedUser) => {
          setUser(updatedUser);
          window.localStorage.setItem("yapz_user", JSON.stringify(updatedUser));
        }} />
      ) : view === "admin" ? (
        <AdminView token={token} />
      ) : (
        <>
          <section className="flex min-h-[58vh] min-w-0 flex-1 flex-col lg:min-h-0">
            <header className="flex h-16 items-center justify-between border-b border-line bg-[#181b22] px-5">
              <div className="flex items-center gap-3">
                <Hash className="text-zinc-500" size={22} />
                <div>
                  <h2 className="text-base font-semibold">{activeTextChannel?.name ?? "暂无文字频道"}</h2>
                  <p className="text-xs text-zinc-500">{selectedVoiceChannel ? `语音：${selectedVoiceChannel.name}` : "文字频道"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Shield size={16} />
                <span>{activeServer?.role === "owner" ? "服务器拥有者" : "成员"}</span>
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <div className="flex min-h-[420px] min-w-0 flex-1 flex-col">
                <ChatPanel token={token} channel={activeTextChannel} messages={messages} />
              </div>
              {selectedVoiceChannel ? (
                <VoicePanel
                channel={selectedVoiceChannel}
                user={user}
                joined={voiceChannelId === selectedVoiceChannel.id}
                muted={muted}
                members={voiceMembers}
                remoteStreams={remoteStreams}
                remoteVolumes={remoteVolumes}
                inputGain={inputGain}
                outputGain={outputGain}
                noiseSuppression={noiseSuppression}
                onInputGain={setInputGain}
                onOutputGain={setOutputGain}
                onNoiseSuppression={setNoiseSuppression}
                onRemoteVolume={(id, value) => setRemoteVolumes((prev) => ({ ...prev, [id]: value }))}
                onRemoteLevel={(id, value) => setRemoteLevels((prev) => ({ ...prev, [id]: value }))}
                localLevel={localLevel}
                remoteLevels={remoteLevels}
                onToggleMute={() => setMuted((value) => !value)}
                onJoin={async () => {
                  if (wsRef.current?.readyState !== WebSocket.OPEN) {
                    window.alert("实时连接还未就绪，请稍后再加入语音。");
                    return;
                  }
                  await prepareLocalAudio();
                  voiceChannelRef.current = selectedVoiceChannel.id;
                  setVoiceChannelId(selectedVoiceChannel.id);
                  setVoiceMembers({ [user.id]: user.username });
                  pendingVoiceJoinRef.current = selectedVoiceChannel.id;
                  wsRef.current?.send(JSON.stringify({ type: "join_channel", channelId: selectedVoiceChannel.id }));
                  playJoinTone();
                }}
                onLeave={() => {
                  wsRef.current?.send(JSON.stringify({ type: "voice_leave", channelId: selectedVoiceChannel.id }));
                  voiceChannelRef.current = null;
                  setVoiceChannelId(null);
                  closeVoice();
                }}
              />
              ) : null}
            </div>
          </section>
          <MembersPanel members={members} currentUser={user} activeServer={activeServer} onKick={removeMember} onLeave={leaveServer} />
        </>
      )}
    </main>
  );
}

function playJoinTone() {
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0.08;
  gain.connect(context.destination);
  const first = context.createOscillator();
  const second = context.createOscillator();
  first.frequency.value = 523.25;
  second.frequency.value = 659.25;
  first.connect(gain);
  second.connect(gain);
  first.start();
  second.start(context.currentTime + 0.08);
  first.stop(context.currentTime + 0.12);
  second.stop(context.currentTime + 0.22);
  window.setTimeout(() => context.close(), 400);
}

function watchAudioLevel(analyser: AnalyserNode, onLevel: (value: number) => void) {
  const data = new Uint8Array(analyser.frequencyBinCount);
  let frame = 0;
  const tick = () => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, item) => sum + item, 0) / data.length;
    onLevel(Math.min(1, avg / 90));
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(frame);
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-ink text-zinc-300">
      <div className="flex items-center gap-3 text-sm"><Loader2 className="animate-spin text-mint" size={18} /> 正在恢复登录状态...</div>
    </main>
  );
}

function AuthScreen({ onAuthed }: { onAuthed: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response =
        mode === "login"
          ? await api.login({ login: String(form.get("login")), password: String(form.get("password")) })
          : await api.register({ username: String(form.get("username")), email: String(form.get("email")), password: String(form.get("password")) });
      onAuthed(response.token, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-6">
      <Card className="w-full max-w-[420px] p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-mint text-ink">
            <Gamepad2 size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Yapz</h1>
            <p className="text-sm text-zinc-400">游戏频道聊天与语音开黑平台</p>
          </div>
        </div>
        <div className="mb-5 grid grid-cols-2 rounded-lg bg-[#12151b] p-1">
          <Button type="button" variant={mode === "login" ? "default" : "ghost"} onClick={() => setMode("login")}>登录</Button>
          <Button type="button" variant={mode === "register" ? "default" : "ghost"} onClick={() => setMode("register")}>注册</Button>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {mode === "register" && (
            <>
              <Field name="username" label="用户名" placeholder="例如 ShadowCarry" />
              <Field name="email" label="邮箱" type="email" placeholder="you@example.com" />
            </>
          )}
          {mode === "login" && <Field name="login" label="用户名或邮箱" placeholder="you@example.com" />}
          <Field name="password" label="密码" type="password" placeholder="至少 8 位" />
          {error && <p className="rounded-md border border-coral/50 bg-coral/10 px-3 py-2 text-sm text-coral">{error}</p>}
          <Button disabled={loading} className="w-full">{loading ? "处理中..." : mode === "login" ? "进入 Yapz" : "创建账号"}</Button>
        </form>
      </Card>
    </main>
  );
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <Label>
      <span className="mb-2 block">{label}</span>
      <Input {...props} required />
    </Label>
  );
}

function ChannelGroup(props: {
  title: string;
  kind: "text" | "voice";
  channels: Channel[];
  activeChannelId: string | null;
  onSelect: (id: string) => void;
  token: string;
  server: Server | null;
  onCreated: (channel: Channel) => void;
  onRenamed: (channel: Channel) => void;
  onDeleted: (channelID: string) => void;
}) {
  const list = props.channels.filter((channel) => channel.kind === props.kind);
  const [creating, setCreating] = useState(false);
  const disabled = !props.server || creating;
  const canDelete = props.server?.role === "owner";

  async function createChannel() {
    if (!props.server) return;
    const name = window.prompt(`新建${props.kind === "text" ? "文字" : "语音"}频道名称`);
    if (!name) return;
    const channel = await api.createChannel(props.token, props.server.id, { name, kind: props.kind });
    props.onCreated(channel);
  }

  async function deleteChannel(channel: Channel) {
    if (!props.server || !window.confirm(`确定删除频道 ${channel.name}？`)) return;
    await api.deleteChannel(props.token, props.server.id, channel.id);
    props.onDeleted(channel.id);
  }

  async function renameChannel(channel: Channel) {
    if (!props.server) return;
    const name = window.prompt("新的频道名称", channel.name);
    if (!name || name === channel.name) return;
    const updated = await api.renameChannel(props.token, props.server.id, channel.id, name);
    props.onRenamed(updated);
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase text-zinc-500">
        <span>{props.title}</span>
        <Button title={props.server ? "添加频道" : "请先创建或加入服务器"} variant="secondary" disabled={disabled} onClick={async () => { setCreating(true); try { await createChannel(); } finally { setCreating(false); } }} className="h-10 w-10 p-0">
          <Plus size={21} />
        </Button>
      </div>
      {!props.server ? <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-zinc-500">创建或加入服务器后可添加频道</p> : null}
      <div className="space-y-1">
        {list.map((channel) => (
          <div key={channel.id} className={cn("group flex items-center rounded-md transition", props.activeChannelId === channel.id ? "bg-rail text-white" : "text-zinc-400 hover:bg-[#232831] hover:text-zinc-100")}>
            <button onClick={() => props.onSelect(channel.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm">
              {channel.kind === "voice" ? <Volume2 size={17} /> : <Hash size={17} />}
              <span className="truncate">{channel.name}</span>
            </button>
            {canDelete ? (
              <div className="mr-1 flex opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                <button title="重命名频道" onClick={() => renameChannel(channel)} className="rounded p-1.5 text-zinc-500 hover:bg-rail hover:text-white"><Settings size={15} /></button>
                <button title="删除频道" onClick={() => deleteChannel(channel)} className="rounded p-1.5 text-zinc-500 hover:bg-coral hover:text-white"><Trash2 size={15} /></button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function JoinInviteButton({ token, onJoined }: { token: string; onJoined: () => Promise<void> }) {
  async function join() {
    const code = window.prompt("输入朋友给你的邀请码");
    if (!code) return;
    await api.joinInvite(token, code);
    await onJoined();
  }
  return <Button variant="secondary" onClick={join}>加入</Button>;
}

function InviteButton({ token, server }: { token: string; server: Server | null }) {
  async function invite() {
    if (!server) return;
    const data = await api.invite(token, server.id);
    await navigator.clipboard?.writeText(data.code);
    window.alert(`邀请码：${data.code}\n已复制到剪贴板`);
  }
  return <Button variant="secondary" disabled={!server} onClick={invite}><Copy size={15} /> 邀请</Button>;
}

function ChatPanel({ token, channel, messages }: { token: string; channel: Channel | null; messages: Message[] }) {
  const [content, setContent] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<Message | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!channel || (!content.trim() && !image) || sending) return;
    setSending(true);
    setError("");
    try {
      let uploaded: { url: string; name: string; size: number } | null = null;
      if (image) uploaded = await api.uploadImage(token, image);
      await api.sendMessage(token, channel.id, {
        content: content.trim(),
        imageUrl: uploaded?.url,
        imageName: uploaded?.name,
        imageSize: uploaded?.size
      });
      setContent("");
      setImage(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 max-lg:max-h-[52vh]">
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-zinc-500">
            <div><Hash className="mx-auto mb-3" size={34} /><p className="text-lg font-semibold text-zinc-300">这里还没有消息</p><p className="mt-1 text-sm">发送第一条消息开始组队。</p></div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((message) => (
              <div key={message.id} className="flex gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rail text-sm font-bold">{message.username[0]?.toUpperCase()}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2"><p className="font-semibold">{message.username}</p><time className="text-xs text-zinc-500">{new Date(message.createdAt).toLocaleString()}</time></div>
                  {message.content ? <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{message.content}</p> : null}
                  {message.imageUrl ? (
                    <button type="button" onClick={() => setPreview(message)} className="group relative mt-3 block max-w-[520px] overflow-hidden rounded-md border border-line bg-[#11151d] text-left">
                      <img src={api.assetUrl(message.imageUrl)} alt={message.imageName ?? "上传图片"} className="max-h-[280px] w-full object-contain sm:max-h-[360px]" />
                      <span className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md bg-black/50 text-white opacity-0 transition group-hover:opacity-100"><Expand size={16} /></span>
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
      <form onSubmit={send} className="border-t border-line bg-[#181b22] p-4">
        {image ? <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-line bg-[#101319] px-3 py-2 text-xs text-zinc-400"><span className="truncate">{image.name}</span><button type="button" className="text-coral" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }}>移除</button></div> : null}
        {error ? <p className="mb-2 text-sm text-coral">{error}</p> : null}
        {emojiOpen ? <EmojiPicker onPick={(emoji) => { setContent((value) => value + emoji); setEmojiOpen(false); }} /> : null}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-[#101319] px-3 py-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
          <Button title="上传图片" type="button" variant="secondary" onClick={() => fileRef.current?.click()} className="h-9 w-9 shrink-0 p-0"><ImagePlus size={17} /></Button>
          <Button title="选择表情" type="button" variant="secondary" onClick={() => setEmojiOpen((value) => !value)} className="h-9 w-9 shrink-0 p-0"><SmilePlus size={17} /></Button>
          <input value={content} onChange={(event) => setContent(event.target.value)} placeholder={channel ? `发送消息到 #${channel.name}` : "请选择频道"} className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
          <Button title="发送" disabled={sending || !channel || (!content.trim() && !image)} className="h-9 w-9 shrink-0 p-0">{sending ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}</Button>
        </div>
      </form>
      {preview?.imageUrl ? <ImagePreview message={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

const emojis = ["😀", "😂", "🤣", "😊", "😍", "😎", "😭", "😡", "👍", "👎", "👏", "🙏", "🔥", "💯", "🎮", "🏆", "⚔️", "🛡️", "❤️", "💔", "😴", "🤔", "😅", "🥳"];

function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="mb-2 grid grid-cols-8 gap-1 rounded-md border border-line bg-[#101319] p-2 sm:grid-cols-12">
      {emojis.map((emoji) => <button key={emoji} type="button" onClick={() => onPick(emoji)} className="grid h-9 w-9 place-items-center rounded-md text-xl hover:bg-rail">{emoji}</button>)}
    </div>
  );
}

function ImagePreview({ message, onClose }: { message: Message; onClose: () => void }) {
  const imageUrl = message.imageUrl ? api.assetUrl(message.imageUrl) : "";
  async function saveImage() {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = message.imageName || "yapz-image";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-full w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm text-zinc-300"><p className="truncate font-medium">{message.imageName ?? "图片预览"}</p><p className="text-xs text-zinc-500">{message.username}</p></div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={saveImage}><Download size={16} /> 保存</Button>
            <Button type="button" variant="secondary" onClick={onClose}>关闭</Button>
          </div>
        </div>
        <img src={imageUrl} alt={message.imageName ?? "图片预览"} className="max-h-[82vh] w-full rounded-md object-contain" />
      </div>
    </div>
  );
}

function VoicePanel(props: {
  channel: Channel;
  user: User;
  joined: boolean;
  muted: boolean;
  members: Record<string, string>;
  remoteStreams: Record<string, MediaStream>;
  remoteVolumes: Record<string, number>;
  remoteLevels: Record<string, number>;
  localLevel: number;
  inputGain: number;
  outputGain: number;
  noiseSuppression: boolean;
  onInputGain: (value: number) => void;
  onOutputGain: (value: number) => void;
  onNoiseSuppression: (value: boolean) => void;
  onRemoteVolume: (id: string, value: number) => void;
  onRemoteLevel: (id: string, value: number) => void;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
}) {
  const remoteEntries = Object.entries(props.remoteStreams);
  const memberEntries = Object.entries(props.members);
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(memberEntries.length / pageSize));
  const visibleMembers = memberEntries.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return (
    <div className="flex min-h-0 flex-col items-center overflow-y-auto border-t border-line px-4 py-6 text-center lg:w-[380px] lg:border-l lg:border-t-0">
      <div className="grid h-24 w-24 place-items-center rounded-xl bg-rail text-mint"><Headphones size={48} /></div>
      <h2 className="mt-6 text-2xl font-bold">{props.channel.name}</h2>
      <p className="mt-2 max-w-[560px] text-sm leading-6 text-zinc-400">语音使用浏览器 WebRTC 传输，媒体流默认通过 DTLS-SRTP 加密；服务器只转发信令，不接触音频内容。</p>
      <div className="mt-8 flex items-center gap-3">
        {!props.joined ? <Button onClick={props.onJoin}>加入语音</Button> : <><Button variant="secondary" onClick={props.onToggleMute} className="h-12 w-12 p-0">{props.muted ? <MicOff size={20} /> : <Mic size={20} />}</Button><Button variant="destructive" onClick={props.onLeave}>离开语音</Button></>}
      </div>
      {props.joined && <p className="mt-4 text-sm text-zinc-400">{props.user.username} 正在频道中{props.muted ? "，麦克风已静音" : ""}</p>}
      {props.joined ? (
        <Card className="mt-6 w-full max-w-[720px] p-4 text-left">
          <div className="grid gap-4 sm:grid-cols-2">
            <VolumeControl label="我的麦克风音量" value={props.inputGain} onChange={props.onInputGain} />
            <VolumeControl label="听筒总音量" value={props.outputGain} onChange={props.onOutputGain} />
          </div>
          <label className="mt-4 flex items-center justify-between rounded-md border border-line bg-[#11151d] px-3 py-2 text-sm text-zinc-300">
            <span>浏览器降噪</span>
            <input type="checkbox" checked={props.noiseSuppression} onChange={(event) => props.onNoiseSuppression(event.target.checked)} className="h-4 w-4 accent-mint" />
          </label>
          <p className="mt-2 text-xs text-zinc-500">降噪、回声消除和自动增益由浏览器处理，切换后下次加入语音生效。</p>
        </Card>
      ) : null}
      <div className="mt-6 grid max-h-[360px] w-full max-w-[720px] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {visibleMembers.map(([id, name]) => (
          <Card key={id} className="p-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{name}</p>
                <p className="text-xs text-zinc-500">{id === props.user.id ? "本地加密音频" : "远端加密音频"}</p>
              </div>
              <Badge>加密</Badge>
            </div>
            {id !== props.user.id ? <VolumeControl label="个人听筒" value={props.remoteVolumes[id] ?? 1} onChange={(value) => props.onRemoteVolume(id, value)} compact /> : null}
            <LevelMeter level={id === props.user.id ? props.localLevel : props.remoteLevels[id] ?? 0} />
          </Card>
        ))}
      </div>
      <PaginationControls page={Math.min(page, pageCount)} pageCount={pageCount} onPage={setPage} />
      {remoteEntries.map(([id, stream]) => <RemoteAudio key={id} stream={stream} volume={(props.remoteVolumes[id] ?? 1) * props.outputGain} onLevel={(value) => props.onRemoteLevel(id, value)} />)}
    </div>
  );
}

function VolumeControl({ label, value, onChange, compact = false }: { label: string; value: number; onChange: (value: number) => void; compact?: boolean }) {
  return (
    <label className={cn("block", compact ? "mt-3" : "")}>
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input className="w-full accent-mint" type="range" min="0" max="2" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#11151d]">
      <div className={cn("h-full rounded-full transition-all", level > 0.72 ? "bg-coral" : level > 0.38 ? "bg-amber" : "bg-mint")} style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

function RemoteAudio({ stream, volume, onLevel }: { stream: MediaStream; volume: number; onLevel: (value: number) => void }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const onLevelRef = useRef(onLevel);
  useEffect(() => {
    onLevelRef.current = onLevel;
  }, [onLevel]);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    ref.current.play().then(() => setPlayBlocked(false)).catch(() => setPlayBlocked(true));
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);
  useEffect(() => {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const stop = watchAudioLevel(analyser, (value) => onLevelRef.current(value));
    return () => {
      stop();
      context.close();
    };
  }, [stream]);
  return (
    <>
      <audio ref={ref} autoPlay playsInline />
      {playBlocked ? <button className="mt-2 rounded-md border border-amber px-3 py-1 text-xs text-amber" onClick={() => ref.current?.play().then(() => setPlayBlocked(false))}>点击恢复远端声音</button> : null}
    </>
  );
}

function MembersPanel({
  members,
  currentUser,
  activeServer,
  onKick,
  onLeave
}: {
  members: Member[];
  currentUser: User;
  activeServer: Server | null;
  onKick: (memberID: string) => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const canKick = activeServer?.role === "owner";
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleMembers = members.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);
  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-[#171a21] max-lg:w-full lg:w-[252px]">
      <div className="border-b border-line px-4 py-4">
        <p className="text-xs uppercase text-zinc-500">在线成员</p>
        <p className="mt-1 text-sm text-zinc-300">{members.length} 位成员</p>
        {activeServer && activeServer.role !== "owner" ? <Button variant="secondary" onClick={onLeave} className="mt-3 w-full">退出服务器</Button> : null}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {visibleMembers.map((member) => (
          <div key={member.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-rail">
            <div className="relative grid h-9 w-9 place-items-center rounded-lg bg-[#2c3340] text-sm font-bold">{member.username[0]?.toUpperCase()}<span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#171a21]", member.status === "online" ? "bg-mint" : "bg-coral")} /></div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.username}</p><p className={cn("text-xs", member.status === "online" ? "text-mint" : "text-coral")}>{member.status === "online" ? "在线" : "离线"} · {member.role}</p></div>
            {canKick && member.id !== currentUser.id && member.role !== "owner" ? (
              <Button title="踢出成员" variant="ghost" onClick={() => onKick(member.id)} className="h-8 w-8 p-0 text-coral"><UserMinus size={15} /></Button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <PaginationControls page={currentPage} pageCount={pageCount} onPage={setPage} />
      </div>
    </aside>
  );
}

function SettingsView({ token, user, onUpdated }: { token: string; user: User; onUpdated: (user: User) => void }) {
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await api.updateMe(token, { username: String(form.get("username")), email: String(form.get("email")) });
      onUpdated(updated);
      setProfileMessage("账号资料已保存");
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "保存失败");
    }
  }
  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await api.changePassword(token, { currentPassword: String(form.get("currentPassword")), nextPassword: String(form.get("nextPassword")) });
      setPasswordMessage("密码已修改");
    } catch (err) {
      setPasswordMessage(err instanceof Error ? err.message : "密码修改失败");
      return;
    }
    event.currentTarget.reset();
  }
  return (
    <section className="flex-1 overflow-y-auto p-8">
      <div className="max-w-[720px]">
        <h2 className="text-2xl font-bold">个人中心</h2>
        <p className="mt-2 text-sm text-zinc-400">管理账号资料和安全信息。</p>
        <Card className="mt-6 p-5">
          <div className="mb-5 flex items-center gap-3"><UserCog className="text-mint" /><div><h3 className="font-semibold">账号资料</h3><p className="text-sm text-zinc-500">修改用户名和登录邮箱。</p></div></div>
          <form onSubmit={submitProfile} className="space-y-4">
            <Field name="username" label="用户名" defaultValue={user.username} />
            <Field name="email" label="邮箱" type="email" defaultValue={user.email} />
            {profileMessage && <p className={cn("text-sm", profileMessage.includes("已") ? "text-mint" : "text-coral")}>{profileMessage}</p>}
            <Button>保存账号资料</Button>
          </form>
        </Card>
        <Card className="mt-6 p-5">
          <div className="mb-5 flex items-center gap-3"><KeyRound className="text-mint" /><div><h3 className="font-semibold">修改密码</h3><p className="text-sm text-zinc-500">{user.email}</p></div></div>
          <form onSubmit={submitPassword} className="space-y-4">
            <Field name="currentPassword" label="当前密码" type="password" />
            <Field name="nextPassword" label="新密码" type="password" />
            {passwordMessage && <p className={cn("text-sm", passwordMessage.includes("已") ? "text-mint" : "text-coral")}>{passwordMessage}</p>}
            <Button>保存新密码</Button>
          </form>
        </Card>
      </div>
    </section>
  );
}

function AdminView({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [servers, setServers] = useState<AdminServer[]>([]);
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [serverPage, setServerPage] = useState(1);
  const [channelPage, setChannelPage] = useState(1);
  const pageSize = 10;
  const load = useCallback(async () => {
    const [u, s, c] = await Promise.all([api.adminUsers(token), api.adminServers(token), api.adminChannels(token)]);
    setUsers(u);
    setServers(s);
    setChannels(c);
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  async function deleteChannel(id: string) {
    if (!window.confirm("确定删除这个频道？")) return;
    await api.deleteAdminChannel(token, id);
    await load();
  }
  async function setRole(user: AdminUser, role: "user" | "admin") {
    if (user.role === role) return;
    if (!window.confirm(`确定将 ${user.username} 设置为 ${role === "admin" ? "管理员" : "普通用户"}？`)) return;
    await api.setUserRole(token, user.id, role);
    await load();
  }
  const usersPage = paged(users, userPage, pageSize);
  const serversPage = paged(servers, serverPage, pageSize);
  const channelsPage = paged(channels, channelPage, pageSize);
  return (
    <section className="flex-1 overflow-y-auto p-8">
      <h2 className="text-2xl font-bold">管理员控制台</h2>
      <p className="mt-2 text-sm text-zinc-400">管理所有账号、服务器和频道。</p>
      <div className="mt-6 grid grid-cols-3 gap-4">
        <Stat label="账号" value={users.length} />
        <Stat label="服务器" value={servers.length} />
        <Stat label="频道" value={channels.length} />
      </div>
      <Card className="mt-6 p-5">
        <h3 className="mb-4 font-semibold">账号</h3>
        <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">{usersPage.items.map((user) => <Row key={user.id} left={`${user.username} · ${user.email}`} right={<><Badge>{user.role}</Badge><span>{user.serverCount} 个服务器</span><Button variant={user.role === "admin" ? "default" : "secondary"} onClick={() => setRole(user, user.role === "admin" ? "user" : "admin")} className="h-8 px-2">{user.role === "admin" ? "取消管理员" : "设为管理员"}</Button></>} />)}</div>
        <PaginationControls page={usersPage.page} pageCount={usersPage.pageCount} onPage={setUserPage} />
      </Card>
      <Card className="mt-6 p-5">
        <h3 className="mb-4 font-semibold">服务器</h3>
        <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">{serversPage.items.map((server) => <Row key={server.id} left={server.name} right={<span>{server.ownerName} · {server.memberCount} 成员 · {server.channelCount} 频道</span>} />)}</div>
        <PaginationControls page={serversPage.page} pageCount={serversPage.pageCount} onPage={setServerPage} />
      </Card>
      <Card className="mt-6 p-5">
        <h3 className="mb-4 font-semibold">频道</h3>
        <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">{channelsPage.items.map((channel) => <Row key={channel.id} left={`${channel.serverName} / ${channel.name}`} right={<><Badge>{channel.kind}</Badge><Button variant="destructive" onClick={() => deleteChannel(channel.id)} className="h-8 px-2"><Trash2 size={14} /></Button></>} />)}</div>
        <PaginationControls page={channelsPage.page} pageCount={channelsPage.pageCount} onPage={setChannelPage} />
      </Card>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <Card className="p-4"><p className="text-sm text-zinc-500">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></Card>;
}

function Row({ left, right }: { left: string; right: React.ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-md border border-line bg-[#151922] px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 truncate">{left}</span><div className="flex shrink-0 flex-wrap items-center gap-2 text-zinc-400">{right}</div></div>;
}

function PaginationControls({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-2 text-xs text-zinc-400">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-8 px-2">上一页</Button>
      <span>{page} / {pageCount}</span>
      <Button variant="secondary" disabled={page >= pageCount} onClick={() => onPage(page + 1)} className="h-8 px-2">下一页</Button>
    </div>
  );
}

function paged<T>(items: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  return {
    page: currentPage,
    pageCount,
    items: items.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  };
}

function CreateServerButton({ token, onCreated }: { token: string; onCreated: () => Promise<void> }) {
  async function create() {
    const name = window.prompt("服务器名称");
    if (!name) return;
    await api.createServer(token, { name, description: "新的游戏开黑频道", iconText: name.slice(0, 2).toUpperCase() });
    await onCreated();
  }
  return <button title="创建服务器" onClick={create} className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-line text-zinc-400 hover:border-mint hover:text-mint"><Plus size={22} /></button>;
}
