import { onTestFinished } from "vitest";

/**
 * Whether the phone's permission question came from a tap (c012 design.md D3, D7): iOS asks for notification
 * permission only while the page handles the user's gesture, so the app must call `Notification.requestPermission()`
 * synchronously in the tap's handler, never after an `await`. Built on the push stand-ins (./push.ts), which count the
 * questions but do not know when they came: this wraps their `Notification.requestPermission` and notes, for each
 * question, whether a tap's event (pointer, mouse, touch, click or key) was being dispatched at that moment.
 *
 * Call `watchPermissionQuestions()` after `installPushStandIns`; it stops watching when the test ends.
 */

/** The events of a tap or a key press, during whose dispatch a browser counts the page as handling the user's gesture. */
const GESTURE_EVENTS = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "click",
  "keydown",
  "keyup",
] as const;

/** The phone's permission questions, as the watch saw them. */
export interface PermissionQuestions {
  /** For each question asked, in order, whether it was asked while a tap's event was being dispatched. */
  askedInTap(): boolean[];
}

/** Watches the phone's permission questions for this test (see the module's description). */
export function watchPermissionQuestions(): PermissionQuestions {
  const notification = (globalThis as { Notification?: typeof Notification })
    .Notification;
  if (notification === undefined)
    throw new Error(
      "watchPermissionQuestions needs the push stand-ins: call installPushStandIns() first.",
    );

  const asked: boolean[] = [];
  let dispatching: Event[] = [];
  const onGesture = (event: Event): void => {
    dispatching.push(event);
  };
  // An event is being dispatched until its phase returns to NONE, also when a handler stops its propagation.
  const inTap = (): boolean => {
    dispatching = dispatching.filter(
      (event) => event.eventPhase !== Event.NONE,
    );
    return dispatching.length > 0;
  };

  for (const type of GESTURE_EVENTS)
    window.addEventListener(type, onGesture, { capture: true });

  const ask = notification.requestPermission.bind(notification);
  Object.defineProperty(notification, "requestPermission", {
    configurable: true,
    writable: true,
    value: (callback?: NotificationPermissionCallback) => {
      asked.push(inTap());
      return ask(callback);
    },
  });

  onTestFinished(() => {
    for (const type of GESTURE_EVENTS)
      window.removeEventListener(type, onGesture, { capture: true });
  });

  return { askedInTap: () => [...asked] };
}
