import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bell, BellRing, LoaderCircle } from "lucide-react";
import { expect, test } from "vitest";
import { NotificationOptIn } from "./NotificationOptIn";

// The notification opt-in card (design system NotificationOptIn, c012 design.md D1). Its texts and buttons are read by
// role and text, as a user and a screen reader meet them. Its icon is decorative (hidden from screen readers) and has no
// role or name, so it is compared with Lucide's own icon by its drawing.

/** The drawing of a Lucide icon on its own, to compare with the icon a card shows. */
function drawingOf(Icon: typeof Bell): string {
  const { container, unmount } = render(<Icon />);
  const drawing = container.querySelector("svg")?.innerHTML ?? "";
  unmount();
  return drawing;
}

test('The default card shows the bell, "Chceš vědět o každé platbě?", its sentence, "Zapnout upozornění" and "Teď ne"', () => {
  const bell = drawingOf(Bell);
  expect(bell, "Lucide's bell draws something").not.toBe("");
  const { container } = render(
    <NotificationOptIn
      state="default"
      onEnable={() => {}}
      onDismiss={() => {}}
    />,
  );

  const icons = [...container.querySelectorAll("svg")];
  expect(
    icons.some(
      (icon) =>
        icon.innerHTML === bell &&
        icon.closest('[aria-hidden="true"]') !== null,
    ),
    "the bell, hidden from screen readers",
  ).toBe(true);
  const title = screen.getByText("Chceš vědět o každé platbě?");
  const sentence = screen.getByText(
    "Hned uvidíš, když přijdou peníze nebo když zaplatíš kartou.",
  );
  const enable = screen.getByRole("button", { name: "Zapnout upozornění" });
  const dismiss = screen.getByRole("button", { name: "Teď ne" });
  expect(enable).toBeEnabled();
  expect(dismiss).toBeEnabled();
  expect(
    title.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the sentence under the title",
  ).toBeTruthy();
  expect(
    sentence.compareDocumentPosition(enable) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the buttons under the sentence",
  ).toBeTruthy();
  expect(
    enable.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING,
    '"Teď ne" under "Zapnout upozornění"',
  ).toBeTruthy();
});

// ---- group 10: the card turning on (D1: the enabling and enabled states) ----

test('Enabling: "Zapnout upozornění" spins beside its label, is busy and ignores taps; "Teď ne" is disabled', async () => {
  const spinner = drawingOf(LoaderCircle);
  let enables = 0;
  render(
    <NotificationOptIn
      state="enabling"
      onEnable={() => {
        enables += 1;
      }}
      onDismiss={() => {}}
    />,
  );
  const user = userEvent.setup();

  const enable = screen.getByRole("button", { name: "Zapnout upozornění" });
  expect(enable, "busy, its label kept as its whole name").toHaveAttribute(
    "aria-busy",
    "true",
  );
  expect(
    [...enable.querySelectorAll("svg")].some(
      (icon) => icon.innerHTML === spinner,
    ),
    "a spinner beside the label",
  ).toBe(true);
  await user.click(enable);
  expect(enables, "the tap is ignored").toBe(0);
  expect(screen.getByRole("button", { name: "Teď ne" })).toBeDisabled();
});

test('Enabled: the ringing bell, "Upozornění jsou zapnutá", its sentence, no button, announced as a status', () => {
  const ringingBell = drawingOf(BellRing);
  expect(ringingBell, "Lucide's ringing bell draws something").not.toBe("");
  const { container } = render(
    <NotificationOptIn
      state="enabled"
      onEnable={() => {}}
      onDismiss={() => {}}
    />,
  );

  expect(
    [...container.querySelectorAll("svg")].some(
      (icon) =>
        icon.innerHTML === ringingBell &&
        icon.closest('[aria-hidden="true"]') !== null,
    ),
    "the ringing bell, hidden from screen readers",
  ).toBe(true);
  const status = screen.getByRole("status");
  const title = within(status).getByText("Upozornění jsou zapnutá");
  const sentence = within(status).getByText(
    "Když se na účtu něco změní, přijde ti upozornění.",
  );
  expect(
    title.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the sentence under the title",
  ).toBeTruthy();
  expect(screen.queryAllByRole("button"), "no button").toEqual([]);
});
