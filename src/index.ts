import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createServer, createConnection, type Server as IPCServer, type Socket } from "node:net";
import { WebSocketServer, WebSocket, type Server as WSServer, RawData } from "ws";

type GenericReturnType<V extends unknown[],T extends (...args:V)=>unknown> = T extends (...args:V)=>infer R ? R : never;

type NumericFn = (counter:number,...args:(never|unknown)[])=>unknown;
type NumericFnArgs<T extends NumericFn> = (
  Parameters<T> extends [Parameters<T>[0], ...infer R extends unknown[]] ? R : [Parameters<T>[0]]
);

type BinaryEncoding = "hex"|"base64";

type uuid = `${string}-${string}-${string}-${string}-${string}`;

const enum Protocol { IPC = "ipc", WS = "ws", WSS = "wss" }

interface EvtMsg {
  evt: "connection"|"ping-pong"|"close"|"open"|"message"|"listening";
  transport: Protocol;
  receiver: "client"|"server"|"both";
  timestamp: readonly [number,number];
}

interface ConMsg extends EvtMsg {
  evt: "connection";
  id: number;
}

interface WSListenMsg extends EvtMsg {
  transport: Protocol.WS|Protocol.WSS;
  evt: "listening";
  port: number;
}

interface IPCListenMsg extends EvtMsg {
  transport: Protocol.IPC;
  evt: "listening";
  socketId: number;
}

interface ReqMsg extends EvtMsg {
  evt: "message";
  id: uuid;
  body: string|object;
  bodyType: string;
}

interface BinMsg extends ReqMsg {
  body : string;
  bodyType: `binary:${BinaryEncoding}`;
}

interface StrMsg extends ReqMsg {
  body: string;
  bodyType: "string"|"text";
}

interface JSONMsg extends ReqMsg {
  body: object;
  bodyType: "json";
}

interface ServerParamCommon {
  kind: Protocol;
}

interface ServerParamIPC extends ServerParamCommon {
  kind: Protocol.IPC;
  path: string;
}

interface ServerParamWS extends ServerParamCommon {
  kind: Protocol.WS | Protocol.WSS;
  host: string,
  port: number
}

const uid = process.getuid?.()??process.env["UID"]??1000;

const socketPath = process.platform === "win32" ? "\\\\pipe\\?" : process.env["XDG_RUNTIME_DIR"] ?? (
  existsSync(`/run/user/${uid}`) ? `/run/user/${uid}` : '/tmp/'
);

async function tryUntil<T extends NumericFn,V extends NumericFnArgs<T>,R extends GenericReturnType<[number,...V],T>>(fn:T,current:number,limit:number,...args:V): Promise<Awaited<R>> {
  try {
    return (await fn(current,...args)) as Awaited<R>;
  } catch(error:unknown) {
    if(current < limit)
      return await tryUntil(fn,current+1,limit,...args);
    if(error instanceof Error)
      throw error;
    else if(typeof error == "string")
      throw new Error(error);
    else if(typeof error === "object" && error !== null && "toString" in error && typeof error.toString === "function")
      throw new Error(error.toString());
    else
      throw new Error(String(error));
  }
}

function getServer(param: ServerParamWS):WSServer;
function getServer(param: ServerParamIPC):IPCServer;
function getServer(param: ServerParamIPC|ServerParamWS):IPCServer|WSServer {
  switch(param.kind) {
    case Protocol.IPC:
      return createServer().listen(param.path);
    case Protocol.WS:
    case Protocol.WSS: {
      return new WebSocketServer({ host: param.host, port: param.port, clientTracking: true });
    }
    default:
      throw new TypeError(`Unknown param of kind: '${(param as ServerParamCommon|undefined)?.kind}'`)
  }
}

const server = {
  ws: tryUntil((port) => new Promise<readonly [number,WSServer]>((ok,error) => {
    const server = getServer({ kind: Protocol.WS, host: "127.0.0.1", port });
    server.once("listening", () => ok(Object.freeze([port,server] as const)));
    server.once("error", (cause) => error(cause));
  }),6463,6472),
  ipc: tryUntil((id) => new Promise<readonly [number,IPCServer]>((ok,error) => {
    const server = getServer({ kind: Protocol.IPC, path: resolve(socketPath,`discord-ipc-${id}`) });
    //let isClosed = false;
    server.once("listening", () => ok(Object.freeze([id,server])));
    server.once("error", (cause) => error(cause));
  }),0,9)
}

/** Prints a JSON message about request which came through socket */
function dumpReqMsg(transport:Protocol,receiver:EvtMsg["receiver"],body:ReqMsg["body"]|Buffer,id:uuid,optInfo:object={}) {
  console.log(JSON.stringify({
    evt: "message",
    transport,
    receiver,
    id,
    ...(typeof body === "string" ? {
      body,
      bodyType: "string",
    } : body instanceof Buffer ? {
      body: body.toString("base64"),
      bodyType: "binary:base64"
    } : {
      body: body,
      bodyType: "json"
    }),
    ...optInfo,
    timestamp: process.hrtime()
  } satisfies JSONMsg|StrMsg|BinMsg));
}

/** Prints a JSON message to STDOUT indicating that specific event has came through the transport. */
function dumpEvtMsg<T extends Exclude<EvtMsg["evt"],"message">>(transport:Protocol,receiver:EvtMsg["receiver"],evt:T, portOrId: number|uuid) {
  console.log(JSON.stringify({
    evt,
    transport,
    receiver,
    ...(evt === "listening" ? transport === Protocol.IPC ? {socketId:portOrId} : {port:portOrId} : {id:portOrId}),
    timestamp: process.hrtime()
  } satisfies WSListenMsg|IPCListenMsg|EvtMsg|ConMsg))
}

/**
 * Checks if given message can be UTF-8 encoded. This heavily relies on
 * `Buffer.prototype.toString()` and counting `0xfffd` values after/before
 * conversion.
 */
function isValidUTF8(raw:RawData) {
  /** An instance of Buffer built from raw data. */
  const buffer = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof Buffer ? raw : Buffer.from(raw);
  /** Number of replacement characters **before** conversion to string. */
  const pre = buffer
    .filter(code => 0xfffd === code)
    .length;
  /** Number of replacement characters **after** conversion to string. */
  const post = [...buffer.toString()]
    .filter(char => 0xfffd === char.charCodeAt(0))
    .length;
  return pre === post;
}
function parseData(protocol:Protocol.IPC,receiver:EvtMsg["receiver"],id:uuid,data:Buffer,isBinary?:boolean):void
function parseData(protocol:Protocol.WS|Protocol.WSS,receiver:EvtMsg["receiver"],id:uuid,data:RawData,isBinary?:boolean):string|ArrayBuffer
function parseData(protocol:Protocol,receiver:EvtMsg["receiver"],id:uuid,data:Buffer|RawData,isBinary?:boolean):void|string|ArrayBuffer|never {
  switch(protocol){
    case Protocol.IPC: {
      if(!(data instanceof Buffer))
        throw TypeError("'data' is not a Buffer");
      let offset = 0;
      const dataPairs:[string,object|string|Buffer][]=[];
      while(offset < data.length) {
        const prefix = data.subarray(offset,offset+=8);
        const dataSize = prefix.readUInt32LE(4);
        const bodyRaw = data.subarray(offset,offset+=dataSize);
        let body:string|object|Buffer;
        if(isValidUTF8(bodyRaw)) {
          body = bodyRaw.toString();
          try {
            body = JSON.parse(body);
          } catch {}
        } else {
          body = bodyRaw;
        }
        dataPairs.push([prefix.toString("hex"),body]);
      }
      dataPairs.forEach(pair => {
        dumpReqMsg(protocol,receiver,pair[1],id,{bodyPrefix:pair[0]});
      })
      break;
    }
    default:
      const parsedData = (isBinary??!isValidUTF8(data)) ? (
        Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
        ) : (
          Array.isArray(data) ? data.every(buf => buf instanceof Buffer) ? Buffer.concat(data) : data as unknown[] : Buffer.from(data)
        ).toString();

      if(typeof parsedData === "string") try {
        dumpReqMsg(protocol,receiver,JSON.parse(parsedData),id);
      } catch {} else {
        dumpReqMsg(protocol,receiver,parsedData,id);
      }

      return parsedData;
  }
}

// IPC message ID store (to avoid loops)
const msgStore = new Set<string>();

// Source map support
(process as {setSourceMapsEnabled?: (stat:boolean)=>void})?.setSourceMapsEnabled?.(true)

// WebSocket
server.ws.then(([port,server]) => {
  const sigintMsg = JSON.stringify({signal:"SIGINT",transport:Protocol.WS});
  process.once("SIGINT",() => {server.close(); console.log("\r\r"+sigintMsg)});
  server.on("connection", async(ws,req) => {
    const id = crypto.randomUUID();
    /** A connection to Discord's WebSocket server. */
    const con = await (async () => { try {
      return await tryUntil((port) => new Promise<WebSocket>((ok,error)=>{
        const client = new WebSocket(new URL(req.url??"/?v=1",`ws://127.0.0.1:${port}`), {
          origin: req.headers["origin"]
        });
        const errorListener = (cause:Error) => error(cause);
        client.once("open", () => {
          ok(client);
          client.removeListener("error",errorListener)
        });
        client.once("error",errorListener);
      }),port+1,6472);
    } catch(error) {
      console.error(error);
      return null;
    }})()
    // Pipe: Discord->client->server
    ws.on("message", (data,isBinary) => {
      const parsed = parseData(Protocol.WS,"server",id,data,isBinary);
      if(con === null)
        return;
      if(con.readyState === con.OPEN)
        con.send(parsed);
      else
        con.once("open", () => con.send(parsed));
    });
    ws.on("pong", (data) => con?.ping(data));
    ws.on("close",(code,reason) => {
      if(con) try {
        con.close(Number(code),reason);
      } catch {
        con.close();
      }
      dumpEvtMsg(Protocol.WS,"server","close",id);
    });
    if(con === null)
      return;
    con.on("message", (data, isBinary) => {
      const parsed = parseData(Protocol.WS,"client",id,data,isBinary);
      if(ws.readyState === ws.OPEN)
        ws.send(parsed);
      else
        ws.once("open", () => ws.send(parsed))
    });
    con.on("pong",(data) => ws.ping(data));
    con.on("close",(code,reason) => {
      try {
        con.close(Number(code),reason);
      } catch {
        con.close();
      }
      dumpEvtMsg(Protocol.WS,"client","close",id);
    });
    dumpEvtMsg(Protocol.WS,"both","connection",id);
  });
  dumpEvtMsg(Protocol.WS,"both","listening",port);
});

// IPC
server.ipc.then(([socketId,server]) => {
  const sigintMsg = JSON.stringify({signal:"SIGINT",transport:Protocol.IPC});
  process.once("SIGINT",() => {server.close(); console.log("\r\r"+sigintMsg)});
  server.on("connection", async(ipc) => {
    /** Connection ID. */
    const id = crypto.randomUUID();
    const con = await (async () => { try {
      return await tryUntil((id) => new Promise<Socket>((ok,error) => {
        const client = createConnection({path: resolve(socketPath,`discord-ipc-${id}`)});
        client.once("connect", () => ok(client));
        client.once("error", (cause) => error(cause));
      }),socketId+1,9);
    } catch(error) {
      console.error(error);
      return null;
    }})();
    dumpEvtMsg(Protocol.IPC,"both","connection",id);
    ipc.on("data", (data) => {
      parseData(Protocol.IPC,"server",id,data);
      if(con === null)
        return;
      if(con.connecting)
        con.once("connect", () => con.write(data))
      else
        con.write(data);
    })
    ipc.on("end", () => con?.end());
    ipc.on("close", () => {
      dumpEvtMsg(Protocol.IPC,"server","close",id);
      con?.destroy();
    });
    if(con === null)
      return;
    con.on("data", (data) => {
      if(ipc.connecting)
        ipc.once("connect", () => ipc.write(data))
      else
        ipc.write(data);
    });
    con.on("end", () => ipc.end());
    con.on("close", () => {
      dumpEvtMsg(Protocol.IPC,"client","close",id);
      ipc.destroy();
    })
  });
  dumpEvtMsg(Protocol.IPC,"both","listening",socketId);
})