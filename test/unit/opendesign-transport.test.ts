/**
 * CDP 传输层测试（真机教训的回归）。
 *
 * 真机实测：Open Design 的浏览器进程 `/json/version` 正常，但 `/json` 会挂起。
 * 因此传输必须**两条路径**：先 HTTP `/json`，失败即用浏览器级 WebSocket 的
 * `Target.getTargets` + `Target.attachToTarget(flatten)` 拿 `sessionId` 继续。
 *
 * 这里的断言：路径选择、会话路由（页面级命令带 sessionId / 浏览器级不带）、
 * 以及「两条都失败」时必须给出写明试过什么的可操作错误。
 */
import { describe, expect, it } from "vitest";
import {
  OpenDesignCdpError,
  OpenDesignTransport,
  resolvePageTargets,
  type CdpSocketLike,
} from "../../src/agents/opendesign/transport.js";

interface SentMessage {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

/** 假 WebSocket：记录发出的命令，并按 handler 同步回结果 */
function makeSocket(handler: (msg: SentMessage) => unknown) {
  const sent: SentMessage[] = [];
  const socket: CdpSocketLike & { sent: SentMessage[] } = {
    sent,
    send(data: string) {
      const msg = JSON.parse(data) as SentMessage;
      sent.push(msg);
      const result = handler(msg);
      if (result !== undefined)
        setTimeout(() => socket.onmessage?.({ data: JSON.stringify({ id: msg.id, result }) }), 0);
    },
    close() {
      /* no-op */
    },
    onopen: null,
    onerror: null,
    onclose: null,
    onmessage: null,
  };
  // 打开事件要在调用方挂好 onopen 之后触发（transport 是同步挂载的）
  setTimeout(() => socket.onopen?.(), 0);
  return socket;
}

describe("resolvePageTargets：快路径 / 慢路径 / 全失败", () => {
  it("HTTP /json 可用时走快路径，不碰浏览器级 WS", async () => {
    const targets = await resolvePageTargets(9222, 100, {
      fetchJson: async (_p, path) =>
        path === "/json" ? [{ type: "page", title: "Open Design", url: "od://app/" }] : null,
      browserCall: async () => {
        throw new Error("不应走慢路径");
      },
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]!.title).toBe("Open Design");
  });

  it("HTTP /json 挂起时回退到浏览器级 Target.getTargets", async () => {
    const targets = await resolvePageTargets(9222, 100, {
      fetchJson: async () => {
        throw new Error("hang");
      },
      browserCall: async () => ({
        targetInfos: [
          { type: "page", title: "Open Design", targetId: "T1" },
          { type: "service_worker", url: "od://sw.js" },
        ],
      }),
    });
    // 只返回 page 目标（service_worker 不算页面）
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetId).toBe("T1");
  });

  it("两条路径都失败 → 返回空列表（由调用方落明确错误）", async () => {
    const targets = await resolvePageTargets(9222, 50, {
      fetchJson: async () => {
        throw new Error("hang");
      },
      browserCall: async () => {
        throw new Error("ws fail");
      },
    });
    expect(targets).toEqual([]);
  });
});

describe("OpenDesignTransport：会话路由与命令执行", () => {
  /** 慢路径场景下的 fetchJson：/json 挂起，/json/version 给出浏览器级 WS */
  const hangingJson = async (_port: number, path: string) => {
    if (path === "/json/version") return { webSocketDebuggerUrl: "ws://browser-level" };
    throw new Error("hang");
  };

  it("慢路径：attach 拿到 sessionId，页面级命令带 sessionId、浏览器级命令不带", async () => {
    const socket = makeSocket((msg) => {
      if (msg.method === "Target.attachToTarget") return { sessionId: "S1" };
      if (msg.method === "Runtime.evaluate") return { result: { value: 42 } };
      return undefined;
    });
    const transport = new OpenDesignTransport({
      port: 9222,
      fetchJson: hangingJson,
      browserCall: async () => ({
        targetInfos: [{ type: "page", title: "Open Design", targetId: "T1" }],
      }),
      createSocket: () => socket as unknown as CdpSocketLike,
      sendTimeoutMs: 500,
    });
    await transport.connect();
    expect(transport.connected).toBe(true);

    const value = await transport.evaluate<number>("42");
    expect(value).toBe(42);

    const attach = socket.sent.find((m) => m.method === "Target.attachToTarget");
    expect(attach?.sessionId).toBeUndefined(); // 浏览器级方法不得带 sessionId
    const evaluate = socket.sent.find((m) => m.method === "Runtime.evaluate");
    expect(evaluate?.sessionId).toBe("S1"); // 页面级方法必须带
    transport.disconnect();
  });

  it("快路径：目标自带页面级 WS，不需要 attach，也不带 sessionId", async () => {
    const socket = makeSocket((msg) =>
      msg.method === "Runtime.enable" ? {} : { result: { value: "ok" } },
    );
    const transport = new OpenDesignTransport({
      port: 9222,
      fetchJson: async (_p, path) =>
        path === "/json"
          ? [{ type: "page", title: "Open Design", webSocketDebuggerUrl: "ws://page-level" }]
          : { webSocketDebuggerUrl: "ws://browser-level" },
      createSocket: () => socket as unknown as CdpSocketLike,
      sendTimeoutMs: 500,
    });
    await transport.connect();
    await transport.evaluate("location.href");
    expect(socket.sent.some((m) => m.method === "Target.attachToTarget")).toBe(false);
    const evaluate = socket.sent.find((m) => m.method === "Runtime.evaluate");
    expect(evaluate?.sessionId).toBeUndefined();
    transport.disconnect();
  });

  it("端口上没有页面目标 → 抛出写明原因的可操作错误", async () => {
    const transport = new OpenDesignTransport({
      port: 9222,
      fetchJson: async () => [],
      browserCall: async () => ({ targetInfos: [] }),
      createSocket: () => makeSocket(() => undefined) as unknown as CdpSocketLike,
      connectTimeoutMs: 100,
    });
    await expect(transport.connect()).rejects.toBeInstanceOf(OpenDesignCdpError);
    await expect(transport.connect()).rejects.toThrow(/没有页面目标/);
  });

  it("未连接时发送命令 → 明确报「未连接」而不是挂死", async () => {
    const transport = new OpenDesignTransport({ port: 9222, sendTimeoutMs: 100 });
    await expect(transport.send("Runtime.evaluate", {})).rejects.toThrow(/未连接/);
  });
});