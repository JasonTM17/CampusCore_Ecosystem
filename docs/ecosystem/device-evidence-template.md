# Device evidence — <os> <build-id>

> Copy to `artifacts/verification/devices/<os>-<build>.md`. One file per
> OS per accepted build. Unverifiable rows stay `BLOCKED` — never blank.

## Build identity (mandatory)

| Field | Value |
| --- | --- |
| OS + version | e.g. Android 14 / iOS 18.x |
| Device model | e.g. Pixel 7 / iPhone 15 |
| App build | EAS build id + internal version |
| Runtime version | from `eas build:inspect` |
| Signing fingerprint | SHA-256 (Android) / TeamID+bundle (iOS) |
| Git SHA | source the build was made from |
| Evidence collector | name + date (UTC) |
| Bundle ID / package | `io.campuscore.mobile` |

## Scenario results

| # | Scenario | Verdict | Notes / artifact link |
| --- | --- | --- | --- |
| 1 | Fresh install → OIDC sign-in | | |
| 2 | Cold restart → session survives | | |
| 3 | Update over prior version | | |
| 4 | Sign-out → sign back in | | |
| 5 | Refresh-token replay after sign-out | | |
| 6 | `https://www.campusute.io.vn/news` deep link → app | | |
| 7 | `campuscore://auth/callback` stray link → guard | | |
| 8 | File picker (attachment lane) | | |
| 9 | Slow API (throttled) | | |
| 10 | Cold start with API down | | |
| 11 | Denied-role account | | |
| 12 | Reinstall → sign in | | |

## Verdict

`PASS` only when every row is `PASS`. `FAIL`/`BLOCKED` rows carry the
exact failure or the missing capability — an absent file and an
all-`BLOCKED` file mean the same thing: this OS leg is NOT_DONE.
