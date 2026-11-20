import { expect, test } from "vitest";
import { declarativeMessage } from "./pushDisplay";

// What the service worker does with a push (c012 design.md D9). Every value here is made up.

/** The page a message opens, on a made-up address of the app. */
const PAGE = "https://reader.example/";

/** A push's JSON as the server sends it (c011 design.md D2): Declarative Web Push, changed by `notification`. */
function pushJson(notification: Record<string, unknown>): unknown {
  return {
    web_push: 8030,
    notification: { title: "Ahoj", navigate: PAGE, ...notification },
  };
}

// ---- Reading a push: declarativeMessage ----

test("A Declarative Web Push message gives its title, its text and the page it opens", () => {
  expect(declarativeMessage(pushJson({ body: "Zkušební zpráva" }))).toEqual({
    title: "Ahoj",
    body: "Zkušební zpráva",
    navigate: PAGE,
  });
});

test("A message without text gives no text", () => {
  const message = declarativeMessage(pushJson({}));

  expect(message).toEqual({ title: "Ahoj", navigate: PAGE });
  expect(message?.body).toBeUndefined();
});

test("Anything else is no message: not an object, web_push other than 8030, no or an empty title, no navigate", () => {
  const notification = { title: "Ahoj", navigate: PAGE };
  const cases: [string, unknown][] = [
    ["not an object: null", null],
    ["not an object: undefined", undefined],
    ["not an object: a string", "Ahoj"],
    ["not an object: a number", 8030],
    ["no web_push", { notification }],
    ["web_push 8031", { web_push: 8031, notification }],
    ["web_push the string 8030", { web_push: "8030", notification }],
    ["no notification", { web_push: 8030 }],
    ["a null notification", { web_push: 8030, notification: null }],
    ["a string notification", { web_push: 8030, notification: "Ahoj" }],
    ["no title", { web_push: 8030, notification: { navigate: PAGE } }],
    ["an empty title", pushJson({ title: "" })],
    ["a title that is not a string", pushJson({ title: 42 })],
    ["no navigate", { web_push: 8030, notification: { title: "Ahoj" } }],
    ["a navigate that is not a string", pushJson({ navigate: 42 })],
  ];

  for (const [name, json] of cases) {
    expect(declarativeMessage(json), name).toBeNull();
  }
});

// ---- Showing a push: listenForPushes (group 41) ----
