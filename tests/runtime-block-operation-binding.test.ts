import { describe, expect, it, vi } from "vitest";

import { TaskQueueService } from "../src/application/task-queue/index.js";
import { DefaultWorkSafetyPolicy } from "../src/domain/safety/index.js";
import { createStateStore } from "../src/domain/state/index.js";
import {
  createAcceptanceRuntimeBlockOperationBinding,
  createDisabledRuntimeBlockOperationBinding,
} from "../src/runtime/block-operation-binding.js";
import { FakeBlockOperationPort } from "./fakes/fake-block-operation-port.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

describe("runtime block operation binding", () => {
  it("既定でunsupportedかつdisabledで外部通信しない", async () => {
    const binding = createDisabledRuntimeBlockOperationBinding();
    expect(binding.enabled).toBe(false);
    expect(binding.port.capability).toBe("unsupported");
    await expect(
      binding.port.observe(
        { x: 0, y: 71, z: 0, dimension: "overworld" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("closeを複数回安全に呼べる", () => {
    const binding = createDisabledRuntimeBlockOperationBinding();
    const stop = vi.spyOn(binding.port, "stop");
    binding.close();
    binding.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("明示的な専用試験bindingだけcoordinatorを生成しcloseで中断する", () => {
    const port = new FakeBlockOperationPort([]);
    const binding = createAcceptanceRuntimeBlockOperationBinding({
      approvedForDedicatedTestServer: true,
      port,
      stateStore: createStateStore(),
      safetyPolicy: new DefaultWorkSafetyPolicy(),
      taskQueue: new TaskQueueService(new FakeTaskQueueRepository()),
    });
    expect(binding.enabled).toBe(true);
    if (!binding.enabled) throw new Error("acceptance binding missing");
    expect(binding.coordinator).toBeDefined();
    binding.close();
    binding.close();
    expect(port.stopCalls).toBe(1);
  });

  it("unsupported portではacceptance bindingもfail-closedに拒否する", () => {
    const disabled = createDisabledRuntimeBlockOperationBinding();
    expect(() =>
      createAcceptanceRuntimeBlockOperationBinding({
        approvedForDedicatedTestServer: true,
        port: disabled.port,
        stateStore: createStateStore(),
        safetyPolicy: new DefaultWorkSafetyPolicy(),
        taskQueue: new TaskQueueService(new FakeTaskQueueRepository()),
      }),
    ).toThrowError("Block operation adapter is unsupported");
  });
});
