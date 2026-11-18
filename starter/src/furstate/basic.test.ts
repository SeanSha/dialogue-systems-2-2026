import { setup, createActor, sendTo, waitFor, AnyActorRef } from "xstate";
import { describe, expect, test } from "vitest";
import { furstate } from "./main";

const waitForConnection = (actor: AnyActorRef) =>
  waitFor(actor, (snapshot) => snapshot.value === "Connected", {
    timeout: 5000,
  });

describe("Furstate tests", () => {
  const machine = setup({
    actors: {
      furstate: furstate,
    },
  }).createMachine({
    initial: "Idle",
    invoke: { id: "furstate", src: "furstate" },
    states: {
      Idle: {
        on: { WS_CONNECTED: "Connected" },
      },
      Connected: {
        on: {
          "TEST.SPEAKING": "SpeakingTest",
          "TEST.LISTENING": "ListeningTest",
        },
      },

      SpeakingTest: {
        initial: "Start",
        states: {
          Start: {
            entry: sendTo("furstate", {
              type: "SPEAK",
              value: { utterance: "hello", bargeIn: false },
            }),
            on: { TTS_STARTED: { target: "Progress" } },
          },
          Progress: { on: { SPEAK_COMPLETE: "Complete" } },
          Complete: { type: "final" },
        },
        onDone: "Done",
      },

      ListeningTest: {
        /**
         * @todo listening test
         */
        initial: "Start",
        states: {
          Start: {
            entry: sendTo("furstate", { type: "LISTEN" }),
            on: {
              RECOGNISED: "Progress",
              ASR_NOINPUT: "Progress",
            },
          },
          Progress: { on: { LISTEN_COMPLETE: "Complete" } },
          Complete: { type: "final" },
        },
        onDone: "Done",
      },

      Done: {},
    },
  });

  test("SpeakingTest", async () => {
    const actor = createActor(machine).start();
    await waitForConnection(actor);
    actor.send({ type: "TEST.SPEAKING" });
    const snapshot = await waitFor(
      actor,
      (snapshot) => snapshot.value === "Done",
      { timeout: 5000 },
    );
    expect(snapshot).toBeTruthy;
  });

  test("ListeningTest", async () => {
    const actor = createActor(machine).start();
    await waitForConnection(actor);
    actor.send({ type: "TEST.LISTENING" });
    const snapshot = await waitFor(
      actor,
      (snapshot) => snapshot.value === "Done",
      { timeout: 5000 },
    );
    expect(snapshot).toBeTruthy;
  });
});
