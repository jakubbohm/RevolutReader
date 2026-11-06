import { screen, within } from "@testing-library/react";
import { expect } from "vitest";
import { renderApp } from "../test/renderApp";
import { scenario } from "../test/scenario";

const INSTALL_HINT = "Nejdřív si appku přidej na plochu";

scenario(
  "app-installation",
  "iPhone Safari shows only the install hint",
  () => {
    renderApp("iPhone Safari");

    expect(
      screen.getByRole("heading", { name: INSTALL_HINT }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(3);
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  },
);

scenario(
  "app-installation",
  "The Home Screen app shows the app, not the install hint",
  () => {
    renderApp("iPhone Home Screen");

    expect(
      within(screen.getByRole("banner")).getByText("Tarjeta Papá"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: INSTALL_HINT }),
    ).not.toBeInTheDocument();
  },
);

scenario(
  "app-installation",
  "Other browsers show the app, not the install hint",
  () => {
    renderApp("computer browser");

    expect(
      within(screen.getByRole("banner")).getByText("Tarjeta Papá"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: INSTALL_HINT }),
    ).not.toBeInTheDocument();
  },
);
