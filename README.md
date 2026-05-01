# 智慧农业监测与控制平台

一个基于 Node.js + 原生 HTML/CSS/JavaScript 的智慧农业网页控制台，用于展示环境数据、控制继电器执行器、配置阈值、查看告警、历史曲线和运行日志。

本项目当前重点适配已有 STM32 + ESP8266 旧硬件和旧 App 协议，同时保留未来 HTTP 设备主动接入能力。

## 当前能力

- 实时显示空气温度、空气湿度、土壤湿度、光照值、MQ2 烟雾浓度
- 显示设备在线状态、最近上报时间、WiFi 信号、供电状态、固件信息
- 控制自动/手动模式、水泵、风扇、加湿/雾化、补光灯、蜂鸣器
- 配置温度上限、湿度下限、光照下限、土壤湿度下限、烟雾浓度上限
- 自动生成阈值告警、运行日志、灌溉建议、补光建议和风险提示
- 历史曲线支持土壤湿度、空气温度、空气湿度、光照值
- 保留 HTTP API：`/api/sensors`、`/api/control`、`/api/config`、`/api/device/commands.txt`
- 新增旧硬件 TCP 网关：Node.js 连接 `192.168.4.1:8080`，兼容旧 App 文本协议

## 快速启动

```bash
npm start
```

然后打开：

```text
http://localhost:3000
```

局域网内其他设备可访问：

```text
http://<电脑IP>:3000
```

## 项目结构

```text
smart-farm-dashboard/
├── server.js                         # Node.js 服务端、HTTP API、SSE、TCP 网关
├── package.json                      # npm start 启动脚本
├── README.md                         # 项目说明
├── HARDWARE_PROTOCOL.md              # 硬件协议说明
├── public/
│   ├── index.html                    # 网页结构
│   ├── app.js                        # 前端交互逻辑
│   └── styles.css                    # 页面样式
└── examples/
    └── esp32_smart_farm_demo.ino     # ESP32 HTTP 接入示例
```

## 旧硬件 TCP 兼容模式

当前已有硬件使用 ESP8266 建立 TCP Server，旧 App 连接：

```text
192.168.4.1:8080
```

网页不能直接连接原始 TCP，所以本项目由 `server.js` 作为 TCP 网关。

网页接口：

```text
GET  /api/tcp/status
POST /api/tcp/connect
POST /api/tcp/disconnect
POST /api/tcp/send
```

旧硬件上报格式示例：

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

网页控制到旧硬件命令映射：

| 网页控制 | 旧硬件命令 |
|---|---|
| `mode=manual` | `Manual` |
| `mode=auto` | `Auto` |
| `growLight=on/off` | `led_on` / `led_off` |
| `pump=on/off` | `pump_on` / `pump_off` |
| `fan=on/off` | `fan_on` / `fan_off` |
| `mist=on/off` | `humidifier_on` / `humidifier_off` |

配置保存时，TCP 已连接的情况下会发送旧 App 风格配置：

```text
temp_max:32,humi_min:45,light_min:15,soil_min:35,smoke_max:700
```

## HTTP 设备接口

未来如果将 STM32 + ESP8266 改成主动 HTTP 方式，可以直接使用以下接口。

上传传感器数据：

```http
POST /api/sensors
Content-Type: application/json
```

推荐字段：

```json
{
  "deviceId": "stm32-farm-01",
  "deviceName": "STM32 智慧农业节点",
  "firmware": "STM32/ESP8266 节点",
  "soilMoisture": 55,
  "airTemperature": 26.5,
  "airHumidity": 60,
  "lightValue": 35,
  "mq2": 300,
  "rssi": null,
  "battery": null
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

拉取文本命令：

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

## API 自测示例

```bash
curl http://localhost:3000/api/state
curl -X POST http://localhost:3000/api/sensors ^
  -H "Content-Type: application/json" ^
  -d "{\"temp\":27,\"humi\":60,\"soil\":38,\"light\":850,\"smoke\":300}"
curl -X POST http://localhost:3000/api/control ^
  -H "Content-Type: application/json" ^
  -d "{\"pump\":\"off\",\"fan\":\"on\",\"mist\":\"off\",\"growLight\":\"on\",\"mode\":\"manual\"}"
```

## 真硬件联调步骤

1. 电脑连接旧硬件 ESP8266 的 WiFi。
2. 启动网页服务：`npm start`。
3. 打开 `http://localhost:3000`。
4. 在页面的“硬件连接 / TCP 兼容模式”区域点击“连接硬件”。
5. 观察“最近原始数据”是否出现 `temp:...#,humi:...#`。
6. 点击水泵、风扇、补光灯、加湿、自动/手动按钮，确认硬件执行器动作。

更多协议细节见 [HARDWARE_PROTOCOL.md](./HARDWARE_PROTOCOL.md)。
