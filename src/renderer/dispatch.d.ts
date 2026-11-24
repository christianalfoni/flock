// The app's API in the window (src/preload/index.ts, from shared/bridge.ts).
import type { Canvas, CanvasBoard } from "../shared/canvas";
import type { PullRequestDrawing } from "../shared/pullRequestCanvas";
import type { Agent, AppState, CliId, CliStatus, Settings, TranscriptEntry } from "../shared/types";

declare global {
  interface Window {
    dispatch: {
      getState(): Promise<AppState>;
      refreshClis(): Promise<CliStatus[]>;
      saveSettings(settings: Settings): Promise<void>;
      createAgent(input: { name?: string; repo: string; color?: string; voice?: string }): Promise<Agent>;
      removeAgent(id: string): Promise<void>;
      removeWorker(id: string, force?: boolean): Promise<{ removed: boolean; message: string; unsaved?: { uncommitted: number; unpushed: number } }>;
      getTranscript(id: string): Promise<TranscriptEntry[]>;
      sendMessage(input: { id: string; text: string; ask?: { step?: number; pull?: string } }): Promise<void>;
      restartSession(id: string): Promise<void>;
      answerPermission(id: string, allow: boolean): Promise<void>;
      getCanvas(agentId: string): Promise<Canvas>;
      getPullDrawings(): Promise<Record<string, PullRequestDrawing>>;
      closeCanvasAsk(agentId: string, ask: string): Promise<void>;
      markCanvasHeard(agentId: string, words: string[]): Promise<void>;
      canvasUnheard(): Promise<Record<string, number>>;
      saveCanvas(agentId: string, board: CanvasBoard, boardText: string, applied: number): Promise<void>;
      pickFolder(): Promise<string | undefined>;
      startWindowDrag(): void;
      moveWindow(): void;
      zoomWindow(): void;
      openExternal(url: string): Promise<void>;
      onState(callback: (state: AppState) => void): () => void;
      onEntry(callback: (update: { id: string; entry: TranscriptEntry }) => void): () => void;
      onCanvasUpdated(callback: (update: { agentId: string; version: number }) => void): () => void;
      onPullDrawingsUpdated(callback: (update: { urls: string[] }) => void): () => void;
    };
  }
}

export {};
