import { useEffect, type JSX } from "react";
import { needsInstallHint, type Device } from "./app/device";
import { keepServerAwake, pingServer } from "./app/keepAwake";
import { useAccountScreen } from "./app/useAccountScreen";
import { useNotificationOptIn } from "./app/useNotificationOptIn";
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
 * The screen the account screen's sequence picks (`useAccountScreen`, c007 design.md D3; c009 D2): the sign-in screen
 * when nobody is signed in, the no-access screen for a refused account, otherwise the account screen. Whichever shows,
 * the app keeps the server awake while it is on screen (c009 design.md D9): the sign-in screen too, so its button does
 * not meet a sleeping server.
 */
function Screens(): JSX.Element {
  const { shown, list, refresh, retry, signOut } = useAccountScreen();
  // The notification opt-in (c012 design.md D2): for the user the menu names, under the balance header or its placeholder.
  const optIn = useNotificationOptIn({
    signedIn: shown.screen === "account" && shown.account !== null,
    underBalance: shown.screen === "account" && shown.header !== null,
    onFailed: () => {},
    onRetried: () => {},
  });

  useEffect(() => keepServerAwake(pingServer), []);

  switch (shown.screen) {
    case "sign-in":
      return <SignInScreen signedOut={shown.justSignedOut} />;
    case "no access":
      return <NoAccessScreen email={shown.email} />;
    case "account":
      return (
        <AccountScreen
          shown={shown}
          list={list}
          onRefresh={refresh}
          onRetry={retry}
          onSignOut={signOut}
          optIn={optIn}
        />
      );
  }
}
