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
}

export interface SharedStore {
  connectionStatus: ConnectionStatus;
  roomCode: string | null;
  role: Role;
  transfer: TransferState;
}
