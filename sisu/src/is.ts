import { InformationState } from "./types";
import {
  objectsEqual,
  WHQ,
  findout,
  consultDB,
  getFactArgument,
} from "./utils";

export const initialIS = (): InformationState => {
  const predicates: { [index: string]: string } = {
    // Mapping from predicate to sort
    favorite_food: "food",
    booking_course: "course",
    booking_day: "day", // [lab2] [Task 1] Predicate for the day question.
  };

  const individuals: { [index: string]: string } = {
    // Mapping from individual to sort
    pizza: "food",
    LT2319: "course",
    friday: "day", // [lab2] [Task 1] Days used by the room lookup.
    thursday: "day",
    tuesday: "day",
  };
  return {
    domain: {
      predicates: predicates,
      individuals: individuals,
      plans: [
        {
          type: "issue",
          content: WHQ("booking_room"),
          plan: [
            findout(WHQ("booking_day")), // [lab2] [Task 1] Ask the day before the course.
            findout(WHQ("booking_course")),
            consultDB(WHQ("booking_room")),
          ],
        },
      ],
    },
    database: {
      consultDB: (question, facts) => {
        if (objectsEqual(question, WHQ("booking_room"))) {
          const course = getFactArgument(facts, "booking_course");
          const day = getFactArgument(facts, "booking_day"); // [lab2] [Task 1] Read the agreed day.
          if (course == "LT2319" && day == "friday") {
            return { predicate: "booking_room", argument: "G212" };
          }
          if (
            course == "LT2319" &&
            (day == "thursday" || day == "tuesday")
          ) {
            return { predicate: "booking_room", argument: "J440" }; // [lab2] [Task 1] Thursday and Tuesday room.
          }
        }
        return null;
      },
    },
    next_moves: [],
    private: {
      plan: [],
      agenda: [
        {
          type: "greet",
          content: null,
        },
      ],
      bel: [{ predicate: "favorite_food", argument: "pizza" }],
    },
    shared: { lu: undefined, qud: [], com: [] },
  };
};
