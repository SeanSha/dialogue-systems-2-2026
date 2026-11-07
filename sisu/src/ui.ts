// [Extra] Chat page: transcript, state bar, start and end.
import "./style.css";
import {
  setupInterface,
  subscribeChat,
  subscribeMachines,
  type ChatLine,
  type MachineView,
} from "./isu";

const app = document.querySelector("#app");
if (!app) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <section class="shell">
    <header class="top">
      <div>
        <p class="eyebrow">Lab 2</p>
        <h1>对话</h1>
      </div>
      <p id="status" class="status">准备中</p>
    </header>
    <section id="machines" class="machines" aria-label="当前状态"></section>
    <div id="log" class="log" aria-live="polite">
      <div id="transcript" class="transcript">
        <p class="empty">点下面的按钮开始。系统说的话，和麦克风识别到的原句，都会留在这里。</p>
      </div>
    </div>
    <footer class="dock">
      <div class="dock-actions">
        <button id="counter" type="button" disabled>正在准备麦克风…</button>
        <button id="end" type="button" disabled>结束对话</button>
      </div>
      <p class="hint">开始后直接说话。结束会清空这次记录，可以再开始一轮。</p>
    </footer>
  </section>
`;

const log = document.querySelector("#log");
const transcript = document.querySelector("#transcript");
const startButton = document.querySelector("#counter");
const endButton = document.querySelector("#end");
const status = document.querySelector("#status");
const machines = document.querySelector("#machines");

if (
  !(log instanceof HTMLElement) ||
  !(transcript instanceof HTMLElement) ||
  !(startButton instanceof HTMLButtonElement) ||
  !(endButton instanceof HTMLButtonElement) ||
  !(status instanceof HTMLElement) ||
  !(machines instanceof HTMLElement)
) {
  throw new Error("Chat layout failed to render");
}

const machineList = machines;

function renderMachines(views: MachineView[]) {
  machineList.replaceChildren();
  for (const machine of views) {
    const block = document.createElement("section");
    block.className = "machine";
    const title = document.createElement("h2");
    title.textContent = machine.id;
    const row = document.createElement("div");
    row.className = "states";
    machine.states.forEach((state, index) => {
      if (index > 0) {
        const arrow = document.createElement("span");
        arrow.className = "arrow";
        arrow.textContent = "→";
        row.append(arrow);
      }
      const pill = document.createElement("span");
      const current = machine.active.some(
        (path) => path === state || path.startsWith(`${state}.`)
      );
      pill.className = current ? "state current" : "state";
      pill.textContent = state;
      row.append(pill);
    });
    block.append(title, row);
    const details = machine.active.filter((path) => path.includes("."));
    for (const path of details) {
      const line = document.createElement("p");
      line.className = "path";
      line.textContent = path;
      block.append(line);
    }
    machineList.append(block);
  }
}

subscribeMachines(renderMachines);

const chatLog = transcript;
const scroller = log;

function pinToBottom() {
  const apply = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

new ResizeObserver(() => {
  pinToBottom();
}).observe(scroller);

function renderChat(lines: ChatLine[]) {
  const empty = chatLog.querySelector(".empty");
  chatLog.querySelectorAll(".bubble").forEach((node) => node.remove());
  if (empty instanceof HTMLElement) {
    empty.hidden = lines.length > 0;
  }
  for (const line of lines) {
    const bubble = document.createElement("article");
    bubble.className = `bubble ${line.speaker}`;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = line.speaker === "sys" ? "系统" : "你";
    const text = document.createElement("p");
    text.textContent = line.text;
    bubble.append(who, text);
    chatLog.append(bubble);
  }
  pinToBottom();
}

subscribeChat(renderChat);
setupInterface({ startButton, endButton, status });
