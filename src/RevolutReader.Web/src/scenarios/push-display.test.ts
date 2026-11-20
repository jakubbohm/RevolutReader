import { expect } from "vitest";
import { listenForPushes } from "../app/pushDisplay";
import { scenario } from "../test/scenario";
import { installServiceWorkerStandIn, ORIGIN } from "../test/serviceWorker";

/** A push as the server sends it (c011 design.md D2): Declarative Web Push, opening `page` on the app's own address. */
function message(
  title: string,
  options: { body?: string; page?: string } = {},
): unknown {
  return {
    web_push: 8030,
    notification: {
      title,
      ...(options.body === undefined ? {} : { body: options.body }),
      navigate: `${ORIGIN}${options.page ?? "/"}`,
    },
  };
}

scenario(
  "push-display",
  "A push shows as a notification where the browser does not show it itself",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ declarative: false });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(
      message("Ahoj", { body: "Zkušební zpráva", page: "/" }),
    );

    expect(
      serviceWorker
        .shownNotifications()
        .map(({ title, body }) => ({ title, body })),
    ).toEqual([{ title: "Ahoj", body: "Zkušební zpráva" }]);
  },
);

scenario(
  "push-display",
  "A push the browser shows itself shows once",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(message("Ahoj"));

    expect(serviceWorker.shownNotifications()).toEqual([]);
  },
);

scenario(
  "push-display",
  "A tap on a notification opens the app at its page",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ openWindows: [] });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(message("Ahoj", { page: "/" }));
    expect(serviceWorker.shownNotifications()).toHaveLength(1);

    await serviceWorker.tapNotification();

    expect(serviceWorker.openedWindows()).toEqual([`${ORIGIN}/`]);
  },
);

scenario(
  "push-display",
  "A tap on a notification brings the open app to the front",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({
      openWindows: [`${ORIGIN}/`],
    });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(message("Ahoj"));
    expect(serviceWorker.shownNotifications()).toHaveLength(1);

    await serviceWorker.tapNotification();

    expect(serviceWorker.focusedWindows()).toEqual([`${ORIGIN}/`]);
    expect(serviceWorker.openedWindows()).toEqual([]);
  },
);
