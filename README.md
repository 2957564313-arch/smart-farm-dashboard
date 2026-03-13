# Smart Farm Dashboard

> 零依赖、开箱即用的局域网智慧农业监控台 — 适用于 ESP32 + Node.js 课程项目与快速原型验证。

[![Version](https://img.shields.io/badge/version-v0.1.0-blue)]()
[![Node](https://img.shields.io/badge/node-%3E%3D14-green)]()
[![License](https://img.shields.io/badge/license-MIT-brightgreen)]()

---

## 功能一览

| 实时采集 | 远程控制 |
|---------|---------|
| 光照强度 | 水泵开关 |
| 土壤水分 | 补光灯开关 |
| 空气温度 | 风扇开关 |
| 空气湿度 | 自动 / 手动模式切换 |
| 土壤温度 | 下发目标土壤水分 |
| 设备电量 & WiFi 信号 | |

## 目录结构

```text
smart-farm-dashboard/
├── server.js                            # Node.js 服务器（HTTP API + SSE 推送）
├── package.json                         # 项目元信息 & 启动脚本
├── public/
│   ├── index.html                       # 监控台页面
│   ├── styles.css                       # 页面样式
│   └── app.js                           # 前端逻辑
└── examples/
    └── esp32_smart_farm_demo.ino        # ESP32 接入示例
```

## 快速开始

```bash
# 1. 进入项目目录
cd smart-farm-dashboard

# 2. 启动服务器（无需 npm install）
node server.js

# 3. 打开浏览器
#    本机访问    → http://localhost:3000
#    局域网访问  → http://<你的电脑IP>:3000
```

只要手机、ESP32、电脑连的是同一个 WiFi，就能访问网页和接口。

## 设备接入

### 上报传感器数据

```text
POST /api/sensors
Content-Type: application/json
```

```json
{
  "deviceId": "esp32-farm-01",
  "deviceName": "田间节点 01",
  "lightLux": 18200,
  "soilMoisture": 57,
  "airTemperature": 24.6,
  "airHumidity": 61,
  "soilTemperature": 22.4,
  "battery": 88,
  "rssi": -53,
  "pump": "off",
  "growLight": "on",
  "fan": "off",
  "mode": "auto",
  "targetSoilMoisture": 62
}
```

### 拉取待执行命令

```text
GET /api/device/commands.txt?deviceId=esp32-farm-01
```

返回示例：

```text
pump=on
growLight=off
targetSoilMoisture=65
```

每次拉取后，服务器会把这批命令从队列里清掉。

## 实现原理

```
ESP32                        Server (Node.js)                   Browser
  │  POST /api/sensors ──────▶│                                    │
  │                            │── SSE push ──────────────────────▶│
  │                            │◀── POST /api/device/command ──────│
  │  GET  /commands.txt ──────▶│                                    │
```

1. ESP32 连接 WiFi，定时上报光照、土壤水分等数据。
2. 服务器通过 **SSE** 实时推送给网页。
3. 网页点击按钮 → 服务器将命令放入设备队列。
4. ESP32 定时拉取命令并执行。

**优点**：零第三方依赖、局域网即跑、后续可平滑升级为 MQTT / WebSocket。

## ESP32 使用说明

示例程序：`examples/esp32_smart_farm_demo.ino`

需要修改的配置：

- `WIFI_SSID` / `WIFI_PASSWORD` — WiFi 名称和密码
- `SERVER_HOST` — 运行 server.js 的电脑局域网 IP
- 传感器引脚定义 & 土壤湿度映射校准参数

本项目配套 **ESP32-WROOM-E**；ESP8266 等其他模块同样可用，改设备端代码即可。

## 调试

网页内置 **"生成演示数据"** 按钮，无需硬件即可预览完整界面效果。

---

**v0.1.0** · 初始发布
