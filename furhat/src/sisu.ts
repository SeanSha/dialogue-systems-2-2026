// 用 SISU 那一份 XState。furhat 目录里另有一份，两份混用时这段机器对不上。
import { setup, createActor, fromPromise, sendTo, assign } from "../../sisu/node_modules/xstate";
import { dme } from "../../sisu/src/dme";
import { nlg, nluMapping } from "../../sisu/src/nlug";
import { initialIS } from "../../sisu/src/is";
import type { Move } from "../../sisu/src/types";

const FURHATURI = "127.0.0.1:54321";

// 这五个函数和 main.ts 里的是同一组 Remote API 调用。
// 不从 main.ts 导入，是因为那个文件一加载就会启动另一段对话。
async function fhSay(text: string) {
  const encText = encodeURIComponent(text);
  return fetch(`http://${FURHATURI}/furhat/say?text=${encText}&blocking=true`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
}

async function fhListen() {
  return fetch(`http://${FURHATURI}/furhat/listen`, {
    method: "GET",
    headers: { accept: "application/json" },
  })
    .then((response) => response.body)
    .then((body) => body!.getReader().read())
    .then((reader) => reader.value)
    .then((value) => JSON.parse(new TextDecoder().decode(value)).message);
}

async function fhAttendClosest() {
  return fetch(`http://${FURHATURI}/furhat/attend?user=CLOSEST`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
}

async function fhUsers() {
  const response = await fetch(`http://${FURHATURI}/furhat/users`);
  return response.json();
}

async function fhLed(red: number, green: number, blue: number) {
  return fetch(
    `http://${FURHATURI}/furhat/led?red=${red}&green=${green}&blue=${blue}`,
    { method: "POST", headers: { accept: "application/json" } },
  );
}

// 去掉问号、句号和撇号，方便和听懂表里的句子对齐。
function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[?.!,']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 麦克风里的一句话 -> SISU 看得懂的 moves。
// 没听见时交给 Lab 2 的「没接触上」。听见了就忽略标点，和听懂表逐句比较。
function movesFor(heard: string): Move[] {
  const raw = heard.toLowerCase().trim();
  if (
    raw === "silence" ||
    raw === "failed" ||
    raw === "interrupted" ||
    raw === ""
  ) {
    return [{ type: "icm", content: "con*neg" }];
  }
  const heardKey = normalize(raw);
  for (const [utterance, moves] of Object.entries(nluMapping)) {
    if (normalize(utterance) === heardKey) return moves;
  }
  return [];
}

// 两台机器同时跑：
// DME 是 Lab 2 的对话机，决定下一句。
// Loop 是 Furhat，负责说和听。
const machine = setup({
  actors: { dme },
  types: {} as {
    context: { line: string };
    // Idle 只处理这一种事件，所以这里必须带上 value。
    events: { type: "NEXT_MOVES"; value: Move[] };
  },
}).createMachine({
  context: { line: "" },
  type: "parallel",
  states: {
    // 启动 SISU。dmeID 是后面 sendTo 用的名字。
    // parentRef 让对话机能把下一句送回这台机器。
    DME: {
      invoke: {
        src: "dme",
        id: "dmeID",
        input: ({ self }) => ({ parentRef: self, is: initialIS() }),
      },
    },

    Loop: {
      initial: "Idle",
      states: {
        // 等 NEXT_MOVES。记下要说的句子，并告诉 DME「这句是系统说的」。
        Idle: {
          on: {
            NEXT_MOVES: {
              target: "Speak",
              actions: [
                sendTo("dmeID", ({ event }) => ({
                  type: "SAYS",
                  value: { speaker: "sys", moves: event.value },
                })),
                assign({ line: ({ event }) => nlg(event.value) }),
              ],
            },
          },
        },

        // input 是 { line }，不是一整段字符串。红灯说完，去听。
        Speak: {
          invoke: {
            src: fromPromise(async ({ input }: { input: { line: string } }) => {
              console.log("Furhat says:", input.line);
              await fhLed(255, 0, 0);
              await fhSay(input.line);
            }),
            input: ({ context }) => ({ line: context.line }),
            onDone: "Listen",
            onError: {
              target: "Fail",
              actions: ({ event }) => console.error(event),
            },
          },
        },

        // 关灯听用户。听完用 movesFor 变成动作，告诉 DME「这句是用户说的」，再回到 Idle。
        Listen: {
          invoke: {
            src: fromPromise(async () => {
              await fhLed(0, 0, 0);
              return fhListen();
            }),
            onDone: {
              target: "Idle",
              actions: sendTo("dmeID", ({ event }) => {
                const heard = String(event.output ?? "");
                console.log("User said:", heard);
                return {
                  type: "SAYS",
                  value: { speaker: "usr", moves: movesFor(heard) },
                };
              }),
            },
            onError: {
              target: "Fail",
              actions: ({ event }) => console.error(event),
            },
          },
        },

        // Speak 和 Listen 出错时停在这里。没有这个状态，机器启动就会报错。
        Fail: {},
      },
    },
  },
});

// 文件最外层不能写 await，所以包进异步函数：先看向最近的用户，再启动。
async function main() {
  const users = await fhUsers();
  console.log(users);
  await fhAttendClosest();
  createActor(machine).start();
}

main();
