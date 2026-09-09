export interface EphemeralToken {
  token: string;
  expiresAt: string;
  url: string;
}

export interface VoiceProvider {
  mintEphemeralToken(): Promise<EphemeralToken>;
}
