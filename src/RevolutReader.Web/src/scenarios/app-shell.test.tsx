import { screen, within } from "@testing-library/react";
import { expect } from "vitest";
import { renderApp } from "../test/renderApp";
import { scenario } from "../test/scenario";

scenario("app-shell", "The top bar shows the app name", () => {
  renderApp("iPhone Home Screen");

  const name = within(screen.getByRole("banner")).getByText("Tarjeta Papá");
  expect(name).toBeInTheDocument();
  expect(name.closest("[lang]")).toHaveAttribute("lang", "es");
});
