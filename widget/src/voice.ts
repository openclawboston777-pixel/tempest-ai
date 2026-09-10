interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

interface RealtimeTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: unknown;
}

interface VoiceTokenResponse {
  token: string;
  url?: string;
  model: string;
  instructions?: string;
  tools?: ChatTool[];
}

interface FunctionCallDoneMsg {
  type: "response.function_call_arguments.done";
  name: string;
  call_id: string;
  arguments: string;
}

interface RealtimeMsg {
  type: string;
  [key: string]: unknown;
}

export class VoiceSession {
  private backendUrl: string;
  private container: HTMLElement;
  private active = false;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private statusBar: HTMLElement | null = null;
  private btn: HTMLElement | null = null;

  constructor(backendUrl: string, container: HTMLElement) {
    this.backendUrl = backendUrl.replace(/\/+$/, "");
    this.container = container;
  }

  toggle(btn?: HTMLElement): void {
    if (btn) this.btn = btn;
    if (this.active) {
      this.stop();
    } else {
      void this.start();
    }
  }

  private setStatus(text: string): void {
    if (!this.statusBar) {
      this.statusBar = document.createElement("div");
      this.statusBar.className = "tw-voice-status";
      this.container.appendChild(this.statusBar);
    }
    this.statusBar.textContent = text;
  }

  private convertTools(tools?: ChatTool[]): RealtimeTool[] {
    if (!tools || !Array.isArray(tools)) return [];
    const out: RealtimeTool[] = [];
    for (const t of tools) {
      if (t?.type === "function" && t.function?.name) {
        out.push({
          type: "function",
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        });
      }
    }
    return out;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;

    let tokenData: VoiceTokenResponse;
    try {
      const resp = await fetch(`${this.backendUrl}/voice-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!resp.ok) throw new Error(`token ${resp.status}`);
      tokenData = (await resp.json()) as VoiceTokenResponse;
    } catch {
      this.setStatus("Could not start voice session");
      this.stop();
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.setStatus("Microphone access needed to talk");
      this.stop();
      return;
    }

    try {
      const pc = new RTCPeerConnection();
      this.pc = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.setAttribute("playsinline", "");
      this.audioEl = audioEl;
      this.container.appendChild(audioEl);

      pc.ontrack = (e: RTCTrackEvent): void => {
        if (this.audioEl && e.streams[0]) {
          this.audioEl.srcObject = e.streams[0];
        }
      };

      for (const track of this.stream.getTracks()) {
        pc.addTrack(track, this.stream);
      }

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;

      dc.onopen = (): void => {
        const sessionUpdate = {
          type: "session.update",
          session: {
            instructions: tokenData.instructions ?? "",
            tools: this.convertTools(tokenData.tools),
            tool_choice: "auto",
            modalities: ["audio", "text"],
            turn_detection: { type: "server_vad" },
            input_audio_transcription: { model: "whisper-1" },
          },
        };
        try {
          dc.send(JSON.stringify(sessionUpdate));
        } catch {
          /* ignore */
        }
      };

      dc.onmessage = (ev: MessageEvent): void => {
        void this.handleMessage(ev);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const model = tokenData.model;
      const sdpResp = await fetch(
        `https://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenData.token}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        }
      );
      if (!sdpResp.ok) throw new Error(`sdp ${sdpResp.status}`);
      const answer = await sdpResp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      if (this.btn) this.btn.classList.add("tw-voice-active");
      this.setStatus("Listening… tap mic to stop");
    } catch {
      this.setStatus("Voice connection failed");
      this.stop();
    }
  }

  private async handleMessage(ev: MessageEvent): Promise<void> {
    let msg: RealtimeMsg;
    try {
      msg = JSON.parse(ev.data as string) as RealtimeMsg;
    } catch {
      return;
    }

    switch (msg.type) {
      case "response.function_call_arguments.done":
        await this.handleFunctionCall(msg as unknown as FunctionCallDoneMsg);
        break;
      case "input_audio_buffer.speech_started":
        this.setStatus("Listening…");
        break;
      case "response.audio.done":
      case "response.done":
        this.setStatus("Tap mic to stop");
        break;
      default:
        break;
    }
  }

  private async handleFunctionCall(msg: FunctionCallDoneMsg): Promise<void> {
    if (msg.name !== "get_products") return;
    try {
      let query = "";
      try {
        const parsed = JSON.parse(msg.arguments) as { query?: string };
        query = parsed.query ?? "";
      } catch {
        query = "";
      }

      const resp = await fetch(`${this.backendUrl}/tool/get-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const result: unknown = await resp.json();

      if (this.dc && this.dc.readyState === "open") {
        this.dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: msg.call_id,
              output: JSON.stringify(result),
            },
          })
        );
        this.dc.send(JSON.stringify({ type: "response.create" }));
      }
    } catch {
      /* ignore tool error */
    }
  }

  stop(): void {
    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        /* ignore */
      }
      this.dc = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      this.stream = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        /* ignore */
      }
      this.pc = null;
    }

    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }

    if (this.statusBar) {
      this.statusBar.remove();
      this.statusBar = null;
    }

    if (this.btn) {
      this.btn.classList.remove("tw-voice-active");
    }

    this.active = false;
  }
}
