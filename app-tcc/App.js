import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StatusBar, Switch, TouchableOpacity,
  StyleSheet, Alert, Platform, PermissionsAndroid
} from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

const COLORS = {
  background: '#020202',
  header: '#000000',
  card: '#1e293b',
  orange: '#f97316',
  white: '#ffffff',
  secondary: '#aab4c3',
  border: '#334155',
  green: '#22c55e',
  red: '#ef4444',
};

const DEVICE_NAME = 'AutoKitchen';

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const REQUESTED_MTU = 185;

const bleManager = new BleManager();

export default function App() {
  const [lightOn, setLightOn] = useState(false);
  const [emergencyOn, setEmergencyOn] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState('Offline');
  const [bleConnected, setBleConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [bleAvailable, setBleAvailable] = useState(false);

  const [sensorStatus, setSensorStatus] = useState('Aguardando');
  const [sensorData, setSensorData] = useState({
    temperature: null,
    gas: null,
  });
  const [lastUpdate, setLastUpdate] = useState(null);

  const [busyDevices, setBusyDevices] = useState([]);

  const mountedRef = useRef(true);
  const connectedDeviceRef = useRef(null);
  const scanTimeout = useRef(null);
  const notificationSubscription = useRef(null);
  const disconnectSubscription = useRef(null);
  const messageBuffer = useRef('');

  const isValidNumber = useCallback((value) => {
    return (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      Number.isFinite(Number(value))
    );
  }, []);

  const processSensorMessage = useCallback((message) => {
    if (!message || !message.trim()) return;

    try {
      const data = JSON.parse(message.trim());

      const temperature =
        data.temperature ??
        data.temperatura ??
        data.temp ??
        data.lm35;

      const gas =
        data.gas ??
        data.nivel_gas ??
        data.mq5;

      setSensorData(previous => ({
        temperature: isValidNumber(temperature)
          ? Number(temperature)
          : previous.temperature,

        gas: isValidNumber(gas)
          ? Number(gas)
          : previous.gas,
      }));

      if (data.luz !== undefined) {
        setLightOn(Number(data.luz) === 1);
      }

      if (data.alerta !== undefined) {
        setEmergencyOn(Number(data.alerta) === 1);
      }

      if (data.janela !== undefined) {
        setWindowOpen(Number(data.janela) === 1);
      }

      setLastUpdate(new Date());
      setSensorStatus('Atualizado');
    } catch (error) {
      console.log('Mensagem BLE não reconhecida:', message);
    }
  }, [isValidNumber]);

  const receiveBluetoothData = useCallback((base64Value) => {
    try {
      const received = Buffer
        .from(base64Value, 'base64')
        .toString('utf8');

      messageBuffer.current += received;

      const lines = messageBuffer.current.split(/\r?\n/);

      if (lines.length > 1) {
        messageBuffer.current = lines.pop() || '';

        lines.forEach(line => {
          if (line.trim()) processSensorMessage(line);
        });
      }

      if (messageBuffer.current.length > 4096) {
        console.log('Buffer BLE overflow, resetando');
        messageBuffer.current = '';
        setSensorStatus('Erro na leitura');
        return;
      }

      const pending = messageBuffer.current.trim();

      if (pending.startsWith('{') && pending.endsWith('}')) {
        processSensorMessage(pending);
        messageBuffer.current = '';
      }
    } catch (error) {
      console.log('Erro ao decodificar dados BLE:', error.message);
      setSensorStatus('Erro na leitura');
    }
  }, [processSensorMessage]);

  const removeBleSubscriptions = useCallback(() => {
    if (notificationSubscription.current) {
      notificationSubscription.current.remove();
      notificationSubscription.current = null;
    }

    if (disconnectSubscription.current) {
      disconnectSubscription.current.remove();
      disconnectSubscription.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const subscription = bleManager.onStateChange(state => {
      if (!mountedRef.current) return;

      const poweredOn = state === 'PoweredOn';
      setBleAvailable(poweredOn);

      if (!poweredOn) {
        setConnectionStatus(
          state === 'Unauthorized'
            ? 'Sem permissão'
            : 'Bluetooth desligado'
        );

        setScanning(false);
      } else if (!connectedDeviceRef.current) {
        setConnectionStatus('Pronto para conectar');
      }
    }, true);

    return () => {
      mountedRef.current = false;
      subscription.remove();

      if (scanTimeout.current) {
        clearTimeout(scanTimeout.current);
        scanTimeout.current = null;
      }

      bleManager.stopDeviceScan();
      removeBleSubscriptions();

      const device = connectedDeviceRef.current;
      connectedDeviceRef.current = null;

      if (device) {
        device.cancelConnection().catch(() => {});
      }
    };
  }, [removeBleSubscriptions]);

  async function requestBluetoothPermissions() {
    if (Platform.OS !== 'android') return true;

    try {
      if (Number(Platform.Version) >= 31) {
        const hasScan = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
        );
        const hasConnect = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
        );

        if (hasScan && hasConnect) return true;

        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);

        return (
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      }

      const hasLocation = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (hasLocation) return true;

      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );

      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.log('Erro nas permissões:', error.message);
      return false;
    }
  }

  const scanBluetooth = useCallback(async () => {
    if (scanning || bleConnected) return;

    const allowed = await requestBluetoothPermissions();

    if (!allowed) {
      Alert.alert(
        'Permissão necessária',
        'Permita o acesso ao Bluetooth nas configurações do Android.'
      );
      return;
    }

    try {
      const state = await bleManager.state();

      if (state !== 'PoweredOn') {
        setConnectionStatus('Bluetooth desligado');
        Alert.alert(
          'Bluetooth desligado',
          'Ative o Bluetooth do celular e tente novamente.'
        );
        return;
      }

      setScanning(true);
      setConnectionStatus('Procurando ESP32');
      setDeviceName('');

      bleManager.stopDeviceScan();

      bleManager.startDeviceScan(
        null,
        { allowDuplicates: false },
        (error, device) => {
          if (!mountedRef.current) return;

          if (error) {
            bleManager.stopDeviceScan();
            setScanning(false);
            setConnectionStatus('Erro na busca');

            Alert.alert('Erro Bluetooth', error.message);
            return;
          }

          if (!device) return;

          const name = device.name || device.localName || '';
          const matchingName = name === DEVICE_NAME;
          const matchingService =
            device.serviceUUIDs?.some(
              uuid => uuid.toLowerCase() === SERVICE_UUID.toLowerCase()
            ) || false;

          if (matchingName || matchingService) {
            bleManager.stopDeviceScan();

            if (scanTimeout.current) {
              clearTimeout(scanTimeout.current);
              scanTimeout.current = null;
            }

            setScanning(false);
            connectBluetooth(device);
          }
        }
      );

      scanTimeout.current = setTimeout(() => {
        if (!mountedRef.current) return;

        bleManager.stopDeviceScan();
        scanTimeout.current = null;
        setScanning(false);

        if (!connectedDeviceRef.current) {
          setConnectionStatus('ESP32 não encontrado');
          Alert.alert(
            'ESP32 não encontrado',
            'Confira se a placa está ligada e anunciando o Bluetooth BLE.'
          );
        }
      }, 15000);
    } catch (error) {
      setScanning(false);
      setConnectionStatus('Erro na busca');
      Alert.alert('Bluetooth', error.message);
    }
  }, [scanning, bleConnected]);

  const connectBluetooth = useCallback(async (device) => {
    let connectedDevice = null;

    try {
      setConnectionStatus('Conectando');

      connectedDevice = await device.connect({
        timeout: 15000,
      });

      await connectedDevice.discoverAllServicesAndCharacteristics();

      try {
        await connectedDevice.requestMTU(REQUESTED_MTU);
      } catch (mtuError) {
        console.log('MTU recusado:', mtuError.message);
      }

      if (!mountedRef.current) {
        await connectedDevice.cancelConnection().catch(() => {});
        return;
      }

      connectedDeviceRef.current = connectedDevice;
      messageBuffer.current = '';

      const services = await connectedDevice.services();
      const serviceExists = services.some(
        service => service.uuid.toLowerCase() === SERVICE_UUID
      );

      if (!serviceExists) {
        throw new Error('Serviço BLE do AutoKitchen não encontrado.');
      }

      const characteristics = await connectedDevice.characteristicsForService(SERVICE_UUID);

      const txExists = characteristics.some(
        characteristic => characteristic.uuid.toLowerCase() === TX_UUID &&
          (characteristic.isNotifiable || characteristic.isIndicatable)
      );

      const rxExists = characteristics.some(
        characteristic => characteristic.uuid.toLowerCase() === RX_UUID &&
          (characteristic.isWritableWithResponse || characteristic.isWritableWithoutResponse)
      );

      if (!txExists) throw new Error('Característica de leitura TX não encontrada.');
      if (!rxExists) throw new Error('Característica de escrita RX não encontrada.');

      setBleConnected(true);
      setDeviceName(connectedDevice.name || connectedDevice.localName || DEVICE_NAME);
      setConnectionStatus('Online');

      notificationSubscription.current = connectedDevice.monitorCharacteristicForService(
        SERVICE_UUID,
        TX_UUID,
        (error, characteristic) => {
          if (!mountedRef.current) return;
          if (error) {
            console.log('Erro na notificação BLE:', error.message);
            setSensorStatus('Erro na leitura');
            return;
          }
          if (characteristic?.value) {
            receiveBluetoothData(characteristic.value);
          }
        }
      );

      disconnectSubscription.current = connectedDevice.onDisconnected(error => {
        if (!mountedRef.current) return;
        connectedDeviceRef.current = null;
        removeBleSubscriptions();

        setBleConnected(false);
        setDeviceName('');
        setConnectionStatus('Desconectado');
        setSensorStatus('Sem conexão');
        setLastUpdate(null);
        messageBuffer.current = '';
      });
    } catch (error) {
      if (connectedDevice) {
        await connectedDevice.cancelConnection().catch(() => {});
      }
      connectedDeviceRef.current = null;
      removeBleSubscriptions();
      setBleConnected(false);
      setConnectionStatus('Falha na conexão');
      Alert.alert('Falha na conexão', error.message || 'Não foi possível conectar ao ESP32.');
    }
  }, []);

  const disconnectBluetooth = useCallback(async () => {
    bleManager.stopDeviceScan();
    if (scanTimeout.current) {
      clearTimeout(scanTimeout.current);
      scanTimeout.current = null;
    }

    const device = connectedDeviceRef.current;
    connectedDeviceRef.current = null; 

    if (!device) {
      setBleConnected(false);
      setConnectionStatus('Desconectado');
      setSensorStatus('Sem conexão');
      setLastUpdate(null);
      messageBuffer.current = '';
      return;
    }

    setConnectionStatus('Desconectando');
    removeBleSubscriptions();

    try {
      await device.cancelConnection();
    } catch (error) {
      console.log('Erro ao desconectar:', error.message);
    }

    messageBuffer.current = '';
    setBleConnected(false);
    setDeviceName('');
    setConnectionStatus('Desconectado');
    setSensorStatus('Sem conexão');
    setLastUpdate(null);
  }, []);

  const sendBluetoothCommand = useCallback(async (command) => {
    const device = connectedDeviceRef.current;

    if (!device || !bleConnected) {
      Alert.alert('ESP32 desconectado', 'Conecte ao AutoKitchen antes de enviar comandos.');
      return false;
    }

    try {
      const encodedValue = Buffer.from(command + '\n', 'utf8').toString('base64');
      await device.writeCharacteristicWithResponseForService(SERVICE_UUID, RX_UUID, encodedValue);
      return true;
    } catch (error) {
      console.log('Erro ao enviar comando:', error.message);
      setConnectionStatus('Falha no envio');
      Alert.alert('Erro Bluetooth', 'Não foi possível enviar o comando ao ESP32.');
      return false;
    }
  }, [bleConnected]);

  const updateDevice = useCallback(async (id, newValue) => {
    if (busyDevices.includes(id)) return;
    setBusyDevices(previous => [...previous, id]);

    try {
      let command = '';
      if (id === 1) command = `LIGHT:${newValue ? 1 : 0}`;
      else if (id === 2) command = `WINDOW:${newValue ? 1 : 0}`;
      else if (id === 3) command = `ALERT:${newValue ? 1 : 0}`;

      if (!command) return;
      const sent = await sendBluetoothCommand(command);

      if (sent) {
        if (id === 1) setLightOn(newValue);
        if (id === 2) setWindowOpen(newValue);
        if (id === 3) setEmergencyOn(newValue);
      }
    } finally {
      setBusyDevices(previous => previous.filter(deviceId => deviceId !== id));
    }
  }, [bleConnected, busyDevices]);

  const showValue = useCallback((value) => {
    if (value === null || value === undefined || value === '') return '--';
    return String(value);
  }, []);

  function ControlCard({ number, icon, title, description, value, onChange, activeLabel, inactiveLabel, activeColor = COLORS.orange, loading = false }) {
    return (
      <View style={styles.controlCard}>
        <View style={styles.cardHeader}>
          <View style={styles.controlIcon}>
            <Text style={styles.controlIconText}>{icon}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.eyebrow}>CONTROLE {number}</Text>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardDescription}>{description}</Text>
          </View>
        </View>
        <View style={styles.separator} />
        <View style={styles.cardFooter}>
          <View style={styles.stateRow}>
            <View style={[styles.stateDot, { backgroundColor: value ? activeColor : '#64748b' }]} />
            <Text style={[styles.stateText, { color: value ? activeColor : COLORS.secondary }]}>
              {loading ? 'Enviando comando...' : value ? activeLabel : inactiveLabel}
            </Text>
          </View>
          <Switch
            value={value}
            disabled={loading || !bleConnected}
            onValueChange={onChange}
            trackColor={{ false: '#475569', true: COLORS.orange }}
            thumbColor={COLORS.white}
          />
        </View>
      </View>
    );
  }

  function SensorCard({ icon, number, title, description, value, unit }) {
    return (
      <View style={styles.sensorCard}>
        <View style={styles.sensorHeader}>
          <Text style={styles.sensorIcon}>{icon}</Text>
          <Text style={styles.sensorNumber}>SENSOR {number}</Text>
        </View>
        <Text style={styles.sensorTitle}>{title}</Text>
        <View style={styles.sensorValueRow}>
          <Text style={styles.sensorValue}>{value}</Text>
          <Text style={styles.sensorUnit}>{unit}</Text>
        </View>
        <Text style={styles.sensorDescription}>{description}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar backgroundColor={COLORS.header} barStyle="light-content" />

      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>AK</Text>
          </View>
          <View>
            <Text style={styles.brandName}>
              Auto<Text style={styles.brandOrange}>Kitchen</Text>
            </Text>
            <Text style={styles.brandSubtitle}>CONTROLE INTELIGENTE</Text>
          </View>
        </View>
        <View style={styles.connectionBadge}>
          <View style={[styles.connectionDot, { backgroundColor: bleConnected ? COLORS.green : COLORS.red }]} />
          <Text style={styles.connectionText}>{connectionStatus}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.hero}>
          <Text style={styles.sectionLabel}>PAINEL DE CONTROLE</Text>
          <Text style={styles.heroTitle}>
            Sua cozinha,{'\n'}
            <Text style={styles.orangeText}>sob controle.</Text>
          </Text>
          <Text style={styles.heroDescription}>
            Gerencie os dispositivos e acompanhe as condições do ambiente em um único lugar.
          </Text>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>03</Text>
            <Text style={styles.summaryLabel}>Controles</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>02</Text>
            <Text style={styles.summaryLabel}>Sensores</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>01</Text>
            <Text style={styles.summaryLabel}>Ambiente</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Conexão Bluetooth</Text>
              <Text style={styles.sectionDescription}>Comunicação direta com o ESP32</Text>
            </View>
            <View style={styles.bluetoothTag}><Text style={styles.bluetoothTagText}>BLE</Text></View>
          </View>

          <View style={styles.bluetoothCard}>
            <View style={styles.bluetoothIcon}><Text style={styles.bluetoothIconText}>ᛒ</Text></View>
            <Text style={styles.bluetoothTitle}>{bleConnected ? 'ESP32 conectado' : 'Conectar à placa'}</Text>
            <Text style={styles.bluetoothDescription}>
              {bleConnected ? `Dispositivo: ${deviceName || DEVICE_NAME}` : 'Ligue a placa e procure o AutoKitchen por Bluetooth.'}
            </Text>

            {!bleConnected ? (
              <TouchableOpacity
                style={[styles.bluetoothButton, (scanning || !bleAvailable) && styles.buttonDisabled]}
                onPress={scanBluetooth}
                disabled={scanning || !bleAvailable}
              >
                <Text style={styles.bluetoothButtonText}>
                  {!bleAvailable ? 'ATIVE O BLUETOOTH' : scanning ? 'PROCURANDO ESP32...' : 'PROCURAR E CONECTAR'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.disconnectButton} onPress={disconnectBluetooth}>
                <Text style={styles.disconnectButtonText}>DESCONECTAR</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Dispositivos</Text>
              <Text style={styles.sectionDescription}>Gerenciamento dos equipamentos</Text>
            </View>
            <View style={styles.sectionTag}><Text style={styles.sectionTagText}>01—03</Text></View>
          </View>

          <ControlCard
            number="01"
            icon="☼"
            title="Iluminação"
            description="Controle da luz do ambiente"
            value={lightOn}
            onChange={value => updateDevice(1, value)}
            activeLabel="Ligada"
            inactiveLabel="Desligada"
            loading={busyDevices.includes(1)}
          />

          <ControlCard
            number="02"
            icon="⛩"
            title="Janela"
            description="Abre e fecha a janela (servo 90°)"
            value={windowOpen}
            onChange={value => updateDevice(2, value)}
            activeLabel="Aberta"
            inactiveLabel="Fechada"
            activeColor={COLORS.green}
            loading={busyDevices.includes(2)}
          />

          <View style={[styles.emergencyCard, emergencyOn && styles.emergencyCardActive]}>
            <View style={styles.cardHeader}>
              <View style={styles.emergencyIcon}><Text style={styles.emergencyIconText}>!</Text></View>
              <View style={styles.cardInfo}>
                <Text style={styles.eyebrow}>CONTROLE 03</Text>
                <Text style={styles.cardTitle}>Alerta de emergência</Text>
                <Text style={styles.cardDescription}>Acionamento do aviso de emergência</Text>
              </View>
            </View>

            <TouchableOpacity
              disabled={busyDevices.includes(3) || !bleConnected}
              style={[
                styles.emergencyButton,
                emergencyOn && styles.emergencyButtonActive,
                (!bleConnected || busyDevices.includes(3)) && styles.buttonDisabled,
              ]}
              onPress={() => updateDevice(3, !emergencyOn)}
            >
              <Text style={styles.emergencyButtonText}>
                {!bleConnected ? 'CONECTE O ESP32' : busyDevices.includes(3) ? 'ENVIANDO...' : emergencyOn ? 'DESATIVAR ALERTA' : 'ACIONAR ALERTA'}
              </Text>
            </TouchableOpacity>
          </View>

          {!bleConnected && (
            <Text style={styles.connectionHint}>Conecte o ESP32 para habilitar os controles.</Text>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Monitoramento</Text>
              <Text style={styles.sectionDescription}>Leituras recebidas diretamente da placa</Text>
            </View>
            <View style={styles.waitingBadge}>
              <View style={[styles.connectionDot, { backgroundColor: sensorStatus === 'Atualizado' ? COLORS.green : '#64748b' }]} />
              <Text style={styles.waitingText}>{sensorStatus}</Text>
            </View>
          </View>

          <SensorCard
            icon="°"
            number="04"
            title="Temperatura"
            description="Leitura do sensor LM35"
            value={showValue(sensorData.temperature)}
            unit="°C"
          />

          <SensorCard
            icon="◉"
            number="05"
            title="Detecção de gás"
            description="Leitura bruta (ADC 0-4095) do MQ-5"
            value={showValue(sensorData.gas)}
            unit="ADC"
          />

          <View style={styles.infoBox}>
            <View style={styles.infoIcon}><Text style={styles.infoIconText}>i</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoText}>
                Os valores são recebidos por Bluetooth. Para aparecerem corretamente, o ESP32 precisa ler os sensores e enviar os dados em formato JSON.
              </Text>
              {lastUpdate && (
                <Text style={styles.lastUpdate}>Última leitura: {lastUpdate.toLocaleTimeString('pt-BR')}</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerBrand}>Auto<Text style={styles.brandOrange}>Kitchen</Text></Text>
          <Text style={styles.footerDescription}>Tecnologia e cuidado no ambiente doméstico.</Text>
          <Text style={styles.footerVersion}>PAINEL DE CONTROLE · BLUETOOTH BLE</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingBottom: 28 },
  header: {
    minHeight: 82, paddingHorizontal: 20, paddingVertical: 15,
    backgroundColor: COLORS.header, borderBottomWidth: 1, borderBottomColor: '#202020',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  logo: {
    width: 42, height: 42, borderRadius: 9, backgroundColor: COLORS.orange,
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  logoText: { color: COLORS.white, fontSize: 17, fontWeight: '900' },
  brandName: { color: COLORS.white, fontSize: 19, fontWeight: '800', letterSpacing: -0.5 },
  brandOrange: { color: COLORS.orange },
  brandSubtitle: { color: COLORS.secondary, fontSize: 8, letterSpacing: 1.4, marginTop: 4 },
  connectionBadge: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 7,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 20,
  },
  connectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#64748b', marginRight: 6 },
  connectionText: { color: COLORS.secondary, fontSize: 11 },
  hero: { paddingHorizontal: 22, paddingTop: 34, paddingBottom: 26 },
  sectionLabel: { color: COLORS.orange, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 15 },
  heroTitle: { color: COLORS.white, fontSize: 35, lineHeight: 43, fontWeight: '800', letterSpacing: -1 },
  orangeText: { color: COLORS.orange },
  heroDescription: { color: COLORS.secondary, fontSize: 14, lineHeight: 22, marginTop: 14 },
  summary: {
    marginHorizontal: 20, marginBottom: 34, paddingVertical: 18, paddingHorizontal: 5,
    borderRadius: 12, backgroundColor: COLORS.card, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-around',
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNumber: { color: COLORS.orange, fontSize: 23, fontWeight: '800' },
  summaryLabel: { color: COLORS.secondary, fontSize: 11, marginTop: 5 },
  summaryDivider: { width: 1, height: 35, backgroundColor: COLORS.border },
  section: { paddingHorizontal: 20, marginBottom: 34 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 17 },
  sectionTitle: { color: COLORS.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  sectionDescription: { color: COLORS.secondary, fontSize: 12, marginTop: 5 },
  sectionTag: { backgroundColor: '#302015', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
  sectionTagText: { color: COLORS.orange, fontSize: 11, fontWeight: '800' },
  bluetoothTag: { backgroundColor: '#302015', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
  bluetoothTagText: { color: COLORS.orange, fontSize: 11, fontWeight: '800' },
  bluetoothCard: {
    backgroundColor: COLORS.card, borderRadius: 12, padding: 18,
    borderWidth: 1, borderColor: '#273449', alignItems: 'center',
  },
  bluetoothIcon: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: '#3a291c',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  bluetoothIconText: { color: COLORS.orange, fontSize: 30, fontWeight: '800' },
  bluetoothTitle: { color: COLORS.white, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  bluetoothDescription: { color: COLORS.secondary, fontSize: 12, lineHeight: 19, marginTop: 7, marginBottom: 15, textAlign: 'center' },
  bluetoothButton: { backgroundColor: COLORS.orange, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 9, alignItems: 'center', width: '100%' },
  bluetoothButtonText: { color: COLORS.white, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  disconnectButton: { backgroundColor: '#334155', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 9, alignItems: 'center', width: '100%' },
  disconnectButtonText: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  controlCard: { backgroundColor: COLORS.card, borderRadius: 12, padding: 17, marginBottom: 13, borderWidth: 1, borderColor: '#273449' },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  controlIcon: {
    width: 47, height: 47, borderRadius: 10, backgroundColor: '#3a291c',
    alignItems: 'center', justifyContent: 'center', marginRight: 13,
  },
  controlIconText: { color: COLORS.orange, fontSize: 28, fontWeight: '700' },
  cardInfo: { flex: 1 },
  eyebrow: { color: COLORS.orange, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 5 },
  cardTitle: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  cardDescription: { color: COLORS.secondary, fontSize: 11, lineHeight: 17, marginTop: 5 },
  separator: { height: 1, backgroundColor: COLORS.border, marginTop: 17, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stateRow: { flexDirection: 'row', alignItems: 'center' },
  stateDot: { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  stateText: { fontSize: 12, fontWeight: '600' },
  emergencyCard: { backgroundColor: COLORS.card, borderRadius: 12, padding: 17, borderWidth: 1, borderColor: '#273449' },
  emergencyCardActive: { borderColor: COLORS.red },
  emergencyIcon: { width: 47, height: 47, borderRadius: 10, backgroundColor: '#40201e', justifyContent: 'center', alignItems: 'center', marginRight: 13 },
  emergencyIconText: { color: COLORS.red, fontSize: 28, fontWeight: '900' },
  emergencyButton: { backgroundColor: COLORS.orange, minHeight: 45, borderRadius: 7, marginTop: 18, justifyContent: 'center', alignItems: 'center' },
  emergencyButtonActive: { backgroundColor: '#991b1b' },
  buttonDisabled: { opacity: 0.6 },
  emergencyButtonText: { color: COLORS.white, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  connectionHint: { color: COLORS.secondary, fontSize: 11, textAlign: 'center', marginTop: 12 },
  waitingBadge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 7 },
  waitingText: { color: COLORS.secondary, fontSize: 10 },
  sensorCard: { width: '100%', backgroundColor: COLORS.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#273449', marginBottom: 12 },
  sensorHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  sensorIcon: { color: COLORS.orange, fontSize: 21, fontWeight: '800', marginRight: 7 },
  sensorNumber: { color: COLORS.secondary, fontSize: 8, fontWeight: '800', letterSpacing: 0.7, flexShrink: 1 },
  sensorTitle: { color: COLORS.white, fontSize: 13, fontWeight: '700', minHeight: 32 },
  sensorValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  sensorValue: { color: COLORS.white, fontSize: 29, fontWeight: '800' },
  sensorUnit: { color: COLORS.orange, fontSize: 13, fontWeight: '700', marginLeft: 4 },
  sensorDescription: { color: COLORS.secondary, fontSize: 10, lineHeight: 15, marginTop: 9 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#171717', borderWidth: 1, borderColor: '#343434', borderRadius: 9, padding: 13, marginTop: 12 },
  infoIcon: { width: 19, height: 19, borderRadius: 10, borderWidth: 1, borderColor: COLORS.orange, alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1 },
  infoIconText: { color: COLORS.orange, fontSize: 12, fontWeight: '800' },
  infoText: { color: COLORS.secondary, fontSize: 11, lineHeight: 17 },
  lastUpdate: { color: COLORS.orange, fontSize: 10, marginTop: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 8, alignItems: 'center' },
  footerLine: { width: '100%', height: 1, backgroundColor: '#272727', marginBottom: 22 },
  footerBrand: { color: COLORS.white, fontSize: 17, fontWeight: '800' },
  footerDescription: { color: COLORS.secondary, fontSize: 11, marginTop: 7, textAlign: 'center' },
  footerVersion: { color: '#64748b', fontSize: 9, letterSpacing: 1, marginTop: 17, textAlign: 'center' },
});