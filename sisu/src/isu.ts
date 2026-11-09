import { createActor, setup, AnyMachineSnapshot, sendTo, assign, fromPromise } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY, REGION } from "./azure";
import { DMContext, DMEvent, Move, NextMovesEvent } from "./types";
import { nlg } from "./nlug";
import { ensureNluSeeded, nluWithRetrieval } from "./nlu-qdrant";
import { dme } from "./dme";
import { initialIS } from "./is";

// [Extra] Chat transcript for the page.
export type ChatLine = {
  id: number;
  speaker: "sys" | "usr";
  text: string;
};

const chatLines: ChatLine[] = [];
const chatListeners = new Set<(lines: ChatLine[]) => void>();
let nextChatId = 1;

export function subscribeChat(listener: (lines: ChatLine[]) => void) {
  listener(chatLines.slice());
  chatListeners.add(listener);
  return () => {
    chatListeners.delete(listener);
  };
}

export function clearChat() {
  chatLines.length = 0;
  const snapshot = chatLines.slice();
  chatListeners.forEach((listener) => listener(snapshot));
}

function pushChatLine(speaker: ChatLine["speaker"], text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  chatLines.push({ id: nextChatId++, speaker, text: trimmed });
  const snapshot = chatLines.slice();
  chatListeners.forEach((listener) => listener(snapshot));
}
// [Extra] Chinese labels for speech states.
const VIEW_LABEL: Record<string, string> = {
  "not-ready": "正在准备麦克风",
  idle: "等待中",
  speaking: "系统正在说话",
  recognising: "正在听，请说话",
  "recognising-paused": "听写已暂停",
  "speaking-paused": "朗读已暂停",
  error: "语音出错",
  stopped: "已停止",
};

const azureCredentials = {
  endpoint:
    // [Extra] Azure region from azure.ts.
    "https://" + REGION + ".api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

// [Extra] Whether this listen turn heard speech.
let heardThisTurn = false;
// [lab2] [VG-B] Moves for the utterance just heard. Retrieval is async, so speaking waits for this.
let pendingMoves: Promise<Move[]> = Promise.resolve([]);

const settings: Settings = {
  azureCredentials: azureCredentials,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  azureRegion: REGION, // [Extra] Azure region from azure.ts.
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false
};

const dmMachine = setup({
  actors: {
    dme: dme,
    understand: fromPromise(async () => pendingMoves),
  },
  actions: {
    speak_next_moves: ({ context, event }) => {
      const utterance = nlg((event as NextMovesEvent).value);
      pushChatLine("sys", utterance); // [Extra] Record the system utterance.
      context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance,
        },
      });
    },
    listen: ({ context }) => {
      heardThisTurn = false; // [Extra] Reset before a new listen turn.
      pendingMoves = Promise.resolve([]);
      context.ssRef.send({
        type: "LISTEN",
      });
    },
    // [Extra] Stop ASR and TTS.
    haltSpeech: ({ context }) => {
      heardThisTurn = false;
      const speech = context.ssRef.getSnapshot();
      for (const actor of [speech.context.asrRef, speech.context.ttsRef]) {
        try {
          actor?.send({ type: "STOP" });
        } catch (error) {
          console.error(error);
        }
      }
    },
    // [Extra] Clear the transcript and reset the information state.
    resetDialogue: assign(() => {
      clearChat();
      return {
        is: initialIS(),
        lastUserMoves: undefined,
        latest_moves: undefined,
        latest_speaker: undefined,
      };
    }),
  },
  types: {} as {
    context: DMContext;
    events: DMEvent;
  },
}).createMachine({
  context: ({ spawn }) => {
    return {
      ssRef: spawn(speechstate, { input: settings }),
      is: initialIS(),
    };
  },
  id: "DM",
  // [Extra] On END, stop speech, clear the chat, and return to WaitToStart.
  on: {
    END: {
      target: ".WaitToStart",
      actions: ["haltSpeech", "resetDialogue"],
    },
  },
  initial: "Prepare",
  states: {
    Prepare: {
      entry: ({ context }) => context.ssRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: {
        CLICK: "Main",
      },
    },
    Main: {
      type: "parallel",
      states: {
        Interpret: {
          initial: "Idle",
          states: {
            Idle: {
              on: {
                SPEAK_COMPLETE: { target: "Recognising", actions: "listen" },
              },
            },
            Recognising: {
              on: {
                // [Extra] If nothing was heard, listen again.
                LISTEN_COMPLETE: [
                  {
                    guard: () => !heardThisTurn,
                    target: "Recognising",
                    reenter: true,
                    actions: "listen",
                  },
                  { target: "Understanding" },
                ],
                RECOGNISED: {
                  actions: [
                    // [Extra] Mark that speech was heard and record the utterance.
                    () => {
                      heardThisTurn = true;
                    },
                    ({ event }) => {
                      if (event.type === "RECOGNISED") {
                        pushChatLine("usr", event.value[0]?.utterance ?? "");
                      }
                    },
                    // [lab2] [VG-B] Near-miss sentences go to Qdrant. Exact sentences stay on the table.
                    ({ event }) => {
                      const utterance =
                        event.type === "RECOGNISED"
                          ? (event.value[0]?.utterance ?? "")
                          : "";
                      pendingMoves = nluWithRetrieval(utterance);
                    },
                  ],
                },
                ASR_NOINPUT: {}, // [Extra] Ignore no-input timeouts.
              },
            },
            Understanding: {
              invoke: {
                src: "understand",
                onDone: {
                  target: "Idle",
                  actions: [
                    assign(({ event }) => ({
                      lastUserMoves: event.output as Move[],
                    })),
                    sendTo("dmeID", ({ event }) => ({
                      type: "SAYS",
                      value: {
                        speaker: "usr",
                        moves: event.output as Move[],
                      },
                    })),
                  ],
                },
                onError: {
                  target: "Idle",
                  actions: sendTo("dmeID", () => ({
                    type: "SAYS",
                    value: { speaker: "usr", moves: [] },
                  })),
                },
              },
            },
          },
        },
        Generate: {
          initial: "Idle",
          states: {
            Idle: {
              on: {
                NEXT_MOVES: {
                  target: "Speaking",
                  actions: sendTo("dmeID", ({ event }) => ({
                    type: "SAYS",
                    value: {
                      speaker: "sys",
                      moves: event.value,
                    },
                  })),
                },
              },
            },
            Speaking: {
              entry: "speak_next_moves",
              on: {
                SPEAK_COMPLETE: {
                  target: "Idle",
                },
              },
            },
          },
        },
        DME: {
          invoke: {
            src: "dme",
            id: "dmeID",
            input: ({ context, self }) => {
              return {
                parentRef: self,
                latest_moves: context.latest_moves,
                latest_speaker: context.latest_speaker,
                is: context.is,
              };
            },
          },
        },
      },
    },
  },
});

// [Extra] Actor without the Stately inspector.
export const dmActor = createActor(dmMachine).start();

// [lab2] [VG-B] Fill Qdrant before the first near-miss sentence. Failure leaves the exact table in place.
void ensureNluSeeded().catch((error) => {
  console.warn(
    "[VG-B] Qdrant seed failed. Near-miss sentences stay on the exact table.",
    error,
  );
});

// [Extra] DM, speechstate, and dme states for the page.
export type MachineView = {
  id: string;
  states: string[];
  active: string[];
};

function activePaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return [prefix ? `${prefix}.${value}` : value];
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => activePaths(child, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [];
}

type WalkableActor = {
  id?: string;
  sessionId?: string;
  logic?: { config?: { id?: string; states?: Record<string, unknown> } };
  getSnapshot?: () => {
    value?: unknown;
    children?: Record<string, WalkableActor>;
  };
  subscribe?: (listener: () => void) => { unsubscribe: () => void };
};

function machineId(actor: WalkableActor): string | undefined {
  const config = actor.logic?.config;
  if (!config?.states) return undefined;
  if (config.id && config.id !== "(machine)") return config.id;
  return actor.id;
}

export function readMachines(): MachineView[] {
  const rows: MachineView[] = [];
  const seen = new Set<string>();
  const walk = (actor: WalkableActor | undefined, depth: number) => {
    if (!actor?.getSnapshot || depth > 5) return;
    const sessionId = actor.sessionId;
    if (!sessionId || seen.has(sessionId)) return;
    seen.add(sessionId);
    const id = machineId(actor);
    if (id === "DM" || id === "speechstate" || id === "dme" || id === "dmeID") {
      rows.push({
        id: id === "dmeID" ? "dme" : id,
        states: Object.keys(actor.logic?.config?.states ?? {}),
        active: activePaths(actor.getSnapshot().value),
      });
    }
    for (const child of Object.values(actor.getSnapshot().children ?? {})) {
      walk(child, depth + 1);
    }
  };
  walk(dmActor as unknown as WalkableActor, 0);
  return rows;
}

export function subscribeMachines(listener: (machines: MachineView[]) => void) {
  const emit = () => listener(readMachines());
  const subscription = dmActor.subscribe(emit);
  const timer = window.setInterval(emit, 400);
  emit();
  return () => {
    subscription.unsubscribe();
    window.clearInterval(timer);
  };
}
let is = dmActor.getSnapshot().context.is;
console.log("[IS (initial)]", is);
dmActor.subscribe((snapshot: AnyMachineSnapshot) => {
  /* if you want to log some parts of the state */
  // is !== snapshot.context.is && console.log("[IS]", snapshot.context.is);
  is = snapshot.context.is;
  // console.log("IS", is);
  console.log(
    "%cState value:",
    "background-color: #056dff",
    snapshot.value,
    snapshot.context.is
  );
});

// [Extra] Start, end, and status text for the page buttons.
function speechView(snapshot: AnyMachineSnapshot): string {
  const meta = Object.values(snapshot.getMeta())[0] as
    | { view?: string }
    | undefined;
  return meta?.view ?? "";
}

export function setupInterface(elements: {
  startButton: HTMLButtonElement;
  endButton: HTMLButtonElement;
  status: HTMLElement;
}) {
  const { startButton, endButton, status } = elements;

  const renderControls = () => {
    const phase = dmActor.getSnapshot().value;
    const view = speechView(dmActor.getSnapshot().context.ssRef.getSnapshot());
    const inDialogue = typeof phase === "object" && phase !== null;
    endButton.disabled = !inDialogue;
    if (phase === "Prepare" || view === "not-ready") {
      startButton.disabled = true;
      startButton.textContent = "正在准备麦克风…";
      status.textContent = "准备中";
      return;
    }
    if (phase === "WaitToStart") {
      startButton.disabled = false;
      startButton.textContent = "开始对话";
      status.textContent = "可以开始";
      return;
    }
    const label = VIEW_LABEL[view] ?? "对话进行中";
    startButton.disabled = true;
    startButton.textContent = label;
    status.textContent = label;
  };

  startButton.addEventListener("click", () => {
    if (!startButton.disabled) {
      dmActor.send({ type: "CLICK" });
    }
  });
  endButton.addEventListener("click", () => {
    if (!endButton.disabled) {
      dmActor.send({ type: "END" });
    }
  });
  dmActor.subscribe(renderControls);
  dmActor.getSnapshot().context.ssRef.subscribe(renderControls);
  renderControls();
}
