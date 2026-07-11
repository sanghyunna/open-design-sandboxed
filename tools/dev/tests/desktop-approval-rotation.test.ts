import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APP_KEYS } from "@open-design/sidecar-proto";

import { planDesktopApprovalLifecycle } from "../src/desktop-approval-rotation.js";

describe("desktop approval lifecycle", () => {
  it("couples a daemon restart to the live desktop and web", () => {
    assert.deepEqual(planDesktopApprovalLifecycle({
      daemonRunning: true,
      desktopRunning: true,
      forceDaemonRestart: true,
      startTargets: [APP_KEYS.DAEMON],
      stopTargets: [APP_KEYS.DAEMON],
      webRunning: true,
    }), {
      rotationRequired: true,
      startTargets: [APP_KEYS.DAEMON, APP_KEYS.WEB, APP_KEYS.DESKTOP],
      stopTargets: [APP_KEYS.DESKTOP, APP_KEYS.WEB, APP_KEYS.DAEMON],
    });
  });

  it("rotates after a daemon crash but leaves a headless start uncoupled", () => {
    assert.deepEqual(planDesktopApprovalLifecycle({
      daemonRunning: false,
      desktopRunning: true,
      startTargets: [APP_KEYS.DAEMON],
      webRunning: false,
    }), {
      rotationRequired: true,
      startTargets: [APP_KEYS.DAEMON, APP_KEYS.DESKTOP],
      stopTargets: [APP_KEYS.DESKTOP, APP_KEYS.DAEMON],
    });
    assert.equal(planDesktopApprovalLifecycle({
      daemonRunning: false,
      desktopRunning: false,
      startTargets: [APP_KEYS.DAEMON],
      webRunning: false,
    }).rotationRequired, false);
  });
});
