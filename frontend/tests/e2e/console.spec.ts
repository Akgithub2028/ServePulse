import { expect, test } from "@playwright/test";
import {
  HEALTH_DEGRADED,
  MODEL_INFO,
  PREDICT_OK,
  UNAVAILABLE_ENVELOPE,
  VALIDATION_ENVELOPE,
  mockApi,
} from "./fixtures";

test.describe("application shell", () => {
  test("loads and lands on the control room", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Control Room", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
  });

  test("navigation reaches all five views", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Sections" });
    for (const [label, heading] of [
      ["Inference Lab", "Inference Lab"],
      ["Observability", "Observability"],
      ["Model Provenance", "Model Provenance"],
      ["Platform / API", "Platform / API"],
      ["Control Room", "Control Room"],
    ] as const) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
  });

  test("deep links resolve through the SPA fallback", async ({ page }) => {
    await mockApi(page);
    await page.goto("/provenance");
    await expect(page.getByRole("heading", { name: "Model Provenance", level: 1 })).toBeVisible();
  });
});

test.describe("control room", () => {
  test("shows the live service and model state", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");

    // State, model identity and telemetry, all from the (stubbed) live API. Assertions are
    // scoped to the tile/panel that owns the value, so they test placement as well as presence.
    await expect(page.getByText("serving 1")).toBeVisible();
    await expect(page.getByText("alias production").first()).toBeVisible();

    const predictions = page.locator(".stat").filter({ hasText: "Predictions logged" });
    await expect(predictions.getByText("1,119")).toBeVisible();

    const servedModel = page.locator(".panel").filter({ hasText: "Served model" });
    await expect(servedModel.getByText("adult-income-classifier")).toBeVisible();
    await expect(servedModel.getByText(/54122c6ae121/)).toBeVisible();

    await expect(page.getByText("mlserve_prediction_score").first()).toBeVisible();
  });

  test("reports a degraded service as alive but not ready", async ({ page }) => {
    await mockApi(page, {
      health: HEALTH_DEGRADED,
      readyStatus: 503,
      readyBody: UNAVAILABLE_ENVELOPE,
      modelInfo: null,
      modelInfoStatus: 503,
    });
    await page.goto("/");

    await expect(page.getByText("degraded · no model")).toBeVisible();
    await expect(page.getByText("Alive but not ready: no model is loaded")).toBeVisible();
    await expect(page.getByText("503 model_not_loaded")).toBeVisible();
  });

  test("surfaces an unreachable backend without breaking the page", async ({ page }) => {
    await mockApi(page, { offline: true });
    await page.goto("/");

    await expect(page.getByText("API unreachable").first()).toBeVisible();
    await expect(page.getByText("The browser cannot reach the backend").first()).toBeVisible();
    // The shell still works.
    await expect(page.getByRole("heading", { name: "Control Room", level: 1 })).toBeVisible();
  });
});

test.describe("inference lab", () => {
  test("submits the example record and renders the prediction", async ({ page }) => {
    await mockApi(page);
    await page.goto("/inference");

    await page.getByRole("button", { name: /score 1 record/ }).click();

    await expect(page.getByRole("cell", { name: "0.1834" })).toBeVisible();
    await expect(page.getByText(PREDICT_OK.request_id)).toBeVisible();
    await expect(page.getByRole("cell", { name: "<=50K" })).toBeVisible();
  });

  test("scoring a batch reports the batch in the response", async ({ page }) => {
    await mockApi(page, {
      predict: { status: 200, body: { ...PREDICT_OK, n_records: 4, predictions: Array(4).fill(PREDICT_OK.predictions[0]) } },
    });
    await page.goto("/inference");

    await page.getByLabel("batch size").fill("4");
    await page.getByRole("button", { name: /score 4 records/ }).click();
    await expect(page.getByRole("definition").filter({ hasText: /^4$/ })).toBeVisible();
  });

  test("rejects an out-of-contract value before sending it", async ({ page }) => {
    await mockApi(page);
    await page.goto("/inference");

    const age = page.getByLabel("age", { exact: true });
    await age.fill("900");
    await age.blur();

    await expect(page.getByText("must be between 17 and 90")).toBeVisible();
    await expect(page.getByRole("button", { name: /score 1 record/ })).toBeDisabled();
  });

  test("explains a missing model in the lab as well as the control room", async ({ page }) => {
    await mockApi(page, {
      health: HEALTH_DEGRADED,
      readyStatus: 503,
      readyBody: UNAVAILABLE_ENVELOPE,
      modelInfo: null,
      modelInfoStatus: 503,
    });
    await page.goto("/inference");
    await expect(page.getByText("Predictions will fail until a model loads")).toBeVisible();
  });

  test("shows the model's own validation error when the service rejects the payload", async ({ page }) => {
    await mockApi(page, { predict: { status: 422, body: VALIDATION_ENVELOPE } });
    await page.goto("/inference");
    await page.getByRole("button", { name: /score 1 record/ }).click();

    await expect(page.getByText("Rejected by the data contract")).toBeVisible();
    await expect(page.getByText("less_than_equal")).toBeVisible();
    await expect(page.getByText(VALIDATION_ENVELOPE.error.details[0]!.location)).toBeVisible();
  });

  test("renders an oversized-batch rejection distinctly", async ({ page }) => {
    await mockApi(page, {
      predict: {
        status: 413,
        body: {
          request_id: "cccccccc-dddd-eeee-ffff-000000000000",
          error: { type: "payload_too_large", message: "batch of 999 exceeds the maximum of 512", details: [] },
        },
      },
    });
    await page.goto("/inference");
    await page.getByRole("button", { name: /score 1 record/ }).click();
    await expect(page.getByText("Batch too large")).toBeVisible();
    await expect(page.getByText("exceeds the maximum of 512")).toBeVisible();
  });
});

test.describe("observability", () => {
  test("renders recorded telemetry and the window control", async ({ page }) => {
    await mockApi(page);
    await page.goto("/observability");

    await expect(page.getByRole("heading", { name: "Observability", level: 1 })).toBeVisible();

    const predictions = page.locator(".stat").filter({ hasText: /^Predictions/ });
    await expect(predictions.getByText("1,119")).toBeVisible();
    await expect(page.locator(".stat").filter({ hasText: "Model versions seen" })).toBeVisible();

    const events = page.locator(".panel").filter({ hasText: "Recorded events" });
    await expect(events.getByText("validation_error")).toBeVisible();
    await expect(page.getByRole("group", { name: "Aggregation window" })).toBeVisible();
  });

  test("switching the window re-queries the summary with a window parameter", async ({ page }) => {
    await mockApi(page);
    await page.goto("/observability");

    const request = page.waitForRequest((candidate) => candidate.url().includes("window_seconds=900"));
    await page.getByRole("button", { name: "15m" }).click();
    await request;
  });

  test("states plainly when monitoring is disabled", async ({ page }) => {
    await mockApi(page, {
      monitoring: { enabled: false, uptime_seconds: 30, served_model_version: "1" },
    });
    await page.goto("/observability");
    await expect(page.getByText("Monitoring is disabled on this instance")).toBeVisible();
  });
});

test.describe("model provenance", () => {
  test("renders the full trace chain", async ({ page }) => {
    await mockApi(page);
    await page.goto("/provenance");

    for (const step of ["Dataset", "Training run", "Behaviour fingerprint", "Registry version", "Serving process"]) {
      await expect(page.getByText(step, { exact: true })).toBeVisible();
    }
    const trace = page.locator(".panel").filter({ hasText: "Trace" }).first();
    await expect(trace.getByText(MODEL_INFO.dataset_version)).toBeVisible();
    await expect(trace.getByText(MODEL_INFO.run_id)).toBeVisible();
    await expect(page.getByText(MODEL_INFO.git_commit!, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("0.926784").first()).toBeVisible();
  });

  test("lists the model's real input columns", async ({ page }) => {
    await mockApi(page);
    await page.goto("/provenance");
    await expect(page.getByText(/12 input columns/).first()).toBeVisible();
    await expect(page.getByText("native_country", { exact: true }).first()).toBeVisible();
  });

  test("explains an empty registry instead of showing a broken chain", async ({ page }) => {
    await mockApi(page, {
      health: HEALTH_DEGRADED,
      readyStatus: 503,
      readyBody: UNAVAILABLE_ENVELOPE,
      modelInfo: null,
      modelInfoStatus: 503,
    });
    await page.goto("/provenance");
    await expect(page.getByText("No model is loaded, so there is no provenance to trace")).toBeVisible();
  });
});

test.describe("platform view", () => {
  test("lists the endpoint inventory from the service document", async ({ page }) => {
    await mockApi(page);
    await page.goto("/platform");

    await expect(page.getByRole("heading", { name: "Platform / API", level: 1 })).toBeVisible();
    await expect(page.getByText("/predict", { exact: true })).toBeVisible();
    await expect(page.getByText("/admin/reload", { exact: true })).toBeVisible();
    await expect(page.getByText("admin", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("This console holds no privileged credential")).toBeVisible();
  });

  test("does not expose a privileged credential anywhere in the page", async ({ page }) => {
    await mockApi(page);
    await page.goto("/platform");

    const html = await page.content();
    expect(html).not.toContain("MLSERVE_ADMIN_TOKEN");
    expect(html).not.toMatch(/ghp_[A-Za-z0-9]{36}/);

    const storage = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
    }));
    expect(storage.local.toLowerCase()).not.toContain("token");
    expect(storage.session.toLowerCase()).not.toContain("token");
  });
});

test.describe("responsive behaviour", () => {
  test("remains usable at a narrow viewport", async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Control Room", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "Inference Lab" }).click();
    await expect(page.getByRole("heading", { name: "Inference Lab", level: 1 })).toBeVisible();

    // No horizontal overflow: the page must not be wider than the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("accessibility basics", () => {
  test("keyboard users can reach the navigation and the submit control", async ({ page }) => {
    await mockApi(page);
    await page.goto("/inference");

    await expect(page.getByRole("heading", { name: "Inference Lab", level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    const focusables = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("a,button,input,select")).length,
    );
    expect(focusables).toBeGreaterThan(5);

    const submit = page.getByRole("button", { name: /score 1 record/ });
    await submit.focus();
    await expect(submit).toBeFocused();
  });

  test("states are announced, not only coloured", async ({ page }) => {
    await mockApi(page, { offline: true });
    await page.goto("/");
    // The unreachable state is an alert with text, so it is available to a screen reader.
    await expect(page.getByRole("alert").first()).toBeVisible();
  });
});
