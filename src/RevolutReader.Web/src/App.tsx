import type { Device } from "./app/device";

export interface AppProps {
  device: Device;
}

/** The app: the install hint in a browser tab on an iPhone, otherwise the frame (c003 design.md D8). */
export function App({ device }: AppProps) {
  void device;
  return null;
}
