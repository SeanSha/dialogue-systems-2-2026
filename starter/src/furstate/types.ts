import type { SpeechStateExternalEvent } from "speechstate";

/**
 * Furhat events supported so far
 * @todo support more events :-)
 */
type FurhatEvent =
  | { type: "response.speak.start" }
  | { type: "response.speak.end" }
  | { type: "response.hear.end"; text?: string }
  | { type: "response.listen.end"; cause?: string }
  | { type: "ASRTTS_READY" }
  | { type: "ASR_NOINPUT" }
  | { type: "LISTEN_COMPLETE" }
  | { type: "RECOGNISED"; value: { utterance: string }[] };

export type FurstateEvent =
  | SpeechStateExternalEvent
  | FurhatEvent
  | { type: "WS_CONNECTED" };
