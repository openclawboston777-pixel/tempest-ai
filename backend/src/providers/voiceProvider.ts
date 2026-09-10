export interface EphemeralToken {
  token: string;
  expiresAt: string;
  url: string;
  model?: string;
  stub?: boolean;
}

export interface VoiceProvider {
  mintEphemeralToken(): Promise<EphemeralToken>;
}
