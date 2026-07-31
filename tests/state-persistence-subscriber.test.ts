import { describe, expect, it, vi } from "vitest";

import { StatePersistenceSubscriber } from "../src/application/persistence/index.js";
import { createStateStore } from "../src/domain/state/index.js";
import { PersistenceError } from "../src/ports/state-persistence-repository.js";
import { FakeStatePersistenceRepository } from "./fakes/fake-state-persistence-repository.js";

describe("StatePersistenceSubscriber", () => {
  it("revision順に直列保存し、通知outbox候補を同じ呼出しへ渡す", async () => {
    const repository = new FakeStatePersistenceRepository();
    const subscriber = new StatePersistenceSubscriber(
      repository,
      "00000000-0000-4000-8000-000000000001",
    );
    const store = createStateStore();
    subscriber.subscribe(store);
    store.dispatch({ type: "runtime.transition", to: "connecting" });
    store.dispatch({
      type: "minecraft.connection.transition",
      to: "connecting",
    });
    await subscriber.flush();

    expect(repository.persisted.map(({ event }) => event.revision)).toEqual([
      1, 2,
    ]);
    expect(
      repository.persisted.map(({ notification }) => notification?.type),
    ).toEqual([undefined, "minecraft_connecting"]);
    subscriber.close();
  });

  it("古いrevisionと重複revisionを破棄する", async () => {
    const repository = new FakeStatePersistenceRepository();
    const subscriber = new StatePersistenceSubscriber(repository, "run");
    const store = createStateStore();
    const first = store.dispatch({
      type: "runtime.transition",
      to: "connecting",
    });
    const second = store.dispatch({
      type: "runtime.transition",
      to: "reconnecting",
    });
    if (first === undefined || second === undefined)
      throw new Error("fixture event missing");
    subscriber.accept(second);
    subscriber.accept(first);
    subscriber.accept(second);
    await subscriber.flush();
    expect(repository.persisted.map(({ event }) => event.revision)).toEqual([
      2,
    ]);
  });

  it("一時障害だけを上限付き指数backoffで再試行する", async () => {
    const repository = new FakeStatePersistenceRepository();
    let failures = 2;
    repository.handler = () => {
      if (failures-- > 0)
        return Promise.reject(
          new PersistenceError("PERSISTENCE_TRANSIENT", true),
        );
      return Promise.resolve();
    };
    const waits: number[] = [];
    const subscriber = new StatePersistenceSubscriber(repository, "run", {
      wait: (delayMs) => {
        waits.push(delayMs);
        return Promise.resolve();
      },
    });
    const store = createStateStore();
    const event = store.dispatch({
      type: "runtime.transition",
      to: "connecting",
    });
    if (event === undefined) throw new Error("fixture event missing");
    subscriber.accept(event);
    await subscriber.flush();
    expect(repository.persisted).toHaveLength(3);
    expect(waits).toEqual([100, 200]);
  });

  it("恒久障害を隔離し後続eventを保存する", async () => {
    const repository = new FakeStatePersistenceRepository();
    repository.handler = ({ event }) =>
      event.revision === 1
        ? Promise.reject(new PersistenceError("PERSISTENCE_FATAL", false))
        : Promise.resolve();
    const onError = vi.fn();
    const subscriber = new StatePersistenceSubscriber(repository, "run", {
      onError,
    });
    const store = createStateStore();
    subscriber.subscribe(store);
    store.dispatch({ type: "runtime.transition", to: "connecting" });
    store.dispatch({ type: "runtime.transition", to: "reconnecting" });
    await subscriber.flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(repository.persisted.map(({ event }) => event.revision)).toEqual([
      1, 2,
    ]);
    expect(store.getSnapshot().runtime).toBe("reconnecting");
  });

  it("close後は新規eventを受け付けず、既存配送完了を待たない", async () => {
    const repository = new FakeStatePersistenceRepository();
    let release = (): void => undefined;
    repository.handler = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const subscriber = new StatePersistenceSubscriber(repository, "run");
    const store = createStateStore();
    subscriber.subscribe(store);
    store.dispatch({ type: "runtime.transition", to: "connecting" });
    await Promise.resolve();
    await Promise.resolve();
    subscriber.close();
    store.dispatch({ type: "runtime.transition", to: "reconnecting" });
    expect(repository.persisted).toHaveLength(1);
    release();
    await subscriber.flush();
    expect(repository.persisted).toHaveLength(1);
  });
});
