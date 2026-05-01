# STM32 + ESP8266 旧硬件 TCP 网关接入示例

本示例对应当前项目的主接入方式：旧硬件保持原来的 TCP Server 协议不变，网页项目中的 Node.js 服务主动连接硬件。

## 硬件侧现状

- ESP8266 建立热点和 TCP Server。
- 默认地址：`192.168.4.1:8080`
- STM32 通过串口与 ESP8266 通信。
- STM32 周期性发送传感器文本。
- STM32 接收旧 App 风格文本命令控制继电器。

## Node.js 网关连接流程

1. 电脑连接 ESP8266 热点。
2. 启动网页服务：

```bash
npm start
```

3. 打开网页：

```text
http://localhost:3000
```

4. 在“硬件连接”区域点击“连接硬件”。
5. Node.js 服务会连接：

```text
192.168.4.1:8080
```

## 旧硬件上报文本

STM32 通过 ESP8266 发送：

```text
temp:26#,humi:60#,light:15#,soil:50#,smoke:300#
```

字段含义：

| 字段 | 含义 |
|---|---|
| `temp` | 空气温度 |
| `humi` | 空气湿度 |
| `light` | 光照值 |
| `soil` | 土壤湿度 |
| `smoke` | MQ2 烟雾浓度 |

可附带告警：

```text
temp_warn,humi_warn,light_warn,soil_warn,smoke_warn
```

可附带开关状态：

```text
swit1_on,swit2_off,swit3_on,swit4_off,swit5_on
```

## 网页下发到旧硬件的文本命令

| 网页动作 | 文本命令 |
|---|---|
| 自动模式 | `Auto` |
| 手动模式 | `Manual` |
| 开启补光灯 | `led_on` |
| 关闭补光灯 | `led_off` |
| 开启水泵 | `pump_on` |
| 关闭水泵 | `pump_off` |
| 开启风扇 | `fan_on` |
| 关闭风扇 | `fan_off` |
| 开启加湿/雾化 | `humidifier_on` |
| 关闭加湿/雾化 | `humidifier_off` |

## 参数配置文本

网页保存阈值配置时，TCP 已连接则发送：

```text
temp_max:32,humi_min:45,light_min:15,soil_min:35,smoke_max:700
```

对应含义：

| 字段 | 含义 |
|---|---|
| `temp_max` | 温度上限 |
| `humi_min` | 空气湿度下限 |
| `light_min` | 光照下限 |
| `soil_min` | 土壤湿度下限 |
| `smoke_max` | 烟雾浓度上限 |

## STM32 侧伪代码

```c
void Loop(void)
{
    SensorData data = ReadSensors();

    sprintf(sendBuffer,
        "temp:%d#,humi:%d#,light:%d#,soil:%d#,smoke:%d#",
        data.temperature,
        data.humidity,
        data.light,
        data.soil,
        data.smoke);

    ESP8266_SendData(sendBuffer);

    char *cmd = ESP8266_ReadCommand();
    if (strstr(cmd, "Manual")) mode = MODE_MANUAL;
    if (strstr(cmd, "Auto")) mode = MODE_AUTO;

    if (mode == MODE_MANUAL) {
        if (strstr(cmd, "led_on")) Relay_SetLight(ON);
        if (strstr(cmd, "led_off")) Relay_SetLight(OFF);
        if (strstr(cmd, "pump_on")) Relay_SetPump(ON);
        if (strstr(cmd, "pump_off")) Relay_SetPump(OFF);
        if (strstr(cmd, "fan_on")) Relay_SetFan(ON);
        if (strstr(cmd, "fan_off")) Relay_SetFan(OFF);
        if (strstr(cmd, "humidifier_on")) Relay_SetMist(ON);
        if (strstr(cmd, "humidifier_off")) Relay_SetMist(OFF);
    }

    ParseThresholdConfig(cmd);
}
```

以上伪代码只表达协议流程，不假设具体底层函数名。
