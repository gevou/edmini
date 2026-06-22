import { describe, it, expect, vi } from "vitest";
import { createLedger } from "../ledger-supabase";
import { fromRow, type LedgerRow } from "../ledger";

const sampleRow: LedgerRow = {
  id: "id1",
  seq: 1,
  ts: "2026-06-19T00:00:00Z",
  run_id: "t1",
  thread_id: null,
  source: "harness",
  kind: "run_output",
  payload: { text: "hi" },
};

describe("createLedger.append", () => {
  it("inserts only writable columns and maps the returned row", async () => {
    const single = vi.fn().mockResolvedValue({ data: sampleRow, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const ledger = createLedger({ from } as never);

    const out = await ledger.append({
      runId: "t1",
      source: "harness",
      kind: "run_output",
      payload: { text: "hi" },
    });

    expect(from).toHaveBeenCalledWith("events");
    expect(insert).toHaveBeenCalledWith({
      run_id: "t1",
      thread_id: null,
      source: "harness",
      kind: "run_output",
      payload: { text: "hi" },
    });
    expect(out).toEqual(fromRow(sampleRow));
  });

  it("throws on a Supabase error", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const from = vi.fn(() => ({ insert: () => ({ select: () => ({ single }) }) }));
    const ledger = createLedger({ from } as never);
    await expect(
      ledger.append({ runId: null, source: "edmini", kind: "x", payload: {} }),
    ).rejects.toThrow(/boom/);
  });
});

describe("createLedger.snapshot", () => {
  const rowA = { ...sampleRow, seq: 1 };
  const rowB = { ...sampleRow, seq: 2 };

  function mockClient(returned: unknown[]) {
    const q: Record<string, unknown> = {};
    q.order = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.limit = vi.fn(() => q);
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: returned, error: null });
    const select = vi.fn(() => q);
    const from = vi.fn(() => ({ select }));
    return { q, select, ledger: createLedger({ from } as never) };
  }

  it("with a limit, requests the most RECENT N (desc) and returns them chronological", async () => {
    // The DB, ordered desc + limited, yields newest→oldest; snapshot must reverse to oldest→newest.
    const { q, select, ledger } = mockClient([rowB, rowA]);
    const out = await ledger.snapshot({ runId: "t1", limit: 10 });
    expect(select).toHaveBeenCalledWith("*");
    expect(q.order).toHaveBeenCalledWith("seq", { ascending: false });
    expect(q.eq).toHaveBeenCalledWith("run_id", "t1");
    expect(q.limit).toHaveBeenCalledWith(10);
    expect(out).toEqual([fromRow(rowA), fromRow(rowB)]); // reversed to chronological
  });

  it("without a limit, returns the full set ascending (no reverse)", async () => {
    const { q, ledger } = mockClient([rowA, rowB]);
    const out = await ledger.snapshot();
    expect(q.order).toHaveBeenCalledWith("seq", { ascending: true });
    expect(out).toEqual([fromRow(rowA), fromRow(rowB)]);
  });
});

describe("createLedger.subscribe", () => {
  it("wires a postgres_changes INSERT handler that maps the new row", () => {
    let handler: ((p: { new: LedgerRow }) => void) | undefined;
    const channelObj: Record<string, unknown> = {};
    channelObj.on = vi.fn((_evt: unknown, _filter: unknown, cb: (p: { new: LedgerRow }) => void) => {
      handler = cb;
      return channelObj;
    });
    channelObj.subscribe = vi.fn(() => channelObj);
    const channel = vi.fn(() => channelObj);
    const ledger = createLedger({ channel } as never);

    const onEvent = vi.fn();
    ledger.subscribe(onEvent);

    expect(channel).toHaveBeenCalledWith("ledger:events");
    expect(channelObj.on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "events" },
      expect.any(Function),
    );
    expect(channelObj.subscribe).toHaveBeenCalled();

    handler?.({ new: sampleRow });
    expect(onEvent).toHaveBeenCalledWith(fromRow(sampleRow));
  });
});
