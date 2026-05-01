const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { randomUUID } = require("node:crypto");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEVICE_TIMEOUT_MS = 30_000;
const HISTORY_LIMIT = 36;
const TCP_DEFAULT_HOST = process.env.TCP_HOST || "192.168.4.1";
const TCP_DEFAULT_PORT = Number(process.env.TCP_PORT || 8080);
const TCP_CONNECT_TIMEOUT_MS = 3500;

const legacyCommandMap = {
  mode: {
    manual: "Manual",
    auto: "Auto"
  },
  growLight: {
    on: "led_on",
    off: "led_off"
  },
  pump: {
    on: "pump_on",
    off: "pump_off"
  },
  fan: {
    on: "fan_on",
    off: "fan_off"
  },
  mist: {
    on: "humidifier_on",
    off: "humidifier_off"
  },
  buzzer: {
    on: "buzzer_on",
    off: "buzzer_off"
  }
};

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

function numericValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return undefined;
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function normalizeSwitchValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["on", "1", "true", "open"].includes(normalized)) {
    return "on";
  }
  if (["off", "0", "false", "close"].includes(normalized)) {
    return "off";
  }

  return undefined;
}

function normalizeMode(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["manual", "hand", "手动"].includes(normalized)) {
    return "manual";
  }
  if (["auto", "automatic", "自动"].includes(normalized)) {
    return "auto";
  }

  return undefined;
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
  const baseLight = 42;
  const baseSoil = 57;
  const baseTemp = 24.6;
  const baseHumidity = 62;
  const baseMq2 = 280;
  const result = [];
  const start = Date.now() - 11 * 60_000;

  for (let i = 0; i < 12; i += 1) {
    const lightValue = clamp(Math.round(baseLight + Math.sin(i / 2) * 12 + (i % 3) * 2), 0, 99);
    result.push({
      timestamp: new Date(start + i * 60_000).toISOString(),
      lightValue,
      lightLux: lightValue,
      soilMoisture: clamp(Math.round(baseSoil - i * 0.8 + (i % 2) * 2), 0, 100),
      airTemperature: Number((baseTemp + Math.sin(i / 3) * 0.9).toFixed(1)),
      airHumidity: clamp(Math.round(baseHumidity + Math.cos(i / 3) * 5), 0, 100),
      mq2: Math.round(baseMq2 + Math.sin(i / 2) * 45)
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
    id: "stm32-farm-01",
    name: "STM32 智慧农业节点",
    firmware: "STM32/ESP8266 节点",
    ip: "demo",
    rssi: null,
    lastSeen: Date.now()
  },
  sensors: {
    lightValue: 42,
    lightLux: 42,
    soilMoisture: 57,
    airTemperature: 24.8,
    airHumidity: 63,
    mq2: 280,
    soilTemperature: null,
    battery: null,
    powerStatus: "外接电源"
  },
  controls: {
    mode: "auto",
    pump: "off",
    mist: "off",
    fan: "off",
    growLight: "on",
    buzzer: "off",
    fanPwm: 0,
    growLightPwm: 100
  },
  config: {
    soilMoistureLow: 10,
    soilMoistureHigh: 75,
    lightLow: 15,
    lightLuxLow: 15,
    airHumidityLow: 20,
    airTemperatureHigh: 35,
    mq2High: 800,
    sampleIntervalSec: 5
  },
  history: buildSeedHistory(),
  alerts: [],
  recommendations: {},
  report: {},
  activityLog: [],
  tcp: {
    host: TCP_DEFAULT_HOST,
    port: TCP_DEFAULT_PORT,
    connected: false,
    connecting: false,
    lastReceivedAt: null,
    lastRawData: "",
    lastError: "",
    lastSentCommand: "",
    lastSentAt: null
  }
};

const sseClients = new Set();
const commandQueues = new Map();
let tcpClient = null;
let tcpReceiveBuffer = "";

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
  const lightLow = snapshot.config.lightLow ?? snapshot.config.lightLuxLow;

  if (!online) {
    alerts.push({
      level: "warn",
      title: "设备离线",
      message: "超过 30 秒没有收到新的 WiFi 数据上报。"
    });
  }

  if (!snapshot.tcp.connected) {
    alerts.push({
      level: "warn",
      title: "硬件 TCP 未连接",
      message: `当前未连接旧硬件 TCP 网关 ${snapshot.tcp.host}:${snapshot.tcp.port}。`
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

  if (snapshot.sensors.lightValue <= lightLow) {
    alerts.push({
      level: "warn",
      title: "光照不足",
      message: `当前光照值 ${snapshot.sensors.lightValue} ，低于设定下限 ${lightLow}。`
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
      message: `当前 ${snapshot.sensors.airTemperature}°C ，建议开启风扇或加强通风。`
    });
  }

  if (Number.isFinite(snapshot.sensors.mq2) && snapshot.sensors.mq2 >= snapshot.config.mq2High) {
    alerts.push({
      level: "danger",
      title: "烟雾浓度过高",
      message: `当前 MQ2 ${snapshot.sensors.mq2} ppm ，已超过上限 ${snapshot.config.mq2High} ppm。`
    });
  }

  return alerts.slice(0, 5);
}

function deriveRecommendations(snapshot) {
  const soilSlope = recentSlope("soilMoisture");
  const soil = snapshot.sensors.soilMoisture;
  const light = snapshot.sensors.lightValue;
  const humidity = snapshot.sensors.airHumidity;
  const config = snapshot.config;
  const lightLow = config.lightLow ?? config.lightLuxLow;

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
    detail: `当前光照值 ${light}，补光灯状态为${snapshot.controls.growLight === "on" ? "开启" : "关闭"}。`
  };

  if (light <= lightLow) {
    lighting = {
      tone: "warn",
      title: "建议开启补光",
      detail: "当前光照低于下限，适合开启补光灯或延长补光时段。"
    };
  } else if (light >= lightLow + 25) {
    lighting = {
      tone: "ok",
      title: "当前无需额外补光",
      detail: "自然光或环境光照值已经足够，可维持当前补光策略。"
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
  } else if (Number.isFinite(snapshot.sensors.mq2) && snapshot.sensors.mq2 >= config.mq2High) {
    risk = {
      tone: "danger",
      title: "烟雾风险偏高",
      detail: "MQ2 数值超过阈值，建议检查现场环境并保持通风。"
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
  const lightSeries = windowedHistory.map((item) => item.lightValue ?? item.lightLux);
  const tempSeries = windowedHistory.map((item) => item.airTemperature);
  const humiditySeries = windowedHistory.map((item) => item.airHumidity);
  const mq2Series = windowedHistory.map((item) => item.mq2).filter(Number.isFinite);
  const soilDelta = soilSeries.length > 1 ? soilSeries[soilSeries.length - 1] - soilSeries[0] : 0;

  let soilTrend = "稳定";
  if (soilDelta >= 3) {
    soilTrend = "回升";
  } else if (soilDelta <= -3) {
    soilTrend = "下降";
  }

  return {
    avgSoilMoisture: Math.round(average(soilSeries)),
    avgLightValue: Math.round(average(lightSeries)),
    avgLightLux: Math.round(average(lightSeries)),
    avgAirTemperature: Number(average(tempSeries).toFixed(1)),
    avgAirHumidity: Math.round(average(humiditySeries)),
    avgMq2: mq2Series.length ? Math.round(average(mq2Series)) : null,
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
    tcp: state.tcp,
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
    lightValue: state.sensors.lightValue,
    lightLux: state.sensors.lightLux,
    soilMoisture: state.sensors.soilMoisture,
    airTemperature: state.sensors.airTemperature,
    airHumidity: state.sensors.airHumidity,
    mq2: state.sensors.mq2
  });

  if (state.history.length > HISTORY_LIMIT) {
    state.history = state.history.slice(-HISTORY_LIMIT);
  }
}

function updateSwitchFromPwm(key, pwmKey) {
  state.controls[key] = state.controls[pwmKey] > 0 ? "on" : "off";
}

function updateFromSensorPayload(payload, req) {
  const lightValue = numericValue(payload.lightValue, payload.light, payload.lightLux, payload.lux);

  state.device = {
    ...state.device,
    id: typeof payload.deviceId === "string" ? payload.deviceId : state.device.id,
    name: typeof payload.deviceName === "string" ? payload.deviceName : state.device.name,
    firmware: typeof payload.firmware === "string" ? payload.firmware : state.device.firmware,
    ip: typeof payload.ip === "string" ? payload.ip : normalizeIp(req.socket.remoteAddress),
    rssi: Number.isFinite(Number(payload.rssi)) ? Number(payload.rssi) : state.device.rssi,
    lastSeen: Date.now()
  };

  const normalizedSensors = {
    soilMoisture: numericValue(payload.soilMoisture, payload.soil, payload.soilHumidity, payload.moisture),
    airTemperature: numericValue(payload.airTemperature, payload.temp, payload.temperature),
    airHumidity: numericValue(payload.airHumidity, payload.humi, payload.humidity),
    lightValue,
    lightLux: lightValue,
    mq2: numericValue(payload.mq2, payload.smoke, payload.gas),
    soilTemperature: numericValue(payload.soilTemperature, payload.soilTemp),
    battery: numericValue(payload.battery, payload.power)
  };

  for (const [field, value] of Object.entries(normalizedSensors)) {
    if (Number.isFinite(value)) {
      state.sensors[field] = value;
    }
  }

  const powerStatus = stringValue(payload.powerStatus, payload.powerSupply);
  if (powerStatus) {
    state.sensors.powerStatus = powerStatus;
  }

  const switchFields = ["pump", "mist", "fan", "growLight", "buzzer"];
  for (const field of switchFields) {
    const value = normalizeSwitchValue(payload[field]);
    if (value) {
      state.controls[field] = value;
    }
  }

  const mode = normalizeMode(payload.mode);
  if (mode) {
    state.controls.mode = mode;
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
    `${state.device.name} 上传新数据：光照值 ${state.sensors.lightValue}，土壤湿度 ${state.sensors.soilMoisture}% ，空气湿度 ${state.sensors.airHumidity}%`,
    "data"
  );
  broadcastState();
}

function createDemoPayload() {
  const pumpEffect = state.controls.pump === "on" ? 4.6 : -1.2;
  const mistEffect = state.controls.mist === "on" ? 4.2 : -0.9;
  const fanCooling = state.controls.fanPwm / 100;
  const lightBoost = state.controls.growLight === "on" ? 8 : -4;

  const lightValue = clamp(
    Math.round(state.sensors.lightValue + (Math.random() - 0.5) * 10 + lightBoost),
    0,
    99
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
  const mq2 = clamp(Math.round(state.sensors.mq2 + (Math.random() - 0.5) * 80), 20, 2000);

  return {
    deviceId: state.device.id,
    deviceName: state.device.name,
    firmware: state.device.firmware,
    lightValue,
    lightLux: lightValue,
    soilMoisture,
    airTemperature,
    airHumidity,
    mq2,
    powerStatus: "外接电源",
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
    growLight: ["on", "off"],
    buzzer: ["on", "off"]
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
    lightLow: [0, 9999],
    airHumidityLow: [0, 100],
    airTemperatureHigh: [-20, 80],
    mq2High: [0, 9999],
    sampleIntervalSec: [1, 3600]
  };

  const aliases = {
    temp_max: "airTemperatureHigh",
    humi_min: "airHumidityLow",
    light_min: "lightLow",
    soil_min: "soilMoistureLow",
    smoke_max: "mq2High",
    lightLuxLow: "lightLow"
  };

  const patch = {};

  for (const [key, [min, max]] of Object.entries(ranges)) {
    const aliasEntry = Object.entries(aliases).find(([, target]) => target === key);
    const aliasKey = aliasEntry ? aliasEntry[0] : null;
    const rawValue = payload[key] ?? (aliasKey ? payload[aliasKey] : undefined);

    if (rawValue === undefined) {
      continue;
    }

    if (!Number.isFinite(Number(rawValue))) {
      throw new Error(`${key} 不是有效数字。`);
    }

    patch[key] = clamp(Number(rawValue), min, max);
  }

  for (const [aliasKey, targetKey] of Object.entries(aliases)) {
    if (patch[targetKey] !== undefined || payload[aliasKey] === undefined) {
      continue;
    }

    const [min, max] = ranges[targetKey];
    if (!Number.isFinite(Number(payload[aliasKey]))) {
      throw new Error(`${aliasKey} 不是有效数字。`);
    }
    patch[targetKey] = clamp(Number(payload[aliasKey]), min, max);
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
    ...patch,
    lightLuxLow: patch.lightLow ?? state.config.lightLow
  };
}

function parseLegacyHardwareText(rawText) {
  const text = String(rawText || "");
  const fields = {};
  const regex = /([A-Za-z0-9_]+):([^#,\r\n]+)#?/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    fields[match[1]] = match[2];
  }

  return {
    sensors: {
      airTemperature: numericValue(fields.temp),
      airHumidity: numericValue(fields.humi),
      lightValue: numericValue(fields.light),
      lightLux: numericValue(fields.light),
      soilMoisture: numericValue(fields.soil),
      mq2: numericValue(fields.smoke)
    },
    controls: {
      mode: text.includes("swit1_on") ? "manual" : text.includes("swit1_off") ? "auto" : undefined,
      growLight: text.includes("swit2_on") ? "on" : text.includes("swit2_off") ? "off" : undefined,
      pump: text.includes("swit3_on") ? "on" : text.includes("swit3_off") ? "off" : undefined,
      fan: text.includes("swit4_on") ? "on" : text.includes("swit4_off") ? "off" : undefined,
      mist: text.includes("swit5_on") ? "on" : text.includes("swit5_off") ? "off" : undefined
    },
    warnings: {
      temp: text.includes("temp_warn"),
      humi: text.includes("humi_warn"),
      light: text.includes("light_warn"),
      soil: text.includes("soil_warn"),
      smoke: text.includes("smoke_warn")
    }
  };
}

function updateFromLegacyTcp(rawText) {
  const parsed = parseLegacyHardwareText(rawText);
  let hasSensorData = false;

  for (const [field, value] of Object.entries(parsed.sensors)) {
    if (Number.isFinite(value)) {
      state.sensors[field] = value;
      hasSensorData = true;
    }
  }

  for (const [field, value] of Object.entries(parsed.controls)) {
    if (value) {
      state.controls[field] = value;
    }
  }

  state.device = {
    ...state.device,
    id: "stm32-farm-01",
    name: "STM32 智慧农业节点",
    firmware: "STM32/ESP8266 节点",
    ip: `${state.tcp.host}:${state.tcp.port}`,
    lastSeen: Date.now()
  };
  state.tcp.lastReceivedAt = nowIso();
  state.tcp.lastRawData = String(rawText || "").trim();
  state.tcp.lastError = "";

  if (hasSensorData) {
    pushHistoryPoint();
  }

  addActivity(`TCP 网关收到旧硬件数据：${state.tcp.lastRawData || "--"}`, "data");
  broadcastState();
}

function hasCompleteLegacySensorFrame(text) {
  return ["temp:", "humi:", "light:", "soil:", "smoke:"].every((token) => text.includes(token))
    && (text.match(/#/g) || []).length >= 5;
}

function handleTcpChunk(chunkText) {
  tcpReceiveBuffer += String(chunkText || "");

  if (tcpReceiveBuffer.length > 4096) {
    tcpReceiveBuffer = tcpReceiveBuffer.slice(-4096);
  }

  if (/[\r\n]/.test(tcpReceiveBuffer)) {
    const parts = tcpReceiveBuffer.split(/\r?\n|\r/);
    tcpReceiveBuffer = parts.pop() || "";

    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed) {
        updateFromLegacyTcp(trimmed);
      }
    }
    return;
  }

  if (hasCompleteLegacySensorFrame(tcpReceiveBuffer)) {
    const frame = tcpReceiveBuffer.trim();
    tcpReceiveBuffer = "";
    updateFromLegacyTcp(frame);
  }
}

function getLegacyCommand(key, value) {
  return legacyCommandMap[key]?.[value];
}

function writeTcpCommand(rawCommand) {
  if (!tcpClient || !state.tcp.connected) {
    return false;
  }

  const command = String(rawCommand || "").trim();
  if (!command) {
    return false;
  }

  tcpClient.write(`${command}\r\n`);
  state.tcp.lastSentCommand = command;
  state.tcp.lastSentAt = nowIso();
  addActivity(`TCP 网关发送命令：${command}`, "command");
  return true;
}

function sendLegacyControlIfConnected(key, value) {
  const command = getLegacyCommand(key, value);
  if (!command || !state.tcp.connected) {
    return false;
  }

  return writeTcpCommand(command);
}

function applyAndQueueControl(deviceId, key, value) {
  const appliedValue = applyControlChange(key, value);
  queueCommand(deviceId, key, appliedValue);
  const legacySent = sendLegacyControlIfConnected(key, appliedValue);
  addActivity(`网页下发控制：${key} -> ${appliedValue}`, "command");

  return {
    deviceId,
    key,
    value: appliedValue,
    legacySent
  };
}

function collectControlChanges(payload) {
  if (typeof payload.key === "string") {
    return [
      {
        key: payload.key,
        value: payload.value,
        strict: true
      }
    ];
  }

  const changes = [];
  const controlKeys = ["mode", "pump", "mist", "fan", "growLight", "buzzer", "fanPwm", "growLightPwm"];

  for (const key of controlKeys) {
    if (payload[key] !== undefined) {
      changes.push({
        key,
        value: payload[key],
        strict: false
      });
    }
  }

  return changes;
}

function buildLegacyConfigCommand(patch = state.config) {
  const nextConfig = {
    ...state.config,
    ...patch
  };

  return [
    `temp_max:${Math.round(nextConfig.airTemperatureHigh)}`,
    `humi_min:${Math.round(nextConfig.airHumidityLow)}`,
    `light_min:${Math.round(nextConfig.lightLow ?? nextConfig.lightLuxLow)}`,
    `soil_min:${Math.round(nextConfig.soilMoistureLow)}`,
    `smoke_max:${Math.round(nextConfig.mq2High)}`
  ].join(",");
}

function disconnectTcp(reason = "manual") {
  const hadConnection = Boolean(tcpClient) || state.tcp.connected || state.tcp.connecting;

  if (tcpClient) {
    tcpClient.removeAllListeners();
    tcpClient.destroy();
    tcpClient = null;
  }

  state.tcp.connected = false;
  state.tcp.connecting = false;
  if (reason !== "manual") {
    state.tcp.lastError = reason;
  }
  if (hadConnection) {
    addActivity(`TCP 网关已断开：${reason}`, reason === "manual" ? "info" : "warn");
    broadcastState();
  }
}

function connectTcp() {
  if (state.tcp.connected) {
    return Promise.resolve({ alreadyConnected: true });
  }

  if (state.tcp.connecting) {
    return Promise.resolve({ connecting: true });
  }

  disconnectTcp("reconnect");
  state.tcp.connecting = true;
  state.tcp.lastError = "";
  broadcastState();

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({
      host: state.tcp.host,
      port: state.tcp.port
    });
    tcpClient = socket;

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      const message = error?.message || "TCP 连接失败";
      disconnectTcp(message);
      reject(new Error(message));
    };

    socket.setTimeout(TCP_CONNECT_TIMEOUT_MS);

    socket.on("connect", () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.setTimeout(0);
      state.tcp.connected = true;
      state.tcp.connecting = false;
      state.tcp.lastError = "";
      addActivity(`TCP 网关已连接 ${state.tcp.host}:${state.tcp.port}`, "info");
      broadcastState();
      resolve({ connected: true });
    });

    socket.on("data", (chunk) => {
      handleTcpChunk(chunk.toString("utf8"));
    });

    socket.on("timeout", () => {
      fail(new Error(`连接 ${state.tcp.host}:${state.tcp.port} 超时`));
    });

    socket.on("error", (error) => {
      if (!settled) {
        fail(error);
        return;
      }
      state.tcp.lastError = error.message;
      addActivity(`TCP 网关错误：${error.message}`, "warn");
      broadcastState();
    });

    socket.on("close", () => {
      if (tcpClient === socket) {
        tcpClient = null;
      }
      const wasConnected = state.tcp.connected || state.tcp.connecting;
      state.tcp.connected = false;
      state.tcp.connecting = false;
      if (wasConnected) {
        addActivity("TCP 网关连接已关闭。", "warn");
        broadcastState();
      }
    });
  });
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
      const changes = collectControlChanges(payload);
      const applied = [];
      const rejected = [];

      if (!changes.length) {
        sendJson(res, 400, {
          ok: false,
          message: "没有可识别的控制字段。"
        });
        return;
      }

      for (const item of changes) {
        if (!validateControl(item.key, item.value)) {
          rejected.push({
            key: item.key,
            value: item.value
          });
          continue;
        }

        applied.push(applyAndQueueControl(deviceId, item.key, item.value));
      }

      if (!applied.length) {
        sendJson(res, 400, {
          ok: false,
          message: "控制参数不合法。",
          rejected
        });
        return;
      }

      broadcastState();

      if (typeof payload.key === "string") {
        const item = applied[0];
        sendJson(res, 200, {
          ok: true,
          legacySent: item.legacySent,
          queued: {
            deviceId: item.deviceId,
            key: item.key,
            value: item.value
          },
          rejected
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        legacySent: applied.some((item) => item.legacySent),
        queued: applied,
        rejected
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
      const legacyConfigCommand = buildLegacyConfigCommand(patch);
      const legacySent = state.tcp.connected ? writeTcpCommand(legacyConfigCommand) : false;
      addActivity(`网页更新参数配置：${Object.entries(patch).map(([key, value]) => `${key}=${value}`).join("，")}`, "config");
      broadcastState();

      sendJson(res, 200, {
        ok: true,
        legacySent,
        legacyConfigCommand,
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

    if (req.method === "GET" && url.pathname === "/api/tcp/status") {
      sendJson(res, 200, {
        ok: true,
        tcp: state.tcp
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tcp/connect") {
      try {
        const result = await connectTcp();
        sendJson(res, 200, {
          ok: true,
          result,
          tcp: state.tcp
        });
      } catch (error) {
        sendJson(res, 502, {
          ok: false,
          message: error.message,
          tcp: state.tcp
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tcp/disconnect") {
      disconnectTcp("manual");
      sendJson(res, 200, {
        ok: true,
        tcp: state.tcp
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tcp/send") {
      const payload = await parseJsonBody(req);
      const command = stringValue(payload.command, payload.raw, payload.text);

      if (!command) {
        sendJson(res, 400, {
          ok: false,
          message: "缺少 command。"
        });
        return;
      }

      if (!state.tcp.connected) {
        sendJson(res, 409, {
          ok: false,
          message: "TCP 未连接，无法发送命令。",
          tcp: state.tcp
        });
        return;
      }

      writeTcpCommand(command);
      broadcastState();
      sendJson(res, 200, {
        ok: true,
        sent: command,
        tcp: state.tcp
      });
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

addActivity("服务器已启动，可通过 TCP 兼容模式连接 STM32/ESP8266 旧硬件。", "info");
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
  console.log(`旧硬件 TCP 网关: ${state.tcp.host}:${state.tcp.port}`);
});
