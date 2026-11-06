import type { JSX } from "react";
import { needsInstallHint, type Device } from "./app/device";
import { AppShell } from "./components/AppShell";
import { InstallHint } from "./components/InstallHint";

export interface AppProps {
  device: Device;
}

/** The app: the install hint alone in a browser tab on an iPhone, otherwise the frame (c003 design.md D8). */
export function App({ device }: AppProps): JSX.Element {
  return needsInstallHint(device) ? <InstallHint /> : <AppShell />;
}
