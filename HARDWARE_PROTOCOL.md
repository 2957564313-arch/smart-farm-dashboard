# 智慧农业硬件对接协议

本文档说明 `smart-farm-dashboard` 当前支持的两套硬件接入方式。

## 1. 当前推荐：Node.js TCP 网关兼容旧硬件

旧 STM32 + ESP8266 程序当前工作方式是：ESP8266 建立 AP 和 TCP Server，手机 App 连接 `192.168.4.1:8080` 后收发文本命令。网页不能在浏览器里直接连接原始 TCP，所以本项目由 `server.js` 作为网关连接旧硬件。

### 连接信息

- 硬件地址：`192.168.4.1`
- TCP 端口：`8080`
- 网页接口：`POST /api/tcp/connect`
- 断开接口：`POST /api/tcp/disconnect`
- 状态接口：`GET /api/tcp/status`
- 原始命令接口：`POST /api/tcp/send`

### 旧硬件上报格式

```text
temp:26#,humi:60#,light:15#,soil:50#,smoke:300#
```

可以附带告警标志和开关状态：

```text
temp:36#,humi:18#,light:10#,soil:8#,smoke:900#,temp_warn,humi_warn,light_warn,soil_warn,smoke_warn,swit1_off,swit2_on,swit3_on,swit4_off,swit5_on
```

### 上报字段映射

| 旧字段 | 网页标准字段 | 含义 |
|---|---|---|
| `temp` | `airTemperature` | 空气温度，单位 °C |
| `humi` | `airHumidity` | 空气湿度，单位 % |
| `light` | `lightValue` | 光照值，当前硬件为 0-99 或 ADC 换算值 |
| `soil` | `soilMoisture` | 土壤湿度，单位 % |
| `smoke` | `mq2` | MQ2 烟雾浓度，单位 ppm |

### 开关状态映射

| 旧状态 | 网页字段 | 含义 |
|---|---|---|
| `swit1_on` / `swit1_off` | `mode=manual/auto` | 手动 / 自动模式 |
| `swit2_on` / `swit2_off` | `growLight=on/off` | 补光灯 |
| `swit3_on` / `swit3_off` | `pump=on/off` | 水泵 |
| `swit4_on` / `swit4_off` | `fan=on/off` | 风扇 |
| `swit5_on` / `swit5_off` | `mist=on/off` | 加湿 / 雾化 |

### 网页下发旧命令

控制按钮会先更新网页状态和命令队列。如果 TCP 已连接，`server.js` 会同时向旧硬件发送旧文本命令。

| 网页控制字段 | 旧硬件命令 |
|---|---|
| `mode=manual` | `Manual` |
| `mode=auto` | `Auto` |
| `growLight=on` | `led_on` |
| `growLight=off` | `led_off` |
| `pump=on` | `pump_on` |
| `pump=off` | `pump_off` |
| `fan=on` | `fan_on` |
| `fan=off` | `fan_off` |
| `mist=on` | `humidifier_on` |
| `mist=off` | `humidifier_off` |

命令映射集中在 `server.js` 的 `legacyCommandMap`，如果后续硬件文本命令变化，只需要改这里。

### 旧 App 风格配置字符串

网页保存配置后，如果 TCP 已连接，会发送：

```text
temp_max:35,humi_min:20,light_min:15,soil_min:10,smoke_max:800
```

字段含义：

| 旧配置字段 | 网页标准字段 | 含义 |
|---|---|---|
| `temp_max` | `airTemperatureHigh` | 温度上限 |
| `humi_min` | `airHumidityLow` | 空气湿度下限 |
| `light_min` | `lightLow` | 光照下限 |
| `soil_min` | `soilMoistureLow` | 土壤湿度下限 |
| `smoke_max` | `mq2High` | MQ2 烟雾浓度上限 |

## 2. 未来扩展：设备主动 HTTP POST

保留 HTTP 接入方式，方便后续把 STM32 + ESP8266 改成主动联网设备。

### 上传传感器数据

```http
POST /api/sensors
Content-Type: application/json
```

推荐 JSON：

```json
{
  "deviceId": "stm32-farm-01",
  "deviceName": "STM32 智慧农业节点",
  "firmware": "stm32-esp8266-v1",
  "soilMoisture": 55,
  "airTemperature": 26.5,
  "airHumidity": 60,
  "lightValue": 35,
  "mq2": 300,
  "battery": null,
  "rssi": null
}
```

`/api/sensors` 同时兼容旧字段名：

```json
{
  "temp": 26,
  "humi": 60,
  "soil": 55,
  "light": 35,
  "smoke": 300
}
```

### 拉取待执行命令

文本接口：

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
soilMoistureLow=10
airTemperatureHigh=35
airHumidityLow=20
lightLow=15
mq2High=800
sampleIntervalSec=5
```

JSON 接口：

```http
GET /api/device/commands?deviceId=stm32-farm-01
```

## STM32/ESP8266 注意事项

- 当前旧工程的光照值是 0-99，不是真实 lux，网页显示为“光照值”。
- 当前硬件继电器是开关量，网页以开关控制为主，PWM 仅作为未来预留。
- 浏览器不能直接连接 TCP Socket，因此旧硬件接入必须通过 Node.js 网关。
- 如果 TCP 连接失败，先确认电脑已连接到 ESP8266 AP，默认 SSID 为旧工程中配置的 `ESP8266_WIFI`。
- 后续改 HTTP 模式时，可以让 STM32 通过串口控制 ESP8266，周期性 POST `/api/sensors`，并轮询 `/api/device/commands.txt`。
