#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "替换成你的WiFi名称";
const char* WIFI_PASSWORD = "替换成你的WiFi密码";
const char* SERVER_HOST = "192.168.1.100";
const int SERVER_PORT = 3000;
const char* DEVICE_ID = "esp32-farm-01";
const char* DEVICE_NAME = "田间节点 01";

const int LIGHT_SENSOR_PIN = 34;
const int SOIL_SENSOR_PIN = 35;
const int PUMP_RELAY_PIN = 26;
const int GROW_LIGHT_RELAY_PIN = 27;
const int FAN_RELAY_PIN = 25;

unsigned long lastUploadAt = 0;
unsigned long lastCommandPollAt = 0;

String buildUrl(const char* path) {
  return "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + String(path);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(600);
  }
}

float readLightLux() {
  int raw = analogRead(LIGHT_SENSOR_PIN);
  return map(raw, 0, 4095, 0, 50000);
}

int readSoilMoisturePercent() {
  int raw = analogRead(SOIL_SENSOR_PIN);

  // 这里需要根据你的土壤湿度传感器做校准。
  // 例子里假设 raw=3300 很干，raw=1400 很湿。
  int moisture = map(raw, 3300, 1400, 0, 100);
  return constrain(moisture, 0, 100);
}

void applyCommand(const String& key, const String& value) {
  if (key == "pump") {
    digitalWrite(PUMP_RELAY_PIN, value == "on" ? LOW : HIGH);
  } else if (key == "growLight") {
    digitalWrite(GROW_LIGHT_RELAY_PIN, value == "on" ? LOW : HIGH);
  } else if (key == "fan") {
    digitalWrite(FAN_RELAY_PIN, value == "on" ? LOW : HIGH);
  }
}

void uploadSensors() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  float lightLux = readLightLux();
  int soilMoisture = readSoilMoisturePercent();
  int rssi = WiFi.RSSI();

  String payload = "{";
  payload += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"deviceName\":\"" + String(DEVICE_NAME) + "\",";
  payload += "\"firmware\":\"esp32-wroom-e-v1\",";
  payload += "\"lightLux\":" + String(lightLux, 0) + ",";
  payload += "\"soilMoisture\":" + String(soilMoisture) + ",";
  payload += "\"airTemperature\":25.0,";
  payload += "\"airHumidity\":60,";
  payload += "\"soilTemperature\":22.0,";
  payload += "\"battery\":100,";
  payload += "\"rssi\":" + String(rssi);
  payload += "}";

  HTTPClient http;
  http.begin(buildUrl("/api/sensors"));
  http.addHeader("Content-Type", "application/json");
  http.POST(payload);
  http.end();
}

void pollCommands() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  HTTPClient http;
  http.begin(buildUrl(("/api/device/commands.txt?deviceId=" + String(DEVICE_ID)).c_str()));
  int httpCode = http.GET();

  if (httpCode == 200) {
    String body = http.getString();
    int from = 0;

    while (from < body.length()) {
      int lineEnd = body.indexOf('\n', from);
      if (lineEnd < 0) {
        lineEnd = body.length();
      }

      String line = body.substring(from, lineEnd);
      int split = line.indexOf('=');

      if (split > 0) {
        String key = line.substring(0, split);
        String value = line.substring(split + 1);
        key.trim();
        value.trim();
        applyCommand(key, value);
      }

      from = lineEnd + 1;
    }
  }

  http.end();
}

void setup() {
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  pinMode(GROW_LIGHT_RELAY_PIN, OUTPUT);
  pinMode(FAN_RELAY_PIN, OUTPUT);

  digitalWrite(PUMP_RELAY_PIN, HIGH);
  digitalWrite(GROW_LIGHT_RELAY_PIN, HIGH);
  digitalWrite(FAN_RELAY_PIN, HIGH);

  analogReadResolution(12);
  Serial.begin(115200);
  connectWiFi();
}

void loop() {
  unsigned long now = millis();

  if (now - lastUploadAt >= 5000) {
    lastUploadAt = now;
    uploadSensors();
  }

  if (now - lastCommandPollAt >= 2000) {
    lastCommandPollAt = now;
    pollCommands();
  }
}
