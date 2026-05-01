# 智慧农业监测与控制平台

这是一个面向 STM32 + ESP8266 智慧农业节点的网页监测与控制平台。项目保留原生 Node.js + HTML/CSS/JavaScript 架构，不依赖数据库，不改动旧硬件工程即可先完成网页化接入。

当前重点是适配已有旧 App 与 STM32/ESP8266 TCP 文本协议。

## 功能概览

- 实时显示空气温度、空气湿度、土壤湿度、光照值、MQ2 烟雾浓度
- 显示设备状态、最近上报时间、TCP 连接状态、供电状态和运行日志
- 控制自动/手动模式、水泵、风扇、加湿/雾化、补光灯、蜂鸣器
- 配置温度上限、湿度下限、光照下限、土壤湿度下限、烟雾浓度上限、采样间隔
- 根据阈值生成告警、灌溉建议、补光建议和风险提示
- 展示土壤湿度、空气温度、空气湿度、光照值历史曲线
- 通过 Node.js TCP 网关兼容旧硬件 `192.168.4.1:8080`
- 保留 HTTP API，方便后续扩展为设备主动上传

## 快速启动

```bash
npm start
```

浏览器打开：

```text
http://localhost:3000
```

## 项目结构

```text
smart-farm-dashboard/
├── server.js                              # HTTP API、SSE、旧硬件 TCP 网关
├── package.json                           # npm start 启动脚本
├── README.md                              # 项目说明
├── HARDWARE_PROTOCOL.md                   # 硬件协议说明
├── public/
│   ├── index.html                         # 页面结构
│   ├── app.js                             # 前端交互
│   └── styles.css                         # 页面样式
└── examples/
    └── stm32_esp8266_tcp_gateway.md       # 当前 STM32/ESP8266 TCP 接入示例
```

## 当前主接入方式：旧硬件 TCP 网关

旧硬件保持原协议：

```text
192.168.4.1:8080
```

网页不能直接连接原始 TCP，因此 `server.js` 使用 Node.js `net` 模块作为网关。

相关接口：

```text
GET  /api/tcp/status
POST /api/tcp/connect
POST /api/tcp/disconnect
POST /api/tcp/send
```

旧硬件上报：

```text
temp:26#,humi:60#,light:15#,soil:50#,smoke:300#
```

字段映射：

| 旧字段 | 网页字段 | 含义 |
|---|---|---|
| `temp` | `airTemperature` | 空气温度 |
| `humi` | `airHumidity` | 空气湿度 |
| `soil` | `soilMoisture` | 土壤湿度 |
| `light` | `lightValue` | 光照值 |
| `smoke` | `mq2` | MQ2 烟雾浓度 |

网页下发命令：

| 网页控制 | 旧硬件命令 |
|---|---|
| `mode=manual` | `Manual` |
| `mode=auto` | `Auto` |
| `growLight=on/off` | `led_on` / `led_off` |
| `pump=on/off` | `pump_on` / `pump_off` |
| `fan=on/off` | `fan_on` / `fan_off` |
| `mist=on/off` | `humidifier_on` / `humidifier_off` |

保存配置时会发送旧 App 风格字符串：

```text
temp_max:32,humi_min:45,light_min:15,soil_min:35,smoke_max:700
```

## 保留的 HTTP 接口

后续如果把 STM32/ESP8266 改成主动 HTTP 上传，可以直接使用：

```http
POST /api/sensors
Content-Type: application/json
```

推荐 JSON：

```json
{
  "deviceId": "stm32-farm-01",
  "deviceName": "STM32 智慧农业节点",
  "firmware": "STM32/ESP8266 节点",
  "soilMoisture": 55,
  "airTemperature": 26.5,
  "airHumidity": 60,
  "lightValue": 35,
  "mq2": 300
}
```

也兼容旧字段：

```json
{
  "temp": 27,
  "humi": 60,
  "soil": 38,
  "light": 850,
  "smoke": 300
}
```

拉取命令：

```http
GET /api/device/commands.txt?deviceId=stm32-farm-01
```

返回示例：

```text
pump=on
fan=off
mist=on
growLight=off
mode=auto
soilMoistureLow=35
airTemperatureHigh=32
airHumidityLow=45
lightLow=15
mq2High=700
```

## 真硬件联调

1. 电脑连接旧硬件 ESP8266 热点。
2. 运行 `npm start`。
3. 打开 `http://localhost:3000`。
4. 在页面“硬件连接 / TCP 兼容模式”区域点击“连接硬件”。
5. 观察“最近原始数据”是否出现 `temp:...#,humi:...#`。
6. 点击水泵、风扇、补光灯、加湿、自动/手动按钮，确认继电器动作。
7. 保存阈值配置，确认硬件收到 `temp_max`、`humi_min`、`light_min`、`soil_min`、`smoke_max`。

更多协议细节见 [HARDWARE_PROTOCOL.md](./HARDWARE_PROTOCOL.md)。
