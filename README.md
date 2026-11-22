# AutoKitchen

Aplicativo para monitorar e controlar dispositivos de uma cozinha inteligente por Bluetooth BLE. O app se comunica diretamente com um ESP32 para controlar a iluminação, a janela e o alerta de emergência, além de exibir leituras de temperatura e gás.

Projeto de TCC — desenvolvimento de um sistema de automação e monitoramento residencial.

| Camada | Tecnologias |
| --- | --- |
| Aplicativo | React Native · Expo SDK 54 · JavaScript |
| Interface | React Native · StyleSheet · Expo Status Bar |
| Comunicação | Bluetooth Low Energy (BLE) · `react-native-ble-plx` · Buffer |
| Hardware de referência | ESP32 · LM35 · MQ-5 · servo motor |

## Estrutura do projeto

```text
Autokitchen/
├── .gitignore
└── app-tcc/
    ├── App.js
    ├── index.js
    ├── app.json
    ├── eas.json
    ├── package.json
    ├── package-lock.json
    ├── assets/
    ├── components/
    │   └── AssetExample.js
    └── android/
        └── app/
            └── build/
                └── outputs/
                    └── apk/
                        └── release/
                            └── app-release.apk

    O mais sobre o caminho é ilustrativo. O APK de release é um artefato de build e,, normalmente não é versionado no Git.

Funcionalidades

    Busca e ligação BLE com o ESP32 AutoKitchen.
    Controle da Insinluição.
    Abertura e fechamento da por janela servo motor.
    Ativação e desativação do alerta de emergência.
    Exibição de leitura e leitura bruta do sensor de gás.
    da interface de atualização com o estado dos dispositivos e honário da última leitura.
    Indicação do estado da ligação e da dos sensores de leitura.

Como cons
Pré-requisitos

    Node.js e npm.
    Android Studio, Android SDK e Java para compilador localmente.
    Um dispositivo Android com Bluetooth BLE.
    ESP32 para anunciaro o configurar e como serviço BLE características do AutoKitchen.

Instalação

Clone o e entre na massa do aplicativo:

git clone https://github.com/DevKauansinho/Autokitchen.git
cd Autokitchen/app-tcc
npm install

Conecte um dispositivo Android com depuração USB habilitada ou inicie um emulador e executar:

npm run android

    O aplicativo EUA react-native-ble-plx, que depende de nativo. Por isso, o Bluetooth BLE zoom no Expo Go; use uma Android, como compilação npm run androidou o APK de release.

Baixar o APK

Baixar APK para Android

    Nota: se o arquivo não és não, gere um novo com available o EAS Build (veja a seque abaixo).

Gerar um APK com EAS Build

Instalação e autentique o EAS CLI:

npm install -g eas-cli
eas login

Na massa app-tcc, executar o perfil preview, para gerar um configurado APK:

eas build --platform android --profile preview

Comunicação BLE

O aplicativo procura um dispositivo com o nome AutoKitchenou que anuncie o serviço.
Tipo	UUID	Função
Serviço	6e400001-b5a3-f393-e0a9-e50e24dcca9e	Serviço BLE do AutoKitchen
RX	6e400002-b5a3-f393-e0a9-e50e24dcca9e	Receber aplicativos do
TX	6e400003-b5a3-f393-e0a9-e50e24dcca9e	Envia dados de notificações ao aplicativo

Os comandos enviados são texto terminado, por quebra de linha (\n):
Dispositivo	Formato do comando
Iluminação	LIGHT:0você LIGHT:1
Janela	WINDOW:0você WINDOW:1
Alerta	ALERT:0você ALERT:1

A característica TX deve dados enviados JSON terminados por quebra de linha. Exemplo:

{
  "temperature": 25.4,
  "gas": 820,
  "luz": 1,
  "alerta": 0,
  "janela": 1
}

Campos aplicativo pelo reconhecidos:

    : Temperatura temperature, temperatura, tempvocê lm35.
    Gás: gas, nivel_gasvocê mq5.
    Estados: luz, alertae janela, utilizando 1para stugado/aberto/ativo e 0para/fechado/inativo.

A leitura do MQ-5 é como valor do ADC (0-4095). Uma versão para concentração de depende da calibração e do firmware do ESP32.
Observações

    O aplicativo se comunica diretamente com o ESP32; este projeto não uso API nem backend.
    Ativo o Bluetooth do celular e solicitado como permissões pelo Android.
    O ESP32 implementar o protocolo BLE e enviar os dados dos sensores no formato de espera.
    O arquivo APK é um artefato de compilação; o-fonte do aplicativo está em app-tcc/.

Licença

Este projeto está sob licença a MIT. Remoção esta selo caso não se aplique.
Autor

Desenvolvido por DevKauansinhoDevKauansinho como projeto de TCC.
