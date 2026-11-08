import { useEffect, useState, type JSX } from "react";
import { needsInstallHint, type Device } from "./app/device";
import { readSession, type Session } from "./app/session";
import { InstallHint } from "./components/InstallHint";
import { AccountScreen } from "./screens/AccountScreen";
import { NoAccessScreen } from "./screens/NoAccessScreen";
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
 * out → the sign-in screen; refused → the no-access screen, naming the account; signed in → the account screen, with
 * the account menu. Until the answer comes, and when it is unknown (offline, a server error), the same screen without
 * the menu: the empty frame (D5), so the top bar stays in place when a signed-in answer comes. C7 hooks its waiting and
 * offline screens onto this.
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

  switch (session.kind) {
    case "signed-out":
      return <SignInScreen signedOut={session.justSignedOut} />;
    case "refused":
      return <NoAccessScreen email={session.email} />;
    case "signed-in":
      return (
        <AccountScreen account={{ name: session.name, email: session.email }} />
      );
    case "unknown":
      return <AccountScreen />;
  }
}
