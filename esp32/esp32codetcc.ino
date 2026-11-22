#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <ESP32Servo.h>

// ===============================
// CONFIGURACOES
// ===============================

#define DEVICE_NAME "AutoKitchen"

#define LIGHT_PIN 4
#define LM35_PIN  34
#define SERVO_PIN 13
#define GAS_PIN   35 // Pino analógico para o sensor MQ-5

#define SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define RX_UUID      "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define TX_UUID      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

#define STATUS_INTERVAL_MS 1000
#define TEMP_SAMPLE_INTERVAL_MS 50
#define ADVERTISING_RESTART_MS 500
#define PREFERRED_MTU 185

#define LM35_MV_PER_CELSIUS 10.0f
#define TEMP_FILTER_ALPHA 0.2f
#define TEMP_MIN_VALID (-10.0f)
#define TEMP_MAX_VALID 150.0f

// ===============================
// VARIAVEIS
// ===============================

BLEServer *bleServer = nullptr;
BLECharacteristic *txCharacteristic = nullptr;
BLECharacteristic *rxCharacteristic = nullptr;

volatile bool deviceConnected = false;

bool lightState = false;
bool alertState = false;

float temperatureC = NAN;
int gasValue = 0; // Variável que armazena a leitura do gás
uint16_t negotiatedMtu = 23;

Servo servoMotor;
int servoAngle = 0;
bool windowState = false;

unsigned long lastStatusMs = 0;
unsigned long lastSampleMs = 0;
unsigned long disconnectMs = 0;
bool advertisingPending = false;

char jsonBuffer[160]; 

// ===============================
// LEITURA DOS SENSORES (LM35 e MQ-5)
// ===============================

void sampleSensors() {
  // 1. Leitura da Temperatura (LM35)
  int millivolts = analogReadMilliVolts(LM35_PIN);
  float celsius = millivolts / LM35_MV_PER_CELSIUS;

  if (celsius >= TEMP_MIN_VALID && celsius <= TEMP_MAX_VALID) {
    if (isnan(temperatureC)) {
      temperatureC = celsius;
    } else {
      temperatureC += TEMP_FILTER_ALPHA * (celsius - temperatureC);
    }
  }

  // 2. Leitura do Gás (MQ-5)
  gasValue = analogRead(GAS_PIN); 
}

// ===============================
// ENVIO DE DADOS BLE
// ===============================

uint16_t maxNotificationPayload() {
  return negotiatedMtu > 3 ? (negotiatedMtu - 3) : 20;
}

void sendStatus() {
  if (!deviceConnected || txCharacteristic == nullptr || bleServer == nullptr) {
    return;
  }

  if (isnan(temperatureC)) {
    return;
  }

  uint16_t mtu = bleServer->getPeerMTU(bleServer->getConnId());
  if (mtu >= 23) {
    negotiatedMtu = mtu;
  }

  int written = snprintf(
    jsonBuffer,
    sizeof(jsonBuffer),
    "{\"luz\":%d,\"alerta\":%d,\"temperature\":%.1f,\"gas\":%d,\"janela\":%d}",
    lightState ? 1 : 0,
    alertState ? 1 : 0,
    temperatureC,
    gasValue, // Envia o valor do gás
    windowState ? 1 : 0
  );

  if (written <= 0) return;
  if ((size_t)written >= sizeof(jsonBuffer) - 1) {
    Serial.println("JSON de status excedeu o buffer.");
    return;
  }

  jsonBuffer[written] = '\n';
  size_t length = (size_t)written + 1;
  size_t payloadLimit = maxNotificationPayload();

  for (size_t offset = 0; offset < length;) {
    size_t chunkLength = length - offset;
    if (chunkLength > payloadLimit) {
      chunkLength = payloadLimit;
    }

    txCharacteristic->setValue((uint8_t *)(jsonBuffer + offset), chunkLength);
    txCharacteristic->notify();
    offset += chunkLength;
  }

  Serial.print("Enviado pelo Bluetooth: ");
  Serial.print(jsonBuffer);
}

// ===============================
// CALLBACKS DO SERVIDOR BLE
// ===============================

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    deviceConnected = true;
    advertisingPending = false;
    Serial.println("Aplicativo conectado!");
    uint16_t mtu = server->getPeerMTU(server->getConnId());
    if (mtu >= 23) negotiatedMtu = mtu;
  }

  void onDisconnect(BLEServer *server) override {
    deviceConnected = false;
    disconnectMs = millis();
    advertisingPending = true;
    Serial.println("Aplicativo desconectado!");
  }
};

// ===============================
// RECEBIMENTO DE COMANDOS
// ===============================

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    String command = String(characteristic->getValue().c_str());
    if (command.length() == 0) return;
    command.trim();

    Serial.print("Comando recebido: ");
    Serial.println(command);

    if (command == "LIGHT:1") {
      lightState = true;
      digitalWrite(LIGHT_PIN, HIGH);
    }
    else if (command == "LIGHT:0") {
      lightState = false;
      digitalWrite(LIGHT_PIN, LOW);
    }
    else if (command == "ALERT:1") {
      alertState = true;
    }
    else if (command == "ALERT:0") {
      alertState = false;
    }
    else if (command == "WINDOW:1") {
      windowState = true;
      servoMotor.write(90);
      Serial.println("Janela ABERTA");
    }
    else if (command == "WINDOW:0") {
      windowState = false;
      servoMotor.write(0);
      Serial.println("Janela FECHADA");
    }
    
  }
};

// ===============================
// SETUP E LOOP
// ===============================

void setup() {
  Serial.begin(115200);

  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(LIGHT_PIN, LOW);

  servoMotor.attach(SERVO_PIN, 500, 2400);
  servoMotor.write(0);

  analogReadResolution(12);
  analogSetPinAttenuation(LM35_PIN, ADC_11db);
  analogSetPinAttenuation(GAS_PIN, ADC_11db); // Atenuação para o MQ-5

  Serial.println("\nIniciando AutoKitchen...");
  
  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(PREFERRED_MTU);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  BLEService *service = bleServer->createService(SERVICE_UUID);

  txCharacteristic = service->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  rxCharacteristic = service->createCharacteristic(RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  
  rxCharacteristic->setCallbacks(new CommandCallbacks());
  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  sampleSensors();

  Serial.println("Bluetooth pronto! Nome: " + String(DEVICE_NAME));
  Serial.println("Aguardando conexao...");
}

void loop() {
  unsigned long now = millis();

  if (now - lastSampleMs >= TEMP_SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    sampleSensors(); // Lê temperatura e gás
  }

  if (advertisingPending && now - disconnectMs >= ADVERTISING_RESTART_MS) {
    advertisingPending = false;
    BLEDevice::startAdvertising();
    Serial.println("Bluetooth aguardando conexao...");
  }

  if (deviceConnected && now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    sendStatus();
  }

  delay(2);
}