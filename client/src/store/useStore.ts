import { create } from 'zustand';

export type ConnectionStatus = 
  | "idle" 
  | "creating" 
  | "waiting" 
  | "joining" 
  | "connecting" 
  | "connected" 
  | "disconnected" 
  | "failed";

export type Role = "initiator" | "joiner" | null;
export type FlowState = "home" | "send-pick" | "send-wait" | "receive-input";

export type TransferDirection = "send" | "receive" | null;

export type TransferStage = 
  | "idle" 
  | "hashing" 
  | "transferring" 
  | "verifying" 
  | "complete" 
  | "error";

export interface TransferState {
  direction: TransferDirection;
  fileName: string | null;
  fileSize: number | null;
  bytesTransferred: number;
  verified: boolean | null;
  stage: TransferStage;
  batchTotalFiles?: number;
  batchCurrentIndex?: number;
}

export interface SharedStore {
  flowState: FlowState;
  pendingFiles: File[];
  pendingFileMeta: { name: string, size: number, mime: string, hash: string, isBatch?: boolean, totalFiles?: number } | null;
  connectionStatus: ConnectionStatus;
  roomCode: string | null;
  role: Role;
  transfer: TransferState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  debugLogs: string[];
  securityFingerprint: string | null;
  securityVerified: boolean;
  
  // Actions
  addDebugLog: (log: string) => void;
  setFlowState: (state: FlowState) => void;
  setPendingFiles: (files: File[]) => void;
  setPendingFileMeta: (meta: { name: string, size: number, mime: string, hash: string, isBatch?: boolean, totalFiles?: number } | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setRoomCode: (code: string | null) => void;
  setRole: (role: Role) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  setSecurityFingerprint: (fingerprint: string | null) => void;
  setSecurityVerified: (verified: boolean) => void;
  updateTransfer: (updates: Partial<TransferState>) => void;
  reset: () => void;
}

const initialTransferState: TransferState = {
  direction: null,
  fileName: null,
  fileSize: null,
  bytesTransferred: 0,
  verified: null,
  stage: "idle",
  batchTotalFiles: 0,
  batchCurrentIndex: 0
};

export const useStore = create<SharedStore>((set) => ({
  flowState: "home",
  pendingFiles: [],
  pendingFileMeta: null,
  connectionStatus: "idle",
  roomCode: null,
  role: null,
  transfer: initialTransferState,

  localStream: null,
  remoteStream: null,
  debugLogs: [],
  securityFingerprint: null,
  securityVerified: false,

  addDebugLog: (log) => set((state) => ({ debugLogs: [...state.debugLogs, `[${new Date().toISOString()}] ${log}`] })),
  setFlowState: (state) => set({ flowState: state }),
  setPendingFiles: (files) => set({ pendingFiles: files }),
  setPendingFileMeta: (meta) => set({ pendingFileMeta: meta }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setRoomCode: (code) => set({ roomCode: code }),
  setRole: (role) => set({ role: role }),
  setLocalStream: (stream) => set({ localStream: stream }),
  setRemoteStream: (stream) => set({ remoteStream: stream }),
  setSecurityFingerprint: (fingerprint) => set({ securityFingerprint: fingerprint, securityVerified: false }),
  setSecurityVerified: (verified) => set({ securityVerified: verified }),
  updateTransfer: (updates) => set((state) => ({
    transfer: { ...state.transfer, ...updates }
  })),
  reset: () => set({
    flowState: "home",
    pendingFiles: [],
    pendingFileMeta: null,
    connectionStatus: "idle",
    roomCode: null,
    role: null,
    localStream: null,
    remoteStream: null,
    transfer: initialTransferState,
    debugLogs: [],
    securityFingerprint: null,
    securityVerified: false
  })
}));
