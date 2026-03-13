# 智慧农业监控台

这是一个可以直接放在电脑上运行的本地网站，适合做农业种植相关的 WiFi 数据监控。
设备端通过同一个局域网把传感器数据上传到电脑，网页端实时显示：

- 光照强度
- 土壤水分
- 空气温度
- 空气湿度
- 土壤温度
- 设备电量和 WiFi 信号

同时网页也能把控制命令发回设备，比如：

- 开启或关闭水泵
- 开启或关闭补光灯
- 开启或关闭风扇
- 切换自动 / 手动模式
- 下发目标土壤水分

## 1. 项目结构

- `server.js`: 本地 Node.js 服务器，负责网页、接口、实时推送
- `public/index.html`: 农业监控网页
- `public/styles.css`: 页面样式
- `public/app.js`: 前端逻辑
- `examples/esp32_smart_farm_demo.ino`: ESP32 接入示例

## 2. 启动方式

在 `C:\Users\29575\Desktop\smart-farm-dashboard` 目录运行：

```powershell
node server.js
```

也可以运行：

```powershell
npm.cmd start
```

启动后浏览器访问：

- `http://localhost:3000`
- 或者 `http://你的电脑局域网IP:3000`

只要手机、ESP32、电脑连的是同一个 WiFi，就能访问这个网页和接口。

## 3. 设备接入方式

设备上传数据接口：

```text
POST /api/sensors
Content-Type: application/json
```

示例 JSON：

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

设备拉取待执行命令：

```text
GET /api/device/commands.txt?deviceId=esp32-farm-01
```

返回示例：

```text
pump=on
growLight=off
targetSoilMoisture=65
```

设备每次拉取后，服务器会把这批命令从队列里清掉。

## 4. 网页调试

如果你现在还没有接硬件，网页里有一个“生成演示数据”按钮，可以模拟上传农业传感器数据，方便先看页面效果。

## 5. 实现原理

这套方案采用的是“HTTP 上报 + HTTP 拉取命令 + SSE 实时刷新网页”：

1. ESP32 连接 WiFi。
2. ESP32 定时把光照、土壤水分等数据发给电脑上的服务器。
3. 服务器把新数据实时推送给网页。
4. 网页点击按钮后，服务器把命令放进设备命令队列。
5. ESP32 定时拉取命令并执行。

这个方案的优点是：

- 不依赖第三方库，电脑直接能跑
- 很适合局域网实验和课程项目
- 后续你可以很容易升级成 MQTT 或 WebSocket 方案

## 6. ESP32 使用说明

示例程序在：

- `C:\Users\29575\Desktop\smart-farm-dashboard\examples\esp32_smart_farm_demo.ino`

你需要修改的地方：

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `SERVER_HOST`
- 传感器引脚定义
- 土壤湿度映射校准参数

本项目配套 ESP32-WROOM-E 模块。如果你的模块是 ESP8266 或其他型号，接口也可以继续用，改设备端程序就行。
