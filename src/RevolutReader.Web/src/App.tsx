import { useEffect, useState, type JSX } from "react";
import { needsInstallHint, type Device } from "./app/device";
import { readSession, type Session } from "./app/session";
import { AppShell } from "./components/AppShell";
import { InstallHint } from "./components/InstallHint";
import { SignInScreen } from "./screens/SignInScreen";

export interface AppProps {
  device: Device;
}

/** The app: the install hint alone in a browser tab on an iPhone, otherwise its screens (c003 design.md D8). */
export function App({ device }: AppProps): JSX.Element {
  return needsInstallHint(device) ? <InstallHint /> : <Screens />;
}

/**
 * The screen picked from the server's first answer to who is signed in, asked once at start (c007 design.md D3): signed
 * out → the sign-in screen. Until the answer comes, and when it is unknown (offline, a server error), the empty frame
 * (D5); C7 hooks its waiting and offline screens onto this.
 */
function Screens(): JSX.Element {
  const [session, setSession] = useState<Session>({ kind: "unknown" });

  useEffect(() => {
    let showing = true;

    void readSession().then((answer) => {
      if (showing) setSession(answer);
    });

    return () => {
      showing = false;
    };
  }, []);

  return session.kind === "signed-out" ? (
    <SignInScreen signedOut={session.justSignedOut} />
  ) : (
    <AppShell />
  );
}
