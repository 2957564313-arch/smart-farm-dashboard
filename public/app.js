const els = {
  deviceStatusBadge: document.querySelector("#deviceStatusBadge"),
  commandCountBadge: document.querySelector("#commandCountBadge"),
  deviceName: document.querySelector("#deviceName"),
  deviceId: document.querySelector("#deviceId"),
  networkUrls: document.querySelector("#networkUrls"),
  lastSeen: document.querySelector("#lastSeen"),
  firmwareValue: document.querySelector("#firmwareValue"),
  signalValue: document.querySelector("#signalValue"),
  batteryValue: document.querySelector("#batteryValue"),
  soilTemperatureValue: document.querySelector("#soilTemperatureValue"),
  liveModeValue: document.querySelector("#liveModeValue"),
  fanPwmQuickValue: document.querySelector("#fanPwmQuickValue"),
  growLightPwmQuickValue: document.querySelector("#growLightPwmQuickValue"),
  sampleIntervalValue: document.querySelector("#sampleIntervalValue"),
  irrigationAdviceCard: document.querySelector("#irrigationAdviceCard"),
  lightAdviceCard: document.querySelector("#lightAdviceCard"),
  riskAdviceCard: document.querySelector("#riskAdviceCard"),
  irrigationAdvice: document.querySelector("#irrigationAdvice"),
  irrigationAdviceDetail: document.querySelector("#irrigationAdviceDetail"),
  lightAdvice: document.querySelector("#lightAdvice"),
  lightAdviceDetail: document.querySelector("#lightAdviceDetail"),
  riskAdvice: document.querySelector("#riskAdvice"),
  riskAdviceDetail: document.querySelector("#riskAdviceDetail"),
  reportAvgSoil: document.querySelector("#reportAvgSoil"),
  reportAvgLight: document.querySelector("#reportAvgLight"),
  reportAvgTemp: document.querySelector("#reportAvgTemp"),
  reportTrend: document.querySelector("#reportTrend"),
  soilMoistureValue: document.querySelector("#soilMoistureValue"),
  soilHint: document.querySelector("#soilHint"),
  soilMeterBar: document.querySelector("#soilMeterBar"),
  lightLuxValue: document.querySelector("#lightLuxValue"),
  lightHint: document.querySelector("#lightHint"),
  lightMeterBar: document.querySelector("#lightMeterBar"),
  airTemperatureValue: document.querySelector("#airTemperatureValue"),
  airTemperatureHint: document.querySelector("#airTemperatureHint"),
  airHumidityValue: document.querySelector("#airHumidityValue"),
  airHumidityHint: document.querySelector("#airHumidityHint"),
  soilChart: document.querySelector("#soilChart"),
  lightChart: document.querySelector("#lightChart"),
  soilChartLabel: document.querySelector("#soilChartLabel"),
  lightChartLabel: document.querySelector("#lightChartLabel"),
  soilLowInput: document.querySelector("#soilLowInput"),
  soilHighInput: document.querySelector("#soilHighInput"),
  lightLowInput: document.querySelector("#lightLowInput"),
  humidityLowInput: document.querySelector("#humidityLowInput"),
  tempHighInput: document.querySelector("#tempHighInput"),
  sampleIntervalInput: document.querySelector("#sampleIntervalInput"),
  configSubmit: document.querySelector("#configSubmit"),
  fanPwmSlider: document.querySelector("#fanPwmSlider"),
  fanPwmValue: document.querySelector("#fanPwmValue"),
  fanPwmSubmit: document.querySelector("#fanPwmSubmit"),
  growLightPwmSlider: document.querySelector("#growLightPwmSlider"),
  growLightPwmValue: document.querySelector("#growLightPwmValue"),
  growLightPwmSubmit: document.querySelector("#growLightPwmSubmit"),
  pumpStateValue: document.querySelector("#pumpStateValue"),
  mistStateValue: document.querySelector("#mistStateValue"),
  fanStateValue: document.querySelector("#fanStateValue"),
  growLightStateValue: document.querySelector("#growLightStateValue"),
  alertsList: document.querySelector("#alertsList"),
  activityList: document.querySelector("#activityList"),
  demoButton: document.querySelector("#demoButton")
};

const toggleButtons = Array.from(document.querySelectorAll(".toggle-button[data-key]"));

function percent(value, max) {
  return `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

function formatLastSeen(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 10_000) {
    return "刚刚";
  }
  if (diff < 60_000) {
    return `${Math.floor(diff / 1000)} 秒前`;
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  return new Date(isoString).toLocaleString("zh-CN");
}

function makeSoilHint(value, low, high) {
  if (value <= low) {
    return "低于下限，建议浇灌";
  }
  if (value >= high) {
    return "高于上限，暂停浇灌";
  }
  return "处于目标区间";
}

function makeLightHint(value, low) {
  if (value <= low) {
    return "低于补光阈值";
  }
  if (value >= low + 8000) {
    return "自然光充足";
  }
  return "可维持当前补光";
}

function makeTempHint(value, high) {
  if (value >= high) {
    return "温度偏高，建议通风";
  }
  if (value <= 18) {
    return "温度偏低";
  }
  return "温度基本稳定";
}

function makeHumidityHint(value, low) {
  if (value <= low) {
    return "湿度偏低，关注雾化";
  }
  if (value >= 80) {
    return "湿度较高，注意通风";
  }
  return "湿度处于正常范围";
}

function stateLabel(value, kind = "switch") {
  if (kind === "mode") {
    return value === "manual" ? "手动模式" : "自动模式";
  }

  return value === "on" ? "运行中" : "已关闭";
}

function buildPath(values, color, fill) {
  if (!values.length) {
    return "";
  }

  const width = 320;
  const height = 140;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);

  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - ((value - min) / spread) * (height - 22) - 10;
    return `${x},${y}`;
  });

  const last = points[points.length - 1].split(",");
  const gradientId = `g-${color.replace("#", "")}`;

  return `
    <defs>
      <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${fill}" stop-opacity="0.48"></stop>
        <stop offset="100%" stop-color="${fill}" stop-opacity="0.02"></stop>
      </linearGradient>
    </defs>
    <polyline fill="url(#${gradientId})" stroke="none" points="0,140 ${points.join(" ")} 320,140"></polyline>
    <polyline fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${points.join(" ")}"></polyline>
    <circle cx="${last[0]}" cy="${last[1]}" r="5" fill="${color}"></circle>
  `;
}

function renderCharts(history) {
  const soilValues = history.map((item) => item.soilMoisture);
  const lightValues = history.map((item) => item.lightLux);

  els.soilChart.innerHTML = buildPath(soilValues, "#8ecb70", "#8ecb70");
  els.lightChart.innerHTML = buildPath(lightValues, "#f0b466", "#f0b466");
}

function renderToneCard(card, tone) {
  card.className = `strategy-card tone-${tone}`;
}

function renderRecommendations(recommendations) {
  const fallback = {
    irrigation: { tone: "ok", title: "等待建议", detail: "等待设备数据上报。" },
    lighting: { tone: "ok", title: "等待建议", detail: "等待设备数据上报。" },
    risk: { tone: "ok", title: "等待建议", detail: "等待设备数据上报。" }
  };
  const irrigation = recommendations.irrigation || fallback.irrigation;
  const lighting = recommendations.lighting || fallback.lighting;
  const risk = recommendations.risk || fallback.risk;

  renderToneCard(els.irrigationAdviceCard, irrigation.tone);
  renderToneCard(els.lightAdviceCard, lighting.tone);
  renderToneCard(els.riskAdviceCard, risk.tone);

  els.irrigationAdvice.textContent = irrigation.title;
  els.irrigationAdviceDetail.textContent = irrigation.detail;
  els.lightAdvice.textContent = lighting.title;
  els.lightAdviceDetail.textContent = lighting.detail;
  els.riskAdvice.textContent = risk.title;
  els.riskAdviceDetail.textContent = risk.detail;
}

function renderReport(report) {
  els.reportAvgSoil.textContent = report.avgSoilMoisture !== undefined ? `${report.avgSoilMoisture}%` : "--";
  els.reportAvgLight.textContent = report.avgLightLux !== undefined ? `${report.avgLightLux} lux` : "--";
  els.reportAvgTemp.textContent = report.avgAirTemperature !== undefined ? `${Number(report.avgAirTemperature).toFixed(1)}°C` : "--";
  els.reportTrend.textContent = report.soilTrend || "--";
}

function renderAlerts(alerts) {
  if (!alerts.length) {
    els.alertsList.innerHTML = `
      <div class="feed-item">
        <strong>暂无越界告警</strong>
        <p>当前环境数据没有触发阈值风险，适合展示正常工作状态。</p>
      </div>
    `;
    return;
  }

  els.alertsList.innerHTML = alerts
    .map(
      (item) => `
        <div class="feed-item ${item.level}">
          <strong>${item.title}</strong>
          <p>${item.message}</p>
        </div>
      `
    )
    .join("");
}

function renderActivity(items) {
  if (!items.length) {
    els.activityList.innerHTML = `
      <div class="feed-item">
        <strong>暂无运行日志</strong>
        <p>设备开始上报后，这里会记录通信和控制历史。</p>
      </div>
    `;
    return;
  }

  els.activityList.innerHTML = items
    .map(
      (item) => `
        <div class="feed-item">
          <strong>${item.text}</strong>
          <p class="meta">${new Date(item.createdAt).toLocaleString("zh-CN")}</p>
        </div>
      `
    )
    .join("");
}

function updateToggleHighlight(controls) {
  for (const button of toggleButtons) {
    const active = controls[button.dataset.key] === button.dataset.value;
    button.classList.toggle("is-active", active);
  }
}

function updateView(data) {
  els.deviceName.textContent = data.device.name;
  els.deviceId.textContent = data.device.id;
  els.networkUrls.textContent = data.meta.networkUrls.join(" / ") || window.location.origin;
  els.lastSeen.textContent = formatLastSeen(data.device.lastSeen);
  els.firmwareValue.textContent = data.device.firmware;
  els.signalValue.textContent = `${data.device.rssi} dBm`;
  els.batteryValue.textContent = `${Math.round(data.sensors.battery)}%`;
  els.soilTemperatureValue.textContent = `${Number(data.sensors.soilTemperature).toFixed(1)}°C`;

  els.deviceStatusBadge.textContent = data.device.online ? "设备在线" : "设备离线";
  els.deviceStatusBadge.className = `status-chip ${data.device.online ? "chip-online" : "chip-offline"}`;
  els.commandCountBadge.textContent = `待执行命令 ${data.pendingCommands}`;

  els.liveModeValue.textContent = stateLabel(data.controls.mode, "mode");
  els.fanPwmQuickValue.textContent = `${Math.round(data.controls.fanPwm)}%`;
  els.growLightPwmQuickValue.textContent = `${Math.round(data.controls.growLightPwm)}%`;
  els.sampleIntervalValue.textContent = `${Math.round(data.config.sampleIntervalSec)} 秒`;

  els.soilMoistureValue.textContent = Math.round(data.sensors.soilMoisture);
  els.soilHint.textContent = makeSoilHint(data.sensors.soilMoisture, data.config.soilMoistureLow, data.config.soilMoistureHigh);
  els.soilMeterBar.style.width = `${Math.round(data.sensors.soilMoisture)}%`;

  els.lightLuxValue.textContent = Math.round(data.sensors.lightLux);
  els.lightHint.textContent = makeLightHint(data.sensors.lightLux, data.config.lightLuxLow);
  els.lightMeterBar.style.width = percent(data.sensors.lightLux, 50000);

  els.airTemperatureValue.textContent = Number(data.sensors.airTemperature).toFixed(1);
  els.airTemperatureHint.textContent = makeTempHint(data.sensors.airTemperature, data.config.airTemperatureHigh);

  els.airHumidityValue.textContent = Math.round(data.sensors.airHumidity);
  els.airHumidityHint.textContent = makeHumidityHint(data.sensors.airHumidity, data.config.airHumidityLow);

  els.soilChartLabel.textContent = `${Math.round(data.sensors.soilMoisture)}%`;
  els.lightChartLabel.textContent = `${Math.round(data.sensors.lightLux)} lux`;

  els.soilLowInput.value = Math.round(data.config.soilMoistureLow);
  els.soilHighInput.value = Math.round(data.config.soilMoistureHigh);
  els.lightLowInput.value = Math.round(data.config.lightLuxLow);
  els.humidityLowInput.value = Math.round(data.config.airHumidityLow);
  els.tempHighInput.value = Number(data.config.airTemperatureHigh).toFixed(1);
  els.sampleIntervalInput.value = Math.round(data.config.sampleIntervalSec);

  els.fanPwmSlider.value = Math.round(data.controls.fanPwm);
  els.fanPwmValue.textContent = `${Math.round(data.controls.fanPwm)}%`;
  els.growLightPwmSlider.value = Math.round(data.controls.growLightPwm);
  els.growLightPwmValue.textContent = `${Math.round(data.controls.growLightPwm)}%`;

  els.pumpStateValue.textContent = stateLabel(data.controls.pump);
  els.mistStateValue.textContent = stateLabel(data.controls.mist);
  els.fanStateValue.textContent = stateLabel(data.controls.fan);
  els.growLightStateValue.textContent = stateLabel(data.controls.growLight);

  renderRecommendations(data.recommendations || {});
  renderReport(data.report || {});
  renderAlerts(data.alerts || []);
  renderActivity(data.activityLog || []);
  renderCharts(data.history || []);
  updateToggleHighlight(data.controls || {});
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "请求失败");
  }

  return response.json();
}

async function bootstrap() {
  const state = await fetch("/api/state").then((res) => res.json());
  updateView(state);

  const source = new EventSource("/events");
  source.onmessage = (event) => {
    updateView(JSON.parse(event.data));
  };
}

toggleButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await postJson("/api/control", {
        key: button.dataset.key,
        value: button.dataset.value
      });
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
});

els.fanPwmSlider.addEventListener("input", () => {
  els.fanPwmValue.textContent = `${els.fanPwmSlider.value}%`;
});

els.growLightPwmSlider.addEventListener("input", () => {
  els.growLightPwmValue.textContent = `${els.growLightPwmSlider.value}%`;
});

els.fanPwmSubmit.addEventListener("click", async () => {
  els.fanPwmSubmit.disabled = true;
  try {
    await postJson("/api/control", {
      key: "fanPwm",
      value: Number(els.fanPwmSlider.value)
    });
  } catch (error) {
    alert(error.message);
  } finally {
    els.fanPwmSubmit.disabled = false;
  }
});

els.growLightPwmSubmit.addEventListener("click", async () => {
  els.growLightPwmSubmit.disabled = true;
  try {
    await postJson("/api/control", {
      key: "growLightPwm",
      value: Number(els.growLightPwmSlider.value)
    });
  } catch (error) {
    alert(error.message);
  } finally {
    els.growLightPwmSubmit.disabled = false;
  }
});

els.configSubmit.addEventListener("click", async () => {
  els.configSubmit.disabled = true;
  try {
    await postJson("/api/config", {
      soilMoistureLow: Number(els.soilLowInput.value),
      soilMoistureHigh: Number(els.soilHighInput.value),
      lightLuxLow: Number(els.lightLowInput.value),
      airHumidityLow: Number(els.humidityLowInput.value),
      airTemperatureHigh: Number(els.tempHighInput.value),
      sampleIntervalSec: Number(els.sampleIntervalInput.value)
    });
  } catch (error) {
    alert(error.message);
  } finally {
    els.configSubmit.disabled = false;
  }
});

els.demoButton.addEventListener("click", async () => {
  els.demoButton.disabled = true;
  try {
    await postJson("/api/demo/push", {});
  } catch (error) {
    alert(error.message);
  } finally {
    els.demoButton.disabled = false;
  }
});

bootstrap().catch((error) => {
  console.error(error);
  alert(`页面初始化失败：${error.message}`);
});

