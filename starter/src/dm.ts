import { assign, createActor, fromPromise, setup } from "xstate";
import { Settings, speechstate } from "speechstate";
import { KEY, REGION, TOKEN_ENDPOINT } from "./credentials";
import { DMContext, DMEvents } from "./types";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { furstate } from "./furstate/main.ts";

const qdrant = new QdrantClient({ host: "localhost", port: 6333 });
const RAG_COLLECTION = "gu_support_all"; // 要和你灌库时的名字一致

/** 连本地/隧道上的 Ollama（OpenAI 兼容接口） */
const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

/** 问题/文档 → 向量（须与建库时同一模型、同一维度） */
const embed = async (input: string) =>
  openai.embeddings
    .create({
      model: "qwen3-embedding",
      input,
      dimensions: 384,
    })
    .then((r) => r.data[0].embedding);

const azureCredentials = {
  endpoint: TOKEN_ENDPOINT,
  key: KEY,
};

/** backup: Azure access via FLoV proxy
const azureProxyCredentials = {
  proxyUrl: "https://rndserv.flov.gu.se:4000/api/token",
  key: "",
  };
*/

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: REGION,
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
  bargeIn: false,
};

/** 语音口令：说这些就暂停持续聆听 */
function isStopCommand(utterance: string) {
  const t = utterance.toLowerCase().trim();
  return (
    t === "stop" ||
    t === "pause" ||
    t === "goodbye" ||
    t === "good bye" ||
    t === "exit" ||
    t.includes("stop listening") ||
    t.includes("that's all")
  );
}

const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    /** 让 SpeechState 朗读一段文字 */
    "spst.speak": ({ context }, params: { utterance: string }) =>
      context.spstRef.send({
        type: "SPEAK",
        value: {
          utterance: params.utterance,
        },
      }),

    /** 让 SpeechState 开始听麦克风 */
    "spst.listen": ({ context }) =>
      context.spstRef.send({
        type: "LISTEN",
      }),

    /**
     * 点按钮进入对话时：往 messages 追加一句开场白（assistant）
     * Speaking 状态会朗读 messages 里的最后一条
     */
    appendGreeting: assign(({ context }) => ({
      messages: [
        ...context.messages,
        { role: "assistant" as const, content: "Hi! I'm Altlas. How can I help you?" },
      ],
    })),

    /**
     * 听完用户说话后：把识别结果追加为 user 消息
     * 这样下一轮 LLM 能看到完整对话历史
     */
    appendUserFromSpeech: assign(({ context }) => {
      const utterance = context.lastResult?.[0]?.utterance ?? "";
      return {
        messages: [
          ...context.messages,
          { role: "user" as const, content: utterance },
        ],
      };
    }),

    /**
     * LLM 调用成功后：把回复追加为 assistant 消息
     * event.output 来自下面 chatCompletion actor 的 return 值
     */
    appendAssistantFromLLM: assign(({ context, event }) => {
      const message = (
        event as { output: { role: "assistant"; content: string } }
      ).output;
      return {
        messages: [...context.messages, message],
      };
    }),

    /** 打断当前的说/听（暂停时用） */
    "spst.stop": ({ context }) =>
      context.spstRef.send({ type: "STOP" }),
  },
  actors: {
    /**
     * Generation：调用 Ollama
     * Augmentation：把 ragContext 拼进 system，再带上对话历史
     */
    chatCompletion: fromPromise(
      async ({
        input,
      }: {
        input: {
          messages: DMContext["messages"];
          ragContext: string;
        };
      }) => {
        const baseSystem =
          input.messages.find((m) => m.role === "system")?.content ??
          "You are a friendly voice assistant. Keep replies very short.";

        // 其余消息（user/assistant），不含原始 system
        const history = input.messages.filter((m) => m.role !== "system");

        // Augmentation：系统提示 + 检索到的文档
        const augmentedSystem = `${baseSystem}

You help University of Gothenburg students. Use the documents below when relevant.
If the documents do not contain the answer, say you don't know. Do not invent facts.
Keep replies very short for speech.

RELEVANT DOCUMENTS:
${input.ragContext || "(no documents retrieved)"}
`;

        const messagesForLLM = [
          { role: "system" as const, content: augmentedSystem },
          ...history,
        ];

        console.log("[LLM] calling ollama; rag chars:", input.ragContext.length);
        try {
          const response = await openai.chat.completions.create({
            model: "llama3.2",
            messages: messagesForLLM,
          });
          const content = response.choices[0]?.message?.content ?? "";
          console.log("[LLM] reply:", content);
          return { role: "assistant" as const, content };
        } catch (err) {
          console.error("[LLM] failed:", err);
          throw err;
        }
      },
    ),

    /**
     * Retrieval：用用户刚说的话去 Qdrant 查相关文档块
     * 返回拼好的字符串，后面会放进 context.ragContext
     */
    retrieve: fromPromise(
      async ({ input }: { input: { query: string } }) => {
        console.log("[RAG] query:", input.query);
        const vector = await embed(input.query);
        const results = await qdrant.query(RAG_COLLECTION, {
          query: vector,
          with_payload: true,
          limit: 5,
        });
        const texts = (results.points ?? [])
          .map((p) => (p.payload as { text?: string } | null)?.text ?? "")
          .filter(Boolean);
        const ragContext = texts.join("\n\n---\n\n");
        console.log("[RAG] got chunks:", texts.length);
        return ragContext;
      },
    ),
  },
}).createMachine({
  context: ({ spawn }) => ({
    // spstRef: spawn(speechstate, { input: settings }),
    spstRef: spawn(furstate),
    lastResult: null,
    ragContext: "",
    /** 一开始就放一条 system，约束 LLM 回复要短（适合语音） */
    messages: [
      {
        role: "system",
        content:
          "You are a friendly voice assistant. Keep replies very short.",
      },
    ],
  }),
  id: "DM",
  initial: "Prepare",
  states: {
    /** 初始化 Azure 语音；就绪后才能点按钮 */
    Prepare: {
      entry: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
      on: { ASRTTS_READY: "WaitToStart" },
    },

    /** 等待用户点击页面按钮 */
    WaitToStart: {
      on: {
        CLICK: {
          target: "Loop",
          actions: "appendGreeting", // 先写入开场白，再进入循环
        },
      },
    },

    /**
     * Part 2 循环:
     * Speaking → Ask → Retrieve → ChatCompletion → Speaking → ...
     * 点按钮 或 说 stop/goodbye → 暂停
     */
    Loop: {
      initial: "Speaking",
      // 对话进行中再点同一按钮 → 暂停聆听
      on: {
        CLICK: {
          target: "#DM.Paused",
          actions: [
            "spst.stop",
            assign(({ context }) => ({
              messages: [
                ...context.messages,
                {
                  role: "assistant" as const,
                  content: "Okay, I'll pause. Click the button when you want to continue.",
                },
              ],
            })),
          ],
        },
      },
      states: {
        /** 朗读 messages 的最后一条（开场白或 LLM 回复） */
        Speaking: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              utterance:
                context.messages[context.messages.length - 1].content,
            }),
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },

        /** 听用户说话；有结果先检索；口令则暂停；没听清走 NoInput */
        Ask: {
          entry: { type: "spst.listen" },
          on: {
            RECOGNISED: {
              actions: assign(({ event }) => ({
                lastResult: event.value,
              })),
            },
            ASR_NOINPUT: {
              actions: assign({ lastResult: null }),
            },
            LISTEN_COMPLETE: [
              {
                // 语音暂停：stop / pause / goodbye ...
                guard: ({ context }) => {
                  const u = context.lastResult?.[0]?.utterance ?? "";
                  return !!context.lastResult && isStopCommand(u);
                },
                target: "#DM.Paused",
                actions: [
                  "appendUserFromSpeech",
                  "spst.stop",
                  assign(({ context }) => ({
                    messages: [
                      ...context.messages,
                      {
                        role: "assistant" as const,
                        content:
                          "Okay, I'll pause. Click the button when you want to continue.",
                      },
                    ],
                  })),
                ],
              },
              {
                guard: ({ context }) => !!context.lastResult,
                target: "Retrieve",
                actions: "appendUserFromSpeech",
              },
              {
                target: "NoInput",
              },
            ],
          },
        },

        /**
         * VG-1：处理 ASR_NOINPUT / 空识别
         * 告诉用户没听清，说完后再回到 Ask
         */
        NoInput: {
          entry: {
            type: "spst.speak",
            params: {
              utterance: "I didn't catch that. Please say it again.",
            },
          },
          on: { SPEAK_COMPLETE: "Ask" },
        },

        /**
         * B5 Retrieval：用刚说的话查 Qdrant
         * onDone → 写入 ragContext → ChatCompletion
         */
        Retrieve: {
          invoke: {
            src: "retrieve",
            input: ({ context }) => ({
              query: context.lastResult?.[0]?.utterance ?? "",
            }),
            onDone: {
              target: "ChatCompletion",
              actions: assign(({ event }) => ({
                ragContext: (event as { output: string }).output,
              })),
            },
            onError: {
              target: "ChatCompletion",
              actions: assign({ ragContext: "" }),
            },
          },
        },

        /** B6 Generation：带 ragContext 的增强 prompt 调 LLM */
        ChatCompletion: {
          invoke: {
            src: "chatCompletion",
            input: ({ context }) => ({
              messages: context.messages,
              ragContext: context.ragContext,
            }),
            onDone: {
              target: "Speaking",
              actions: "appendAssistantFromLLM",
            },
            onError: {
              target: "Speaking",
              actions: assign(({ context }) => ({
                messages: [
                  ...context.messages,
                  {
                    role: "assistant" as const,
                    content: "Sorry, I had a problem answering.",
                  },
                ],
              })),
            },
          },
        },
      },
    },

    /**
     * 暂停：不再 listen。再点按钮 → 说一句提示后继续 Ask
     */
    Paused: {
      initial: "Announce",
      states: {
        Announce: {
          entry: {
            type: "spst.speak",
            params: ({ context }) => ({
              utterance:
                context.messages[context.messages.length - 1].content,
            }),
          },
          on: { SPEAK_COMPLETE: "Idle" },
        },
        Idle: {
          on: {
            CLICK: {
              // 先说 “I'm listening again”，再说完后进 Ask
              target: "#DM.Loop.Speaking",
              actions: assign(({ context }) => ({
                messages: [
                  ...context.messages,
                  {
                    role: "assistant" as const,
                    content: "I'm listening again.",
                  },
                ],
              })),
            },
          },
        },
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  // 看这里：浏览器 Console（不是下面跑 vite 的终端）
  console.log(">>> state:", JSON.stringify(state.value));
  console.log(">>> messages:", state.context.messages);
  console.log(">>> ragContext length:", state.context.ragContext?.length ?? 0);
  console.log(">>> lastResult:", state.context.lastResult);
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const value = snapshot.value;
    const view = typeof value === "string" ? value : JSON.stringify(value);
    let hint = "";
    if (value === "WaitToStart") hint = " (click to start)";
    else if (typeof value === "object" && value && "Paused" in value)
      hint = " (click to resume)";
    else if (typeof value === "object" && value && "Loop" in value)
      hint = " (click to pause)";
    element.innerHTML = `${view}${hint}`;
  });
}
