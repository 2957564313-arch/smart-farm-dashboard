const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEVICE_TIMEOUT_MS = 30_000;
const HISTORY_LIMIT = 36;

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeIp(ip) {
  if (!ip) {
    return null;
  }

  if (ip.startsWith("::ffff:")) {
    return ip.slice(7);
  }

  return ip;
}

function getLanUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) {
      continue;
    }

    for (const address of addresses) {
      if (address.family === "IPv4" && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }

  return urls;
}

function buildSeedHistory() {
  const baseLight = 16200;
  const baseSoil = 57;
  const baseTemp = 24.6;
  const baseHumidity = 62;
  const result = [];
  const start = Date.now() - 11 * 60_000;

  for (let i = 0; i < 12; i += 1) {
    result.push({
      timestamp: new Date(start + i * 60_000).toISOString(),
      lightLux: Math.round(baseLight + Math.sin(i / 2) * 2800 + (i % 3) * 260),
      soilMoisture: clamp(Math.round(baseSoil - i * 0.8 + (i % 2) * 2), 0, 100),
      airTemperature: Number((baseTemp + Math.sin(i / 3) * 0.9).toFixed(1)),
      airHumidity: clamp(Math.round(baseHumidity + Math.cos(i / 3) * 5), 0, 100)
    });
  }

  return result;
}

const state = {
  meta: {
    title: "智能农业网页控制台",
    subtitle: "实时数据、参数配置、手动控制、风险提示、历史曲线与运行日志",
    serverStartedAt: nowIso(),
    networkUrls: getLanUrls(PORT)
  },
  device: {
    id: "esp32-farm-01",
    name: "ESP32-WROOM-E 边缘控制节点",
    firmware: "esp32-wroom-e-v1",
    ip: "demo",
    rssi: -58,
    lastSeen: Date.now()
  },
  sensors: {
    lightLux: 18600,
    soilMoisture: 57,
    airTemperature: 24.8,
    airHumidity: 63,
    soilTemperature: 22.5,
    battery: 88
  },
  controls: {
    mode: "auto",
    pump: "off",
    mist: "off",
    fan: "off",
    growLight: "on",
    fanPwm: 0,
    growLightPwm: 65
  },
  config: {
    soilMoistureLow: 40,
    soilMoistureHigh: 75,
    lightLuxLow: 9000,
    airHumidityLow: 45,
    airTemperatureHigh: 32,
    sampleIntervalSec: 5
  },
  history: buildSeedHistory(),
  alerts: [],
  recommendations: {},
  report: {},
  activityLog: []
};

const sseClients = new Set();
const commandQueues = new Map();

function addActivity(text, kind = "info") {
  state.activityLog.unshift({
    id: randomUUID(),
    text,
    kind,
    createdAt: nowIso()
  });
  state.activityLog = state.activityLog.slice(0, 20);
}

function getPendingCommands(deviceId) {
  return commandQueues.get(deviceId) || [];
}

function queueCommand(deviceId, key, value, source = "dashboard") {
  const queue = getPendingCommands(deviceId).slice();
  queue.push({
    id: randomUUID(),
    key,
    value,
    source,
    createdAt: nowIso()
  });
  commandQueues.set(deviceId, queue);
}

function popCommands(deviceId) {
  const queue = getPendingCommands(deviceId).slice();
  commandQueues.set(deviceId, []);
  return queue;
}

function recentSeries(field, count = 8) {
  return state.history.slice(-count).map((item) => item[field]);
}

function recentSlope(field, count = 6) {
  const series = recentSeries(field, count);
  if (series.length < 2) {
    return 0;
  }

  return (series[series.length - 1] - series[0]) / (series.length - 1);
}

function deriveAlerts(snapshot) {
  const alerts = [];
  const online = Date.now() - snapshot.device.lastSeen < DEVICE_TIMEOUT_MS;

  if (!online) {
    alerts.push({
      level: "warn",
      title: "设备离线",
      message: "超过 30 秒没有收到新的 WiFi 数据上报。"
    });
  }

  if (snapshot.sensors.soilMoisture <= snapshot.config.soilMoistureLow) {
    alerts.push({
      level: "danger",
      title: "土壤湿度过低",
      message: `当前 ${snapshot.sensors.soilMoisture}% ，已低于下限 ${snapshot.config.soilMoistureLow}% 。`
    });
  } else if (snapshot.sensors.soilMoisture >= snapshot.config.soilMoistureHigh) {
    alerts.push({
      level: "warn",
      title: "土壤湿度偏高",
      message: `当前 ${snapshot.sensors.soilMoisture}% ，已高于上限 ${snapshot.config.soilMoistureHigh}% 。`
    });
  }

  if (snapshot.sensors.lightLux <= snapshot.config.lightLuxLow) {
    alerts.push({
      level: "warn",
      title: "光照不足",
      message: `当前 ${snapshot.sensors.lightLux} lux ，低于设定下限 ${snapshot.config.lightLuxLow} lux。`
    });
  }

  if (snapshot.sensors.airHumidity <= snapshot.config.airHumidityLow) {
    alerts.push({
      level: "warn",
      title: "空气湿度偏低",
      message: `当前 ${snapshot.sensors.airHumidity}% ，建议关注雾化或加湿控制。`
    });
  }

  if (snapshot.sensors.airTemperature >= snapshot.config.airTemperatureHigh) {
    alerts.push({
      level: "warn",
      title: "空气温度偏高",
      message: `当前 ${snapshot.sensors.airTemperature}°C ，建议提高风扇 PWM 或加强通风。`
    });
  }

  return alerts.slice(0, 5);
}

function deriveRecommendations(snapshot) {
  const soilSlope = recentSlope("soilMoisture");
  const soil = snapshot.sensors.soilMoisture;
  const light = snapshot.sensors.lightLux;
  const humidity = snapshot.sensors.airHumidity;
  const config = snapshot.config;

  let irrigation = {
    tone: "ok",
    title: "维持当前灌溉策略",
    detail: `当前土壤湿度 ${soil}% ，在设定区间 ${config.soilMoistureLow}% - ${config.soilMoistureHigh}% 内。`
  };

  if (soil <= config.soilMoistureLow - 5) {
    irrigation = {
      tone: "danger",
      title: "建议立即浇灌",
      detail: `土壤湿度明显低于下限，建议开启水泵 15 - 25 秒并继续观察回升情况。`
    };
  } else if (soil <= config.soilMoistureLow || (soil <= config.soilMoistureLow + 4 && soilSlope < -0.6)) {
    irrigation = {
      tone: "warn",
      title: "建议提前准备浇灌",
      detail: `土壤湿度正在下降，当前变化趋势约 ${soilSlope.toFixed(2)} %/采样周期。`
    };
  } else if (soil >= config.soilMoistureHigh) {
    irrigation = {
      tone: "warn",
      title: "建议暂停浇灌",
      detail: `湿度已超过上限，避免继续灌溉造成积水和根系缺氧。`
    };
  }

  let lighting = {
    tone: "ok",
    title: "当前补光可维持",
    detail: `当前光照 ${light} lux ，系统补光 PWM 为 ${snapshot.controls.growLightPwm}% 。`
  };

  if (light <= config.lightLuxLow) {
    const recommendedPwm = clamp(Math.max(snapshot.controls.growLightPwm, 70), 0, 100);
    lighting = {
      tone: "warn",
      title: `建议提升补光至 ${recommendedPwm}%`,
      detail: `当前光照低于下限，适合提高补光强度或延长补光时段。`
    };
  } else if (light >= config.lightLuxLow + 8000) {
    lighting = {
      tone: "ok",
      title: "当前无需额外补光",
      detail: `自然光已经足够，可维持或适度下调补光 PWM。`
    };
  }

  let risk = {
    tone: "ok",
    title: "整体风险较低",
    detail: "当前环境没有出现明显越界，适合继续保持自动模式。"
  };

  if (soil <= config.soilMoistureLow - 5) {
    risk = {
      tone: "danger",
      title: "干旱风险偏高",
      detail: "土壤湿度过低，优先处理浇灌，再观察温湿度联动。"
    };
  } else if (humidity <= config.airHumidityLow || snapshot.sensors.airTemperature >= config.airTemperatureHigh) {
    risk = {
      tone: "warn",
      title: "环境波动风险上升",
      detail: "建议关注雾化、通风和补光配合，避免温湿度继续偏离。"
    };
  }

  return { irrigation, lighting, risk };
}

function deriveReport(snapshot) {
  const windowedHistory = snapshot.history.slice(-12);
  const soilSeries = windowedHistory.map((item) => item.soilMoisture);
  const lightSeries = windowedHistory.map((item) => item.lightLux);
  const tempSeries = windowedHistory.map((item) => item.airTemperature);
  const soilDelta = soilSeries.length > 1 ? soilSeries[soilSeries.length - 1] - soilSeries[0] : 0;

  let soilTrend = "稳定";
  if (soilDelta >= 3) {
    soilTrend = "回升";
  } else if (soilDelta <= -3) {
    soilTrend = "下降";
  }

  return {
    avgSoilMoisture: Math.round(average(soilSeries)),
    avgLightLux: Math.round(average(lightSeries)),
    avgAirTemperature: Number(average(tempSeries).toFixed(1)),
    soilTrend
  };
}

function refreshDerivedState() {
  state.alerts = deriveAlerts(state);
  state.recommendations = deriveRecommendations(state);
  state.report = deriveReport(state);
}

function buildPublicState() {
  const online = Date.now() - state.device.lastSeen < DEVICE_TIMEOUT_MS;

  return {
    meta: {
      ...state.meta,
      serverTime: nowIso()
    },
    device: {
      ...state.device,
      lastSeen: new Date(state.device.lastSeen).toISOString(),
      online
    },
    sensors: state.sensors,
    controls: state.controls,
    config: state.config,
    history: state.history,
    alerts: state.alerts,
    recommendations: state.recommendations,
    report: state.report,
    activityLog: state.activityLog,
    pendingCommands: getPendingCommands(state.device.id).length
  };
}

function broadcastState() {
  refreshDerivedState();
  const payload = `data: ${JSON.stringify(buildPublicState())}\n\n`;

  for (const client of sseClients) {
    client.write(payload);
  }
}

function pushHistoryPoint() {
  state.history.push({
    timestamp: nowIso(),
    lightLux: state.sensors.lightLux,
    soilMoisture: state.sensors.soilMoisture,
    airTemperature: state.sensors.airTemperature,
    airHumidity: state.sensors.airHumidity
  });

  if (state.history.length > HISTORY_LIMIT) {
    state.history = state.history.slice(-HISTORY_LIMIT);
  }
}

function updateSwitchFromPwm(key, pwmKey) {
  state.controls[key] = state.controls[pwmKey] > 0 ? "on" : "off";
}

function updateFromSensorPayload(payload, req) {
  state.device = {
    ...state.device,
    id: typeof payload.deviceId === "string" ? payload.deviceId : state.device.id,
    name: typeof payload.deviceName === "string" ? payload.deviceName : state.device.name,
    firmware: typeof payload.firmware === "string" ? payload.firmware : state.device.firmware,
    ip: typeof payload.ip === "string" ? payload.ip : normalizeIp(req.socket.remoteAddress),
    rssi: Number.isFinite(payload.rssi) ? payload.rssi : state.device.rssi,
    lastSeen: Date.now()
  };

  const sensorFields = [
    "lightLux",
    "soilMoisture",
    "airTemperature",
    "airHumidity",
    "soilTemperature",
    "battery"
  ];

  for (const field of sensorFields) {
    if (Number.isFinite(payload[field])) {
      state.sensors[field] = payload[field];
    }
  }

  const switchFields = ["pump", "mist", "fan", "growLight", "mode"];
  for (const field of switchFields) {
    if (typeof payload[field] === "string") {
      state.controls[field] = payload[field];
    }
  }

  if (Number.isFinite(payload.fanPwm)) {
    state.controls.fanPwm = clamp(Math.round(payload.fanPwm), 0, 100);
    updateSwitchFromPwm("fan", "fanPwm");
  }

  if (Number.isFinite(payload.growLightPwm)) {
    state.controls.growLightPwm = clamp(Math.round(payload.growLightPwm), 0, 100);
    updateSwitchFromPwm("growLight", "growLightPwm");
  }

  pushHistoryPoint();
  addActivity(
    `${state.device.name} 上传新数据：光照 ${state.sensors.lightLux} lux，土壤湿度 ${state.sensors.soilMoisture}% ，空气湿度 ${state.sensors.airHumidity}%`,
    "data"
  );
  broadcastState();
}

function createDemoPayload() {
  const pumpEffect = state.controls.pump === "on" ? 4.6 : -1.2;
  const mistEffect = state.controls.mist === "on" ? 4.2 : -0.9;
  const fanCooling = state.controls.fanPwm / 100;
  const lightBoost = state.controls.growLightPwm * 55;

  const lightLux = clamp(
    Math.round(state.sensors.lightLux + (Math.random() - 0.5) * 2600 + lightBoost * 0.18),
    1200,
    50000
  );
  const soilMoisture = clamp(
    Math.round(state.sensors.soilMoisture + pumpEffect + (Math.random() - 0.55) * 3),
    10,
    95
  );
  const airTemperature = Number(
    clamp(state.sensors.airTemperature + (Math.random() - 0.45) * 1.1 - fanCooling * 0.9, 12, 40).toFixed(1)
  );
  const airHumidity = clamp(
    Math.round(state.sensors.airHumidity + mistEffect + (Math.random() - 0.5) * 3 - fanCooling * 2),
    20,
    95
  );
  const soilTemperature = Number(
    clamp(state.sensors.soilTemperature + (Math.random() - 0.5) * 0.8, 8, 35).toFixed(1)
  );
  const battery = clamp(Math.round(state.sensors.battery - Math.random() * 0.8), 20, 100);

  return {
    deviceId: state.device.id,
    deviceName: state.device.name,
    firmware: state.device.firmware,
    lightLux,
    soilMoisture,
    airTemperature,
    airHumidity,
    soilTemperature,
    battery,
    rssi: clamp(Math.round(-42 - Math.random() * 26), -85, -35),
    pump: state.controls.pump,
    mist: state.controls.mist,
    fan: state.controls.fan,
    fanPwm: state.controls.fanPwm,
    growLight: state.controls.growLight,
    growLightPwm: state.controls.growLightPwm,
    mode: state.controls.mode
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function serveStatic(res, fileName) {
  const filePath = path.join(PUBLIC_DIR, fileName);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "no-store"
  });
  res.end(content);
}

function validateControl(key, value) {
  const enumMap = {
    mode: ["auto", "manual"],
    pump: ["on", "off"],
    mist: ["on", "off"],
    fan: ["on", "off"],
    growLight: ["on", "off"]
  };

  if (Object.prototype.hasOwnProperty.call(enumMap, key)) {
    return enumMap[key].includes(value);
  }

  if (["fanPwm", "growLightPwm"].includes(key)) {
    return Number.isFinite(Number(value));
  }

  return false;
}

function applyControlChange(key, value) {
  if (key === "fanPwm") {
    state.controls.fanPwm = clamp(Math.round(Number(value)), 0, 100);
    updateSwitchFromPwm("fan", "fanPwm");
    return state.controls.fanPwm;
  }

  if (key === "growLightPwm") {
    state.controls.growLightPwm = clamp(Math.round(Number(value)), 0, 100);
    updateSwitchFromPwm("growLight", "growLightPwm");
    return state.controls.growLightPwm;
  }

  state.controls[key] = value;

  if (key === "fan") {
    state.controls.fanPwm = value === "on" && state.controls.fanPwm === 0 ? 60 : value === "off" ? 0 : state.controls.fanPwm;
  }

  if (key === "growLight") {
    state.controls.growLightPwm = value === "on" && state.controls.growLightPwm === 0 ? 65 : value === "off" ? 0 : state.controls.growLightPwm;
  }

  return value;
}

function sanitizeConfigPatch(payload) {
  const ranges = {
    soilMoistureLow: [0, 100],
    soilMoistureHigh: [0, 100],
    lightLuxLow: [0, 50000],
    airHumidityLow: [0, 100],
    airTemperatureHigh: [-20, 80],
    sampleIntervalSec: [1, 3600]
  };

  const patch = {};

  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (payload[key] === undefined) {
      continue;
    }

    if (!Number.isFinite(Number(payload[key]))) {
      throw new Error(`${key} 不是有效数字。`);
    }

    patch[key] = clamp(Number(payload[key]), min, max);
  }

  if (!Object.keys(patch).length) {
    throw new Error("没有可更新的配置项。");
  }

  const nextLow = patch.soilMoistureLow ?? state.config.soilMoistureLow;
  const nextHigh = patch.soilMoistureHigh ?? state.config.soilMoistureHigh;

  if (nextLow >= nextHigh) {
    throw new Error("土壤湿度下限必须小于上限。");
  }

  return patch;
}

function applyConfigPatch(patch) {
  state.config = {
    ...state.config,
    ...patch
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      serveStatic(res, "index.html");
      return;
    }

    if (req.method === "GET" && url.pathname === "/styles.css") {
      serveStatic(res, "styles.css");
      return;
    }

    if (req.method === "GET" && url.pathname === "/app.js") {
      serveStatic(res, "app.js");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, buildPublicState());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        time: nowIso(),
        deviceOnline: buildPublicState().device.online
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      res.write(`data: ${JSON.stringify(buildPublicState())}\n\n`);
      sseClients.add(res);

      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sensors") {
      const payload = await parseJsonBody(req);
      updateFromSensorPayload(payload, req);
      sendJson(res, 200, {
        ok: true,
        receivedAt: nowIso(),
        pendingCommands: getPendingCommands(state.device.id).length
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/control") {
      const payload = await parseJsonBody(req);
      const deviceId = typeof payload.deviceId === "string" ? payload.deviceId : state.device.id;
      const key = typeof payload.key === "string" ? payload.key : "";
      const value = payload.value;

      if (!validateControl(key, value)) {
        sendJson(res, 400, {
          ok: false,
          message: "控制参数不合法。"
        });
        return;
      }

      const appliedValue = applyControlChange(key, value);
      queueCommand(deviceId, key, appliedValue);
      addActivity(`网页下发控制：${key} -> ${appliedValue}`, "command");
      broadcastState();

      sendJson(res, 200, {
        ok: true,
        queued: {
          deviceId,
          key,
          value: appliedValue
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config") {
      const payload = await parseJsonBody(req);
      const deviceId = typeof payload.deviceId === "string" ? payload.deviceId : state.device.id;
      const patch = sanitizeConfigPatch(payload);
      applyConfigPatch(patch);
      for (const [key, value] of Object.entries(patch)) {
        queueCommand(deviceId, key, value, "dashboard-config");
      }
      addActivity(`网页更新参数配置：${Object.entries(patch).map(([key, value]) => `${key}=${value}`).join("，")}`, "config");
      broadcastState();

      sendJson(res, 200, {
        ok: true,
        config: state.config
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/device/commands") {
      const deviceId = url.searchParams.get("deviceId") || state.device.id;
      const commands = popCommands(deviceId);
      addActivity(`设备 ${deviceId} 拉取了 ${commands.length} 条命令。`, "info");
      broadcastState();
      sendJson(res, 200, { ok: true, commands });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/device/commands.txt") {
      const deviceId = url.searchParams.get("deviceId") || state.device.id;
      const commands = popCommands(deviceId);
      const text = commands.map((item) => `${item.key}=${item.value}`).join("\n");
      addActivity(`设备 ${deviceId} 拉取了 ${commands.length} 条文本命令。`, "info");
      broadcastState();
      sendText(res, 200, text);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/demo/push") {
      updateFromSensorPayload(createDemoPayload(), req);
      sendJson(res, 200, {
        ok: true,
        message: "已生成一条演示数据。"
      });
      return;
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: error.message || "服务器内部错误。"
    });
  }
});

addActivity("服务器已启动，等待 ESP32-WROOM-E 农业节点通过 WiFi 接入。", "info");
refreshDerivedState();

setInterval(() => {
  broadcastState();
}, 5_000);

server.listen(PORT, HOST, () => {
  const urls = state.meta.networkUrls.length ? state.meta.networkUrls : [`http://localhost:${PORT}`];

  console.log("智能农业网页控制台已启动");
  for (const url of urls) {
    console.log(`访问地址: ${url}`);
  }
  console.log(`设备上传接口: http://<电脑IP>:${PORT}/api/sensors`);
  console.log(`设备拉取命令: http://<电脑IP>:${PORT}/api/device/commands.txt?deviceId=${state.device.id}`);
});
