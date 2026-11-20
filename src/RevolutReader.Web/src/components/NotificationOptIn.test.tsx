import { render, screen } from "@testing-library/react";
import { Bell } from "lucide-react";
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
