// Vitest setup (c003 design.md § Bootstrap): Testing Library's DOM matchers, and a clean DOM after every test.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
