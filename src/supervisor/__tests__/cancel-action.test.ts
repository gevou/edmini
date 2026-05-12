/**
 * Unit tests for the noop cancelAction implementation.
 */
import { describe, expect, it } from "vitest";
import { cancelAction } from "../cancel-action";
import type { SupervisorEvent, SupervisorTransport } from "../types";

function createRecordingTransport(): {
  transport: SupervisorTransport;
  events: SupervisorEvent[];
} {
  const events: SupervisorEvent[] = [];
  return {
    transport: { emit: (event) => events.push(event) },
    events,
  };
}

describe("cancelAction (noop)", () => {
  it("emits exactly one cancelled event", async () => {
    const { transport, events } = createRecordingTransport();
    await cancelAction(
      { actionId: "act_test_1", reason: "user changed mind" },
      transport,
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("cancelled");
  });

  it("includes actionId and reason in the event payload", async () => {
    const { transport, events } = createRecordingTransport();
    await cancelAction(
      { actionId: "act_test_2", reason: "wrong date" },
      transport,
    );
    expect(events[0].payload).toMatchObject({
      actionId: "act_test_2",
      reason: "wrong date",
    });
  });

  it("references the actionId in the event label", async () => {
    const { transport, events } = createRecordingTransport();
    await cancelAction(
      { actionId: "act_test_3", reason: "..." },
      transport,
    );
    expect(events[0].label).toContain("act_test_3");
  });

  it("resolves without a return value", async () => {
    const { transport } = createRecordingTransport();
    const result = await cancelAction(
      { actionId: "act_test_4", reason: "..." },
      transport,
    );
    expect(result).toBeUndefined();
  });
});
