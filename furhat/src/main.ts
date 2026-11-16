import { setup, createActor, fromPromise, assign } from "xstate";

const FURHATURI = "127.0.0.1:54321";

async function fhVoice(name: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encName = encodeURIComponent(name);
  return fetch(`http://${FURHATURI}/furhat/voice?name=${encName}`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function fhSay(text: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  const encText = encodeURIComponent(text);
  return fetch(`http://${FURHATURI}/furhat/say?text=${encText}&blocking=true`, {
    method: "POST",
    headers: myHeaders,
    body: "",
  });
}

async function newGesture() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/gesture?blocking=false`, {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({
      name: "newGesture",
      frames: [
        {
          time: [0.2], //ADD THE TIME FRAME OF YOUR LIKING
          persist: true,
          params: {
            //ADD PARAMETERS HERE IN ORDER TO CREATE A GESTURE
            LOOK_UP: 1, BROW_UP_LEFT: 0.6, BROW_UP_RIGHT: 0.6
          },
        },
        {
          time: [0.8], //ADD TIME FRAME IN WHICH YOUR GESTURE RESETS
          persist: true,
          params: {
            LOOK_DOWN: 0.5, NECK_ROLL: 15
          },
        },
        {
          time: [1.3],
          persist: true,
          params: { reset: true },
        },
        //ADD MORE TIME FRAMES IF YOUR GESTURE REQUIRES THEM
      ],
      class: "furhatos.gestures.Gesture",
    }),
  });
}

async function fhGesture(text: string) {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(
    `http://${FURHATURI}/furhat/gesture?name=${text}&blocking=true`,
    {
      method: "POST",
      headers: myHeaders,
      body: "",
    },
  );
}

async function fhListen() {
  const myHeaders = new Headers();
  myHeaders.append("accept", "application/json");
  return fetch(`http://${FURHATURI}/furhat/listen`, {
    method: "GET",
    headers: myHeaders,
  })
    .then((response) => response.body)
    .then((body) => body.getReader().read())
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

async function fhAngerWithSound(name: string) {
  await fetch(`http://${FURHATURI}/furhat/gesture?name=ExpressAnger&blocking=false`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const heard = name.trim();
  const missed =
    heard === "SILENCE" ||
    heard === "FAILED" ||
    heard === "INTERRUPTED" ||
    heard === "";
  const line = missed
    ? "I am angry. You never told me your name."
    : `${heard}! Have you heard the story?!`;
  return fhSay(line);
}

const dmMachine = setup({
  types: {
    context: {} as { lastUtterance: string },
  },
  actors: {
    fhVoice: fromPromise<any, null>(async () => {
      return fhVoice("en-US-EchoMultilingualNeural");
    }),
    fhAttend: fromPromise<any, null>(async () => {
      const users = await fhUsers();
      console.log(users);
      return fhAttendClosest();
    }),
    fhHello: fromPromise<any, null>(async () => {
      await fhLed(255, 0, 0);
      return fhSay("Hi. What is your name?");
    }),
    fhL: fromPromise<any, null>(async () => {
      await fhLed(0, 0, 0);
     return fhListen();
   }),
    fhEcho: fromPromise<any, string>(async ({ input }) => {
      await fhLed(255, 0, 0)
      const heard = String(input ?? "");
      if (
        heard === "SILENCE" ||
        heard === "FAILED" ||
        heard === "INTERRUPTED" ||
        heard === ""
      ) {
        return fhSay("I did not hear you. What is your name?");
      }
      return fhSay(`You said ${heard}`);
    }),
    fhRoll: fromPromise<any, null>(async () => {
      return newGesture();
    }),
    fhAnger: fromPromise<any, string>(async ({ input }) => {
      return fhAngerWithSound(String(input ?? ""));
    }),
  },
}).createMachine({
  id: "root",
  context: { lastUtterance: "" },
  initial: "Start",
  states: {
    Start: { after: { 1000: "Attend" } },
    Attend: {
      invoke: {
        src: "fhAttend",
        onDone: "Roll",
        onError: { target: "Fail", actions: ({ event }) => console.error(event)},
      },
    },
    Greet: {
      invoke: {
        src: "fhHello",
        onDone: "Listen",
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Listen: {
      invoke: {
        src: "fhL",
        onDone: {
          target: "Echo",
          actions: assign({
            lastUtterance: ({ event }) => String(event.output ?? ""),
          }),
        },
        onError: { target: "Fail", actions: ({ event }) => console.error(event) },
      },
    },
    Echo: {
      invoke: {
        src: "fhEcho",
        input: ({ context }) => context.lastUtterance,
        onDone: "AngerSound",
        onError: { target: "Fail", actions: ({ event }) => console.error(event)},
      },
    },
    Roll: {
      invoke: {
        src: "fhRoll",
        onDone: "Greet",
        onError: { target: "Fail", actions: ({ event }) => console.error(event)},
      },
    },
    AngerSound: {
      invoke: {
        src: "fhAnger",
        input: ({ context }) => context.lastUtterance,
        onDone: "Done",
        onError: { target: "Fail", actions: ({ event }) => console.error(event)},
      },
    },
    Done: {},
    Fail: {},
  },
}); 

const actor = createActor(dmMachine).start();
console.log(actor.getSnapshot().value);

actor.subscribe((snapshot) => {
  console.log(snapshot.value);
});

