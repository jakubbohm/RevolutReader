# Manual scenarios

Scenarios verified by hand at handover instead of by an automated test. Each row is that scenario's one claim, and the traceability check reads this table ([docs/conventions/testing.md § Every scenario has exactly one test](../docs/conventions/testing.md#every-scenario-has-exactly-one-test-the-traceability-check)). The file doubles as the handover checklist.

| Capability | Scenario | Why manual | Handover step | Date last checked |
|---|---|---|---|---|
| app-installation | The Home Screen shows the app's icon and name | iOS draws the Home Screen itself, so only the owner's iPhone can show the icon and the name. First chance: after C4's first deploy. | M5 | |
| app-installation | The Home Screen app opens with its launch screen | iOS draws the launch screen from its own cache, in light and in dark mode, so only the owner's iPhone can show it. First chance: after C4's first deploy. | M5 | |
| app-delivery | The app opens without network after the first visit | Service worker behaviour on the phone: jsdom runs no service worker, and there are no browser tests ([divergences.md R-19](../docs/software-factory/divergences.md)). First chance: after C4's first deploy. | M5 | |
| app-delivery | A new version shows on the first open after a deploy | Needs two deploys and the iPhone's Home Screen app. First chance: after C4's second deploy. | M5 | |
